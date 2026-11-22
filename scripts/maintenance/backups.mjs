import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { archiveName, catalogArchiveGroups, deleteArchivedTarget, measureArchiveTargets, nativeArchiveOperation,
  openBackupFile, publishEvidenceArchive, readGuardedRecords, verifyArchive } from './archive.mjs';
import { inheritedMaintenanceLease, probePaths, requireHeldLease, requirePlainPath, resolveMaintenanceHome,
  withLifecycleLock, withReservationGate } from './guard.mjs';
import { guardedJson, writeRecords } from './lifecycle.mjs';
import { absolutePath, maintenancePolicy, pathInMaintenanceHome, pathKey, refusal, relativeWithin } from './policy.mjs';
import { resolveVerifiedRelease } from './release.mjs';
import { runLifecycle } from './storage.mjs';
import { backupHash, canonical, captureBackupSnapshot, parsePageSize, publicTables, snapshotFingerprint } from '../local-system-backup.mjs';

const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^point-[a-f0-9-]{36}$/.test(value);
const reasons = new Set(['routine', 'before-data-change', 'before-schema-change']);
const format = 'backup-v2+zip-v1';
// Agreed fallback: thirty elapsed days; no active dates are inferred.
// Rotation and the post-availability restore route use this exact freshness rule.
export function restoreDue({now=new Date().toISOString(),lastVerified,schemaHash,format:expectedFormat}={}) {
  const proof=lastVerified?.proof??lastVerified;
  const elapsed=Date.parse(now)-Date.parse(proof?.at);
  return !(proof?.passed===true&&proof.status==='passed'&&proof.schemaHash===schemaHash&&proof.format===expectedFormat&&
    Number.isFinite(elapsed)&&elapsed>=0&&elapsed<30*86400000);
}
const iso = value => { const date = new Date(value); if (!Number.isFinite(+date)) throw refusal('Invalid backup date'); return date.toISOString(); };
const localDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso(value)));
const when = value => typeof value === 'string' ? value : value?.at;

export function backupDue({ now = new Date().toISOString(), lastAttempt, lastComplete, reason = 'routine', schemaHash } = {}) {
  if (!reasons.has(reason)) throw refusal('Invalid backup reason');
  iso(now);
  if (reason !== 'routine') return { due: true, reason };
  const previous = when(lastAttempt) ?? when(lastComplete);
  if (previous && localDay(previous) >= localDay(now)) return { due: false, reason: 'routine-already-attempted-today' };
  return { due: true, reason: schemaHash && lastComplete?.schemaHash !== schemaHash ? 'schema-changed' : 'routine-due' };
}

