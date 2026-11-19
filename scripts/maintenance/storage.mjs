import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  catalogArchiveGroups, createVerifiedArchive, deleteArchivedTarget, measureArchiveTargets, nativeArchiveOperation,
  publishEvidenceArchive, readGuardedRecords, verifyArchive,
} from './archive.mjs';
import { probePaths, requireHeldLease, resolveMaintenanceHome, withLifecycleLock, withReservationGate } from './guard.mjs';
import { readInventory } from './inventory.mjs';
import { registerLegacyProvenance } from './legacy.mjs';
import { managedCacheProof } from './lifecycle.mjs';
import {
  artifactRoot, assertNarrowRoot, isBuildName, maintenancePolicy, pathInMaintenanceHome, pathKey, refusal,
} from './policy.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashIsValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validBytes = bytes => Number.isSafeInteger(bytes) && bytes >= 0;
const jobKinds = new Set(['build', 'release']);
const policyOptions = policy => ({ ...maintenancePolicy, ...policy });

function freshness(inventory, removed = new Set()) {
  const artifacts = inventory.artifacts.filter(item => !removed.has(item.id)).map(item => ({
    id: item.id, path: item.path, kind: item.kind, taskId: item.taskId, commit: item.commit,
    dirty: item.dirty, protectedBy: [...item.protectedBy].sort(), provenance: item.provenance,
  }));
  const releaseRemoved = item => removed.has('release:' + item.id);
  return digest({
    current: inventory.current, pointers: inventory.pointerFingerprint ?? null,
    accepted: inventory.acceptedReleases.filter(item => !releaseRemoved(item)),
    manifests: (inventory.releaseManifests ?? []).filter(item => !releaseRemoved(item)),
    artifacts, tasks: inventory.tasks, processes: inventory.processes, uncertainties: inventory.uncertainties,
    legacy: inventory.legacyFingerprint ?? null,
  });
}

function classified(inventory, policy) {
  const recentFailures = new Map();
  const oldestRecent = Date.parse(inventory.at) - policy.failedBuildRetentionMs;
  for (const item of inventory.artifacts) {
    if (item.kind !== 'build' || item.provenance?.outcome !== 'failed' ||
        Date.parse(item.provenance.at) < oldestRecent || !item.taskId) continue;
    const builds = recentFailures.get(item.taskId) ?? [];
    builds.push(item);
    recentFailures.set(item.taskId, builds);
  }
  const retainedFailures = new Set([...recentFailures.values()].flatMap(builds => builds
    .sort((a, b) => Date.parse(b.provenance.at) - Date.parse(a.provenance.at))
    .slice(0, policy.failedBuildsPerTask).map(item => item.id)));

  return inventory.artifacts.map(item => {
    const reasons = [...item.protectedBy];
    if (!jobKinds.has(item.kind)) {
      if (!reasons.length) reasons.push('outside-cleanup-policy');
    } else if (item.kind === 'release') {
      if (!item.provenance?.acceptedAt && !item.provenance?.closedAt) reasons.push('acceptance-not-proven');
    } else if (item.provenance?.outcome === 'failed') {
      if (item.provenance.unresolved !== false) reasons.push('failed-build-unresolved');
      if (retainedFailures.has(item.id)) reasons.push('recent-failed-build');
    } else if (item.provenance?.outcome !== 'passed' || item.provenance.packageVerified !== true || item.provenance.unresolved) {
      reasons.push('standalone-package-not-proven');
    }
    return { ...item, reasons };
  });
}

function budget(rows, limitBytes) {
  const included = rows.filter(item => !item.reasons.includes('current-release') && !item.reasons.includes('previous-release'));
  const sum = items => items.reduce((total, item) => total + (validBytes(item.bytes) ? item.bytes : 0), 0);
  const protectedRows = included.filter(item => item.reasons.length);
  const protectedBytes = sum(protectedRows);
  const unmeasured = included.filter(item => !validBytes(item.bytes)).map(item => item.id);
  return {
    limitBytes, measuredBytes: sum(included), protectedBytes,
    protectedOverageBytes: Math.max(0, protectedBytes - limitBytes),
    unmeasured,
    status: protectedBytes > limitBytes ? 'protected-overage' : unmeasured.length ? 'unmeasured' : 'measured',
    protectedReasons: protectedBytes > limitBytes
      ? protectedRows.map(item => ({ id: item.id, reasons: item.reasons, bytes: item.bytes })) : [],
  };
}

function archivalIntent(item) {
  return {
    format: 'zip-v1', includeTarget: 'all-files', source: item.historicalSnapshot ? item.root : null,
    evidence: (item.provenance?.evidence ?? []).map(record => ({ path: record.path, sha256: record.sha256 })),
    dependencyBaseline: item.provenance?.dependencyRoot && item.dependencyFingerprint
      ? path.join(item.provenance.dependencyRoot, 'node_modules') : null,
    dependencyFingerprint: item.dependencyFingerprint ?? null,
  };
}

