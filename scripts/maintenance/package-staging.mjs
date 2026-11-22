import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { archiveName, catalogArchiveGroups, measureArchiveTargets, nativeArchiveOperation, readGuardedRecords } from './archive.mjs';
import { probePaths, requireHeldLease } from './guard.mjs';
import { assertNarrowRoot, isBuildName, isReleaseId, pathKey, refusal } from './policy.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashShape = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const states = ['initial', 'copying', 'ready', 'published', 'closed'];
const evidenceDirectory = home => path.join(home, 'maintenance-state', 'package-attempts');
const stateFile = (home, slot) => path.join(evidenceDirectory(home), slot + '.json');
const secretFile = home => path.join(evidenceDirectory(home), 'seal.json');
export const stagingDirectory = home => path.join(home, 'package-staging');
const slotFor = ({ source, dist, owner }) => hash(JSON.stringify(owner ? ['task', owner.id.toLowerCase()] : ['legacy', pathKey(source), dist.toLowerCase()]));
const stageFor = (home, slot) => path.join(stagingDirectory(home), slot);
const openStages = new WeakMap();

function hold(context, record) {
  if (record.owner) Object.freeze(record.owner);
  Object.freeze(record);
  openStages.set(record, context.lease);
  return record;
}

function requireOpen(context, record, status) {
  if (!record || openStages.get(record) !== context.lease || record.home !== context.home ||
      (status && record.status !== status)) throw refusal('This package attempt is not held by the calling operation');
}

async function rawRecord(file) {
  const [status] = await probePaths([file]);
  if (status === 'missing') return null;
  if (status !== 'plain') throw refusal('The package staging record is not a plain file');
  const bytes = (await readGuardedRecords([file])).get(file);
  if (!bytes) throw refusal('The package staging record cannot be verified');
  return bytes;
}

async function write(file, value, overwrite = false) {
  return nativeArchiveOperation('write', { writes: [{ path: file, data: JSON.stringify(value, null, 2) + '\n', overwrite }] });
}

export async function plainFileHash(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink !== 1 || pathKey(await fs.realpath(file)) !== pathKey(file)) {
    throw refusal('A package input is not an ordinary file');
  }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

function stamp(key, value) {
  if (!hashShape(key)) throw refusal('The package staging seal is invalid');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify(value)).digest();
}

function validReceipt(home, slot, record) {
  return record.version === 1 && record.home === home && record.slot === slot && isReleaseId(record.releaseId) &&
    isBuildName(record.dist) && typeof record.task === 'string' && hashShape(record.recipe) &&
    states.includes(record.status) && slotFor(record) === slot && record.stage === stageFor(home, slot);
}

export async function readPackageStage(home, slot) {
  if (!hashShape(slot)) return null;
  const file = stateFile(home, slot);
  const bytes = await rawRecord(file);
  if (!bytes) return null;
  const secret = JSON.parse(await rawRecord(secretFile(home)))?.key;
  const { seal, ...record } = JSON.parse(bytes);
  if (!hashShape(seal) || !timingSafeEqual(Buffer.from(seal, 'hex'), stamp(secret, record)) ||
      !validReceipt(home, slot, record)) throw refusal('The package staging evidence has changed');
  return { record, evidence: { path: file, bytes: bytes.length, sha256: hash(bytes) } };
}

async function save(context, record, overwrite) {
  const home = await requireHeldLease(context.home, context.lease);
  await nativeArchiveOperation('ensure-directories', { records: [evidenceDirectory(home)] });
  const keyFile = secretFile(home);
  let key = JSON.parse(await rawRecord(keyFile))?.key;
  if (!key) {
    key = randomBytes(32).toString('hex');
    await write(keyFile, { key });
  }
  await write(stateFile(home, record.slot), { ...record, seal: stamp(key, record).toString('hex') }, overwrite);
  return record;
}