export function selectBackupRetention(backups, now = new Date().toISOString()) {
  iso(now);
  const keep = new Set(), slots = { daily: [], weekly: [], monthly: [] };
  const complete = backups.filter(point => {
    if (point.archiveUnavailable || point.archiveRemoved) { keep.add(point.id); return false; }
    if (point.legacy !== false || !point.complete || point.pinned || point.restorePins?.length || point.restored || point.lastRestored ||
        !Number.isFinite(Date.parse(point.at)) || Date.parse(point.at) > Date.parse(now)) keep.add(point.id);
    return point.legacy === false && point.complete && Date.parse(point.at) <= Date.parse(now);
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  const period = (point, kind) => {
    const day = localDay(point.at);
    if (kind === 'daily') return day;
    if (kind === 'monthly') return day.slice(0, 7);
    const date = new Date(day + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  };
  for (const [kind, limit] of [['daily', 7], ['weekly', 4], ['monthly', 6]]) {
    const periods = new Set();
    for (const point of complete) {
      const key = period(point, kind);
      if (periods.has(key)) continue;
      periods.add(key); slots[kind].push(point.id); keep.add(point.id);
      if (periods.size === limit) break;
    }
  }
  return { keep: [...keep], eligible: backups.filter(p => !keep.has(p.id)).map(p => p.id), slots };
}

async function smallJson(file, max = 16 * 1024 ** 2) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink !== 1 || info.size > max) throw refusal('Invalid backup metadata file');
  const bytes = (await readGuardedRecords([file])).get(file);
  if (!bytes || bytes.length > max) throw refusal('Backup metadata is missing');
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}


export async function verifyBackupBytes(input) {
  const directory = path.resolve(typeof input === 'string' ? input : input.directory);
  await requirePlainPath(directory);
  if ((await probePaths([path.join(directory, 'incomplete-manifest.json')]))[0] !== 'missing') throw refusal('The backup is explicitly incomplete');
  const [before] = await measureArchiveTargets([directory]);
  if (!validHash(before?.fingerprint)) throw refusal('Backup tree bytes cannot be verified');
  const { value: manifest } = await smallJson(path.join(directory, 'manifest.json'));
  if (manifest.version !== 2 || !Array.isArray(manifest.errors) || manifest.errors.length ||
      !Array.isArray(manifest.tables) || !Array.isArray(manifest.objects) || !Array.isArray(manifest.buckets)) throw refusal('The backup is incomplete or unsupported');
  const { bytes: schemaBytes, value: schema } = await smallJson(path.join(directory, 'schema.json'));
  if (backupHash(schemaBytes) !== manifest.schemaSha256) throw refusal('Schema bytes differ');
  const expectedTables = publicTables(schema);
  if (canonical(expectedTables) !== canonical(manifest.tables.map(t => ({ name: t.name, primaryKey: t.primaryKey })))) throw refusal('Incomplete or duplicate table coverage');
  if (manifest.buckets.some(b => typeof b.id !== 'string') || new Set(manifest.buckets.map(b => b.id)).size !== manifest.buckets.length) throw refusal('Invalid bucket coverage');
  const files = [{ file: 'schema.json', size: schemaBytes.length, sha256: backupHash(schemaBytes) }], names = new Set(['schema.json', 'manifest.json']), keys = new Set();
  const actualFiles = new Map((await nativeArchiveOperation('backup-files', {
    records: [...manifest.tables, ...manifest.objects].map(row => path.join(directory, archiveName(row.file))),
  })).map(entry => [pathKey(entry.path), entry]));
  const counts = new Map((await nativeArchiveOperation('backup-table-counts', {
    records: manifest.tables.map(table => path.join(directory, archiveName(table.file))),
  })).map(row => [pathKey(row.path), row.count]));
  for (const [kind, rows] of [['table', manifest.tables], ['object', manifest.objects]]) for (const row of rows) {
    const name = archiveName(row.file);
    if (names.has(name.toLowerCase()) || !validHash(row.sha256)) throw refusal('Duplicate or invalid backup file');
    if (kind === 'table' && name !== 'tables/' + row.name + '.json') throw refusal('Invalid table file');
    if (kind === 'object') {
      const key = canonical([row.bucket, row.key]);
      if (keys.has(key) || !manifest.buckets.some(b => b.id === row.bucket) || typeof row.key !== 'string' || !row.key ||
          name !== 'objects/' + backupHash(row.bucket + '\0' + row.key)) throw refusal('Invalid object coverage');
      keys.add(key);
    }
    names.add(name.toLowerCase());
    const checked = actualFiles.get(pathKey(path.join(directory, name)));
    if (!checked || checked.sha256 !== row.sha256 || row.size !== undefined && checked.size !== row.size ||
        kind === 'object' && checked.size !== row.metadata?.metadata?.size || kind === 'table' && counts.get(pathKey(path.join(directory, name))) !== row.count) throw refusal('Backup file hash, bytes or count differ');
    files.push({ file: name, size: checked.size, sha256: checked.sha256 });
  }
  const { groups: [catalog] } = await catalogArchiveGroups([{ source: directory }]);
  if (catalog.files.length !== names.size || catalog.files.some(name => !names.has(name.toLowerCase()))) throw refusal('Unmanifested backup bytes');
  const [after] = await measureArchiveTargets([directory]);
  if (after?.fingerprint !== before.fingerprint || after.identity !== before.identity) throw refusal('Backup bytes changed during verification');
  return { contentFingerprint: snapshotFingerprint(manifest, files), files, bytes: files.reduce((sum, f) => sum + f.size, 0),
    schemaHash: manifest.schemaSha256, manifest, tree: after };
}

// B2 must persist exact byte-backed restore evidence. A status-only/legacy proof
// never enables deletion, nor does a proof for an older schema or different point.
export function rotationEvidenceMatches(proof, point, now, home) {
  let slot=false;
  try{const file=absolutePath(point.archive.path),root=home??path.dirname(path.dirname(path.dirname(file)));
    slot=pathKey(file)===pathKey(path.join(root,'backups','archives',point.id+'.zip'));
  }catch{/* Older records remain history; they require a new exact restore. */}
  return Boolean(slot && point?.archive?.format === 'zip-v1' && validHash(point.archive.sha256) && validHash(point.archive.contentFingerprint) && validHash(point.archive.metadataSha256) &&
    proof?.sourceArchiveSha256===point.archive.sha256 && proof?.sourceArchiveFingerprint===point.archive.contentFingerprint && proof?.sourceSidecarSha256===point.archive.metadataSha256 && proof?.version === 1 && proof.passed === true && proof.status === 'passed' &&
    validId(proof.backupId) && proof.backupId === point.id && proof.backupFingerprint === point.contentFingerprint &&
    validHash(proof.backupFingerprint) && proof.schemaHash === point.schemaHash && validHash(proof.schemaHash) &&
    proof.format === format && point.format === format && Number.isFinite(Date.parse(proof.at)) &&
    !restoreDue({now,lastVerified:proof,schemaHash:point.schemaHash,format:point.format}) &&
    ['tables', 'storage', 'schema', 'permissions'].every(check => proof.checks?.[check] === true) &&
    Number.isSafeInteger(proof.counts?.tables) && proof.counts.tables === point.counts?.tables &&
    Number.isSafeInteger(proof.counts?.objects) && proof.counts.objects === point.counts?.objects);
}

const indexFile = home => path.join(home, 'maintenance-state', 'backup-index.json');
const revisions = new WeakMap();
async function loadIndex(home) {
  const file = indexFile(home), [state] = await probePaths([file]);
  if (state === 'missing') {
    const empty = { version: 1, points: [], lastAttempt: null, lastComplete: null, lastVerified: null };
    revisions.set(empty, canonical(empty)); return empty;
  }
  if (state !== 'plain') throw refusal('Backup index is unsafe');
  const index = await guardedJson(file);
  if (index.version !== 1 || !Array.isArray(index.points) || new Set(index.points.map(p => p.id)).size !== index.points.length) throw refusal('Backup index is invalid');
  for (const point of index.points) if (point.legacy === false && !validId(point.id)) throw refusal('Invalid managed backup identity');
  revisions.set(index, canonical(index)); return index;
}
async function saveIndexHeld(home, index) {
  const fresh = await loadIndex(home);
  if (canonical(fresh) !== revisions.get(index)) throw Object.assign(Error('The backup index changed before publication'), { code: 'BUSY' });
  await writeRecords([{ path: indexFile(home), value: index, overwrite: true }]);
  revisions.set(index, canonical(index));
}
async function saveIndex(home, lease, index) {
  return withReservationGate(home, lease, () => saveIndexHeld(home, index));
}
// B2 proof/index writers use this same short gate and mutate a freshly loaded
// index. Prepare/verify large evidence outside it; publish evidence + reference
// together inside the callback. Never call this while already holding the gate.
export async function updateBackupIndex(home, lease, update) {
  home = await requireHeldLease(home, lease);
  return withReservationGate(home, lease, async () => {
    const index = await loadIndex(home);
    const result = await update(index);
    await saveIndexHeld(home, index);
    return result;
  });
}
async function legacyPoints(home, index) {
  const root = path.join(home, 'backups');
  const names = await nativeArchiveOperation('list', { target: root });
  for (const file of names) {
    const name = path.basename(file);
    if (name === 'archives' || index.points.some(p => p.originalName === name || p.id === name)) continue;
    index.points.push({ id: 'legacy-' + backupHash(name), originalName: name, legacy: true, complete: false, protected: true,
      aliases: [{ name, at: null }] });
  }
}
export async function backupStatus({ home } = {}) {
  home = await resolveMaintenanceHome({ explicitHome: home });
  const index = await loadIndex(home);
  return { ...index, due: backupDue({ lastAttempt: index.lastAttempt, lastComplete: index.lastComplete }).due };
}

async function verifiedClient({ home, releaseId, schemaPath, envPath }) {
  const binding = await resolveVerifiedRelease({ home, releaseId });
  const { parse } = binding.require('dotenv'), { createClient } = binding.require('@supabase/supabase-js');
  const config = envPath ?? path.join(home, 'config', 'system.env');
  const envBytes = (await readGuardedRecords([path.resolve(config)])).get(path.resolve(config));
  if (!envBytes) throw refusal('Backup configuration is missing');
  const env = { ...process.env, ...parse(envBytes) };
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(90000) }) },
  });
  const source = path.resolve(schemaPath ?? path.join(binding.release.root, 'ops', 'backup-schema.json'));
  const bytes = (await readGuardedRecords([source])).get(source);
  if (!bytes) throw refusal('Versioned backup schema metadata is missing');
  if (schemaPath === undefined && !binding.release.files.some(file =>
    file.path.replaceAll('\\', '/') === 'ops/backup-schema.json' && file.sha256 === backupHash(bytes))) {
    throw refusal('The default backup schema differs from the verified release');
  }
  return { client, schemaBytes: bytes, provenance: { releaseId: binding.release.id, schemaSource: source, schemaSha256: backupHash(bytes) } };
}