function actionFor(item) {
  return {
    id: item.id, path: item.path, root: item.root, kind: item.kind, bytes: item.bytes,
    reason: item.kind === 'release' ? (item.provenance.acceptedAt ? 'older-accepted-release' : 'managed-candidate-closed') :
      item.provenance.outcome === 'failed' ? 'resolved-failure-outside-retention' : 'standalone-package-verified',
    expectedFingerprint: item.pending?.action.expectedFingerprint ?? item.fingerprint,
    expectedIdentity: item.pending?.action.expectedIdentity ?? item.identity,
    archiveRequirement: item.pending?.action.archiveRequirement ?? archivalIntent(item),
  };
}

export function planStorage(inventory, policy) {
  policy = policyOptions(policy);
  const rows = classified(inventory, policy);
  for (const item of rows) {
    if (!item.reasons.length && (!(item.root && item.identity && hashIsValid(item.fingerprint)) ||
        (item.pending && item.identity !== item.pending.action.expectedIdentity))) item.reasons.push('target-not-verified');
  }
  const eligible = rows.filter(item => !item.reasons.length);
  eligible.sort((a, b) => Number(a.kind === 'release') - Number(b.kind === 'release') ||
    Date.parse(a.provenance.acceptedAt ?? a.provenance.closedAt ?? a.provenance.at) -
      Date.parse(b.provenance.acceptedAt ?? b.provenance.closedAt ?? b.provenance.at) ||
    a.id.localeCompare(b.id));
  return {
    version: 1, id: randomUUID(), createdAt: inventory.at, inventoryFingerprint: freshness(inventory),
    actions: eligible.map(actionFor),
    protected: rows.filter(item => item.reasons.length).map(item => ({
      id: item.id, path: item.path, kind: item.kind, bytes: item.bytes, reasons: item.reasons,
    })),
    budgets: {
      builds: budget(rows.filter(item => item.kind === 'build'), policy.buildBudgetBytes),
      releases: budget(rows.filter(item => item.kind === 'release'), policy.releaseBudgetBytes),
    },
    uncertainties: inventory.uncertainties,
    freeBytes: inventory.freeBytes,
    lowFreeSpace: validBytes(inventory.freeBytes) ? inventory.freeBytes < policy.warningFreeBytes : null,
  };
}

function layout(home) {
  const state = path.join(home, 'maintenance-state');
  return {
    archives: path.join(state, 'evidence-archives'), journals: path.join(state, 'storage-journal'),
    index: path.join(state, 'evidence-index'),
  };
}

const transactionKey = action => digest([action.id, pathKey(action.path), action.expectedIdentity, action.expectedFingerprint]);

async function readJournals(directories) {
  const children = await nativeArchiveOperation('list', { target: directories.journals });
  const filenames = children.filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  const files = filenames.map(name => path.join(directories.journals, name));
  const read = await readGuardedRecords(files);
  const journals = new Map();
  for (const file of files) {
    const bytes = read.get(file);
    const record = bytes && JSON.parse(bytes.toString('utf8'));
    const key = path.basename(file, '.json');
    if (record?.version !== 1 || !record.action || transactionKey(record.action) !== key ||
        record.archive?.path !== path.join(directories.archives, key + '.zip') || !hashIsValid(record.archive.sha256) ||
        !Array.isArray(record.outcomes)) throw refusal('The storage journal record cannot be verified');
    if (record.outcomes.at(-1)?.status === 'completed') continue;
    const previous = journals.get(record.action.id);
    if (previous) throw refusal('More than one unfinished deletion targets the same artifact');
    journals.set(record.action.id, record);
  }
  return journals;
}

async function ensureDirectories(directories) {
  await nativeArchiveOperation('ensure-directories', { records: Object.values(directories) });
}

async function saveState(file, record, overwrite) {
  return nativeArchiveOperation('write', { writes: [{ path: file, data: JSON.stringify(record, null, 2) + '\n', overwrite }] });
}

function operationRoot(home, inventory, artifact) {
  return artifactRoot({ home, repoRoots: (inventory.worktrees ?? []).map(tree => tree.path) }, artifact);
}

