import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  catalogArchiveGroups, createVerifiedArchive, deleteArchivedTarget, measureArchiveTargets, nativeArchiveOperation,
  publishEvidenceArchive, readGuardedRecords, verifyArchive,
} from './archive.mjs';
import { probePaths, requireHeldLease, resolveMaintenanceHome, withLifecycleLock, withReservationGate } from './guard.mjs';
import { readInventory } from './inventory.mjs';
import { registerLegacyProvenance } from './legacy.mjs';
import { managedCacheProof } from './lifecycle.mjs';
import {
  artifactRoot, assertNarrowRoot, isBuildName, maintenancePolicy, pathInMaintenanceHome, pathKey, refusal, relativeWithin,
} from './policy.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashIsValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validBytes = bytes => Number.isSafeInteger(bytes) && bytes >= 0;
const lowFreeSpace = (bytes, policy = maintenancePolicy) => validBytes(bytes) ? bytes < policy.warningFreeBytes : null;
const jobKinds = new Set(['build', 'release', 'package-stage']);
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
    } else if (item.kind === 'release' || item.kind === 'package-stage') {
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
    reason: item.kind === 'package-stage' ? 'managed-package-attempt-closed' :
      item.kind === 'release' ? (item.provenance.acceptedAt ? 'older-accepted-release' : 'managed-candidate-closed') :
      item.provenance.outcome === 'failed' ? 'resolved-failure-outside-retention' : 'standalone-package-verified',
    expectedFingerprint: item.pending?.action.expectedFingerprint ?? item.fingerprint,
    expectedIdentity: item.pending?.action.expectedIdentity ?? item.identity,
    archiveRequirement: item.pending?.action.archiveRequirement ?? archivalIntent(item),
  };
}