async function freshBudget(home, bytes, getFreeBytes) {
  const data = getFreeBytes ? null : await fs.statfs(home, { bigint: true });
  const free = getFreeBytes ? await getFreeBytes(home) : Number(data.bavail * data.bsize);
  if (!Number.isSafeInteger(free) || free - bytes < maintenancePolicy.minimumFreeBytes) throw Object.assign(Error('Insufficient verified disk space for backup'), { code: 'LOW_DISK' });
}
async function materializationSink(directory, expected, getFreeBytes) {
  const limits = new Map(expected.files.map(f => [f.file, f.size]));
  return async file => {
    archiveName(file);
    if (!limits.has(file)) throw refusal('Unplanned backup file');
    const output = await openBackupFile({ directory, file, maximumBytes: limits.get(file) }); let written = 0;
    return { async write(bytes) { written += bytes.length;
      if (written > limits.get(file)) throw refusal('Backup grew beyond the admitted snapshot');
      await freshBudget(directory, bytes.length, getFreeBytes); await output.write(bytes); },
    close: () => output.close(), abort: () => output.abort() };
  };
}

export async function maintainBackups({ home, lease, reason = 'routine', now = new Date().toISOString(),
  releaseId, pageSize, schemaPath, envPath, destination, reuse, client, schemaBytes, getFreeBytes } = {}) {
  if (!reasons.has(reason)) throw refusal('Invalid backup reason');
  pageSize = parsePageSize(pageSize); now = iso(now);
  home = await requireHeldLease(home, lease);
  const options = { home, lease, event: 'backup', task: 'data-backup', cleanup: false, ...(getFreeBytes ? { getFreeBytes } : {}) };
  const reservation = await runLifecycle('backup', options);
  let passed = false, index, receipt, point, primaryFailure;
  try {
    index = await loadIndex(home);
    if (await reconcileRemovalIntents(home, index, now)) await saveIndex(home, lease, index);
    await nativeArchiveOperation('ensure-directories', { records: [path.join(home, 'backups'), path.join(home, 'backups', 'archives')] });
    await legacyPoints(home, index);
    const due = backupDue({ now, lastAttempt: index.lastAttempt, lastComplete: index.lastComplete, reason });
    receipt = { version: 1, at: now, reason, due: due.due, created: [], reused: [], archived: [], protected: [], failed: [] };
    if (!due.due) { passed = true; return { ...receipt, previousComplete: index.lastComplete, protected: ['routine-already-attempted-today'] }; }
    index.lastAttempt = { at: now, reason, passed: false };
    await saveIndex(home, lease, index);
    if (index.points.some(p => p.legacy === false && !p.complete)) throw Object.assign(
      Error('An incomplete managed backup is protected; resolve its recorded slot before another materialization'), { code: 'INCOMPLETE_BACKUP' });
    const binding = client && schemaBytes ? { client, schemaBytes, provenance: { synthetic: true } }
      : await verifiedClient({ home, releaseId, schemaPath, envPath });
    const first = await captureBackupSnapshot({ ...binding, pageSize, now });
    const previous = index.points.find(p => p.id === index.lastComplete?.id);
    if (previous?.complete && !previous.archiveUnavailable && previous.contentFingerprint === first.contentFingerprint) {
      const previousCheck = await verifyPoint(home, previous);
      if (!previous.archive) {
        const forecast = Math.ceil(first.bytes * 1.1) + 16 * 1024 ** 2;
        await runLifecycle('backup', { ...options, phase: 'resize', reservation, expectedAdditionalBytes: forecast });
        await freshBudget(home, forecast, getFreeBytes);
        await compressPoint(home, lease, index, previous, previousCheck, receipt);
      }
      previous.aliases.push({ name: destination ? path.basename(destination) : 'unchanged-' + now, at: now,
        reason, provenance: binding.provenance, contentFingerprint: first.contentFingerprint,
        schemaHash: first.manifest.schemaSha256, format, verifiedReference: previous.id });
      index.lastAttempt = { at: now, reason, passed: true, reused: previous.id };
      index.lastComplete = { id: previous.id, at: now, schemaHash: first.manifest.schemaSha256 };
      receipt.reused.push(previous.id);
      previous.verifiedAt = now;
    } else {
      const id = 'point-' + randomUUID();
      const directory = destination ? pathInMaintenanceHome(home, path.resolve(destination)) : path.join(home, 'backups', id);
      if (pathKey(path.dirname(directory)) !== pathKey(path.join(home, 'backups')) ||
          (await probePaths([directory]))[0] !== 'missing') throw refusal('A new backup destination directly inside HOME/backups is required');
      const forecast = Math.ceil(first.bytes * 2.2) + 16 * 1024 ** 2 + Buffer.byteLength(canonical(first.manifest)) * 4;
      await runLifecycle('backup', { ...options, phase: 'resize', reservation, expectedAdditionalBytes: forecast });
      point = { id, originalName: path.basename(directory), legacy: false, complete: false, at: now, reason, format,
        schemaHash: first.manifest.schemaSha256, contentFingerprint: first.contentFingerprint, directory,
        provenance: binding.provenance, aliases: [{ name: path.basename(directory), at: now }], counts: {
          tables: first.manifest.tables.length, objects: first.manifest.objects.length }, pinned: false };
      index.points.push(point); await saveIndex(home, lease, index);
      await nativeArchiveOperation('ensure-directories', { records: [directory, path.join(directory, 'tables'), path.join(directory, 'objects')] });
      const materialized = await captureBackupSnapshot({ ...binding, pageSize, now, sink: await materializationSink(directory, first, getFreeBytes) });
      if (materialized.contentFingerprint !== first.contentFingerprint) throw refusal('Backup snapshot changed before materialization completed');
      await writeRecords([{ path: path.join(directory, 'manifest.json'), value: materialized.manifest }]);
      const checked = await verifyBackupBytes(directory);
      if (checked.contentFingerprint !== first.contentFingerprint) throw refusal('Materialized backup bytes differ');
      point.complete = true; point.verifiedAt = now;
      index.lastComplete = { id, at: now, schemaHash: point.schemaHash };
      index.lastAttempt = { at: now, reason, passed: true, created: id };
      receipt.created.push(id);
      await saveIndex(home, lease, index);
      await freshBudget(home, Math.ceil(first.bytes * 1.1) + 16 * 1024 ** 2, getFreeBytes);
      await compressPoint(home, lease, index, point, checked, receipt);
    }
    // Existing --reuse remains accepted but cannot replace fresh Storage reads.
    if (reuse) receipt.cacheIgnored = true;
    const complete = index.points.find(p => p.id === index.lastComplete.id);
    receipt.verification = { id: complete.id, at: now, contentFingerprint: complete.contentFingerprint,
      schemaHash: complete.schemaHash, format: complete.format, archive: complete.archive?.path, directory: complete.directory };
    await rotatePoints(home, lease, index, now, receipt);
    passed = true; index.lastReceipt = receipt; await saveIndex(home, lease, index);
    return receipt;
  } catch (error) {
    receipt ??= { version: 1, at: now, reason, created: [], reused: [], archived: [], protected: [], failed: [] };
    const failureReason = error.code === 'LOW_DISK' ? 'insufficient-space' : error.code === 'INCOMPLETE_BACKUP' ? 'incomplete-managed-slot' : 'backup-not-verified';
    receipt.failed.push({ code: error.code ?? 'FAILED', reason: failureReason });
    if (error.cleanupFailures?.length) (receipt.cleanupFailures ??= []).push(...error.cleanupFailures);
    if (index) { index.lastReceipt = receipt; await saveIndex(home, lease, index).catch(() => {}); }
    if (point && !point.complete) await writeRecords([{ path: path.join(point.directory, 'incomplete-manifest.json'), value: { version: 2, complete: false, at: now, error: 'Backup could not be verified' } }]).catch(() => {});
    primaryFailure = Object.assign(Error(error.code === 'INCOMPLETE_BACKUP' ? error.message :
      'Backup could not be verified; the dependent maintenance operation must not continue'), { code: error.code ?? 'FAILED', receipt, cause: error });
    throw primaryFailure;
  } finally {
    try { await runLifecycle('backup', { ...options, phase: 'finish', reservation, passed }); }
    catch (cleanup) {
      (receipt.cleanupFailures ??= []).push({ operation: 'reservation-finish', code: cleanup.code ?? 'FAILED' });
      if (index) { index.lastReceipt = receipt; await saveIndex(home, lease, index).catch(() => {}); }
      if (!primaryFailure) throw Object.assign(Error('The backup receipt could not finish its reservation'), {
        code: cleanup.code ?? 'FAILED', receipt, cause: cleanup });
    }
  }
}