export async function prepareStoragePlan({ home, repoRoots = [], policy, coordinatorLease } = {}) {
  home = await resolveMaintenanceHome({ explicitHome: home });
  const inventory = await readInventory({ home, repoRoots, coordinatorLease });
  const pending = await readJournals(layout(home));
  const eligible = [];
  for (const item of classified(inventory, policyOptions(policy)).filter(row => !row.reasons.length)) {
    const original = inventory.artifacts.find(artifact => artifact.id === item.id);
    try {
      original.root = operationRoot(home, inventory, item);
      original.pending = pending.get(item.id);
      eligible.push(original);
    } catch {
      original.protectedBy.push('operation-root-unverified');
    }
  }
  // Metadata inventory stays cheap. Measure only items eligible to appear in this dry run.
  // Use bounded batches so one worker is never asked to read every large release at once.
  for (let offset = 0; offset < eligible.length; offset += 2) {
    const batch = eligible.slice(offset, offset + 2);
    const measured = await Promise.all(batch.map(async artifact => {
      try {
        const [result] = await measureArchiveTargets([artifact.path]);
        return result;
      } catch {
        return null;
      }
    }));
    for (const [index, result] of measured.entries()) {
      if (!result?.fingerprint || !validBytes(result.bytes)) continue;
      const { bytes, files, fingerprint, identity, dependencyFingerprint } = result;
      Object.assign(batch[index], { bytes, files, fingerprint, identity, dependencyFingerprint });
    }
  }
  return planStorage(inventory, policy);
}

async function registerEvidence(index, { home, repoRoots = [], lease }, lifecycle) {
  home = await requireHeldLease(home, lease);
  const inventory = await readInventory({ home, repoRoots });
  if (inventory.uncertainties.some(item => item.scope === 'worktrees')) throw refusal('Registered worktrees cannot be verified');
  return registerLegacyProvenance(index, {
    home, lease, registered: inventory.worktrees ?? [],
    manifests: new Map((inventory.releaseManifests ?? []).map(item => [item.id, item])),
    lifecycle,
  });
}

export function importLegacyEvidence(index, options) {
  return registerEvidence(index, options, false);
}

export function registerLifecycleEvidence(index, options) {
  return registerEvidence(index, options, true);
}

// The build wrapper calls this once, immediately after its isolated build succeeds.
// This late observation is diagnostic. It does not prove which process produced a file.
export async function captureGeneratedBuild({ home, lease, repoRoots = [], source, dist, nodeExe }) {
  home = await requireHeldLease(home, lease);
  source = assertNarrowRoot(source);
  if (typeof dist !== 'string' || !isBuildName(dist) || !/^build-[0-9]+-[a-z0-9][a-z0-9-]*$/i.test(path.basename(source))) {
    throw refusal('An isolated newly built snapshot is required');
  }
  const inventory = await readInventory({ home, repoRoots });
  if (inventory.uncertainties.some(item => item.scope === 'worktrees')) throw refusal('Registered worktrees cannot be verified');
  const target = path.join(source, dist);
  const worktree = (inventory.worktrees ?? []).find(tree => {
    try {
      return operationRoot(home, inventory, {
        kind: 'build', path: target, root: source, worktree: tree.path, historicalSnapshot: true,
        provenance: { buildId: 'capture-only' },
      }) === source;
    } catch {
      return false;
    }
  });
  if (!worktree) throw refusal('The build snapshot is outside its registered worktree');
  const snapshot = await nativeArchiveOperation('capture', { target });
  if (pathKey(snapshot.target) !== pathKey(target) || !hashIsValid(snapshot.fingerprint)) {
    throw refusal('The generated build snapshot cannot be verified');
  }
  if (snapshot.entries.length && nodeExe) {
    try {
      nodeExe = pathInMaintenanceHome(home, nodeExe);
      const link = path.join(source, 'node_modules');
      const dependencyRoot = pathInMaintenanceHome(home, await fs.readlink(link));
      if (pathKey(path.dirname(nodeExe)) !== pathKey(path.join(home, 'runtime')) ||
          path.basename(dependencyRoot) !== 'node_modules' ||
          pathKey(path.dirname(path.dirname(dependencyRoot))) !== pathKey(path.join(home, 'dependencies'))) {
        throw refusal('The runtime and dependencies are outside the installed basis');
      }
      const [node, [dependencies]] = await Promise.all([
        nativeArchiveOperation('hash-file', { target: nodeExe }),
        measureArchiveTargets([dependencyRoot]),
      ]);
      if (hashIsValid(node.sha256) && validBytes(node.size) && node.size > 0 &&
          hashIsValid(dependencies?.fingerprint) &&
          pathKey(pathInMaintenanceHome(home, await fs.readlink(link))) === pathKey(dependencyRoot)) {
        snapshot.basis = { dependencyRoot, dependencyFingerprint: dependencies.fingerprint,
          nodeExe, nodeSha256: node.sha256, nodeSize: node.size };
      }
    } catch {
      // An unverified runtime or junction makes the cache part of the full ZIP.
    }
  }
  const file = path.join(path.dirname(source), path.basename(source) + '-generated-dist.json');
  const data = JSON.stringify(snapshot) + '\n';
  await requireHeldLease(home, lease);
  await nativeArchiveOperation('write', { writes: [{ path: file, data, overwrite: false }] });
  return {
    path: file, bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex'),
    fingerprint: snapshot.fingerprint,
  };
}