export async function openPackageStage(context, descriptor) {
  const home = await requireHeldLease(context.home, context.lease);
  const slot = slotFor(descriptor), stage = stageFor(home, slot);
  const old = (await readPackageStage(home, slot))?.record;
  const [seen] = await probePaths([stage]);
  if (seen === 'unverified') throw refusal('The package staging directory is unsafe');
  if (old && (old.status === 'copying' || old.status === 'ready')) {
    if (old.releaseId !== descriptor.releaseId || old.recipe !== descriptor.recipe ||
        pathKey(old.source) !== pathKey(descriptor.source) || old.dist !== descriptor.dist ||
        JSON.stringify(old.owner) !== JSON.stringify(descriptor.owner)) {
      throw refusal('An unfinished package occupies this staging slot');
    }
    if (old.status === 'copying' && seen === 'missing') throw refusal('The recorded package staging directory is missing');
    if (seen === 'plain') {
      const [snapshot] = await measureArchiveTargets([stage]);
      if (snapshot?.identity !== old.identity || !snapshot.fingerprint) throw refusal('The package staging directory changed');
    }
    return hold(context, old);
  }
  if (seen !== 'missing') throw refusal('A package staging directory cannot be taken over');
  if ((await probePaths([path.join(home, 'releases', descriptor.releaseId)]))[0] !== 'missing') {
    throw refusal('Release already exists; it will not be overwritten');
  }
  if (old?.status === 'closed' && old.stageMissing === true) await retainMissingClosure(context, old);
  const record = await save(context, { version: 1, home, slot, stage, ...descriptor, status: 'initial',
    startedAt: new Date().toISOString() }, Boolean(old));
  await nativeArchiveOperation('ensure-directories', { records: [stagingDirectory(home)] });
  await fs.mkdir(stage);
  const [snapshot] = await measureArchiveTargets([stage]);
  if (!snapshot?.identity || snapshot.files !== 0 || (await fs.readdir(stage)).length) {
    throw refusal('The newly prepared staging directory cannot be verified');
  }
  return hold(context, await save(context, { ...record, status: 'copying', identity: snapshot.identity }, true));
}

export async function markPackageReady(context, record, payload, manifestSha256) {
  requireOpen(context, record, 'copying');
  const ready = await save(context, { ...record, status: 'ready', payloadIdentity: payload.identity,
    payloadFingerprint: payload.fingerprint, manifestSha256 }, true);
  openStages.delete(record);
  return hold(context, ready);
}

export async function markPackagePublished(context, record) {
  requireOpen(context, record, 'ready');
  // The two prepared children were moved to their final locations. An unexpected
  // child prevents rmdir; it is never removed or overwritten here.
  await fs.rmdir(record.stage).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await save(context, { ...record, status: 'published', publishedAt: new Date().toISOString() }, true);
  openStages.delete(record);
}

export async function recordPackageStageFailure(context, record, error) {
  if (!record) return;
  requireOpen(context, record);
  await save(context, { ...record, failure: { at: new Date().toISOString(), error: error.message } }, true);
}

async function retainStageState(context, record, prefix) {
  const home = await requireHeldLease(context.home, context.lease);
  const current = await readPackageStage(home, record.slot);
  if (!current || JSON.stringify(current.record) !== JSON.stringify(record)) {
    throw refusal('The package attempt changed before retaining its diagnostic');
  }
  const bytes = await rawRecord(stateFile(home, record.slot));
  if (!bytes || hash(bytes) !== current.evidence.sha256) throw refusal('The package attempt diagnostic changed');
  const file = path.join(evidenceDirectory(home), prefix + '-' + hash(bytes) + '.json');
  const prior = await rawRecord(file);
  if (prior && !prior.equals(bytes)) throw refusal('A retained package diagnostic contains different bytes');
  if (!prior) await nativeArchiveOperation('write', { writes: [{ path: file, data: bytes.toString('utf8'), overwrite: false }] });
  return { path: file, bytes: bytes.length, sha256: hash(bytes) };
}

async function retainMissingClosure(context, record) {
  const diagnostic = record.diagnostic;
  const expected = hashShape(diagnostic?.sha256)
    ? path.join(evidenceDirectory(context.home), 'diagnostic-' + diagnostic.sha256 + '.json') : null;
  if (!expected || diagnostic.path !== expected || !Number.isSafeInteger(diagnostic.bytes) || diagnostic.bytes < 1) {
    throw refusal('The missing stage diagnostic is not bound to this attempt');
  }
  const bytes = await rawRecord(expected);
  if (!bytes || bytes.length !== diagnostic.bytes || hash(bytes) !== diagnostic.sha256) {
    throw refusal('The retained missing stage diagnostic is missing or changed');
  }
  return retainStageState(context, record, 'closed');
}

