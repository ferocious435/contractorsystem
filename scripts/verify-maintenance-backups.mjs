import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { backupDue, selectBackupRetention, verifyBackupBytes, maintainBackups, rotationEvidenceMatches } from './maintenance/backups.mjs';
import { captureBackupSnapshot, parsePageSize } from './local-system-backup.mjs';
import { withMaintenanceLock } from './maintenance/guard.mjs';
import { nativeArchiveOperation, openBackupFile, catalogArchiveGroups, publishEvidenceArchive } from './maintenance/archive.mjs';
import { publishLauncherBundle } from './maintenance/lifecycle.mjs';
import { runLifecycle } from './maintenance/storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const day = '2026-06-08T10:00:00.000Z';
const schema = { tables: [{ schema: 'public', name: 'items', constraints: [{ type: 'p', definition: 'PRIMARY KEY (id)' }] }] };
const schemaBytes = Buffer.from(JSON.stringify(schema));
function client({ rows = [{ id: 'one', value: 1 }], object = 'abc', fail = false, drift = false,
  failAfter = Infinity, bucketPublic = false, streaming = false } = {}) {
  let reads = 0, downloads = 0;
  const bucket = { id: 'sample', public: bucketPublic };
  return {
    get downloads() { return downloads; },
    from() { return { select() { return this; }, order() { return this; }, async range(start, end) {
      reads++;
      const data = drift && reads > 1 ? [...rows, { id: 'two' }] : rows;
      return { data: data.slice(start, end + 1), count: data.length, error: null };
    } }; },
    storage: { async listBuckets() { return { data: [bucket] }; }, from() { return {
      async list() { return { data: [{ id: 'object-one', name: 'sample.txt', metadata: { size: object.length }, updated_at: 'fixed' }] }; },
      async download() { downloads++; if (fail || downloads > failAfter) return { error: { code: 'offline', message: 'private payload must not leak' } };
        return { data: streaming ? new Blob([object]) : { size: Buffer.byteLength(object), async arrayBuffer() { return Buffer.from(object); } } }; },
    }; } },
  };
}
async function fixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const home = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'backup-synthetic-')));
  t.after(async () => {
    const target = await fs.realpath(home);
    assert.equal(target, home); assert.equal(path.dirname(target), temporaryRoot);
    assert.match(path.basename(target), /^backup-synthetic-/);
    await fs.rm(target, { recursive: true, force: true });
  });
  return home;
}
async function materialize(directory) {
  const snapshot = await captureBackupSnapshot({ client: client(), schemaBytes, sink: async name => {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const handle = await fs.open(file, 'wx');
    return { write: bytes => handle.writeFile(bytes), close: () => handle.close() };
  } });
  return snapshot;
}