function compactReceipt(receipt) {
  return {
    format: receipt.format, path: receipt.path, sha256: receipt.sha256, verifiedAt: receipt.verifiedAt,
    references: receipt.references, omittedJunctions: receipt.omittedJunctions,
    generatedOmissions: receipt.generatedOmissions,
    managedProofSha256: receipt.managedProofSha256,
    rebuildBasis: receipt.rebuildBasis,
  };
}

const evidencePrefix = folder => 'evidence/' + digest(pathKey(folder));

function evidenceGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const folder = path.dirname(item.path);
    let group = groups.get(pathKey(folder));
    if (!group) {
      group = { source: folder, prefix: evidencePrefix(folder), files: [], expectedFiles: Object.create(null) };
      groups.set(pathKey(folder), group);
    }
    const file = path.basename(item.path);
    if (Object.hasOwn(group.expectedFiles, file)) {
      if (group.expectedFiles[file] !== item.sha256) throw refusal('Source receipts conflict');
    } else {
      group.expectedFiles[file] = item.sha256;
      group.files.push(file);
    }
  }
  return [...groups.values()];
}

async function sharedTreeArchive(dependencyBaseline, dependencyFingerprint, directories) {
  if (!dependencyBaseline || !hashIsValid(dependencyFingerprint) ||
      !['node_modules', 'bin'].includes(path.basename(dependencyBaseline))) return null;
  const destination = path.join(directories.archives, 'dependencies-' + dependencyFingerprint + '.zip');
  const states = await probePaths([destination, destination + '.manifest.json']);
  if (states.some(state => state === 'unverified')) return null;
  if (states.every(state => state === 'plain')) {
    const verified = await verifyArchive(destination);
    if (verified.contentFingerprint !== dependencyFingerprint || verified.references.length) return null;
    return verified;
  }
  // A shared copy is retained independently. No release is allowed to rely on another release's node_modules.
  const { groups } = await catalogArchiveGroups([{ source: dependencyBaseline }]);
  return publishEvidenceArchive({
    groups, destination,
    baseline: true, targetFingerprint: dependencyFingerprint,
  });
}

const archiveReference = outcome => ({ file: path.basename(outcome.path), sha256: outcome.sha256 });

async function sharedOcrArchive(artifact, inventory, directories) {
  const release = inventory.releaseManifests.find(item => pathKey(item.path) === pathKey(artifact.path));
  const ocr = release?.ocrAssets;
  if (!/^data\/tools\/kreuzberg\/\d+\.\d+\.\d+\/bin$/.test(ocr?.prefix ?? '') || !hashIsValid(ocr.fingerprint)) return null;
  const releases = [release, ...inventory.releaseManifests
    .filter(item => item.id !== release.id && item.ocrAssets?.prefix === ocr.prefix && item.ocrAssets.fingerprint === ocr.fingerprint)];
  const paths = releases.map(item => path.join(item.path, ocr.prefix));
  if (paths.length < 2) return null;
  const [target] = await measureArchiveTargets(paths.slice(0, 1));
  if (target?.fingerprint !== ocr.fingerprint) return null;
  const checkManifest = async (record, tree) => {
    const manifestPath = path.join(record.path, 'release.json');
    const raw = (await readGuardedRecords([manifestPath])).get(manifestPath);
    const manifest = raw && JSON.parse(raw);
    if (manifest?.ocrAssets?.fingerprint !== ocr.fingerprint || manifest.ocrAssets.prefix !== ocr.prefix) return false;
    const prefix = ocr.prefix + '/';
    const files = new Map((manifest.files ?? []).map(file => [file.path.replaceAll('\\', '/'), file.sha256])
      .filter(([file]) => file.startsWith(prefix)).map(([file, hash]) => [file.slice(prefix.length), hash]));
    if (!files.has('kreuzberg.exe') || !files.has('onnxruntime.dll')) return false;
    const { groups: [catalog] } = await catalogArchiveGroups([{ source: tree }]);
    return catalog.files.length === files.size && catalog.files.every(file => hashIsValid(files.get(file)));
  };
  if (!await checkManifest(release, paths[0])) return null;
  for (const [index, candidate] of releases.slice(1).entries()) {
    const tree = paths[index + 1];
    const [other] = await measureArchiveTargets([tree]);
    if (other?.fingerprint !== ocr.fingerprint || !await checkManifest(candidate, tree)) continue;
    const base = await sharedTreeArchive(tree, ocr.fingerprint, directories);
    if (!base) continue;
    const manifestPath = path.join(release.path, 'release.json');
    const bytes = (await readGuardedRecords([manifestPath])).get(manifestPath);
    const sealed = new Map(JSON.parse(bytes).files.map(file => [file.path.replaceAll('\\', '/'), file.sha256]));
    if (base.entries.some(row => sealed.get(ocr.prefix + '/' + row.path) !== row.sha256)) return null;
    return { prefix: 'artifact/' + ocr.prefix, ...archiveReference(base) };
  }
  return null;
}