async function verifyPoint(home, point) {
  if (point.archive) {
    const expected = path.join(home, 'backups', 'archives', point.id + '.zip');
    if (pathKey(point.archive.path) !== pathKey(expected)) throw refusal('Backup archive is outside its managed slot');
    const metadata = await nativeArchiveOperation('backup-metadata', { file: expected, archiveSha256: point.archive.sha256 });
    const verified = metadata.archive;
    if (verified.sha256 !== point.archive.sha256 || verified.contentFingerprint !== point.archive.contentFingerprint) throw refusal('Backup archive bytes changed');
    const manifest = JSON.parse(Buffer.from(metadata.manifest, 'base64').toString('utf8'));
    const schemaBytes = Buffer.from(metadata.schema, 'base64');
    const files = verified.entries.filter(entry => entry.path !== 'artifact/manifest.json').map(entry => ({
      file: entry.path.replace(/^artifact\//, ''), size: entry.size, sha256: entry.sha256,
    }));
    if (manifest.version !== 2 || manifest.errors?.length !== 0 || backupHash(schemaBytes) !== point.schemaHash ||
        manifest.schemaSha256 !== point.schemaHash || manifest.tables?.length !== point.counts?.tables ||
        manifest.objects?.length !== point.counts?.objects || snapshotFingerprint(manifest, files) !== point.contentFingerprint) throw refusal('Archived backup fingerprint or schema differs');
    if (!validHash(metadata.metadataSha256)) throw refusal('The verified archive sidecar hash is missing');
    return { ...verified, metadataSha256: metadata.metadataSha256 };
  }
  if (!point.directory || pathKey(path.dirname(point.directory)) !== pathKey(path.join(home, 'backups'))) throw refusal('The raw backup is outside its managed slot');
  const checked = await verifyBackupBytes(point.directory);
  if (checked.contentFingerprint !== point.contentFingerprint) throw refusal('Previous backup bytes differ');
  return checked;
}

async function compressPoint(home, lease, index, point, checked, receipt) {
  await requireHeldLease(home, lease);
  const { groups } = await catalogArchiveGroups([{ source: point.directory, prefix: 'artifact' }]);
  const archive = await publishEvidenceArchive({ groups, destination: path.join(home, 'backups', 'archives', point.id + '.zip'),
    targetFingerprint: checked.tree.fingerprint, targetIdentity: checked.tree.identity });
  const verified = await verifyArchive(archive.path);
  if (verified.sha256 !== archive.sha256 || verified.contentFingerprint !== archive.contentFingerprint) throw refusal('Archive reread differs');
  point.archive = { format: verified.format, path: verified.path, sha256: verified.sha256,
    contentFingerprint: verified.contentFingerprint, metadataSha256: verified.metadataSha256, verifiedAt: verified.verifiedAt };
  point.rawRemovalIntent = { at: receipt.at, directory: point.directory, archivePath: verified.path,
    archiveSha256: verified.sha256, targetFingerprint: checked.tree.fingerprint, targetIdentity: checked.tree.identity };
  await saveIndex(home, lease, index);
  // Preserve the archived point before any source removal, including interruption.
  const removed = await deleteArchivedTarget({ archive: verified, target: point.directory,
    targetFingerprint: checked.tree.fingerprint, targetIdentity: checked.tree.identity, resume: false }, async phase => {
    if (!await terminalProtection(home, index, point, receipt.at, false)) return false;
    if (phase === 'commit') {
      point.rawRemovalIntent.authorizedAt = new Date().toISOString();
      await saveIndexHeld(home, index);
    }
    return true;
  }, run => withReservationGate(home, lease, run));
  point.rawRemoved = removed.status === 'completed';
  point.rawRemovalOutcome = { at: new Date().toISOString(), status: removed.status, confirmedDeletion: point.rawRemoved };
  receipt.archived.push({ id: point.id, archive: archive.path, sourceRemoved: point.rawRemoved });
}

async function rotationProof(home, index, current, now) {
  const record = index.lastVerified;
  if (!current?.complete || current.archiveRemoved || current.archive?.format !== 'zip-v1' || !record || !validHash(record.evidenceSha256) || typeof record.evidencePath !== 'string' ||
      relativeWithin(path.join(home, 'maintenance-state', 'restore-evidence'), record.evidencePath) === null) return null;
  const { bytes, value } = await smallJson(record.evidencePath);
  const restored = index.points.find(point => point.id === value.backupId);
  if (!restored?.complete || restored.archiveRemoved || restored.archive?.format !== 'zip-v1' || restored.schemaHash !== current.schemaHash || restored.format !== current.format ||
      backupHash(bytes) !== record.evidenceSha256 || canonical(value) !== canonical(record.proof) || !rotationEvidenceMatches(value, restored, now, home)) return null;
  const protectedBackups = [];
  for (const point of [restored, ...(current.id === restored.id ? [] : [current])]) {
    const verified = await verifyPoint(home, point);
    if (verified.format !== 'zip-v1' || !validHash(verified.metadataSha256) || point.id===value.backupId && verified.metadataSha256!==value.sourceSidecarSha256) return null;
    protectedBackups.push({ id: point.id, file: verified.path, sha256: verified.sha256, metadataSha256: verified.metadataSha256 });
  }
  return { proof: value, protectedBackups };
}

export function backupPinsPoint(home, point, pins) {
  const references = [point.directory, point.archive?.path, point.archive && point.archive.path + '.manifest.json'].filter(Boolean)
    .map(file => pathInMaintenanceHome(home, file));
  return pins.some(pin => {
    if (pin === point.id) return true;
    if (typeof pin !== 'string' || !path.isAbsolute(pin)) return false;
    let actual = absolutePath(pin);
    try { actual = pathInMaintenanceHome(home, actual); } catch { /* External ancestor/worktree pins keep their original path, as inventory. */ }
    return references.some(ref => relativeWithin(actual, ref) !== null || relativeWithin(ref, actual) !== null);
  });
}

async function taskPins(home, point) {
  const root = path.join(home, 'maintenance-state', 'tasks');
  const names = await nativeArchiveOperation('list', { target: root });
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9_-]{0,89}\.json$/i.test(name)) throw refusal('Unknown task protection record');
    const task = await guardedJson(path.join(root, name));
    if (!Array.isArray(task.pins)) throw refusal('Task pins cannot be verified');
    if (backupPinsPoint(home, point, task.pins)) return true;
  }
  return false;
}

