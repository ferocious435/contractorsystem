import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backupDue, selectBackupRetention, verifyBackupBytes, maintainBackups, rotationEvidenceMatches, backupPinsPoint,
  updateBackupIndex, backupStatus } from './maintenance/backups.mjs';
import { localHomes } from './maintenance/policy.mjs';
import { captureBackupSnapshot, parsePageSize } from './local-system-backup.mjs';
import { withMaintenanceLock, withReservationGate } from './maintenance/guard.mjs';
import { nativeArchiveOperation, openBackupFile, catalogArchiveGroups, publishEvidenceArchive, deleteArchivedTarget, measureArchiveTargets, verifyArchive } from './maintenance/archive.mjs';
import { updateTask, readTask } from './maintenance/inventory.mjs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { publishLauncherBundle } from './maintenance/lifecycle.mjs';
import { runLifecycle } from './maintenance/storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const day = '2026-06-08T10:00:00.000Z';
const exactSources=point=>({sourceArchiveSha256:point.archive.sha256,sourceArchiveFingerprint:point.archive.contentFingerprint,sourceSidecarSha256:point.archive.metadataSha256});
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
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
async function incompleteFixture(t, change = async () => {}) {
  const home = await fixture(t), id = 'point-' + randomUUID(), directory = path.join(home, 'backups', id);
  await fs.mkdir(directory, { recursive: true });
  const snapshot = await materialize(directory);
  await fs.rm(path.join(directory, snapshot.manifest.objects[0].file));
  const point = { id, originalName: id, directory, legacy: false, complete: false, at: day, reason: 'routine',
    format: 'backup-v2+zip-v1', contentFingerprint: snapshot.contentFingerprint, schemaHash: hash(schemaBytes),
    aliases: [{ name: id, at: day }], counts: { tables: 1, objects: 1 } };
  const [tree] = await measureArchiveTargets([directory]);
  point.directoryIdentity = tree.identity;
  await change(point);
  await fs.mkdir(path.join(home, 'maintenance-state'), { recursive: true });
  await fs.writeFile(path.join(home, 'maintenance-state', 'backup-index.json'), JSON.stringify({ version: 1,
    points: [point], lastComplete: null, lastAttempt: { at: day, reason: 'routine', passed: false } }));
  return { home, point };
}
async function nativeRequests(edit, work) {
  const original = childProcess.spawn;
  childProcess.spawn = function (...args) {
    const child = original(...args);
    for (const method of ['end', 'write']) {
      const send = child.stdin[method].bind(child.stdin);
      child.stdin[method] = function (chunk, ...tail) {
        if (typeof chunk === 'string') {
          const lines = chunk.trimEnd().split('\n');
          try {
            const request = JSON.parse(lines.at(-1));
            if (request?.operation) { edit(request); lines[lines.length - 1] = JSON.stringify(request); chunk = lines.join('\n') + '\n'; }
          } catch (error) { if (error instanceof assert.AssertionError) throw error; }
        }
        return send(chunk, ...tail);
      };
    }
    return child;
  };
  syncBuiltinESMExports();
  try { return await work(); } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
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
    format: 'backup-v2+zip-v1', archive: { format: 'zip-v1' }, counts: { tables: 1, objects: 1 } };
  exact.archive={...exact.archive,path:path.join(os.tmpdir(),'synthetic-home','backups','archives',exact.id+'.zip'),sha256:hash('zip'),contentFingerprint:hash('entries'),metadataSha256:hash('sidecar')};
  const proof = { ...exactSources(exact),version: 1, status: 'passed', passed: true, at: day, backupId: exact.id,
    backupFingerprint: exact.contentFingerprint, schemaHash: exact.schemaHash, format: exact.format,
    counts: exact.counts, checks: { tables: true, storage: true, schema: true, permissions: true } };
  assert.equal(rotationEvidenceMatches(proof, exact, day), true);
  assert.equal(rotationEvidenceMatches(proof, { ...exact, archive: undefined }, day), false);
  assert.equal(rotationEvidenceMatches(proof, { ...exact, archive: { format: 'directory' } }, day), false);
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
    const preliminaryAlias = original.aliases.find(alias => alias.at === '2026-06-09T11:00:00.000Z');
    assert.equal(preliminaryAlias.reason, 'before-schema-change');
    assert.deepEqual(preliminaryAlias.provenance, { synthetic: true });
    assert.equal(preliminaryAlias.verifiedReference, original.id);
    assert.deepEqual(Object.keys(original.archive).sort(), ['contentFingerprint', 'format', 'metadataSha256', 'path', 'sha256', 'verifiedAt']);
    for (let n = 1; n <= 6; n++) {
      const id = 'point-' + randomUUID(), archivePath = path.join(home, 'backups', 'archives', id + '.zip');
      await fs.copyFile(original.archive.path, archivePath);
      await fs.copyFile(original.archive.path + '.manifest.json', archivePath + '.manifest.json');
      const prior = { ...original, id, originalName: id, directory: path.join(home, 'backups', id),
        at: '2026-06-0' + n + 'T10:00:00.000Z', archive: { ...original.archive, path: archivePath } };
      oldPoints.push(prior); index.points.push(prior);
    }
    const proof = { ...exactSources(original),version: 1, status: 'passed', passed: true, at: '2026-06-09T11:00:00.000Z', backupId: original.id,
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
    assert.equal(final.points.find(p => p.id === original.id).aliases.find(alias => alias.at === preliminaryAlias.at).reason, 'before-schema-change');
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

// A new folder, overwritten partial file, or skipped SHA check breaks these cases.
test('same-point recovery resumes only missing files and retains the original reason', async t => {
  const home = await fixture(t);
  await withMaintenanceLock(home, 'resume-fixture', async lease => {
    const options = { home, lease, schemaBytes, now: day, getFreeBytes: async () => 100 * 1024 ** 3 };
    await assert.rejects(maintainBackups({ ...options, client: client({ failAfter: 1 }) }));
    const initial = await backupStatus({ home }), point = initial.points[0];
    const table = path.join(point.directory, 'tables/items.json');
    const before = await fs.stat(table, { bigint: true });
    await updateTask(home, lease, { id: 'resume-pin', status: 'active', result: null, commit: null, dirty: true, pid: null,
      processStartedAt: null, pins: [point.id], worktree: path.join(home, 'worktree'), build: null, candidate: null });
    await assert.rejects(fs.access(path.join(point.directory, 'incomplete-manifest.json')), { code: 'ENOENT' });
    const receipt = await maintainBackups({ ...options, client: client(), resume: point.id });
    assert.deepEqual(receipt.resumed, [point.id]);
    const final = await backupStatus({ home });
    assert.equal(final.points.length, 1); assert.equal(final.points[0].reason, 'routine');
    assert.equal(final.points[0].complete, true); assert.equal(final.lastComplete.id, point.id);
    assert.ok(final.points[0].archive);
    const after = await fs.stat(table, { bigint: true });
    assert.equal(after.ino, before.ino); assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(after.size, before.size);
    assert.equal((await fs.readdir(path.join(home, 'backups', 'archives'))).filter(x => x.endsWith('.zip')).length, 1);
  });
});

test('same-point recovery preserves SHA drift and explicit close frees only the recorded slot', async t => {
  const home = await fixture(t);
  await withMaintenanceLock(home, 'resume-drift', async lease => {
    const options = { home, lease, schemaBytes, now: day, getFreeBytes: async () => 100 * 1024 ** 3 };
    await assert.rejects(maintainBackups({ ...options, client: client({ failAfter: 1 }) }));
    const point = (await backupStatus({ home })).points[0], file = path.join(point.directory, 'tables/items.json');
    const original = await fs.readFile(file), changed = Buffer.from(original); changed[changed.length - 2] ^= 1;
    await fs.writeFile(file, changed);
    await assert.rejects(maintainBackups({ ...options, client: client(), resume: point.id }), { code: 'INCOMPLETE_BACKUP' });
    assert.deepEqual(await fs.readFile(file), changed);
    const closed = await maintainBackups({ ...options, preserveIncomplete: point.id });
    assert.deepEqual(closed.preserved, [point.id]);
    const status = await backupStatus({ home });
    assert.equal(status.points[0].complete, false); assert.equal(status.points[0].recovery.status, 'closed-preserved');
    assert.deepEqual(await fs.readFile(file), changed);
  });
});

test('same-point recovery refuses source drift, unknown bytes, legacy diagnostics and replaced directories', async t => {
  for (const variant of ['source', 'unknown', 'marker', 'replacement', 'partial']) await t.test(variant, async sub => {
    const { home, point } = await incompleteFixture(sub, async point => {
      if (variant === 'unknown') await fs.writeFile(path.join(point.directory, 'extra.json'), 'private bytes');
      if (variant === 'marker') await fs.writeFile(path.join(point.directory, 'incomplete-manifest.json'),
        JSON.stringify({ version: 2, complete: false, at: day, error: 'Backup could not be verified' }, null, 2) + '\n');
      if (variant === 'replacement') {
        await fs.rename(point.directory, path.join(path.dirname(path.dirname(point.directory)), 'original-root'));
        await fs.mkdir(point.directory); await materialize(point.directory);
      }
      if (variant === 'partial') await fs.writeFile(path.join(point.directory, 'schema.json'), '{');
    });
    const [treeBefore] = await measureArchiveTargets([point.directory]);
    await withMaintenanceLock(home, 'unsafe-resume', async lease => {
      await assert.rejects(maintainBackups({ home, lease, now: day, resume: point.id, schemaBytes,
        client: client({ object: variant === 'source' ? 'xyz' : 'abc' }), getFreeBytes: async () => 100 * 1024 ** 3 }), { code: 'INCOMPLETE_BACKUP' });
      const status = await backupStatus({ home }); assert.equal(status.points.length, 1); assert.equal(status.points[0].complete, false);
      const [treeAfter] = await measureArchiveTargets([point.directory]);
      assert.equal(treeAfter.fingerprint, treeBefore.fingerprint); assert.equal(treeAfter.identity, treeBefore.identity);
      if (variant === 'marker') {
        const bytes = await fs.readFile(path.join(point.directory, 'incomplete-manifest.json'));
        await maintainBackups({ home, lease, now: day, preserveIncomplete: point.id });
        assert.deepEqual(await fs.readFile(path.join(point.directory, 'incomplete-manifest.json')), bytes);
        const skipped = await maintainBackups({ home, lease, now: day });
        assert.equal(skipped.due, false);
      }
    });
  });
});

test('same-point recovery ordinary due resumes the same ID and retry limit blocks source reads', async t => {
  const { home, point } = await incompleteFixture(t);
  await withMaintenanceLock(home, 'bounded-resume', async lease => {
    const options = { home, lease, schemaBytes, now: day, getFreeBytes: async () => 100 * 1024 ** 3 };
    const failing = client({ fail: true });
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(maintainBackups({ ...options, client: failing, resume: point.id }));
    const downloaded = failing.downloads;
    await assert.rejects(maintainBackups({ ...options, client: failing, resume: point.id }), { code: 'INCOMPLETE_BACKUP' });
    assert.equal(failing.downloads, downloaded);
    const state = await backupStatus({ home }); assert.equal(state.points.length, 1); assert.equal(state.points[0].recovery.attempts, 2);
  });
  const second = await incompleteFixture(t);
  await withMaintenanceLock(second.home, 'ordinary-resume', async lease => {
    const receipt = await maintainBackups({ home: second.home, lease, schemaBytes, client: client(),
      now: '2026-06-09T10:00:00Z', getFreeBytes: async () => 100 * 1024 ** 3 });
    assert.deepEqual(receipt.resumed, [second.point.id]); assert.deepEqual(receipt.created, []);
  });
});

test('same-point recovery native writer rejects a replaced root before creating payload', async t => {
  const { home, point } = await incompleteFixture(t);
  await fs.rename(point.directory, point.directory + '-original');
  await fs.mkdir(point.directory);
  await assert.rejects(openBackupFile({ directory: point.directory, file: 'schema.json', maximumBytes: 0,
    directoryIdentity: point.directoryIdentity }));
  assert.deepEqual(await fs.readdir(point.directory), []);
});

test('same-point recovery reports source phase even if diagnostic publication fails', async t => {
  const { home, point } = await incompleteFixture(t), original = childProcess.spawn;
  childProcess.spawn = function (...args) {
    const child = original(...args), end = child.stdin.end.bind(child.stdin);
    child.stdin.end = function (chunk, ...tail) {
      if (typeof chunk === 'string' && chunk.includes('"operation":"write"')) {
        const parts = chunk.trimEnd().split('\n');
        try {
          const request = JSON.parse(parts.at(-1));
          if (request.writes?.some(row => row.path.includes('backup-failures'))) {
            request.operation = 'fixture-diagnostic-refusal'; parts[parts.length - 1] = JSON.stringify(request); chunk = parts.join('\n') + '\n';
          }
        } catch { /* Preserve other native operations. */ }
      }
      return end(chunk, ...tail);
    };
    return child;
  };
  syncBuiltinESMExports();
  try {
    await withMaintenanceLock(home, 'diagnostic-failure', async lease => {
      await assert.rejects(maintainBackups({ home, lease, now: day, resume: point.id, schemaBytes,
        client: client({ fail: true }), getFreeBytes: async () => 100 * 1024 ** 3 }), error => {
        assert.equal(error.code, 'REFUSED');
        assert.equal(error.receipt.failed[0].phase, 'storage-download');
        assert.equal(error.receipt.failed[0].cause, 'SOURCE_READ_FAILED');
        assert.equal(error.receipt.failed[0].completedFiles, 2);
        assert.ok(error.receipt.cleanupFailures.some(row => row.operation === 'diagnostic-write'));
        assert.ok(!JSON.stringify(error.receipt).includes('private payload'));
        return true;
      });
    });
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
});

test('same-point recovery maintenance CLI relays exact preserving-close and resume IDs', async t => {
  const { home, point } = await incompleteFixture(t), execute = promisify(execFile);
  const entry = fileURLToPath(new URL('./local-system-maintenance.mjs', import.meta.url));
  const run = (...args) => execute(process.execPath, [entry, 'backup', '--home', home, ...args],
    { cwd: os.tmpdir(), windowsHide: true, timeout: 120000 });
  await assert.rejects(run('--resume', 'point-00000000-0000-0000-0000-000000000000'), error => {
    assert.equal(JSON.parse(error.stderr.trim()).code, 'INCOMPLETE_BACKUP'); return true;
  });
  const closed = JSON.parse((await run('--preserve-incomplete', point.id)).stdout);
  assert.deepEqual(closed.preserved, [point.id]);
  assert.equal((await backupStatus({ home })).points[0].recovery.status, 'closed-preserved');
});

test('same-point recovery preserving-close permits one later ordinary point and preserves unknown bytes', async t => {
  const { home, point } = await incompleteFixture(t, async point => fs.writeFile(path.join(point.directory, 'unknown.json'), 'preserved'));
  await withMaintenanceLock(home, 'close-later', async lease => {
    const options = { home, lease, now: day, client: client(), schemaBytes, getFreeBytes: async () => 100 * 1024 ** 3 };
    await maintainBackups({ ...options, preserveIncomplete: point.id });
    const skipped = await maintainBackups(options); assert.equal(skipped.due, false);
    const next = await maintainBackups({ ...options, now: '2026-06-09T10:00:00Z' });
    assert.equal(next.created.length, 1); assert.notEqual(next.created[0], point.id);
    assert.equal(await fs.readFile(path.join(point.directory, 'unknown.json'), 'utf8'), 'preserved');
    const state = await backupStatus({ home }); assert.equal(state.points.length, 2);
    const closed = state.points.find(p => p.id === point.id);
    assert.equal(closed.complete, false); assert.equal(closed.recovery.status, 'closed-preserved');
    assert.equal(hash(await fs.readFile(closed.recovery.evidencePath)), closed.recovery.evidenceSha256);
    const repeated = await maintainBackups({ ...options, now: '2026-06-09T11:00:00Z' });
    assert.equal(repeated.due, false); assert.equal((await backupStatus({ home })).points.length, 2);
  });
});

test('recovery R1 completion holds verified ZIP pair through CAS and preserves a new raw child', async t => {
  const { home, point } = await incompleteFixture(t);
  const blocked = []; let checked = false, archiveReady = false;
  await nativeRequests(request => {
    if (request.operation !== 'write' || checked) return;
    const write = request.writes?.find(row => row.path.endsWith('backup-index.json'));
    const published = write && JSON.parse(write.data).points.find(p => p.id === point.id && p.complete);
    if (!published) return;
    checked = true;
    archiveReady = Boolean(published.archive);
    if (published.archive) {
      const zip = published.archive.path, sidecar = zip + '.manifest.json';
      for (const attempt of [() => syncFs.renameSync(zip, zip + '.moved'), () => syncFs.writeFileSync(zip, 'changed'),
        () => syncFs.writeFileSync(zip + ':late', 'stream'), () => syncFs.unlinkSync(sidecar),
        () => syncFs.writeFileSync(sidecar + ':late', 'stream')]) {
        try { attempt(); blocked.push(false); } catch { blocked.push(true); }
      }
    }
    syncFs.writeFileSync(path.join(point.directory, 'objects/unknown'), 'new');
  }, async () => withMaintenanceLock(home, 'completion-CAS', async lease => {
    const result = await maintainBackups({ home, lease, now: day, client: client(), schemaBytes, resume: point.id,
      getFreeBytes: async () => 100 * 1024 ** 3 }).catch(error => error);
    assert.equal(archiveReady, true); assert.deepEqual(blocked, [true, true, true, true, true]);
    assert.deepEqual(result.resumed, [point.id]);
    const final = (await backupStatus({ home })).points[0]; assert.equal(final.complete, true); assert.equal(final.rawRemoved, false);
    assert.equal(await fs.readFile(path.join(point.directory, 'objects/unknown'), 'utf8'), 'new');
    const archive = await verifyArchive(final.archive.path);
    assert.equal(archive.sha256, final.archive.sha256); assert.ok(!archive.entries.some(row => row.path.endsWith('/unknown')));
  }));
});

test('recovery R1 preserving-close holds tree and immutable proof through index CAS', async t => {
  const { home, point } = await incompleteFixture(t), blocked = []; let checked = false;
  await nativeRequests(request => {
    if (request.operation !== 'write' || checked) return;
    const write = request.writes?.find(row => row.path.endsWith('backup-index.json'));
    const closed = write && JSON.parse(write.data).points.find(p => p.id === point.id && p.recovery?.status === 'closed-preserved');
    if (!closed) return; checked = true;
    for (const attempt of [() => syncFs.unlinkSync(closed.recovery.evidencePath),
      () => syncFs.renameSync(point.directory, path.join(home, 'moved-root')),
      () => syncFs.writeFileSync(path.join(point.directory, 'schema.json') + ':late', 'stream'),
      () => syncFs.writeFileSync(closed.recovery.evidencePath + ':late', 'stream')]) {
      try { attempt(); blocked.push(false); } catch { blocked.push(true); }
    }
    syncFs.writeFileSync(path.join(point.directory, 'objects/unknown'), 'new');
  }, async () => withMaintenanceLock(home, 'preserve-CAS', async lease => {
    const result = await maintainBackups({ home, lease, now: day, preserveIncomplete: point.id }).catch(error => error);
    assert.deepEqual(blocked, [true, true, true, true]); assert.deepEqual(result.preserved, [point.id]);
    const final = (await backupStatus({ home })).points[0];
    assert.equal(hash(await fs.readFile(final.recovery.evidencePath)), final.recovery.evidenceSha256);
    const proof = JSON.parse(await fs.readFile(final.recovery.evidencePath));
    assert.equal(proof.scope, 'verified-existing-set'); assert.equal(proof.complete, false);
    assert.equal(await fs.readFile(path.join(point.directory, 'objects/unknown'), 'utf8'), 'new');
  }));
});

test('recovery R1 archive failure leaves the same active incomplete point before complete publication', async t => {
  const { home, point } = await incompleteFixture(t);
  await nativeRequests(request => { if (request.operation === 'publish') request.operation = 'fixture-archive-refusal'; },
    () => withMaintenanceLock(home, 'archive-before-complete', async lease => {
      await assert.rejects(maintainBackups({ home, lease, now: day, resume: point.id, client: client(), schemaBytes,
        getFreeBytes: async () => 100 * 1024 ** 3 }));
      const state = await backupStatus({ home }); assert.equal(state.points.length, 1);
      assert.equal(state.points[0].complete, false); assert.equal(state.lastComplete, null);
      await verifyBackupBytes(point.directory);
    }));
});

test('recovery R1 rejects a plain file root and unknown missing legacy point', async t => {
  for (const variant of ['file', 'missing']) await t.test(variant, async sub => {
    const { home, point } = await incompleteFixture(sub, async point => {
      delete point.directoryIdentity;
      await fs.rename(point.directory, path.join(path.dirname(path.dirname(point.directory)), 'original-root'));
      if (variant === 'file') await fs.writeFile(point.directory, 'untouched');
    });
    await withMaintenanceLock(home, 'root-kind', async lease => {
      await assert.rejects(maintainBackups({ home, lease, now: day, preserveIncomplete: point.id }));
      assert.notEqual((await backupStatus({ home })).points[0].recovery?.status, 'closed-preserved');
      if (variant === 'file') assert.equal(await fs.readFile(point.directory, 'utf8'), 'untouched');
    });
  });
});

test('recovery R1 resumes its preregistered absent directory after interruption before creation', async t => {
  const home = await fixture(t), options = { home, now: day, client: client(), schemaBytes, getFreeBytes: async () => 100 * 1024 ** 3 };
  await withMaintenanceLock(home, 'preregistered-missing', async lease => {
    await nativeRequests(request => {
      if (request.operation === 'backup-initialize' || request.operation === 'ensure-directories' &&
          request.records?.some(file => /^point-/.test(path.basename(file)))) request.operation = 'fixture-before-directory-refusal';
    }, () => assert.rejects(maintainBackups({ ...options, lease })));
    const point = (await backupStatus({ home })).points[0];
    await assert.rejects(fs.access(point.directory), { code: 'ENOENT' });
    assert.equal(point.materialization?.state, 'directory-pending');
    const receipt = await maintainBackups({ ...options, lease, client: client(), resume: point.id });
    assert.deepEqual(receipt.resumed, [point.id]); assert.equal((await backupStatus({ home })).points.length, 1);
  });
});

test('recovery R1 reports zero materialized progress and precise manifest create cause', async t => {
  for (const file of ['schema.json', 'manifest.json']) await t.test(file, async sub => {
    const home = await fixture(sub);
    await withMaintenanceLock(home, 'create-cause', async lease => nativeRequests(request => {
      if (request.operation === 'backup-write' && request.file === file) request.operation = 'fixture-file-create-refusal';
    }, () => assert.rejects(maintainBackups({ home, lease, now: day, client: client(), schemaBytes,
      getFreeBytes: async () => 100 * 1024 ** 3 }), error => {
      assert.equal(error.receipt.failed[0].cause, 'FILE_CREATE_FAILED');
      assert.equal(error.receipt.failed[0].phase, file === 'schema.json' ? 'file-create' : 'manifest-create');
      assert.equal(error.receipt.failed[0].completedFiles, file === 'schema.json' ? 0 : 3); return true;
    })));
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
  request.protectedBackups = [await copiedProtectedPair(home, archive)];
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
    await assert.rejects(fs.access(path.join(index.points[0].directory, 'incomplete-manifest.json')), { code: 'ENOENT' });
    assert.ok((await fs.readdir(path.join(home, 'maintenance-state', 'backup-failures'))).length);
    const before = live.downloads;
    await assert.rejects(maintainBackups(options));
    assert.ok(live.downloads > before);
    assert.equal(JSON.parse(await fs.readFile(indexPath)).points.length, 1);
  });
});
test('direct backup CLI rejects unknown options before any installation access', async () => {
  const entry = fileURLToPath(new URL('./local-system-backup.mjs', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [entry, '--invalid-option'],
    { cwd: os.tmpdir(), windowsHide: true, timeout: 15000 }), error => error.code === 1 &&
    /Invalid backup options/.test(error.stderr) && !/unsettled top-level await/.test(error.stderr));
});
async function createCliFixture(base) {
  const logical = path.join(base, 'ContractorSystem');
  const home = path.join(base, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Local', 'ContractorSystem');
  const releaseId = 'fixture-release', root = path.join(home, 'releases', releaseId);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const write = async (file, bytes) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); };
  const schema = JSON.stringify({ tables: [{ schema: 'public', name: 'items', constraints: [{ type: 'p', definition: 'PRIMARY KEY (id)' }] }] });
  const lock = JSON.stringify({ packages: Object.fromEntries(['next', 'dotenv', 'officeparser'].map(name => ['node_modules/' + name, { version: '1.0.0' }])) });
  const sources = { 'package.json': '{}', 'package-lock.json': lock, '.next/BUILD_ID': 'fixture-build', 'ops/backup-schema.json': schema };
  for (const [name, bytes] of Object.entries(sources)) await write(path.join(root, name), bytes);
  for (const name of ['next', 'dotenv', 'officeparser', '@supabase/supabase-js']) {
    const folder = path.join(root, 'node_modules', name);
    await write(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
    let code = 'module.exports = {};';
    if (name === 'dotenv') code = 'exports.parse = () => ({NEXT_PUBLIC_SUPABASE_URL:"https://synthetic.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-key"});';
    if (name === '@supabase/supabase-js') code = 'exports.createClient=()=>({from(){return {select(){return this},order(){return this},async range(){return {data:[{id:"fixture-row"}],count:1}}}},storage:{async listBuckets(){return {data:[]}}}});';
    await write(path.join(folder, 'index.js'), code);
  }
  const nodeExe = path.join(home, 'runtime', 'node.fixture.exe'), runtime = 'fixture-runtime'; await write(nodeExe, runtime);
  const dependencyRoot = path.join(home, 'dependencies', 'fixture'); await fs.mkdir(dependencyRoot, { recursive: true });
  const release = { id: releaseId, root, nodeExe, dependencyRoot, dist: '.next', buildId: 'fixture-build',
    nodeSha256: digest(runtime), dependencyLockSha256: digest(lock),
    files: Object.entries(sources).map(([name, bytes]) => ({ path: name, sha256: digest(bytes) })) };
  await write(path.join(root, 'release.json'), JSON.stringify(release));
  await write(path.join(home, 'current.json'), JSON.stringify({ releaseId, pid: process.pid }));
  await write(path.join(home, 'config', 'system.env'), 'FIXTURE=1\n');
  const schemaPath = path.join(base, 'alternate-schema.json'); await write(schemaPath, schema);
  const preload = path.join(base, 'preload.mjs');
  await write(preload, 'import fs from "node:fs/promises"; import {syncBuiltinESMExports} from "node:module"; fs.statfs=async()=>({bavail:100n*1024n**3n,bsize:1n});syncBuiltinESMExports();globalThis.fetch=async()=>new Response(' +
    JSON.stringify('<script>self.__next_f.push([1,"{\\"b\\":\\"fixture-build\\"}"])</script>') + ',{status:200});import cp from \"node:child_process\";const spawnBefore=cp.spawn;cp.spawn=(command,...args)=>{if(command===\"docker\")throw Error(\"synthetic engine unavailable\");return spawnBefore(command,...args)};syncBuiltinESMExports();');
  return { home, logical, preload, schemaPath, env: { ...process.env, LOCALAPPDATA: base } };
}

test('round1 direct backup and launcher execute due maintenance with release-backed synthetic dependencies and preserve provenance', async t => {
  const base = await fixture(t), f = await createCliFixture(base), execute = promisify(execFile);
  const source = path.dirname(fileURLToPath(import.meta.url));
  const run = (name, args) => execute(process.execPath, ['--import', pathToFileURL(f.preload).href,
    path.join(source, name), ...args], { cwd: os.tmpdir(), env: f.env, windowsHide: true, timeout: 240000 });
  const first = JSON.parse((await run('local-system-backup.mjs', ['--home', f.home, '--reason', 'before-schema-change',
    '--destination', path.join(f.logical, 'backups', 'requested-alias')])).stdout);
  assert.equal(first.created.length, 1); assert.equal(first.failed.length, 0);
  const file = path.join(f.home, 'maintenance-state', 'backup-index.json'), initial = JSON.parse(await fs.readFile(file));
  assert.equal(initial.points[0].directory, path.join(f.home, 'backups', 'requested-alias'));
  const originalAt = initial.points[0].at, restoreMarker = { proof: { at: '2020-01-01T00:00:00Z', marker: 'not-a-passed-proof' } };
  initial.lastAttempt.at = '2020-01-01T00:00:00Z'; initial.lastVerified = restoreMarker;
  await fs.writeFile(file, JSON.stringify(initial));
  const launched = await run('local-system-launch.mjs', ['start']);
  assert.equal(JSON.parse(launched.stdout).running, true); assert.doesNotMatch(launched.stderr, /pending|unsettled top-level await/);
  assert.equal(JSON.parse(await fs.readFile(file)).lastAttempt.passed, true);
  await run('local-system-backup.mjs', ['--home', f.home, '--reason', 'before-schema-change', '--schema', f.schemaPath]);
  await run('local-system-backup.mjs', ['--home', f.home, '--reason', 'before-data-change']);
  const final = JSON.parse(await fs.readFile(file)), point = final.points.find(p => p.id === first.created[0]);
  const schemaAlias = point.aliases.find(alias => alias.reason === 'before-schema-change' && alias.provenance.schemaSource === f.schemaPath);
  assert.ok(schemaAlias); assert.equal(schemaAlias.schemaHash, point.schemaHash); assert.equal(schemaAlias.verifiedReference, point.id);
  assert.equal(point.at, originalAt); assert.deepEqual(final.lastVerified, restoreMarker);
  assert.equal(final.lastAttempt.reason, 'before-data-change');
  const entry = pathToFileURL(path.join(source, 'local-system-backup.mjs')).href;
  const imported = await execute(process.execPath, ['--input-type=module', '-e',
    'process.argv[1]="file:///foreign-entry.mjs";await import(' + JSON.stringify(entry) + ');console.log("imported");'],
    { cwd: os.tmpdir(), env: f.env, windowsHide: true, timeout: 15000 });
  assert.equal(imported.stdout.trim(), 'imported');
});

test('round1 sidecar and known logical HOME pins protect the complete managed pair', () => {
  const old = process.env.LOCALAPPDATA;
  try {
    process.env.LOCALAPPDATA = path.join(os.tmpdir(), 'synthetic-alias-path-only');
    const { logical, physical } = localHomes(), id = 'point-' + randomUUID();
    const point = { id, directory: path.join(physical, 'backups', id), archive: { path: path.join(physical, 'backups', 'archives', id + '.zip') } };
    for (const pin of [point.archive.path + '.manifest.json', path.join(logical, 'backups', 'archives', id + '.zip'),
      path.join(logical, 'backups', 'archives', id + '.zip.manifest.json'), point.id, point.directory,
      physical, path.dirname(physical), path.dirname(logical), path.parse(physical).root]) assert.equal(backupPinsPoint(physical, point, [pin]), true);
    assert.equal(backupPinsPoint(physical, point, [path.join(os.tmpdir(), 'unrelated-backup-home')]), false);
  } finally { if (old === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = old; }
});
test('round1 streaming close preserves the first LOW_DISK error', async () => {
  const diskError = Object.assign(Error('modeled disk exhausted'), { code: 'LOW_DISK' });
  await assert.rejects(captureBackupSnapshot({ client: client(), schemaBytes,
    sink: async () => ({ async write() { throw diskError; }, async close() { throw Error('secondary close failure'); } }) }),
  error => error === diskError);
});
test('round1 unavailable terminal points preserve their record without filling physical retention slots', () => {
  const absent = { id: 'absent', legacy: false, complete: true, archiveUnavailable: true, at: day };
  const available = { id: 'available', legacy: false, complete: true, at: '2026-06-07T10:00:00Z' };
  const selected = selectBackupRetention([absent, available], day);
  assert.deepEqual(selected.slots.daily, ['available']);
  assert.ok(selected.keep.includes('absent')); assert.deepEqual(selected.eligible, []);
});
test('round1 index writer uses the physical HOME for a known logical alias', async t => {
  const base = await fixture(t), original = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = base;
  try {
    const { logical, physical } = localHomes(); await fs.mkdir(physical, { recursive: true });
    await withMaintenanceLock(physical, 'alias-writer-fixture', async lease => {
      await updateBackupIndex(logical, lease, index => { index.aliasWriterMarker = 'physical'; });
      assert.equal((await backupStatus({ home: physical })).aliasWriterMarker, 'physical');
      await assert.rejects(fs.access(path.join(logical, 'maintenance-state', 'backup-index.json')), { code: 'ENOENT' });
    });
  } finally { if (original === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = original; }
});

async function tinyArchive(home, id = 'point-' + randomUUID()) {
  const source = path.join(home, 'backups', id), archives = path.join(home, 'backups', 'archives');
  await fs.mkdir(source, { recursive: true }); await fs.mkdir(archives, { recursive: true });
  const snapshot = await materialize(source);
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(snapshot.manifest));
  const checked = await verifyBackupBytes(source);
  const { groups } = await catalogArchiveGroups([{ source, prefix: 'artifact' }]);
  const archive = await publishEvidenceArchive({ groups, destination: path.join(archives, id + '.zip') });
  return { source, archive, checked, point: { id, directory: source, originalName: id, legacy: false,
    complete: true, at: day, format: 'backup-v2+zip-v1', schemaHash: snapshot.manifest.schemaSha256,
    contentFingerprint: snapshot.contentFingerprint, counts: { tables: 1, objects: 1 }, archive, aliases: [] } };
}

async function capturedProtectedPair(id, original) {
  const verified = await nativeArchiveOperation('backup-metadata', { file: original.path, archiveSha256: original.sha256 });
  assert.equal(verified.metadataSha256, hash(await fs.readFile(original.path + '.manifest.json')));
  return { id, file: original.path, sha256: verified.archive.sha256, metadataSha256: verified.metadataSha256 };
}

async function copiedProtectedPair(home, original) {
  const id = 'point-' + randomUUID(), file = path.join(home, 'backups', 'archives', id + '.zip');
  await fs.copyFile(original.path, file); await fs.copyFile(original.path + '.manifest.json', file + '.manifest.json');
  return capturedProtectedPair(id, { path: file, sha256: original.sha256 });
}

test('round2 protected pair disappearance or replacement after early verification preserves the candidate', async t => {
  const home = await fixture(t), original = await tinyArchive(home);
  for (const [anchorIndex, suffix, action] of [[0, '', 'remove'], [0, '.manifest.json', 'replace'],
    [1, '', 'replace'], [1, '.manifest.json', 'remove']]) {
    const candidate = await copiedProtectedPair(home, original.archive);
    const protectedBackups = [await copiedProtectedPair(home, original.archive), await copiedProtectedPair(home, original.archive)];
    const changed = protectedBackups[anchorIndex].file + suffix;
    if (action === 'remove') await fs.unlink(changed); else await fs.writeFile(changed, 'modeled replacement');
    let callbacks = 0;
    await assert.rejects(nativeArchiveOperation('backup-prune', { target: home, destination: candidate.id,
      file: candidate.file, archiveSha256: candidate.sha256, archiveMetadataSha256: candidate.metadataSha256,
      protectedBackups }, async () => { callbacks++; return true; }));
    assert.equal(callbacks, 0);
    await fs.access(candidate.file); await fs.access(candidate.file + '.manifest.json');
  }
});

test('round2 native hold protects both anchor pairs through callbacks and rechecks each candidate', async t => {
  const home = await fixture(t), original = await tinyArchive(home);
  const candidate = await copiedProtectedPair(home, original.archive);
  const protectedBackups = [await copiedProtectedPair(home, original.archive), await copiedProtectedPair(home, original.archive)];
  const prune = (target, approve) => nativeArchiveOperation('backup-prune', { target: home, destination: target.id,
    file: target.file, archiveSha256: target.sha256, archiveMetadataSha256: target.metadataSha256, protectedBackups }, approve);
  const result = await prune(candidate, async phase => {
    for (const anchor of protectedBackups) for (const file of [anchor.file, anchor.file + '.manifest.json']) {
      await assert.rejects(fs.writeFile(file, 'late primary write'));
      await assert.rejects(fs.rename(file, file + '.moved'));
      await assert.rejects(fs.writeFile(file + ':late', 'late named stream'));
      if (phase === 'commit') await assert.rejects(fs.unlink(file));
    }
    return true;
  });
  assert.equal(result.status, 'completed'); await assert.rejects(fs.access(candidate.file), { code: 'ENOENT' });
  for (const anchor of protectedBackups) {
    assert.equal(hash(await fs.readFile(anchor.file)), anchor.sha256);
    assert.equal(hash(await fs.readFile(anchor.file + '.manifest.json')), anchor.metadataSha256);
  }
  const second = await copiedProtectedPair(home, original.archive);
  await fs.unlink(protectedBackups[1].file + '.manifest.json');
  await assert.rejects(prune(second, async () => true));
  await fs.access(second.file); await fs.access(second.file + '.manifest.json');
});

test('round2 narrow anchor contract refuses missing duplicate colliding or unsupported inputs', async t => {
  const home = await fixture(t), original = await tinyArchive(home);
  const candidate = await copiedProtectedPair(home, original.archive), anchor = await copiedProtectedPair(home, original.archive);
  let callbacks = 0;
  const prune = refs => nativeArchiveOperation('backup-prune', { target: home, destination: candidate.id,
    file: candidate.file, archiveSha256: candidate.sha256, archiveMetadataSha256: candidate.metadataSha256,
    protectedBackups: refs }, async () => { callbacks++; return true; });
  for (const refs of [undefined, [], [anchor, anchor], [candidate], [{ ...anchor, file: path.join(home, 'outside.zip') }],
    [{ ...anchor, metadataSha256: undefined }]]) await assert.rejects(prune(refs));
  assert.equal(callbacks, 0);
  const stream = anchor.file + ':unsupported'; await fs.writeFile(stream, 'synthetic ADS');
  await assert.rejects(prune([anchor])); await fs.unlink(stream);
  const writer = await fs.open(anchor.file, 'r+');
  try { await assert.rejects(prune([anchor])); } finally { await writer.close(); }
  await fs.unlink(anchor.file); await fs.symlink(original.source, anchor.file, 'junction');
  try { await assert.rejects(prune([anchor])); } finally { await fs.unlink(anchor.file); }
  assert.equal(callbacks, 0); await fs.access(candidate.file); await fs.access(candidate.file + '.manifest.json');
  await fs.copyFile(original.archive.path, anchor.file);
  const succeeded = await prune([anchor]);
  assert.equal(succeeded.status, 'completed'); assert.equal(callbacks, 2);
  await fs.access(anchor.file); await fs.access(anchor.file + '.manifest.json');
});

test('round1 terminal gate rejects a late successful pin and proof update and excludes sibling writers', async t => {
  const home = await fixture(t), f = await tinyArchive(home);
  await withMaintenanceLock(home, 'terminal-fixture', async lease => {
    const task = { id: 'pin-fixture', status: 'active', result: null, commit: null, dirty: true, pid: null,
      processStartedAt: null, pins: [], worktree: path.join(home, 'worktree'), build: null, candidate: null };
    await updateTask(home, lease, task);
    const sidecar = await fs.readFile(f.archive.path + '.manifest.json');
    const request = { target: home, destination: f.point.id, file: f.archive.path,
      archiveSha256: f.archive.sha256, archiveMetadataSha256: hash(sidecar),
      protectedBackups: [await copiedProtectedPair(home, f.archive)] };
    let terminalEntered = false;
    const scope = async run => withReservationGate(home, lease, async () => { terminalEntered = true; return run(); });
    const pinned = await nativeArchiveOperation('backup-prune', request, async phase => {
      const previous = await readTask(home, task.id);
      if (phase === 'stage') {
        await updateTask(home, lease, { ...task, pins: [f.archive.path + '.manifest.json'] });
        return previous.pins.length === 0;
      }
      return !backupPinsPoint(home, f.point, previous.pins);
    }, scope);
    assert.equal(terminalEntered, true); assert.equal(pinned.status, 'skipped'); await fs.access(f.archive.path);
    await updateTask(home, lease, task);
    await updateBackupIndex(home, lease, index => { index.lastVerified = { marker: 'first' }; });
    const drift = await nativeArchiveOperation('backup-prune', request, async phase => {
      const previous = (await backupStatus({ home })).lastVerified;
      if (phase === 'stage') await updateBackupIndex(home, lease, index => { index.lastVerified = { marker: 'changed' }; });
      return previous.marker === 'first';
    }, scope);
    assert.equal(drift.status, 'skipped'); await fs.access(f.archive.path);
    const excluded = await nativeArchiveOperation('backup-prune', request, async phase => {
      if (phase === 'commit') {
        await assert.rejects(Promise.resolve().then(() => updateTask(home, lease, { ...task, pins: [f.archive.path] })), { code: 'BUSY' });
        await assert.rejects(Promise.resolve().then(() => updateBackupIndex(home, lease, index => { index.lastVerified = { marker: 'must-not-publish' }; })), { code: 'BUSY' });
        return false;
      }
      return true;
    }, scope);
    assert.equal(excluded.status, 'skipped');
    assert.deepEqual((await readTask(home, task.id)).pins, []);
    assert.equal((await backupStatus({ home })).lastVerified.marker, 'changed');
    await fs.access(f.archive.path); assert.deepEqual(await fs.readFile(f.archive.path + '.manifest.json'), sidecar);
  });
});

test('round1 crash after native commits reconciles exact missing paths without claiming deletion or touching residue', async t => {
  const home = await fixture(t), f = await tinyArchive(home);
  await withMaintenanceLock(home, 'reconcile-fixture', async lease => {
    const pruning = { ...f.point, id: 'point-' + randomUUID(), rawRemoved: true };
    pruning.archive = { ...f.archive, path: path.join(home, 'backups', 'archives', pruning.id + '.zip') };
    await fs.copyFile(f.archive.path, pruning.archive.path); await fs.copyFile(f.archive.path + '.manifest.json', pruning.archive.path + '.manifest.json');
    const sidecar = await fs.readFile(pruning.archive.path + '.manifest.json');
    pruning.pruneIntent = { at: day, authorizedAt: day, archivePath: pruning.archive.path,
      archiveSha256: pruning.archive.sha256, metadataSha256: hash(sidecar), evidenceSha256: hash('synthetic-proof') };
    f.point.rawRemovalIntent = { at: day, authorizedAt: day, directory: f.source, archivePath: f.archive.path,
      archiveSha256: f.archive.sha256, targetFingerprint: f.checked.tree.fingerprint, targetIdentity: f.checked.tree.identity };
    const partial = { ...pruning, id: 'point-' + randomUUID() };
    partial.archive = { ...f.archive, path: path.join(home, 'backups', 'archives', partial.id + '.zip') };
    partial.pruneIntent = { ...pruning.pruneIntent, archivePath: partial.archive.path };
    await fs.copyFile(f.archive.path, partial.archive.path); // Sidecar is deliberately absent; preserve the remaining ZIP.
    await updateBackupIndex(home, lease, index => {
      index.points = [f.point, pruning, partial, { id: 'legacy-unknown', legacy: true, complete: false }];
      index.lastAttempt = { at: day, passed: true }; index.lastComplete = { id: f.point.id, at: day, schemaHash: f.point.schemaHash };
    });
    const raw = await deleteArchivedTarget({ archive: f.archive, target: f.source, targetFingerprint: f.checked.tree.fingerprint,
      targetIdentity: f.checked.tree.identity, resume: false }, async () => true);
    assert.equal(raw.status, 'completed');
    const pair = await nativeArchiveOperation('backup-prune', { target: home, destination: pruning.id,
      file: pruning.archive.path, archiveSha256: pruning.archive.sha256, archiveMetadataSha256: hash(sidecar),
      protectedBackups: [await capturedProtectedPair(f.point.id, f.archive)] }, async () => true);
    assert.equal(pair.status, 'completed');
    // Simulated process loss: no post-commit index publication for either operation.
    await maintainBackups({ home, lease, now: day, getFreeBytes: async () => 100 * 1024 ** 3 });
    const index = await backupStatus({ home }), rawPoint = index.points.find(p => p.id === f.point.id), missing = index.points.find(p => p.id === pruning.id);
    assert.equal(rawPoint.rawMissing, true); assert.notEqual(rawPoint.rawRemoved, true);
    assert.equal(rawPoint.rawRemovalOutcome.confirmedDeletion, false);
    assert.equal(missing.archiveUnavailable, true); assert.notEqual(missing.archiveRemoved, true);
    assert.equal(missing.pruneOutcome.status, 'missing-after-authorized-intent'); assert.equal(missing.pruneOutcome.confirmedDeletion, false);
    assert.equal(index.points.find(p => p.id === partial.id).pruneOutcome.status, 'partial-pair-protected');
    await fs.access(partial.archive.path); await fs.access(f.archive.path);
    assert.equal(index.points.find(p => p.id === 'legacy-unknown').legacy, true);
  });
});

test('round1 mid-stream LOW_DISK keeps receipt when stream abort and reservation finish also fail', async t => {
  const home = await fixture(t); let calls = 0;
  const original = childProcess.spawn;
  childProcess.spawn = (...args) => {
    const child = original(...args), end = child.stdin?.end.bind(child.stdin);
    if (end) child.stdin.end = (chunk, ...tail) => {
      if (typeof chunk === 'string') {
        const parts = chunk.trimEnd().split('\n');
        try {
          const request = JSON.parse(parts.at(-1));
          if (request.operation === 'write' && request.writes?.some(row => row.path.endsWith('lifecycle-costs.json') && JSON.parse(row.data).active.length === 0)) {
            request.operation = 'modeled-finish-failure'; parts[parts.length - 1] = JSON.stringify(request); chunk = parts.join('\n') + '\n';
          }
        } catch { /* Other native protocols remain unchanged. */ }
      }
      return end(chunk, ...tail);
    };
    return child;
  };
  syncBuiltinESMExports();
  try {
    await withMaintenanceLock(home, 'low-disk-fixture', async lease => {
      await assert.rejects(maintainBackups({ home, lease, client: client(), schemaBytes, reason: 'before-data-change', now: day,
        getFreeBytes: async () => ++calls >= 5 ? 0 : 100 * 1024 ** 3 }), error => {
        assert.equal(error.code, 'LOW_DISK'); assert.equal(error.receipt.failed[0].reason, 'insufficient-space');
        assert.ok(error.receipt.cleanupFailures.some(row => row.operation === 'reservation-finish')); return true;
      });
      const index = await backupStatus({ home }); assert.equal(index.lastComplete, null); assert.equal(index.points.length, 1);
      assert.equal(index.points[0].complete, false);
      assert.equal(index.lastReceipt.failed[0].reason, 'insufficient-space');
      assert.ok(index.lastReceipt.cleanupFailures.some(row => row.operation === 'reservation-finish'));
    });
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
});