async function archiveCacheBasis(action, artifact, inventory, directories, home) {
  if (!artifact.historicalSnapshot || artifact.provenance?.outcome !== 'passed') return null;
  const release = inventory.releaseManifests.find(item => item.id === artifact.provenance.releaseId);
  const observed = await managedCacheProof(home, artifact, release);
  if (!observed) return null;
  const { runtime, capture, proof, managedProofSha256 } = observed;
  const current = await nativeArchiveOperation('capture', { target: action.path });
  if (current.identity !== capture.identity || current.identity !== action.expectedIdentity ||
      current.fingerprint !== action.expectedFingerprint) return null;
  const files = new Map(capture.entries.map(row => [row.path, row]));
  const entries = current.entries.filter(row => files.get(row.path)?.sha256 === row.sha256 &&
    files.get(row.path).size === row.size).map(row => ({ ...row, path: 'artifact/' + row.path }));
  if (!entries.length) return null;
  const [privateModules] = await measureArchiveTargets([path.join(release.path, 'node_modules')]);
  if (privateModules?.fingerprint !== runtime.dependencyFingerprint) return null;
  const runtimeArchive = path.join(directories.archives, 'runtime-' + runtime.nodeSha256 + '.zip');
  const dependencyZip = path.join(directories.archives, 'dependencies-' + runtime.dependencyFingerprint + '.zip');
  const states = await probePaths([runtimeArchive, runtimeArchive + '.manifest.json', dependencyZip, dependencyZip + '.manifest.json']);
  if (states.includes('unverified')) return null;
  const extra = (states[0] === 'plain' && states[1] === 'plain' ? 0 : runtime.nodeSize) +
    (states[2] === 'plain' && states[3] === 'plain' ? 0 : runtime.dependencyBytes);
  const available = await freeSpace(home);
  if (!validBytes(extra) || !validBytes(available) ||
      available < maintenancePolicy.minimumFreeBytes + 1.1 * (extra + action.bytes)) return null;
  const deps = await sharedTreeArchive(runtime.dependencyRoot, runtime.dependencyFingerprint, directories);
  if (!deps) return null;
  const executable = states[0] === 'plain' && states[1] === 'plain'
    ? await verifyArchive(runtimeArchive)
    : await createVerifiedArchive({ source: path.dirname(runtime.nodeExe),
      files: [path.basename(runtime.nodeExe)], destination: runtimeArchive });
  if (executable.entries.length !== 1 || executable.entries[0].sha256 !== runtime.nodeSha256 ||
      executable.entries[0].size !== runtime.nodeSize || executable.references.length) return null;
  return { managedProofSha256, proof: evidencePrefix(path.dirname(proof.path)) + '/' + path.basename(proof.path),
    target: action.path, identity: action.expectedIdentity, entries,
    dependencies: archiveReference(deps), runtime: archiveReference(executable) };
}