// Large ZIP verification is finished before this metadata-only terminal check.
// The native confirm+commit stays within the caller's reservation gate, shared
// with updateTask and updateBackupIndex. No ZIP or source-body reads here.
async function terminalProtection(home, baseline, point, now, needsRestore) {
  const taskRoot = path.join(home, 'maintenance-state', 'tasks');
  const names = await nativeArchiveOperation('list', { target: taskRoot });
  if (names.some(name => !/^[a-z0-9][a-z0-9_-]{0,89}\.json$/i.test(name))) return false;
  const evidencePath = needsRestore ? baseline.lastVerified?.evidencePath : null;
  if (needsRestore && !evidencePath) return false;
  const files = [indexFile(home), ...(evidencePath ? [evidencePath] : []), ...names.map(name => path.join(taskRoot, name))];
  const records = await readGuardedRecords(files);
  const fresh = JSON.parse(records.get(indexFile(home)));
  if (fresh.version !== 1 || !Array.isArray(fresh.points) || canonical(fresh.lastComplete) !== canonical(baseline.lastComplete)) return false;
  const candidate = fresh.points.find(p => p.id === point.id);
  if (!candidate?.complete || candidate.legacy !== false || candidate.pinned || candidate.restorePins?.length || candidate.archiveUnavailable ||
      canonical(candidate) !== canonical(point)) return false;
  for (const name of names) {
    const task = JSON.parse(records.get(path.join(taskRoot, name)));
    if (!Array.isArray(task.pins) || backupPinsPoint(home, candidate, task.pins)) return false;
  }
  if (!needsRestore) return true;
  const evidence = records.get(evidencePath);
  if (!evidence || backupHash(evidence) !== baseline.lastVerified.evidenceSha256 ||
      canonical(fresh.lastVerified) !== canonical(baseline.lastVerified)) return false;
  const proof = JSON.parse(evidence), restored = fresh.points.find(p => p.id === proof.backupId);
  const current = fresh.points.find(p => p.id === fresh.lastComplete?.id);
  const originalCurrent = baseline.points.find(p => p.id === baseline.lastComplete?.id);
  const originalRestored = baseline.points.find(p => p.id === proof.backupId);
  return Boolean(restored?.complete && current?.complete && !restored.archiveUnavailable && !current.archiveUnavailable &&
    canonical(proof) === canonical(fresh.lastVerified.proof) && rotationEvidenceMatches(proof, restored, now, home) &&
    restored.schemaHash === current.schemaHash && restored.format === current.format &&
    canonical(current) === canonical(originalCurrent) && canonical(restored) === canonical(originalRestored) &&
    selectBackupRetention(fresh.points.filter(p => !p.archiveRemoved && !p.archiveUnavailable)
      .map(p => ({ ...p, restored: p.id === proof.backupId })), now).eligible.includes(point.id));
}