export function planStorage(inventory, policy, protectedInputs = []) {
  policy = policyOptions(policy);
  const rows = classified(inventory, policy);
  for (const item of rows) {
    if (isOperationInput(item.path, protectedInputs)) item.reasons.push('active-package-input');
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
      releases: budget(rows.filter(item => item.kind === 'release' || item.kind === 'package-stage'), policy.releaseBudgetBytes),
    },
    uncertainties: inventory.uncertainties,
    freeBytes: inventory.freeBytes,
    lowFreeSpace: lowFreeSpace(inventory.freeBytes, policy),
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

export async function prepareStoragePlan({ home, repoRoots = [], policy, coordinatorLease, protectedInputs = [] } = {}) {
  home = await resolveMaintenanceHome({ explicitHome: home });
  const inventory = await readInventory({ home, repoRoots, coordinatorLease });
  const pending = await readJournals(layout(home));
  const eligible = [];
  for (const item of classified(inventory, policyOptions(policy)).filter(row =>
    !row.reasons.length && !isOperationInput(row.path, protectedInputs))) {
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
      if (batch[index].kind === 'package-stage' && identity !== batch[index].provenance?.stageIdentity) {
        batch[index].protectedBy.push('package-stage-identity-changed');
        continue;
      }
      Object.assign(batch[index], { bytes, files, fingerprint, identity, dependencyFingerprint });
    }
  }
  return planStorage(inventory, policy, protectedInputs);
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

async function publishArchiveIndex(file, action, archive, journal) {
  const pointer = {
    version: 1, originalPath: action.path, kind: action.kind, archive, journal,
    artifactPrefix: 'artifact/',
    source: action.archiveRequirement.source
      ? { originalPath: action.archiveRequirement.source, prefix: 'source/' } : null,
    evidence: action.archiveRequirement.evidence.map(item => ({
      ...item, entry: evidencePrefix(path.dirname(item.path)) + '/' + path.basename(item.path),
    })),
  };
  const [status] = await probePaths([file]);
  if (status === 'missing') {
    const fresh = { ...pointer, archivedAt: new Date().toISOString() };
    await saveState(file, fresh, false);
    return fresh;
  }
  const bytes = status === 'plain' && (await readGuardedRecords([file])).get(file);
  if (!bytes) throw refusal('The archive index cannot be verified');
  const existing = JSON.parse(bytes.toString('utf8'));
  const { archivedAt, removedAt, ...details } = existing;
  const archived = archivedAt !== undefined && Number.isFinite(Date.parse(archivedAt));
  const removed = removedAt !== undefined && Number.isFinite(Date.parse(removedAt));
  if ((!archived && !removed) || (removedAt !== undefined && !removed) ||
      !isDeepStrictEqual(details, JSON.parse(JSON.stringify(pointer)))) {
    throw refusal('The archive index belongs to different or unverified evidence');
  }
  return existing;
}

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

async function planSharedTreeArchive(dependencyBaseline, dependencyFingerprint, directories) {
  if (!dependencyBaseline || !hashIsValid(dependencyFingerprint) ||
      !['node_modules', 'bin'].includes(path.basename(dependencyBaseline))) return null;
  const destination = path.join(directories.archives, 'dependencies-' + dependencyFingerprint + '.zip');
  const states = await probePaths([destination, destination + '.manifest.json']);
  if (states.some(state => state === 'unverified')) return null;
  if (states.every(state => state === 'plain')) {
    const verified = await verifyArchive(destination);
    if (verified.contentFingerprint !== dependencyFingerprint || verified.references.length) return null;
    return { bound: 0, publish: async () => verified };
  }
  // A shared copy is retained independently. No release is allowed to rely on another release's node_modules.
  const { groups } = await catalogArchiveGroups([{ source: dependencyBaseline }]);
  const sized = await sizeArchiveGroups(groups);
  return { bound: sized.bound, publish: () => publishEvidenceArchive({
    groups: sized.groups, destination, baseline: true, targetFingerprint: dependencyFingerprint,
  }) };
}

const archiveReference = outcome => ({ file: path.basename(outcome.path), sha256: outcome.sha256 });

export function archiveFits(freeBytes, reservedBytes, parts) {
  if (!validBytes(freeBytes) || !validBytes(reservedBytes) || !parts.every(validBytes)) return false;
  const required = parts.reduce((sum, value) => sum + value, reservedBytes + maintenancePolicy.minimumFreeBytes);
  return validBytes(required) && freeBytes >= required;
}

const zipMetadataMargin = 8 * 1024 ** 2;

async function sizeArchiveGroups(groups) {
  let bound = zipMetadataMargin;
  const measured = [];
  for (const group of groups) {
    let data = 0;
    const names = [...(group.directories ?? []), ...group.files];
    // ZIP has two filename copies, central-directory records, and a JSON
    // manifest. Reserve UTF-8 escaping and ZIP64 overhead per entry.
    for (const name of names) bound += 512 + 8 * Buffer.byteLength([group.prefix, name].filter(Boolean).join('/'));
    for (const name of group.files) {
      const file = await fs.lstat(path.join(group.source, name));
      if (!file.isFile() || file.nlink !== 1 || !validBytes(file.size)) throw refusal('An archive input cannot be sized safely');
      data += file.size;
    }
    if (!validBytes(data)) throw refusal('Archive input size is out of range');
    bound += Math.ceil(data * 1.1);
    measured.push({ ...group, maximumBytes: data });
  }
  if (!validBytes(bound)) throw refusal('The archive forecast is out of range');
  return { bound, groups: measured };
}

async function planSharedOcrArchive(artifact, inventory, directories) {
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
    const base = await planSharedTreeArchive(tree, ocr.fingerprint, directories);
    if (!base) continue;
    const manifestPath = path.join(release.path, 'release.json');
    const bytes = (await readGuardedRecords([manifestPath])).get(manifestPath);
    const sealed = new Map(JSON.parse(bytes).files.map(file => [file.path.replaceAll('\\', '/'), file.sha256]));
    return {
      bound: base.bound, prefix: 'artifact/' + ocr.prefix,
      publish: async () => {
        const saved = await base.publish();
        return saved.entries.some(row => sealed.get(ocr.prefix + '/' + row.path) !== row.sha256) ? null : saved;
      },
    };
  }
  return null;
}

async function archiveCacheBasis(action, artifact, inventory, directories, home, admit) {
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
  const states = await probePaths([runtimeArchive, runtimeArchive + '.manifest.json']);
  if (states.includes('unverified')) return null;
  const dependencies = await planSharedTreeArchive(runtime.dependencyRoot, runtime.dependencyFingerprint, directories);
  if (!dependencies) return null;
  const source = path.dirname(runtime.nodeExe), filesForRuntime = [path.basename(runtime.nodeExe)];
  const existing = states.every(state => state === 'plain') ? await verifyArchive(runtimeArchive) : null;
  const runtimeSize = existing ? { bound: 0 } : await sizeArchiveGroups([{ source, files: filesForRuntime }]);
  if (!await admit([dependencies.bound, runtimeSize.bound])) return null;
  const deps = await dependencies.publish();
  if (!await admit([runtimeSize.bound])) return null;
  const executable = existing ?? await createVerifiedArchive({
    source, files: filesForRuntime, destination: runtimeArchive, maximumBytes: runtimeSize.groups[0].maximumBytes,
  });
  if (executable.entries.length !== 1 || executable.entries[0].sha256 !== runtime.nodeSha256 ||
      executable.entries[0].size !== runtime.nodeSize || executable.references.length) return null;
  return { managedProofSha256, proof: evidencePrefix(path.dirname(proof.path)) + '/' + path.basename(proof.path),
    target: action.path, identity: action.expectedIdentity, entries,
    dependencies: archiveReference(deps), runtime: archiveReference(executable) };
}

