import { readLegacyProvenance } from './legacy.mjs';
import { verifiedBuildClosure, verifiedCandidateClosure } from './lifecycle.mjs';
import { readGuardedRecords } from './archive.mjs';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { probePaths, processSnapshot, requireHeldLease, requirePlainPath, resolveMaintenanceHome } from './guard.mjs';
import {
  absolutePath, assertNarrowRoot, isBuildName, isReleaseId, localHomes, maintenancePolicy,
  pathInMaintenanceHome, pathKey, refusal, relativeWithin,
} from './policy.mjs';

const execute = promisify(execFile);
const taskIdIsValid = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,89}$/i.test(id);
const pidIsValid = pid => Number.isInteger(pid) && pid > 0 && pid <= 0xffffffff;
const isDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(date) && Number.isFinite(Date.parse(date));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readJson(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink !== 1) throw refusal('The maintenance record is not a plain file');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function validateTask(record) {
  if (!isObject(record) || !taskIdIsValid(record.id) || !['active', 'closed'].includes(record.status) ||
      !Object.hasOwn(record, 'result') || !Object.hasOwn(record, 'commit') ||
      (record.commit !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(record.commit)) ||
      typeof record.dirty !== 'boolean' || (record.commit === null && !record.dirty) ||
      (record.pid !== null && !pidIsValid(record.pid)) ||
      (record.pid === null ? record.processStartedAt !== null : !isDate(record.processStartedAt)) ||
      !Array.isArray(record.pins) || record.pins.some(pin => typeof pin !== 'string' || !pin.trim())) {
    throw refusal('The task record is incomplete');
  }
  assertNarrowRoot(record.worktree);
  for (const file of [record.build, record.candidate]) if (file !== null) assertNarrowRoot(file);
  if (record.detachedBuild != null) assertNarrowRoot(record.detachedBuild);
  if (record.closedCandidates != null && (!Array.isArray(record.closedCandidates) ||
      record.closedCandidates.some(id => !isReleaseId(id)) ||
      new Set(record.closedCandidates).size !== record.closedCandidates.length)) {
    throw refusal('Invalid closed candidate identities');
  }
  if (record.closedBuilds != null) {
    if (!Array.isArray(record.closedBuilds)) throw refusal('Invalid closed build records');
    for (const subject of record.closedBuilds) {
      assertNarrowRoot(subject?.source);
      if (!isBuildName(subject?.dist)) throw refusal('Invalid closed build directory');
    }
  }
}

export async function readTask(home, id) {
  if (!taskIdIsValid(id)) throw refusal('Invalid task identity');
  const file = path.join(home, 'maintenance-state', 'tasks', id + '.json');
  const [status] = await probePaths([file]);
  if (status === 'missing') return null;
  if (status !== 'plain') throw refusal('The task record cannot be verified');
  const record = await readJson(file);
  validateTask(record);
  if (record.id !== id) throw refusal('The task record has a different identity');
  return record;
}