async function reconcileRemovalIntents(home, index, now) {
  let changed = false;
  for (const point of index.points) {
    if (point.legacy !== false || !validId(point.id) || !point.complete || !point.archive) continue;
    const expected = path.join(home, 'backups', 'archives', point.id + '.zip');
    if (pathKey(point.archive.path) !== pathKey(expected)) continue;
    if (point.pruneIntent && !point.pruneOutcome && point.pruneIntent.archiveSha256 === point.archive.sha256) {
      const intent = point.pruneIntent;
      const exactAuthorization = intent.archivePath === expected && validHash(intent.metadataSha256) &&
        validHash(intent.evidenceSha256) && Number.isFinite(Date.parse(intent.authorizedAt));
      const states = await probePaths([expected, expected + '.manifest.json']);
      const absent = states.every(state => state === 'missing');
      point.pruneOutcome = { at: now, status: absent ? (exactAuthorization ? 'missing-after-authorized-intent' :
        'missing-after-unconfirmed-intent') : states.every(state => state === 'plain') ? 'pair-present-after-interruption' : 'partial-pair-protected',
      confirmedDeletion: false };
      if (!states.every(state => state === 'plain')) point.archiveUnavailable = true;
      changed = true;
    }
    if (!point.rawRemoved && !point.rawRemovalOutcome && point.directory &&
        pathKey(path.dirname(point.directory)) === pathKey(path.join(home, 'backups'))) {
      const [state] = await probePaths([point.directory]);
      const intent = point.rawRemovalIntent;
      const exactIntent = intent?.archivePath === expected && intent.directory === point.directory &&
        intent.archiveSha256 === point.archive.sha256 && validHash(intent.targetFingerprint) && typeof intent.targetIdentity === 'string';
      if (!exactIntent && state === 'plain') continue;
      point.rawMissing = state === 'missing';
      point.rawRemovalOutcome = { at: now, status: point.rawMissing ? (exactIntent ? 'missing-after-intent' : 'missing-without-authorized-intent') :
        state === 'plain' ? 'source-present-after-interruption' : 'unverified-source-protected', confirmedDeletion: false };
      changed = true;
    }
  }
  return changed;
}