async function getArchive(action, artifact, directories, inventory, home) {
  const targetGroup = { source: action.path, prefix: 'artifact' };
  if (action.kind === 'release') {
    const registered = artifact.provenance?.dependencyRoot;
    if (action.archiveRequirement.dependencyBaseline &&
        (!registered || pathKey(action.archiveRequirement.dependencyBaseline) !== pathKey(path.join(registered, 'node_modules')))) {
      throw refusal('The dependency baseline differs from the registered release');
    }
  }
  const evidence = evidenceGroups(artifact.provenance.evidence ?? []);
  const requests = [targetGroup];
  if (artifact.historicalSnapshot) requests.push({
    source: artifact.root, prefix: 'source', skipDirectory: path.basename(action.path),
    omitNodeModulesJunction: true, expectedFiles: artifact.provenance.expectedFiles,
  });
  const destination = path.join(directories.archives, transactionKey(action) + '.zip');
  const statuses = await probePaths([destination, destination + '.manifest.json']);
  if (statuses.some(status => status === 'unverified')) {
    throw refusal('The previously published archive is incomplete or unsafe');
  }
  if (statuses.every(status => status === 'plain')) {
    const existing = await verifyArchive(destination);
    const entries = new Map(existing.entries.map(row => [row.path, row.sha256]));
    for (const group of [...requests.slice(1), ...evidence]) {
      if (Object.entries(group.expectedFiles ?? {}).some(([file, sha256]) => entries.get(group.prefix + '/' + file) !== sha256)) {
        throw refusal('The existing ZIP lacks registered provenance');
      }
    }
    return compactReceipt(existing);
  }
  const references = [];
  let generated;
  if (action.kind === 'release') {
    try {
      const { dependencyBaseline, dependencyFingerprint } = action.archiveRequirement;
      const saved = await sharedTreeArchive(dependencyBaseline, dependencyFingerprint, directories);
      if (saved) references.push({ prefix: 'artifact/node_modules', ...archiveReference(saved) });
    } catch {
      // A complete ZIP is still safe when a shared copy is unavailable or unequal.
    }
    try {
      const ocr = await sharedOcrArchive(artifact, inventory, directories);
      if (ocr) references.push(ocr);
    } catch { /* Keep all OCR bytes when an exact shared copy cannot be secured. */ }
  } else {
    try {
      generated = await archiveCacheBasis(action, artifact, inventory, directories, home);
    } catch { /* A full archive retains every unproven cache byte. */ }
  }
  targetGroup.skipEntries = [...references.map(row => row.prefix.slice('artifact/'.length)),
    ...(generated?.entries.map(row => row.path.slice('artifact/'.length)) ?? [])];
  const { groups, omittedJunctions } = await catalogArchiveGroups(requests);
  return compactReceipt(await publishEvidenceArchive({
    groups: [...groups, ...evidence], destination, omittedJunctions, references, generated,
    targetFingerprint: action.expectedFingerprint, targetIdentity: action.expectedIdentity, publicationTarget: action.path,
  }));
}

function validatePlan(plan) {
  if (plan?.version !== 1 || typeof plan.id !== 'string' || !hashIsValid(plan.inventoryFingerprint) ||
      !Array.isArray(plan.actions) || new Set(plan.actions.map(action => action?.id)).size !== plan.actions.length) {
    throw refusal('The maintenance plan is invalid');
  }
}

function reconcileAction(action, fresh, home, pending) {
  const item = classified(fresh, maintenancePolicy).find(row => row.id === action.id);
  if (!item || item.reasons.length || item.kind !== action.kind || pathKey(item.path) !== pathKey(action.path) ||
      pathKey(operationRoot(home, fresh, item)) !== pathKey(action.root) ||
      !hashIsValid(action.expectedFingerprint) || typeof action.expectedIdentity !== 'string') return null;
  if (pending && transactionKey(action) !== transactionKey(pending.action)) return null;
  const provenance = archivalIntent(item);
  const recorded = action.archiveRequirement;
  if (recorded?.format !== 'zip-v1' || recorded.includeTarget !== 'all-files' ||
      recorded.source !== provenance.source || digest(recorded.evidence) !== digest(provenance.evidence)) return null;
  return item;
}