test('changedDataCreatesAtMostOneRoutinePointPerDay', () => {
  assert.equal(backupDue({ now: day, reason: 'routine' }).due, true);
  assert.equal(backupDue({ now: day, reason: 'routine', lastAttempt: { at: day, passed: false } }).due, false);
  assert.equal(backupDue({ now: '2026-06-08T21:01:00Z', reason: 'routine', lastAttempt: { at: day } }).due, true);
});
test('beforeSchemaBypassesDayLimit', () => {
  for (const reason of ['before-schema-change', 'before-data-change']) {
    assert.equal(backupDue({ now: day, reason, lastAttempt: { at: day }, lastComplete: { at: day } }).due, true);
  }
  assert.throws(() => backupDue({ now: day, reason: 'arbitrary' }));
});
test('retentionSevenFourSix', () => {
  const points = Array.from({ length: 250 }, (_, i) => ({ id: 'point-' + i, complete: true, legacy: false,
    at: new Date(Date.parse(day) - i * 86400000).toISOString() }));
  const selected = selectBackupRetention(points, day);
  const slots = selected.slots;
  assert.deepEqual({ daily: slots.daily.length, weekly: slots.weekly.length, monthly: slots.monthly.length },
    { daily: 7, weekly: 4, monthly: 6 });
  assert.equal(new Set(selected.keep).size, selected.keep.length);
});
test('legacyUniqueAlwaysSurvives', () => {
  const old = ['legacy', 'incomplete', 'pinned', 'restored'].map(id => ({ id, at: '2020-01-01T00:00:00Z',
    legacy: id === 'legacy', complete: id !== 'incomplete', pinned: id === 'pinned', restored: id === 'restored' }));
  assert.deepEqual(new Set(selectBackupRetention(old, day).keep), new Set(old.map(x => x.id)));
});
test('page size accepts only integers 1 through 1000', () => {
  assert.equal(parsePageSize(), 250);
  for (const value of ['0', '1001', '1.5', '-1', 'NaN', '']) assert.throws(() => parsePageSize(value));
  assert.equal(parsePageSize('1'), 1);
});
test('snapshot freshly downloads storage, includes bucket settings and rereads rows', async () => {
  const live = client();
  const first = await captureBackupSnapshot({ client: live, schemaBytes, pageSize: 250 });
  const second = await captureBackupSnapshot({ client: live, schemaBytes, pageSize: 250 });
  assert.equal(first.contentFingerprint, second.contentFingerprint);
  assert.ok(live.downloads >= 2);
  assert.equal(first.manifest.tables[0].count, 1);
  assert.notEqual(first.contentFingerprint, (await captureBackupSnapshot({ client: client({ bucketPublic: true }), schemaBytes })).contentFingerprint);
  assert.equal(first.contentFingerprint, (await captureBackupSnapshot({ client: client({ streaming: true }), schemaBytes })).contentFingerprint);
  assert.equal((await captureBackupSnapshot({ client: client({ rows: [] }), schemaBytes, pageSize: 1 })).manifest.tables[0].count, 0);
  const paged = await captureBackupSnapshot({ client: client({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), schemaBytes, pageSize: 1 });
  assert.equal(paged.manifest.tables[0].count, 3);
  assert.equal(paged.manifest.tables[0].sha256, hash('[{"id":"a"},{"id":"b"},{"id":"c"}]'));
  await assert.rejects(captureBackupSnapshot({ client: client({ drift: true }), schemaBytes }), /consisten|changed/i);
});
test('partial network error fails without leaking payload', async () => {
  await assert.rejects(captureBackupSnapshot({ client: client({ fail: true }), schemaBytes }), error =>
    !error.message.includes('private payload') && /storage/i.test(error.message));
});
test('sameManifestDifferentBytesIsNotDuplicate', async t => {
  const directory = await fixture(t);
  const snapshot = await materialize(directory);
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(snapshot.manifest));
  const checked = await verifyBackupBytes(directory);
  assert.equal(checked.contentFingerprint, snapshot.contentFingerprint);
  await fs.writeFile(path.join(directory, snapshot.manifest.objects[0].file), 'xyz');
  await assert.rejects(verifyBackupBytes(directory), /hash|bytes/i);
});
test('incomplete and missing table coverage fail byte verification', async t => {
  const directory = await fixture(t);
  const snapshot = await materialize(directory);
  snapshot.manifest.tables = [];
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(snapshot.manifest));
  await assert.rejects(verifyBackupBytes(directory), /table|coverage/i);
});
test('old arbitrary restore receipts cannot authorize rotation', () => {
  const point = { id: 'p', contentFingerprint: hash('point'), schemaHash: hash('schema'), format: 'backup-v2' };
  assert.equal(rotationEvidenceMatches({ passed: true, at: day }, point, day), false);
  const exact = { id: 'point-' + randomUUID(), contentFingerprint: hash('data'), schemaHash: hash('schema'),
    format: 'backup-v2+zip-v1', counts: { tables: 1, objects: 1 } };
  const proof = { version: 1, status: 'passed', passed: true, at: day, backupId: exact.id,
    backupFingerprint: exact.contentFingerprint, schemaHash: exact.schemaHash, format: exact.format,
    counts: exact.counts, checks: { tables: true, storage: true, schema: true, permissions: true } };
  assert.equal(rotationEvidenceMatches(proof, exact, day), true);
  for (const changed of [{ schemaHash: hash('other') }, { backupFingerprint: hash('other') }, { format: 'unknown' },
    { at: '2026-06-10T00:00:00Z' }, { at: '2026-01-01T00:00:00Z' }, { status: 'unavailable' },
    { checks: { tables: true, storage: true, schema: true } }]) assert.equal(rotationEvidenceMatches({ ...proof, ...changed }, exact, day), false);
});
test('unchangedDataDoesNotCreateCopy and mandatory preliminary point reuses verified bytes', async t => {
  const home = await fixture(t), live = client();
  await withMaintenanceLock(home, 'backup-fixture', async lease => {
    const base = { home, lease, client: live, schemaBytes, getFreeBytes: async () => 100 * 1024 ** 3 };
    const first = await maintainBackups({ ...base, now: day });
    assert.equal(first.created.length, 1);
    const sameDay = await maintainBackups({ ...base, now: day });
    assert.equal(sameDay.created.length, 0);
    const nextDay = await maintainBackups({ ...base, now: '2026-06-09T10:00:00Z' });
    assert.equal(nextDay.reused[0], first.created[0]);
    assert.equal(nextDay.created.length, 0);
    const preliminary = await maintainBackups({ ...base, now: '2026-06-09T11:00:00Z', reason: 'before-schema-change' });
    assert.equal(preliminary.reused[0], first.created[0]);
    assert.ok(preliminary.protected.includes('matching-verified-restore-required'));
    const names = await fs.readdir(path.join(home, 'backups', 'archives'));
    assert.equal(names.filter(name => name.endsWith('.zip')).length, 1);
    // Synthetic prior restore evidence is bound to the actual archived bytes;
    // a changed current fingerprint of the same schema must still allow 7/4/6.
    const indexPath = path.join(home, 'maintenance-state', 'backup-index.json');
    const index = JSON.parse(await fs.readFile(indexPath));
    const original = index.points[0], oldPoints = [];
    assert.deepEqual(Object.keys(original.archive).sort(), ['contentFingerprint', 'format', 'path', 'sha256', 'verifiedAt']);
    for (let n = 1; n <= 6; n++) {
      const id = 'point-' + randomUUID(), archivePath = path.join(home, 'backups', 'archives', id + '.zip');
      await fs.copyFile(original.archive.path, archivePath);
      await fs.copyFile(original.archive.path + '.manifest.json', archivePath + '.manifest.json');
      const prior = { ...original, id, originalName: id, directory: path.join(home, 'backups', id),
        at: '2026-06-0' + n + 'T10:00:00.000Z', archive: { ...original.archive, path: archivePath } };
      oldPoints.push(prior); index.points.push(prior);
    }
    const proof = { version: 1, status: 'passed', passed: true, at: '2026-06-09T11:00:00.000Z', backupId: original.id,
      backupFingerprint: original.contentFingerprint, schemaHash: original.schemaHash, format: original.format,
      counts: original.counts, checks: { tables: true, storage: true, schema: true, permissions: true } };
    const evidencePath = path.join(home, 'maintenance-state', 'restore-evidence', 'synthetic.json');
    await fs.mkdir(path.dirname(evidencePath));
    const evidenceBytes = Buffer.from(JSON.stringify(proof)); await fs.writeFile(evidencePath, evidenceBytes);
    index.lastVerified = { evidencePath, evidenceSha256: hash(evidenceBytes), proof };
    await fs.writeFile(indexPath, JSON.stringify(index));
    const changed = await maintainBackups({ ...base, client: client({ object: 'xyz' }), now: '2026-06-10T10:00:00Z' });
    assert.equal(changed.created.length, 1);
    assert.ok(changed.archived.some(row => row.id === oldPoints[0].id && row.pruned));
    await assert.rejects(fs.access(oldPoints[0].archive.path), { code: 'ENOENT' });
    await fs.access(original.archive.path);
    const final = JSON.parse(await fs.readFile(indexPath));
    assert.notEqual(final.points.find(p => p.id === final.lastComplete.id).contentFingerprint, original.contentFingerprint);
    const unsupported = { ...oldPoints[0], id: 'point-' + randomUUID(), format: 'another-generation' };
    unsupported.archive = { ...unsupported.archive, path: path.join(home, 'backups', 'archives', unsupported.id + '.zip') };
    await fs.copyFile(original.archive.path, unsupported.archive.path);
    await fs.copyFile(original.archive.path + '.manifest.json', unsupported.archive.path + '.manifest.json');
    final.points.push(unsupported); await fs.writeFile(indexPath, JSON.stringify(final));
    const protectedGeneration = await maintainBackups({ ...base, client: client({ object: 'xyz' }),
      reason: 'before-data-change', now: '2026-06-10T11:00:00Z' });
    assert.ok(protectedGeneration.protected.some(item => item.id === unsupported.id && item.reason === 'different-schema-or-format-requires-own-restore'));
    await fs.access(unsupported.archive.path);
  });
});
test('incompleteCopyNeverTriggersRotation or repeats a large materialization slot', async t => {
  const home = await fixture(t);
  await withMaintenanceLock(home, 'incomplete-fixture', async lease => {
    const pointId = 'point-00000000-0000-0000-0000-000000000000';
    await fs.writeFile(path.join(home, 'maintenance-state', 'backup-index.json'), JSON.stringify({ version: 1,
      points: [{ id: pointId, legacy: false, complete: false }], lastComplete: null }));
    const options = { home, lease, reason: 'before-data-change', now: day, client: client(), schemaBytes,
      getFreeBytes: async () => 100 * 1024 ** 3 };
    await assert.rejects(maintainBackups(options), error => error.receipt.created.length === 0);
    const index = JSON.parse(await fs.readFile(path.join(home, 'maintenance-state', 'backup-index.json')));
    assert.equal(index.points.length, 1);
    assert.equal(index.points[0].complete, false);
  });
});
test('backup reservation excludes another backup while sibling finish can proceed', async t => {
  const home = await fixture(t);
  await withMaintenanceLock(home, 'reservation-fixture', async lease => {
    const base = { home, lease, task: 'fixture', cleanup: false, getFreeBytes: async () => 100 * 1024 ** 3 };
    const sibling = await runLifecycle('start', base);
    const backup = await runLifecycle('backup', base);
    await assert.rejects(runLifecycle('backup', base), { code: 'BUSY' });
    await runLifecycle('start', { ...base, phase: 'finish', reservation: sibling, passed: true });
    await assert.rejects(runLifecycle('backup', { ...base, phase: 'resize', reservation: backup,
      expectedAdditionalBytes: 1, getFreeBytes: async () => 0 }), { code: 'LOW_DISK' });
    await runLifecycle('backup', { ...base, phase: 'finish', reservation: backup, passed: false });
  });
});
test('native backup prune refuses a generic path before authorization', async t => {
  const home = await fixture(t); let authorized = false;
  await assert.rejects(nativeArchiveOperation('backup-prune', { target: home, destination: 'legacy', file: path.join(home, 'legacy.zip') }, async () => {
    authorized = true; return true;
  }), /managed backup/i);
  assert.equal(authorized, false);
});
test('native backup stream pins its output directory and refuses an existing file', async t => {
  const directory = await fixture(t), output = path.join(directory, 'schema.json');
  const sink = await openBackupFile({ directory, file: 'schema.json', maximumBytes: 3 });
  await assert.rejects(fs.rename(directory, directory + '-moved'));
  await sink.write(Buffer.from('abc')); await sink.close();
  assert.equal(await fs.readFile(output, 'utf8'), 'abc');
  await assert.rejects(openBackupFile({ directory, file: 'schema.json', maximumBytes: 3 }));
  assert.equal(await fs.readFile(output, 'utf8'), 'abc');
});
test('native prune rejects changed sidecar and rolls back a late refusal before removing only its exact pair', async t => {
  const home = await fixture(t), source = path.join(home, 'source');
  await fs.mkdir(source); const snapshot = await materialize(source);
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(snapshot.manifest));
  const id = 'point-' + randomUUID(), archives = path.join(home, 'backups', 'archives');
  await fs.mkdir(archives, { recursive: true });
  const { groups } = await catalogArchiveGroups([{ source, prefix: 'artifact' }]);
  const archive = await publishEvidenceArchive({ groups, destination: path.join(archives, id + '.zip') });
  const sidecarPath = archive.path + '.manifest.json', original = await fs.readFile(sidecarPath);
  const request = { target: home, destination: id, file: archive.path, archiveSha256: archive.sha256, archiveMetadataSha256: hash(original) };
  await fs.writeFile(sidecarPath, Buffer.concat([original, Buffer.from(' ')]));
  let calls = 0;
  await assert.rejects(nativeArchiveOperation('backup-prune', request, async () => { calls++; return true; }), /pair changed/i);
  assert.equal(calls, 0); await fs.writeFile(sidecarPath, original);
  const refused = await nativeArchiveOperation('backup-prune', request, async phase => phase !== 'commit');
  assert.equal(refused.status, 'skipped');
  await fs.access(archive.path); assert.deepEqual(await fs.readFile(sidecarPath), original);
  const sentinel = path.join(archives, 'unmanaged.txt'); await fs.writeFile(sentinel, 'preserve');
  const removed = await nativeArchiveOperation('backup-prune', request, async () => true);
  assert.equal(removed.status, 'completed');
  await assert.rejects(fs.access(archive.path), { code: 'ENOENT' });
  await assert.rejects(fs.access(sidecarPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve');
});
test('installed bundle backup-status works outside the repository without its own node_modules', async t => {
  const home = await fixture(t), source = path.dirname(fileURLToPath(import.meta.url));
  await withMaintenanceLock(home, 'bundle-fixture', lease => publishLauncherBundle({ home, lease, source }));
  const { stdout } = await promisify(execFile)(process.execPath,
    [path.join(home, 'launcher.mjs'), 'maintenance', 'backup-status', '--home', home, '--json'],
    { cwd: os.tmpdir(), windowsHide: true, timeout: 60000 });
  const status = JSON.parse(stdout); assert.equal(status.version, 1); assert.deepEqual(status.points, []);
  assert.equal(status.due, true);
});
test('partial materialization fails mandatory operation and leaves one protected incomplete slot', async t => {
  const home = await fixture(t), live = client({ failAfter: 1 });
  await withMaintenanceLock(home, 'partial-fixture', async lease => {
    const options = { home, lease, client: live, schemaBytes, reason: 'before-schema-change', now: day,
      getFreeBytes: async () => 100 * 1024 ** 3 };
    let dependentOperation = false;
    await assert.rejects(async () => { await maintainBackups(options); dependentOperation = true; });
    assert.equal(dependentOperation, false);
    const indexPath = path.join(home, 'maintenance-state', 'backup-index.json');
    const index = JSON.parse(await fs.readFile(indexPath));
    assert.equal(index.points.length, 1); assert.equal(index.points[0].complete, false);
    assert.equal(index.lastComplete, null); assert.equal(index.lastAttempt.passed, false);
    await fs.access(path.join(index.points[0].directory, 'incomplete-manifest.json'));
    const before = live.downloads;
    await assert.rejects(maintainBackups(options), { code: 'INCOMPLETE_BACKUP' });
    assert.equal(live.downloads, before);
    assert.equal(JSON.parse(await fs.readFile(indexPath)).points.length, 1);
  });
});
test('direct backup CLI rejects unknown options before any installation access', async () => {
  const entry = fileURLToPath(new URL('./local-system-backup.mjs', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [entry, '--invalid-option'],
    { cwd: os.tmpdir(), windowsHide: true, timeout: 15000 }), error => error.code === 1 &&
    /Invalid backup options/.test(error.stderr) && !/unsettled top-level await/.test(error.stderr));
});