async function getArchive(action, artifact, directories, inventory, home, checkBudget) {
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
  const initialGroups = await catalogArchiveGroups(requests);
  const main = await sizeArchiveGroups([...initialGroups.groups, ...evidence]);
  const admit = extra => checkBudget([main.bound, ...extra]);
  if (!await admit([])) throw archiveSpace();
  await ensureDirectories(directories);
  const references = [];
  let generated;
  if (action.kind === 'release') {
    const bases = [];
    try {
      const { dependencyBaseline, dependencyFingerprint } = action.archiveRequirement;
      const saved = await planSharedTreeArchive(dependencyBaseline, dependencyFingerprint, directories);
      if (saved) bases.push({ prefix: 'artifact/node_modules', ...saved });
    } catch {
      // A complete ZIP is still safe when a shared copy is unavailable or unequal.
    }
    try {
      const ocr = await planSharedOcrArchive(artifact, inventory, directories);
      if (ocr) bases.push(ocr);
    } catch { /* Keep all OCR bytes when an exact shared copy cannot be secured. */ }
    for (const [index, base] of bases.entries()) {
      try {
        if (base.bound > 0 && !await admit(bases.slice(index).map(item => item.bound))) continue;
        const saved = await base.publish();
        if (saved) references.push({ prefix: base.prefix, ...archiveReference(saved) });
      } catch { /* Keep a full archive with the verified groups that are available. */ }
    }
  } else {
    try {
      generated = await archiveCacheBasis(action, artifact, inventory, directories, home, admit);
    } catch { /* A full archive retains every unproven cache byte. */ }
  }
  const skipped = [...references.map(row => row.prefix.slice('artifact/'.length)),
    ...(generated?.entries.map(row => row.path.slice('artifact/'.length)) ?? [])];
  const filter = name => !skipped.some(entry => entry === name || name.startsWith(entry + '/'));
  const [target, ...otherGroups] = main.groups;
  const groups = [{ ...target, files: target.files.filter(filter), directories: target.directories.filter(filter) }, ...otherGroups];
  if (!await admit([])) throw archiveSpace();
  return compactReceipt(await publishEvidenceArchive({
    groups, destination, omittedJunctions: initialGroups.omittedJunctions, references, generated,
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
  if (item.kind === 'package-stage' && item.provenance?.stageIdentity !== action.expectedIdentity) return null;
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

const archiveSpace = () => Object.assign(new Error('Insufficient verified disk space for the complete archive'), { code: 'ARCHIVE_SPACE' });

export async function applyStorage(plan, context) {
  await requireHeldLease(context.home, context.lease);
  const requireIdle = async () => {
    if ((await activeReservations(context.home, context.lease)).length) {
      throw Object.assign(new Error('An admitted operation must finish before public storage maintenance'), { code: 'BUSY' });
    }
  };
  // Avoid competing with an existing operation's finish; recheck atomically for
  // an admission that completed between this read and acquisition of the gate.
  await requireIdle();
  return withReservationGate(context.home, context.lease, async () => {
    await requireIdle();
    return applyStorageWithHeldGate(plan, context);
  });
}

async function applyStorageWithHeldGate(plan, { home, lease, repoRoots = [], coordinatorLease, protectedInputs = [],
  prospectiveBytes = 0, getFreeBytes = freeSpace }) {
  validatePlan(plan);
  home = await requireHeldLease(home, lease);
  const directories = layout(home);
  const receipt = { version: 1, planId: plan.id, startedAt: new Date().toISOString(),
    completed: [], skipped: [], failed: [], deletedBytes: 0, freeBytesBefore: await freeSpace(home), freeBytesAfter: null };
  const options = { home, repoRoots, coordinatorLease };
  const initial = await readInventory(options);
  const removed = new Set();
  const pending = await readJournals(directories);
  const reservations = () => activeReservations(home, lease);
  const inputProtected = async target => isOperationInput(target, [
    ...protectedInputs, ...(await reservations()).filter(item => item.event === 'package').map(item => item.build).filter(Boolean),
  ]);
  const checkBudget = async groups => {
    const reserved = prospectiveBytes + (await reservations()).reduce((sum, item) => sum + item.bytes, 0);
    return archiveFits(await getFreeBytes(home), reserved, groups);
  };
  if (plan.inventoryFingerprint !== freshness(initial)) {
    for (const action of plan.actions) receipt.skipped.push({ id: action.id, path: action.path, reason: 'inventory-changed' });
  } else {
    for (const action of plan.actions) {
      const row = { id: action.id, path: action.path };
      let archive, journalFile, record;
      try {
        await requireHeldLease(home, lease);
        if (await inputProtected(action.path)) {
          receipt.skipped.push({ ...row, reason: 'active-package-input' });
          continue;
        }
        const expectedState = freshness(initial, removed);
        const fresh = await readInventory(options);
        const previous = pending.get(action.id);
        const artifact = expectedState === freshness(fresh) && reconcileAction(action, fresh, home, previous);
        if (!artifact) {
          receipt.skipped.push({ ...row, reason: 'protection-or-scope-changed' });
          continue;
        }
        const key = transactionKey(action);
        journalFile = path.join(directories.journals, key + '.json');
        const tombstone = path.join(directories.index, key + '.json');
        archive = previous?.archive ?? await getArchive(action, artifact, directories, fresh, home, checkBudget);
        await ensureDirectories(directories);
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
        let archivePointer;
        const result = await deleteArchivedTarget({
          archive, target: action.path, targetFingerprint: action.expectedFingerprint,
          targetIdentity: action.expectedIdentity, resume: Boolean(previous),
          managedProofSha256: archive.managedProofSha256,
        }, async (_phase, _request, deleteWorker) => {
          await requireHeldLease(home, lease);
          if (await inputProtected(action.path)) return false;
          const now = await readInventory({ ...options, pinnedTarget: action.path, deleteWorker });
          const rechecked = expectedState === freshness(now) && reconcileAction(action, now, home, previous);
          if (!rechecked || (archive.generatedOmissions?.length &&
              (await proofFromInventory(rechecked))?.managedProofSha256 !== archive.managedProofSha256)) return false;
          // The native worker holds the verified archive before asking to stage deletion.
          archivePointer ??= await publishArchiveIndex(tombstone, action, archive, journalFile);
          await requireHeldLease(home, lease);
          return true;
        });
        receipt.deletedBytes += result.deletedBytes;
        const entry = { ...row, archive, journal: journalFile, ...result };
        if (result.status === 'completed') {
          if (!archivePointer.removedAt) await saveState(tombstone, { ...archivePointer, removedAt: new Date().toISOString() }, true);
          removed.add(action.id);
        }
        record.outcomes.push({ at: new Date().toISOString(), ...result });
        await saveState(journalFile, record, true);
        if (result.status === 'completed') receipt.completed.push({ ...entry, tombstone });
        else if (result.status === 'failed') receipt.failed.push(entry);
        else receipt.skipped.push({ ...entry, reason: 'protection-or-scope-changed' });
      } catch (error) {
        const changed = /scheduled-target-changed|target directory was replaced|target differs from the verified archive|unarchived entry|target lost entries/.test(error.message);
        const protectedStage = /A previous unfinished publication must be preserved/.test(error.message);
        const skipped = changed || protectedStage || error.code === 'ARCHIVE_SPACE';
        const reason = changed ? 'target-changed' : protectedStage ? 'unfinished-publication-protected' :
          error.code === 'ARCHIVE_SPACE' ? 'archive-space' : error.message;
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
const lifecycleEvents = new Set(['build', 'package', 'start', 'verify', 'install', 'rollback', 'adopt', 'stop', 'backup']);
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
      saved.active.some(row => typeof row?.id !== 'string' || !validBytes(row.bytes) ||
        (row.packageSlot != null && !hashIsValid(row.packageSlot))) ||
      !saved.lastBytes || typeof saved.lastBytes !== 'object' ||
      Object.values(saved.lastBytes).some(bytes => !validBytes(bytes))) {
    throw refusal('The maintenance reservations cannot be verified');
  }
  return saved;
}

function isOperationInput(target, inputs) {
  return inputs.some(input => relativeWithin(target, input) !== null || relativeWithin(input, target) !== null);
}

async function activeReservations(home, lease) {
  const file = path.join(home, 'maintenance-state', 'lifecycle-costs.json');
  if (!await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) return [];
  const state = await lifecycleState(file);
  return state.leaseToken === lease.token ? state.active : [];
}

export async function runLifecycle(event, context) {
  if (!lifecycleEvents.has(event) || typeof context.task !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(context.task)) throw refusal('Invalid lifecycle operation');
  if (!context.lease) {
    const home = await resolveMaintenanceHome({ explicitHome: context.home });
    return withLifecycleLock(home, event, lease => runLifecycle(event, { ...context, home, lease }));
  }
  for (let attempt = 0; ; attempt++) {
    let entered = false;
    try {
      const receipt = await withReservationGate(context.home, context.lease, () => {
        entered = true;
        return lifecycleReservation(event, context);
      });
      if (!context.phase && (heavyOperations.has(event) || event === 'start') && receipt.lowFreeSpace === true) {
        process.stderr.write(`Предупреждение: на диске осталось меньше ${maintenancePolicy.warningFreeBytes / gib} ГиБ.\n`);
      }
      return receipt;
    } catch (error) {
      // Only a finish whose state transition never began may retry a short gate
      // collision. The exact reservation is checked again inside the same gate.
      if (context.phase !== 'finish' || entered || error.code !== 'BUSY' || attempt >= 2) throw error;
      await requireHeldLease(context.home, context.lease);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
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
  if (event === 'backup' && !context.phase && state.active.some(item => item.event === 'backup')) {
    throw Object.assign(new Error('A backup attempt already owns the materialization slot'), { code: 'BUSY' });
  }
  if (context.phase && (!operation || operation.event !== event || operation.task !== context.task)) {
    throw refusal('The operation has no matching disk reservation');
  }
  if (context.phase === 'finish') {
    state.active = state.active.filter(item => item !== operation);
    if (context.passed && heavyOperations.has(event) && validBytes(context.measuredBytes)) {
      state.lastBytes[event] = context.measuredBytes;
    }
    const result = { ...operation, lowFreeSpace: lowFreeSpace(operation.freeBytes), finishedAt: startedAt, passed: context.passed === true,
      measuredBytes: validBytes(context.measuredBytes) ? context.measuredBytes : null };
    state.lastReceipt = result;
    await saveState(file, state, true);
    return result;
  }
  const packageSlot = context.packageSlot ?? null;
  if (packageSlot !== null && !hashIsValid(packageSlot)) throw refusal('The package slot is invalid');
  if (event === 'package' && !context.phase && state.active.some(item => item.event === 'package' && (
    (packageSlot && item.packageSlot === packageSlot) ||
    (context.build && item.build && pathKey(context.build) === pathKey(item.build)) ||
    (typeof context.releaseId === 'string' && typeof item.releaseId === 'string' &&
      context.releaseId.toLowerCase() === item.releaseId.toLowerCase())))) {
    throw Object.assign(new Error('A package operation already holds this slot, source or final release'), { code: 'BUSY' });
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
      const protectedInputs = event === 'package' && context.build ? [context.build] : [];
      const options = { ...context, home, coordinatorLease: lease, protectedInputs, prospectiveBytes: bytes };
      const plan = await prepareStoragePlan(options);
      plan.actions = plan.actions.filter(action => {
        if (context.target && pathKey(action.path) !== pathKey(context.target)) return false;
        return !isOperationInput(action.path, protectedInputs);
      });
      if (plan.actions.length) {
        cleanup = await applyStorageWithHeldGate(plan, options);
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
    Object.assign(operation, { freeBytes, lowFreeSpace: lowFreeSpace(freeBytes), bytes: Math.max(operation.bytes, bytes), reservedBytes });
    state.lastReceipt = { ...(state.lastReceipt?.id === operation.id ? state.lastReceipt : {}), ...operation };
    await requireHeldLease(home, lease);
    await saveState(file, state, true);
    return operation;
  }
  const reservation = { id: randomUUID(), event, task: context.task, build: context.build ?? null,
    releaseId: context.releaseId ?? null, packageSlot, startedAt, freeBytes, lowFreeSpace: lowFreeSpace(freeBytes), bytes, reservedBytes };
  state.active.push(reservation);
  state.lastReceipt = { ...reservation, maintenanceError };
  await requireHeldLease(home, lease);
  await saveState(file, state, true);
  return { ...reservation, maintenanceError, cleanup };
}