async function rotatePoints(home, lease, index, now, receipt) {
  const current = index.points.find(p => p.id === index.lastComplete?.id);
  if (!current?.complete || localDay(index.lastComplete.at) !== localDay(now)) { receipt.protected.push('no-fresh-complete-backup'); return; }
  let verifiedSources;
  try { verifiedSources = await rotationProof(home, index, current, now); }
  catch { receipt.protected.push('restore-evidence-or-source-unavailable'); return; }
  if (!verifiedSources) { receipt.protected.push('matching-verified-restore-required'); return; }
  const { proof, protectedBackups } = verifiedSources;
  const selected = selectBackupRetention(index.points.filter(p => !p.archiveRemoved && !p.archiveUnavailable).map(p => ({ ...p, restored: p.id === proof.backupId })), now);
  for (const id of selected.eligible) {
    const point = index.points.find(p => p.id === id);
    try {
      if (point.schemaHash !== proof.schemaHash || point.format !== proof.format) {
        receipt.protected.push({ id, reason: 'different-schema-or-format-requires-own-restore' });
        continue;
      }
      if (point.legacy !== false || !point.complete || !point.archive || !(point.rawRemoved || point.rawMissing) || point.archiveRemoved || point.archiveUnavailable || point.pinned ||
          point.id === proof.backupId || await taskPins(home, point)) continue;
      const verified = await verifyPoint(home, point);
      const sidecar = await nativeArchiveOperation('hash-file', { target: verified.path + '.manifest.json' });
      point.pruneIntent = { at: now, archivePath: verified.path, archiveSha256: verified.sha256,
        metadataSha256: sidecar.sha256, evidenceSha256: index.lastVerified.evidenceSha256 };
      delete point.pruneOutcome;
      await saveIndex(home, lease, index);
      const outcome = await nativeArchiveOperation('backup-prune', { file: verified.path, archiveSha256: verified.sha256,
        archiveMetadataSha256: sidecar.sha256,
        protectedBackups,
        target: home, destination: id }, async phase => {
        if (!await terminalProtection(home, index, point, now, true)) return false;
        if (phase === 'commit') {
          point.pruneIntent.authorizedAt = new Date().toISOString();
          await saveIndexHeld(home, index);
        }
        return true;
      }, run => withReservationGate(home, lease, run));
      if (outcome.status === 'completed') {
        point.prunedAt = now; point.archiveRemoved = true; receipt.archived.push({ id, pruned: true });
      } else receipt.protected.push({ id, reason: 'retention-protection-changed' });
      point.pruneOutcome = { at: now, status: outcome.status };
      await saveIndex(home, lease, index);
    } catch {
      receipt.protected.push({ id, reason: 'retention-not-authorized' });
      return;
    }
  }
}