export async function updateTask(home, lease, record) {
  validateTask(record);
  const json = JSON.stringify(record, null, 2) + '\n';
  home = await requireHeldLease(home, lease);
  const directory = path.join(home, 'maintenance-state', 'tasks');
  const [status] = await probePaths([directory]);
  if (status === 'missing') {
    await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  await requirePlainPath(directory);
  const target = path.join(directory, record.id + '.json');
  const [existing] = await probePaths([target]);
  if (existing === 'unverified' || (existing === 'plain' && !(await fs.lstat(target)).isFile())) {
    throw refusal('The existing task record cannot be verified');
  }
  const temp = path.join(directory, '.' + randomUUID() + '.tmp');
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(json);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await requireHeldLease(home, lease);
    await fs.rename(temp, target);
  } finally {
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function git(root, ...args) {
  const { stdout } = await execute('git', ['-C', root, '-c', 'core.fsmonitor=false', ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 20000, windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, encoding: 'utf8',
  });
  return stdout;
}

function referencedByProcess(process, file) {
  if (process.executable) {
    try {
      if (relativeWithin(file, process.executable) !== null) return true;
    } catch {
      // An unrelated executable can use a device path.
    }
  }
  if (!process.commandLine) return false;
  const command = process.commandLine.replaceAll('\\', '/').toLowerCase();
  const needle = file.replaceAll('\\', '/').toLowerCase();
  for (let start = command.indexOf(needle); start >= 0; start = command.indexOf(needle, start + 1)) {
    const before = command[start - 1] ?? ' ';
    const after = command[start + needle.length] ?? ' ';
    if (/[\s"'=]/.test(before) && /[\s"'\/,;]/.test(after)) return true;
  }
  return false;
}

function windowsSavedStart(processStartedAt) {
  const old = typeof processStartedAt === 'string' && /^\/Date\((-?\d+)\)\/$/.exec(processStartedAt);
  if (!old) return processStartedAt;
  const parsed = new Date(Number(old[1]));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function savedProcess(row, pid, start) {
  if (!pidIsValid(pid) || !isDate(start)) return 'unknown';
  if (!row) return 'exited';
  if (!isDate(row.processStartedAt)) return 'unknown';
  if (row.processStartedAt === start || Date.parse(row.processStartedAt) === Date.parse(start)) return 'live';
  return Date.parse(row.processStartedAt) > Date.parse(start) ? 'reused' : 'unknown';
}

function needsOperationBinding(proc) {
  if (!/^node(?:-[a-f0-9]+)?(?:\.exe)?$/i.test(proc.name ?? '')) return false;
  if (!proc.commandLine) return true;
  const args = proc.commandLine.match(/"[^"]*"|[^\s"]+/g)?.slice(1).map(arg => arg.replace(/^"|"$/g, '')) ?? [];
  const evaluate = args.findIndex(arg => /^(?:-e|-p|--eval|--print)(?:=|$)/.test(arg));
  return args.some((arg, index) => {
    if (evaluate !== -1 && evaluate < index) return false;
    const script = path.basename(arg);
    if (/^next(?:\.cmd)?$/i.test(script)) return !path.isAbsolute(arg) && /^(?:build|start|dev)$/.test(args[index + 1]);
    if (/^server\.js$/i.test(script)) return !path.isAbsolute(arg);
    if (/^local-system-(?:build|package|launch|backup|restore)\.mjs$/i.test(script)) return !path.isAbsolute(arg);
    return /^npm(?:-cli\.js|\.cmd)?$/i.test(script) && args.slice(index + 1).includes('build');
  });
}

export async function readInventory({ home, repoRoots = [], pinnedTarget = null, coordinatorLease } = {}) {
  const inventory = {
    at: new Date().toISOString(), current: null, acceptedReleases: [], tasks: [],
    artifacts: [], processes: [], uncertainties: [], freeBytes: null,
  };
  const items = new Map();
  const protection = (item, reason) => {
    if (item && !item.protectedBy.includes(reason)) {
      item.protectedBy.push(reason);
      item.status = 'PROTECTED';
    }
  };
  const add = (id, kind, file, extra = {}) => {
    const artifact = { id, kind, path: file, taskId: null, bytes: null, status: 'UNCLASSIFIED', protectedBy: [], fingerprint: null, ...extra };
    items.set(id, artifact);
    return artifact;
  };
  const uncertain = (scope, reason, item) => {
    inventory.uncertainties.push({ scope, reason });
    protection(item, reason);
  };
  const statuses = async paths => {
    try {
      return await probePaths(paths);
    } catch {
      return paths.map(() => 'unverified');
    }
  };
  const entries = async (directory, scope) => {
    const [state] = await statuses([directory]);
    if (state === 'missing') return [];
    try {
      if (state !== 'plain') throw refusal('Unverified directory');
      return (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      uncertain(scope, 'directory-unavailable');
      return [];
    }
  };
  const recordBytes = async (paths, checks) => {
    if (process.platform !== 'win32') return null;
    try {
      return await readGuardedRecords(paths.filter((_, index) => checks[index] === 'plain'), pinnedTarget);
    } catch {
      return new Map();
    }
  };
  const decodeRecord = async (file, guarded) => {
    if (!guarded) return readJson(file);
    const bytes = guarded.get(file);
    if (!bytes) throw refusal('Unverified record');
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  };
  const jsonRecord = async (file, scope, state, guarded) => {
    if (state === 'missing') return null;
    try {
      if (state !== 'plain') throw refusal('Unverified record');
      return await decodeRecord(file, guarded);
    } catch {
      uncertain(scope, 'record-unavailable');
      return null;
    }
  };

  try {
    home = await resolveMaintenanceHome({ explicitHome: home });
  } catch {
    uncertain('home', 'home-unavailable');
    return inventory;
  }
  if (coordinatorLease) await requireHeldLease(home, coordinatorLease);
  try {
    const stats = await fs.statfs(home, { bigint: true });
    const free = stats.bavail * stats.bsize;
    if (free < 0n || free > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid capacity');
    inventory.freeBytes = Number(free);
  } catch {
    uncertain('home', 'free-space-unavailable');
  }

  const currentFile = path.join(home, 'current.json');
  const previousFile = path.join(home, 'previous.json');
  const pointerFiles = [currentFile, previousFile];
  const pointerChecks = await statuses(pointerFiles);
  const [currentState, previousState] = pointerChecks;
  const pointerBytes = await recordBytes(pointerFiles, pointerChecks);
  const current = await jsonRecord(currentFile, 'current', currentState, pointerBytes);
  const previous = await jsonRecord(previousFile, 'previous', previousState, pointerBytes);
  inventory.pointerFingerprint = createHash('sha256').update(JSON.stringify([current, previous])).digest('hex');
  const currentId = isReleaseId(current?.releaseId) ? current.releaseId : null;
  const previousIds = [
    current?.previousId, previous?.releaseId, previous?.previousId,
  ].filter(isReleaseId);
  if (currentId) {
    inventory.current = {
      releaseId: currentId, previousId: isReleaseId(current.previousId) ? current.previousId : null,
      pid: pidIsValid(current.pid) ? current.pid : null, startedAt: isDate(current.startedAt) ? current.startedAt : null,
    };
  } else if (currentState !== 'missing') {
    uncertain('current', 'current-release-unverified');
  }
  if ((current?.previousId != null && !isReleaseId(current.previousId)) ||
      (previousState === 'plain' && !isReleaseId(previous?.releaseId))) {
    uncertain('previous', 'previous-release-unverified');
  }

  const worktrees = new Map();
  for (const repo of repoRoots) {
    try {
      const root = assertNarrowRoot(repo);
      await requirePlainPath(root);
      const rows = (await git(root, 'worktree', 'list', '--porcelain', '-z')).split('\0');
      let record;
      for (const row of rows) {
        if (row.startsWith('worktree ')) {
          const file = assertNarrowRoot(row.slice(9));
          record = { path: file, commit: null };
          worktrees.set(pathKey(file), record);
        } else if (row.startsWith('HEAD ') && record) {
          record.commit = row.slice(5);
        }
      }
      if (!worktrees.size) throw refusal('No worktrees returned by Git');
    } catch {
      uncertain('worktrees', 'worktree-list-unavailable');
    }
  }
  const registered = [...worktrees.values()];
  inventory.worktrees = registered;
  const manifests = new Map();
  for (const [directory, kind] of [['releases', 'release'], ['releases-rejected', 'rejected-release']]) {
    const parent = path.join(home, directory);
    const children = await entries(parent, directory);
    const candidates = children.map(entry => path.join(parent, entry.name));
    // Only plausible release identifiers ever get a manifest read.
    const readable = children.filter(entry => isReleaseId(entry.name) && entry.isDirectory());
    const manifestFiles = readable.map(entry => path.join(parent, entry.name, 'release.json'));
    const checked = await statuses(manifestFiles);
    const guarded = await recordBytes(manifestFiles, checked);
    const checks = new Map(readable.map((entry, index) => [entry.name, checked[index]]));
    for (const [index, entry] of children.entries()) {
      const artifact = add(kind + ':' + entry.name, kind, candidates[index]);
      try {
        if (checks.get(entry.name) !== 'plain') throw refusal('Missing or unverified release manifest');
        const release = await decodeRecord(path.join(artifact.path, 'release.json'), guarded);
        if (release?.id !== entry.name ||
            pathKey(pathInMaintenanceHome(home, release.root)) !== pathKey(artifact.path)) {
          throw refusal('The release manifest does not match its directory');
        }
        const dependencyRoot = pathInMaintenanceHome(home, release.dependencyRoot);
        const nodeExe = pathInMaintenanceHome(home, release.nodeExe);
        if (pathKey(path.dirname(dependencyRoot)) !== pathKey(path.join(home, 'dependencies')) ||
            pathKey(path.dirname(nodeExe)) !== pathKey(path.join(home, 'runtime'))) {
          throw refusal('The release runtime is outside the managed directories');
        }
        if (kind === 'release') {
          const createdAt = isDate(release.createdAt) ? release.createdAt : null;
          if (release.acceptedAt != null) {
            protection(artifact, 'manifest-timestamp-is-not-acceptance');
          }
          manifests.set(entry.name, {
            id: entry.name, path: artifact.path, dependencyRoot, nodeExe, createdAt, acceptedAt: null,
            dist: release.dist, buildId: release.buildId, dependencyLockSha256: release.dependencyLockSha256,
            nodeSha256: release.nodeSha256,
            ocrAssets: release.ocrAssets ?? null,
            runtimeVerified: false,
          });
        }
      } catch {
        uncertain(artifact.id, 'manifest-unverified', artifact);
      }
    }
  }

  inventory.releaseManifests = [...manifests.values()];
  let historical;
  try {
    historical = await readLegacyProvenance(home, registered, manifests, pinnedTarget);
    inventory.legacyFingerprint = historical.hash;
    for (const [id, provenance] of historical.releases) {
      manifests.get(id).acceptedAt = provenance.acceptedAt;
      const artifact = items.get('release:' + id);
      artifact.provenance = provenance;
      artifact.protectedBy = artifact.protectedBy.filter(reason => reason !== 'manifest-timestamp-is-not-acceptance');
      if (!artifact.protectedBy.length) artifact.status = 'UNCLASSIFIED';
    }
    for (const entry of historical.builds.values()) {
      const artifact = add('build:' + pathKey(entry.path), 'build', entry.path, { ...entry, historicalSnapshot: true });
      if (registered.some(tree => relativeWithin(artifact.path, tree.path) !== null)) {
        protection(artifact, 'contains-registered-worktree');
      }
    }
    for (const entry of historical.unknownSnapshots) {
      const item = add('snapshot:' + pathKey(entry.path), 'snapshot', entry.path, entry);
      protection(item, 'legacy-provenance-not-proven');
    }
  } catch {
    uncertain('history', 'legacy-provenance-unverified');
  }

  const receipts = [...manifests.values()].filter(release => release.acceptedAt).map(release => release.id);
  const accepted = new Set([...(currentId ? [currentId] : []), ...previousIds, ...receipts]);
  for (const id of manifests.keys()) {
    if (!accepted.has(id)) protection(items.get('release:' + id), 'acceptance-evidence-unverified');
  }
  const acceptedRecords = [...accepted].flatMap(id => manifests.has(id) ? [manifests.get(id)] : []);
  for (const id of accepted) if (!manifests.has(id)) uncertain('release:' + id, 'accepted-release-missing');
  const requirements = release => [
    release.nodeExe, release.dependencyRoot, path.join(release.dependencyRoot, 'node_modules'), path.join(release.path, 'node_modules'),
  ];
  const files = [...new Map(acceptedRecords.flatMap(requirements).map(file => [pathKey(file), file])).values()];
  const states = await statuses(files);
  const runtimeMetadata = new Map();
  for (const [index, file] of files.entries()) {
    if (states[index] === 'plain') {
      try {
        runtimeMetadata.set(pathKey(file), await fs.lstat(file));
      } catch { /* An unreadable runtime cannot fill a retention slot. */ }
    }
  }
  for (const release of acceptedRecords) {
    const [node, ...directories] = requirements(release).map(file => runtimeMetadata.get(pathKey(file)));
    release.runtimeVerified = Boolean(node?.isFile() && node.size > 0 && directories.every(stats => stats?.isDirectory()));
    if (!release.runtimeVerified) {
      const id = 'release:' + release.id;
      uncertain(id, 'runtime-unverified', items.get(id));
    }
  }
  const byAcceptance = (a, b) => {
    if (!a.acceptedAt) return b.acceptedAt ? 1 : 0;
    if (!b.acceptedAt) return -1;
    return Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt);
  };
  const prior = acceptedRecords.filter(release => release.id !== currentId).sort(byAcceptance);
  const workingPrior = prior.filter(release => release.acceptedAt && release.runtimeVerified);
  const retained = workingPrior.slice(0, maintenancePolicy.protectedPreviousReleases);
  const cutoff = retained.at(-1)?.acceptedAt;
  const ties = cutoff ? workingPrior.slice(retained.length).filter(release => Date.parse(release.acceptedAt) === Date.parse(cutoff)) : [];
  inventory.acceptedReleases = [
    ...acceptedRecords.filter(release => release.id === currentId), ...workingPrior,
    ...prior.filter(release => !workingPrior.includes(release)),
  ];
  if (manifests.size && (!currentId ||
      (workingPrior.length < maintenancePolicy.protectedPreviousReleases &&
        [...manifests.keys()].some(id => id !== currentId && !workingPrior.some(release => release.id === id))))) {
    uncertain('previous', 'accepted-history-incomplete');
  }

  const activeReleaseIds = new Set([...(currentId ? [currentId] : []), ...previousIds, ...[...retained, ...ties].map(release => release.id)]);
  for (const id of activeReleaseIds) {
    const release = manifests.get(id);
    const artifact = items.get('release:' + id);
    protection(artifact, id === currentId ? 'current-release' : 'previous-release');
    if (!release) continue;
    const related = [['dependency', release.dependencyRoot], ['runtime', release.nodeExe]];
    for (const [kind, file] of related) {
      const key = kind + ':' + path.basename(file);
      const item = items.get(key) ?? add(key, kind, file);
      protection(item, 'release:' + id);
      const metadata = runtimeMetadata.get(pathKey(file));
      if (kind === 'runtime' ? metadata?.isFile() : metadata?.isDirectory()) {
        if (metadata.isFile()) item.bytes = metadata.size;
      } else {
        uncertain(item.id, 'runtime-unverified', item);
        protection(artifact, 'runtime-unverified');
      }
    }
  }

  const taskDirectory = path.join(home, 'maintenance-state', 'tasks');
  const taskEntries = (await entries(taskDirectory, 'tasks')).filter(entry => entry.name.endsWith('.json'));
  const taskPaths = taskEntries.map(entry => path.join(taskDirectory, entry.name));
  const safeTaskPaths = await statuses(taskPaths);
  const guardedTasks = await recordBytes(taskPaths, safeTaskPaths);
  for (const [index, entry] of taskEntries.entries()) {
    const id = entry.name.slice(0, -5);
    const record = await jsonRecord(taskPaths[index], 'tasks', safeTaskPaths[index], guardedTasks);
    if (!isObject(record) || record.id !== id || !taskIdIsValid(id)) {
      uncertain('tasks', 'task-identity-unverified');
      continue;
    }
    try {
      validateTask(record);
    } catch {
      uncertain('task:' + id, 'task-record-unverified');
    }
    inventory.tasks.push(record);
  }

  for (const task of inventory.tasks) {
    if (task.status !== 'closed' ||
        inventory.uncertainties.some(item => item.scope === 'task:' + task.id)) continue;
    for (const id of task.closedCandidates ?? []) {
      const manifest = manifests.get(id);
      if (!manifest || accepted.has(id)) continue;
      try {
        const closed = await verifiedCandidateClosure(home, manifest, task, pinnedTarget);
        if (!closed) continue;
        const candidate = items.get('release:' + id);
        candidate.provenance = { closedAt: closed.closedAt, dependencyRoot: manifest.dependencyRoot, evidence: closed.evidence };
        candidate.protectedBy = candidate.protectedBy.filter(reason => reason !== 'acceptance-evidence-unverified');
        if (!candidate.protectedBy.length) candidate.status = 'UNCLASSIFIED';
      } catch { /* Changed or missing closure evidence cannot authorize retirement. */ }
    }
    const tree = worktrees.get(pathKey(task.worktree));
    if (!tree) continue;
    for (const subject of task.closedBuilds ?? []) {
      try {
        const target = path.join(subject.source, subject.dist), id = 'build:' + pathKey(target);
        if ((await statuses([target]))[0] !== 'plain' || !(await fs.lstat(target)).isDirectory()) continue;
        const existing = items.get(id);
        if (existing?.provenance?.packageVerified) continue;
        const provenance = await verifiedBuildClosure(home, subject, task);
        if (!provenance) continue;
        if (existing) Object.assign(existing, { provenance, taskId: task.id });
        else add(id, 'build', target, { provenance, taskId: task.id, root: subject.source, historicalSnapshot: true,
          worktree: tree.path, commit: tree.commit });
      } catch { /* Untrusted or changed evidence does not release the build. */ }
    }
  }

  const worktreeChecks = await statuses(registered.map(worktree => worktree.path));
  for (const [index, tree] of registered.entries()) {
    const id = 'worktree:' + pathKey(tree.path);
    const worktree = add(id, 'worktree', tree.path, { commit: tree.commit, dirty: null });
    protection(worktree, 'registered-worktree');
    if (worktreeChecks[index] !== 'plain') {
      uncertain(id, 'worktree-path-unverified', worktree);
      continue;
    }
    try {
      const top = (await git(tree.path, 'rev-parse', '--show-toplevel')).trim();
      if (pathKey(top) !== pathKey(tree.path)) throw refusal('Git root differs');
      worktree.dirty = Boolean(await git(tree.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all'));
    } catch {
      uncertain(id, 'worktree-status-unavailable', worktree);
    }
    if (worktree.dirty) protection(worktree, 'dirty-worktree');
    const builds = (await entries(tree.path, id)).filter(entry => isBuildName(entry.name));
    const buildPaths = builds.map(build => path.join(tree.path, build.name));
    const buildChecks = await statuses(buildPaths);
    for (const [buildIndex, file] of buildPaths.entries()) {
      const artifact = add('build:' + pathKey(file), 'build', file, { worktree: tree.path, commit: tree.commit });
      if (worktree.dirty === null) protection(artifact, 'worktree-status-unavailable');
      else if (worktree.dirty) protection(artifact, 'dirty-worktree');
      if (buildChecks[buildIndex] !== 'plain' || !builds[buildIndex].isDirectory()) {
        uncertain(artifact.id, 'build-path-unverified', artifact);
      }
    }
  }

  let live = [];
  let processesKnown = true;
  try {
    live = await processSnapshot();
  } catch {
    processesKnown = false;
    uncertain('processes', 'process-enumeration-unavailable');
  }
  const processByPid = new Map(live.map(row => [row.pid, row]));
  const savedPids = new Set();
  const boundPids = new Set();
  const targetedPids = new Map();
  const confirmSavedProcess = async (pid, start) => {
    if (!processesKnown || !pidIsValid(pid) || !isDate(start)) return 'unknown';
    let row = processByPid.get(pid);
    if (!row) {
      if (!targetedPids.has(pid)) targetedPids.set(pid, processSnapshot(pid));
      try {
        [row] = await targetedPids.get(pid);
      } catch {
        return 'unknown';
      }
      if (row && !processByPid.has(pid)) {
        processByPid.set(pid, row);
        live.push(row);
      }
    }
    return savedProcess(row, pid, start);
  };
  if (inventory.current?.pid) {
    savedPids.add(inventory.current.pid);
    const state = await confirmSavedProcess(inventory.current.pid, windowsSavedStart(current.process?.CreationDate ?? current.processStartedAt));
    if (state === 'unknown') {
      uncertain('current', 'current-process-unverified', items.get('release:' + currentId));
    } else if (state === 'live') {
      boundPids.add(inventory.current.pid);
    }
  }
  for (const task of inventory.tasks) {
    const reason = 'task:' + task.id;
    const protects = task.status !== 'closed' || inventory.uncertainties.some(entry => entry.scope === reason);
    const { pid } = task;
    let state = 'exited';
    if (pid !== null) {
      if (pidIsValid(pid)) savedPids.add(pid);
      state = await confirmSavedProcess(pid, task.processStartedAt);
      if (state === 'unknown') uncertain(reason, 'task-process-unverified');
    }
    const references = [];
    for (const [field, kind] of [['worktree', 'worktree'], ['build', 'build'], ['candidate', 'release']]) {
      if (task[field] == null) continue;
      try {
        const raw = assertNarrowRoot(task[field]);
        const file = field === 'candidate' ? pathInMaintenanceHome(home, raw) : raw;
        let artifact = [...items.values()].find(item => pathKey(item.path) === pathKey(file));
        if (!artifact) {
          artifact = add('task-artifact:' + pathKey(file), kind, file);
          uncertain(artifact.id, 'task-artifact-unverified', artifact);
        }
        artifact.taskId ??= task.id;
        references.push({ file, field });
      } catch {
        uncertain(reason, 'task-path-unverified');
      }
    }
    for (const artifact of items.values()) {
      const matching = references.some(({ file, field }) => {
        if (field === 'worktree' && artifact.historicalSnapshot &&
            pathKey(file) === pathKey(artifact.worktree) && worktrees.has(pathKey(file))) {
          if (artifact.taskId !== task.id) return false;
          if (artifact.provenance?.managedTask === task.id && artifact.provenance?.packageVerified &&
              task.detachedBuild && pathKey(task.detachedBuild) === pathKey(artifact.path)) return false;
        }
        return relativeWithin(artifact.path, file) !== null || relativeWithin(file, artifact.path) !== null;
      });
      if (matching && (protects || state === 'live' || state === 'unknown')) protection(artifact, reason);
      const pins = Array.isArray(task.pins) ? task.pins : [];
      for (const pin of pins) {
        if (pin === artifact.id) {
          protection(artifact, 'pin:' + task.id);
        } else if (typeof pin === 'string' && path.isAbsolute(pin)) {
          try {
            let pinned = absolutePath(pin);
            try { pinned = pathInMaintenanceHome(home, pinned); } catch { /* A worktree pin can be external. */ }
            if (relativeWithin(artifact.path, pinned) !== null || relativeWithin(pinned, artifact.path) !== null) {
              protection(artifact, 'pin:' + task.id);
            }
          } catch {
            protection(artifact, 'task-pin-unverified');
          }
        }
      }
    }
    if (state === 'live' && references.length) boundPids.add(pid);
  }

  const { logical, physical } = localHomes();
  const useAlias = pathKey(home) === pathKey(physical) && pathKey(logical) !== pathKey(physical);
  let unboundOperation = false;
  for (const proc of live) {
    if (coordinatorLease && proc.pid === process.pid) continue;
    const matches = [];
    for (const artifact of items.values()) {
      const relative = useAlias ? relativeWithin(home, artifact.path) : null;
      const aliases = relative?.startsWith('..') || relative === null ? [artifact.path] : [artifact.path, path.join(logical, relative)];
      if (aliases.some(file => referencedByProcess(proc, file))) matches.push(artifact);
    }
    const bound = boundPids.has(proc.pid) || matches.some(item => ['build', 'release', 'rejected-release', 'worktree'].includes(item.kind));
    if (!bound && needsOperationBinding(proc)) {
      uncertain('process:' + proc.pid, 'process-path-unverified');
      unboundOperation = true;
    } else if (!matches.length && !savedPids.has(proc.pid)) {
      continue;
    }
    const related = new Set(matches.map(item => item.id));
    for (const tree of matches.filter(item => item.kind === 'worktree')) {
      for (const artifact of items.values()) {
        if (artifact.kind === 'build' && relativeWithin(tree.path, artifact.path) !== null) related.add(artifact.id);
      }
    }
    for (const id of related) protection(items.get(id), 'process:' + proc.pid);
    inventory.processes.push({ pid: proc.pid, processStartedAt: proc.processStartedAt, artifactIds: [...related] });
  }

  const incompleteTasks = inventory.uncertainties.some(entry => entry.scope === 'tasks' ||
    entry.reason === 'task-record-unverified' || entry.reason === 'task-path-unverified');
  const incompleteReleases = inventory.uncertainties.some(entry => entry.scope === 'current' || entry.scope === 'previous' ||
    entry.scope === 'releases' || entry.reason === 'accepted-release-missing');
  for (const item of items.values()) {
    if (!processesKnown) protection(item, 'process-enumeration-unavailable');
    if (inventory.uncertainties.some(entry => entry.scope === 'worktrees' || entry.scope === 'history')) {
      protection(item, 'operation-roots-unverified');
    }
    if (item.historicalSnapshot && items.get('worktree:' + pathKey(item.worktree))?.dirty === null) {
      protection(item, 'worktree-status-unavailable');
    }
    if (incompleteTasks) protection(item, 'task-registry-unverified');
    if (incompleteReleases && ['release', 'rejected-release'].includes(item.kind)) protection(item, 'release-history-unverified');
    if (unboundOperation && ['build', 'release', 'rejected-release'].includes(item.kind)) protection(item, 'process-path-unverified');
    if (item.kind !== 'worktree' && registered.some(tree => relativeWithin(item.path, tree.path) !== null)) {
      protection(item, 'contains-registered-worktree');
    }
  }
  inventory.artifacts = [...items.values()];
  return inventory;
}