export async function closePackageStage(context, { taskId, releaseId, source, dist, result, task }) {
  const home = await requireHeldLease(context.home, context.lease);
  if (!isReleaseId(releaseId)) throw refusal('Invalid release identity');
  if (!['superseded', 'rejected', 'unused'].includes(result)) throw refusal('An explicit staged package conclusion is required');
  if (source !== undefined) source = assertNarrowRoot(source);
  if (Boolean(source) !== Boolean(dist) || (dist && !isBuildName(dist))) {
    throw refusal('An exact legacy source and build directory are required');
  }
  const owner = source ? null : task?.status === 'closed' ? { id: task.id, worktree: task.worktree } : null;
  if (!source && !owner) throw refusal('A closed task is required to close a staged package');
  const slot = slotFor({ owner, source, dist });
  const found = (await readPackageStage(home, slot))?.record;
  if (!found || found.releaseId !== releaseId || found.task !== taskId ||
      (owner ? pathKey(found.owner?.worktree) !== pathKey(owner.worktree) :
        found.owner !== null || pathKey(found.source) !== pathKey(source) || found.dist !== dist) ||
      !['copying', 'ready', 'closed'].includes(found.status)) {
    throw refusal('No matching signed unfinished package belongs to this subject');
  }
  const release = path.join(home, 'releases', releaseId);
  const [stageState] = await probePaths([found.stage]);
  if (stageState === 'missing') {
    if (found.status === 'closed' && found.result !== result) throw refusal('The package already has a different conclusion');
    if ((await probePaths([release]))[0] !== 'missing') throw refusal('A published or unverified release must be preserved');
    let closed = found;
    if (found.stageMissing !== true) {
      const diagnostic = await retainStageState(context, found, 'diagnostic');
      if (!(await probePaths([found.stage, release])).every(state => state === 'missing')) {
        throw refusal('The missing stage or its final release reappeared and must be preserved');
      }
      const at = new Date().toISOString();
      closed = await save(context, { ...found, result, status: 'closed', closedAt: found.closedAt ?? at,
        stageMissing: true, stageMissingAt: at, diagnostic }, true);
    }
    const receipt = await retainMissingClosure(context, closed);
    return { task: taskId, release: releaseId, result, staged: true, stageMissing: true,
      diagnostic: closed.diagnostic, receipt };
  }
  if (found.stageMissing === true) throw refusal('A reappeared package staging tree must be preserved');
  const [snapshot] = await measureArchiveTargets([found.stage]);
  if (!snapshot?.fingerprint || snapshot.identity !== found.identity) throw refusal('The staged package ownership cannot be verified');
  if ((await probePaths([path.join(home, 'releases', releaseId)]))[0] !== 'missing') {
    throw refusal('A published candidate must be closed through its release record');
  }
  if (found.status === 'closed' && found.result !== result) throw refusal('The package already has a different conclusion');
  if (found.status !== 'closed') await save(context, { ...found, result, status: 'closed', closedAt: new Date().toISOString() }, true);
  return { task: taskId, release: releaseId, result, staged: true };
}

// Recataloging the originals gives retry an exact list of typed directories and
// ordinary files. It fills missing files, never replaces an unknown or changed one.
export async function resumableCopy(root, groups, { allowed = [] } = {}) {
  const sources = new Map();
  const directories = new Set();
  const addDirectory = name => {
    for (let folder = name; folder && folder !== '.'; folder = path.posix.dirname(folder)) directories.add(folder);
  };
  for (const { source, prefix = '', files, dirs } of groups) {
    if (prefix) addDirectory(prefix);
    for (const folder of dirs ?? []) addDirectory([prefix, folder].filter(Boolean).join('/'));
    for (const file of files) {
      const relative = archiveName([prefix, file.output ?? file.path].filter(Boolean).join('/'));
      if (sources.has(relative)) throw refusal('Duplicate package staging path');
      sources.set(relative, { path: path.join(source, file.path), sha256: file.sha256 });
      addDirectory(path.posix.dirname(relative));
    }
  }
  const [rootStatus] = await probePaths([root]);
  if (rootStatus === 'missing') await fs.mkdir(root);
  else if (rootStatus !== 'plain') throw refusal('The package staging tree is unsafe');
  const { groups: [existing] } = await catalogArchiveGroups([{ source: root }]);
  if (existing.files.some(name => !sources.has(name) && !allowed.includes(name)) ||
      existing.directories.some(name => !directories.has(name))) throw refusal('An unknown file occupies the package staging tree');
  const saved = new Set(existing.files);
  for (const folder of directories) await fs.mkdir(path.join(root, folder), { recursive: true });
  for (const [relative, input] of sources) {
    const target = path.join(root, relative);
    if (!saved.has(relative)) await fs.copyFile(input.path, target, constants.COPYFILE_EXCL);
    if (input.sha256 && await plainFileHash(target) !== input.sha256) {
      throw refusal('A staged package file differs from its checked source: ' + relative);
    }
  }
}

export async function packageTree(source, prefix = '', include = () => true) {
  const { groups: [group] } = await catalogArchiveGroups([{ source }]);
  const files = [];
  for (const file of group.files.filter(include)) files.push({ path: file, sha256: await plainFileHash(path.join(source, file)) });
  return { source, prefix, dirs: group.directories.filter(include), files };
}