async function freeSpace(home) {
  try {
    const info = await fs.statfs(home, { bigint: true });
    const bytes = Number(info.bavail * info.bsize);
    return validBytes(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function applyStorage(plan, { home, lease, repoRoots = [], coordinatorLease }) {
  validatePlan(plan);
  home = await requireHeldLease(home, lease);
  const directories = layout(home);
  const receipt = { version: 1, planId: plan.id, startedAt: new Date().toISOString(),
    completed: [], skipped: [], failed: [], deletedBytes: 0, freeBytesBefore: await freeSpace(home), freeBytesAfter: null };
  const options = { home, repoRoots, coordinatorLease };
  const initial = await readInventory(options);
  const removed = new Set();
  const pending = await readJournals(directories);
  if (plan.inventoryFingerprint !== freshness(initial)) {
    for (const action of plan.actions) receipt.skipped.push({ id: action.id, path: action.path, reason: 'inventory-changed' });
  } else {
    for (const action of plan.actions) {
      const row = { id: action.id, path: action.path };
      let archive, journalFile, record;
      try {
        await requireHeldLease(home, lease);
        const expectedState = freshness(initial, removed);
        const fresh = await readInventory(options);
        const previous = pending.get(action.id);
        const artifact = expectedState === freshness(fresh) && reconcileAction(action, fresh, home, previous);
        if (!artifact) {
          receipt.skipped.push({ ...row, reason: 'protection-or-scope-changed' });
          continue;
        }
        await ensureDirectories(directories);
        const key = transactionKey(action);
        journalFile = path.join(directories.journals, key + '.json');
        const tombstone = path.join(directories.index, key + '.json');
        archive = previous?.archive ?? await getArchive(action, artifact, directories, fresh, home);
        const proofFromInventory = value => managedCacheProof(home, value, fresh.releaseManifests.find(
          item => item.id === value.provenance?.releaseId));
        if (archive.generatedOmissions?.length &&
            (await proofFromInventory(artifact))?.managedProofSha256 !== archive.managedProofSha256) {
          throw refusal('The managed generation evidence no longer matches');
        }
        record = previous ?? {
          version: 1, action, archive, intentAt: new Date().toISOString(), planId: plan.id, outcomes: [],
        };
        if (!previous) {
          await requireHeldLease(home, lease);
          await saveState(journalFile, record, false);
        }
        const result = await deleteArchivedTarget({
          archive, target: action.path, targetFingerprint: action.expectedFingerprint,
          targetIdentity: action.expectedIdentity, resume: Boolean(previous),
          managedProofSha256: archive.managedProofSha256,
        }, async () => {
          await requireHeldLease(home, lease);
          const now = await readInventory({ ...options, pinnedTarget: action.path });
          const rechecked = expectedState === freshness(now) && reconcileAction(action, now, home, previous);
          if (!rechecked || (archive.generatedOmissions?.length &&
              (await proofFromInventory(rechecked))?.managedProofSha256 !== archive.managedProofSha256)) return false;
          await requireHeldLease(home, lease);
          return true;
        });
        receipt.deletedBytes += result.deletedBytes;
        const entry = { ...row, archive, journal: journalFile, ...result };
        record.outcomes.push({ at: new Date().toISOString(), ...result });
        if (result.status === 'completed') {
          await saveState(tombstone, {
            version: 1, originalPath: action.path, kind: action.kind, archive, journal: journalFile,
            artifactPrefix: 'artifact/',
            source: action.archiveRequirement.source
              ? { originalPath: action.archiveRequirement.source, prefix: 'source/' } : null,
            evidence: action.archiveRequirement.evidence.map(item => ({
              ...item, entry: evidencePrefix(path.dirname(item.path)) + '/' + path.basename(item.path),
            })),
            removedAt: new Date().toISOString(),
          }, true);
          removed.add(action.id);
        }
        await saveState(journalFile, record, true);
        if (result.status === 'completed') receipt.completed.push({ ...entry, tombstone });
        else if (result.status === 'failed') receipt.failed.push(entry);
        else receipt.skipped.push({ ...entry, reason: 'protection-or-scope-changed' });
      } catch (error) {
        const changed = /scheduled-target-changed|target directory was replaced|target differs from the verified archive|unarchived entry|target lost entries/.test(error.message);
        const protectedStage = /A previous unfinished publication must be preserved/.test(error.message);
        const skipped = changed || protectedStage;
        const reason = changed ? 'target-changed' : protectedStage ? 'unfinished-publication-protected' : error.message;
        const entry = { ...row, ...(archive ? { archive, journal: journalFile } : {}), reason };
        (skipped ? receipt.skipped : receipt.failed).push(entry);
        if (record && journalFile) {
          record.outcomes.push({ at: new Date().toISOString(), status: skipped ? 'skipped' : 'failed', reason });
          await saveState(journalFile, record, true).catch(() => {});
        }
      }
    }
  }
  receipt.freeBytesAfter = await freeSpace(home);
  return receipt;
}

export async function runStorageEvent(event, task, context) {
  if (!['build', 'package', 'install', 'start'].includes(event) ||
      typeof task !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(task)) {
    throw refusal('A supported maintenance event and task are required');
  }
  await requireHeldLease(context.home, context.lease);
  const plan = await prepareStoragePlan(context);
  return { ...await applyStorage(plan, context), event, task };
}

const gib = 1024 ** 3;
const heavyOperations = new Set(['build', 'package']);
const lifecycleEvents = new Set(['build', 'package', 'start', 'verify', 'install', 'rollback', 'adopt', 'stop']);
const emptyLifecycle = () => ({ version: 1, leaseToken: null, active: [], lastBytes: {}, lastReceipt: null });

export function mayStart({ freeGiB, estimatedGiB, reservedGiB = 0 }) {
  return [freeGiB, estimatedGiB, reservedGiB].every(value => Number.isFinite(value) && value >= 0) &&
    freeGiB - estimatedGiB - reservedGiB >= maintenancePolicy.minimumFreeBytes / gib;
}

async function lifecycleState(file) {
  const [status] = await probePaths([file]);
  if (status === 'missing') return emptyLifecycle();
  if (status !== 'plain') throw refusal('The maintenance reservation record is unsafe');
  const bytes = (await readGuardedRecords([file])).get(file);
  const saved = bytes && JSON.parse(bytes.toString('utf8'));
  if (saved?.version !== 1 || !Array.isArray(saved.active) ||
      saved.active.some(row => typeof row?.id !== 'string' || !validBytes(row.bytes)) ||
      !saved.lastBytes || typeof saved.lastBytes !== 'object' ||
      Object.values(saved.lastBytes).some(bytes => !validBytes(bytes))) {
    throw refusal('The maintenance reservations cannot be verified');
  }
  return saved;
}

export async function runLifecycle(event, context) {
  if (!lifecycleEvents.has(event) || typeof context.task !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(context.task)) throw refusal('Invalid lifecycle operation');
  if (!context.lease) {
    const home = await resolveMaintenanceHome({ explicitHome: context.home });
    return withLifecycleLock(home, event, lease => runLifecycle(event, { ...context, home, lease }));
  }
  return withReservationGate(context.home, context.lease, () => lifecycleReservation(event, context));
}

async function lifecycleReservation(event, context) {
  const { lease, getFreeBytes = freeSpace } = context;
  const home = await requireHeldLease(context.home, lease);
  const file = path.join(home, 'maintenance-state', 'lifecycle-costs.json');
  const state = await lifecycleState(file);
  if (state.leaseToken !== lease.token) state.active = [];
  state.leaseToken = lease.token;
  const startedAt = new Date().toISOString();
  const operation = state.active.find(item => item.id === context.reservation?.id);
  if (context.phase && (!operation || operation.event !== event || operation.task !== context.task)) {
    throw refusal('The operation has no matching disk reservation');
  }
  if (context.phase === 'finish') {
    state.active = state.active.filter(item => item !== operation);
    if (context.passed && heavyOperations.has(event) && validBytes(context.measuredBytes)) {
      state.lastBytes[event] = context.measuredBytes;
    }
    const result = { ...operation, finishedAt: startedAt, passed: context.passed === true,
      measuredBytes: validBytes(context.measuredBytes) ? context.measuredBytes : null };
    state.lastReceipt = result;
    await saveState(file, state, true);
    return result;
  }
  const requested = context.expectedAdditionalBytes ?? 0;
  if (!validBytes(requested)) throw refusal('The requested disk reservation is invalid');
  const estimated = Math.ceil((state.lastBytes[event] ?? 0) * 1.25);
  const bytes = Math.max(heavyOperations.has(event) ? 2 * gib : 0, estimated, requested);
  const reservedBytes = state.active.reduce((sum, item) => item === operation ? sum : sum + item.bytes, 0);
  const volumes = [...new Set([home, ...(context.writeRoots ?? [])])];
  const free = await Promise.all(volumes.map(getFreeBytes));
  const capacity = values => values.every(validBytes) ? Math.min(...values) : null;
  let freeBytes = capacity(free);
  let cleanup = null;
  let maintenanceError = null;
  if (context.cleanup !== false && !context.phase && reservedBytes === 0) {
    try {
      const options = { ...context, home, coordinatorLease: lease };
      const plan = await prepareStoragePlan(options);
      let headroom = free[0] - maintenancePolicy.minimumFreeBytes - bytes - reservedBytes;
      plan.actions = plan.actions.filter(action => {
        if (context.target && pathKey(action.path) !== pathKey(context.target)) return false;
        // Allow for a ZIP of incompressible bytes and its metadata before the source can be removed.
        const needed = (action.bytes ?? Infinity) * 1.1 + 8 * 1024 ** 2;
        if (!validBytes(free[0]) || needed > headroom) return false;
        headroom -= needed;
        return true;
      });
      if (plan.actions.length) {
        cleanup = await applyStorage(plan, options);
        freeBytes = capacity(await Promise.all(volumes.map(getFreeBytes)));
      }
    } catch (error) {
      maintenanceError = error.message;
    }
  }
  if ((heavyOperations.has(event) || requested > 0) &&
      (!validBytes(freeBytes) || !mayStart({ freeGiB: freeBytes / gib, estimatedGiB: bytes / gib, reservedGiB: reservedBytes / gib }))) {
    throw Object.assign(new Error('Insufficient verified disk space for the operation'), { code: 'LOW_DISK' });
  }
  if (context.phase === 'resize') {
    Object.assign(operation, { freeBytes, bytes: Math.max(operation.bytes, bytes), reservedBytes });
    await requireHeldLease(home, lease);
    await saveState(file, state, true);
    return operation;
  }
  const reservation = { id: randomUUID(), event, task: context.task, build: context.build ?? null,
    releaseId: context.releaseId ?? null, startedAt, freeBytes, bytes, reservedBytes };
  state.active.push(reservation);
  state.lastReceipt = { ...reservation, maintenanceError };
  await requireHeldLease(home, lease);
  await saveState(file, state, true);
  return { ...reservation, maintenanceError, cleanup };
}