export async function backupCli(args = []) {
  const flags = new Map();
  while (args.length) {
    const name = args.shift(), value = args.shift();
    if (!['--destination', '--schema', '--env', '--reuse', '--page-size', '--reason', '--home'].includes(name) || !value || value.startsWith('--') || flags.has(name)) throw refusal('Invalid backup options');
    flags.set(name, value);
  }
  const home = await resolveMaintenanceHome({ explicitHome: flags.has('--home') ? path.resolve(flags.get('--home')) : undefined });
  return withLifecycleLock(home, 'backup', lease => maintainBackups({ home, lease, reason: flags.get('--reason') ?? 'routine',
    pageSize: flags.get('--page-size'), schemaPath: flags.get('--schema'), envPath: flags.get('--env'),
    destination: flags.get('--destination'), reuse: flags.get('--reuse') }), inheritedMaintenanceLease());
}

export async function maintainAvailableBackups(event, context) {
  if (!['start', 'install', 'rollback'].includes(event)) return;
  const backup=await maintainBackups({ ...context, reason: 'routine' });
  // Even an unchanged-day backup receipt must not bypass a due restore.
  const {maintainAvailableRestore}=await import('../local-system-restore.mjs');
  const restore=await maintainAvailableRestore(context);
  return {...backup,restore};
}
