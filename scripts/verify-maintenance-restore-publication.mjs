import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createVerifiedArchive, measureArchiveTargets, nativeArchiveOperation } from './maintenance/archive.mjs';
import { updateBackupIndex } from './maintenance/backups.mjs';
import { withMaintenanceLock } from './maintenance/guard.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const restoreUrl = new URL('./local-system-restore.mjs', import.meta.url);

// Execute the exact publication branch and real native/CAS operations without
// repeating SQL/daemon orchestration. Only the private trust admission is seeded
// in this temporary test module; the shipped module exposes no such interface.
async function harness(t, root, hooks = {}) {
  const key = 'restore-publication-' + randomUUID();
  globalThis[key] = hooks;
  t.after(() => { delete globalThis[key]; });
  const directory = path.join(root, 'test-harness');
  await fs.mkdir(directory);
  const proxies = new Map();
  for (const [name, member, hook] of [['backups', 'updateBackupIndex', 'index'], ['archive', 'nativeArchiveOperation', 'native']]) {
    const original = new URL('./maintenance/' + name + '.mjs', import.meta.url).href;
    const file = path.join(directory, name + '.mjs');
    await fs.writeFile(file, `export * from ${JSON.stringify(original)};\nimport {${member} as actual} from ${JSON.stringify(original)};\nexport async function ${member}(...args) {const hook=globalThis[${JSON.stringify(key)}]?.${hook};return hook?hook(actual,args):actual(...args);}\n`, { flag: 'wx' });
    proxies.set('./maintenance/' + name + '.mjs', pathToFileURL(file).href);
  }
  const original = await fs.readFile(restoreUrl, 'utf8');
  const source = original.replace(/from (['"])(\.\/[^'"]+)\1/g, (_, quote, relative) =>
    'from ' + JSON.stringify(proxies.get(relative) ?? new URL(relative, restoreUrl).href));
  const file = path.join(directory, 'restore.mjs');
  await fs.writeFile(file, source + '\nexport const seedPublicationFixture=(receipt,execution)=>trusted.set(receipt,execution);\n', { flag: 'wx' });
  return import(pathToFileURL(file));
}

async function fixture(t, { external = false, output = false } = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const home = await fs.realpath(await fs.mkdtemp(path.join(parent, 'publication-synthetic-')));
  t.after(async () => {
    assert.equal(await fs.realpath(home), home);
    assert.equal(path.dirname(home), parent);
    assert.match(path.basename(home), /^publication-synthetic-/);
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const source = path.join(home, 'source'), id = 'point-' + randomUUID();
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'tiny.txt'), 'abc');
  const zip = external ? path.join(home, 'external.zip') : path.join(home, 'backups', 'archives', id + '.zip');
  await fs.mkdir(path.dirname(zip), { recursive: true });
  const archive = await createVerifiedArchive({ source, files: ['tiny.txt'], destination: zip });
  const point = { id, legacy: false, complete: true, format: 'backup-v2+zip-v1', schemaHash: hash('schema'),
    contentFingerprint: hash('business bytes'), counts: { tables: 1, objects: 1 }, archive, restorePins: ['own-pin'] };
  const proof = { version: 1, status: 'passed', passed: true, backupId: external ? null : id,
    backupFingerprint: point.contentFingerprint, schemaHash: point.schemaHash, format: point.format,
    at: new Date().toISOString(), counts: point.counts, checks: { tables: true, storage: true, schema: true, permissions: true },
    sourceArchiveSha256: archive.sha256, sourceArchiveFingerprint: archive.contentFingerprint, sourceSidecarSha256: archive.metadataSha256 };
  let outputEntries;
  if (output) {
    const directory = path.join(home, 'explicit-output');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'tiny.txt'), 'abc');
    const [snapshot] = await measureArchiveTargets([directory]);
    proof.output = { directory, identity: snapshot.identity };
    outputEntries = [{ path: 'artifact', directory: true, size: 0, sha256: null },
      { path: 'artifact/tiny.txt', directory: false, size: 3, sha256: hash('abc') }];
  }
  const previous = { evidencePath: 'previous synthetic evidence', evidenceSha256: hash('previous'), proof: { marker: 'previous' } };
  await withMaintenanceLock(home, 'fixture', lease => updateBackupIndex(home, lease, index => {
    index.points = external ? [] : [point]; index.lastVerified = previous; index.restoreHistory = [previous];
  }));
  return { home, point, proof, archive, previous, outputEntries,
    execution: signal => ({ proof: structuredClone(proof), source: archive, outputEntries, signal }),
    index: async () => JSON.parse(await fs.readFile(path.join(home, 'maintenance-state', 'backup-index.json'), 'utf8')) };
}

async function assertPublished(f) {
  const index = await f.index(), record = index.lastVerified;
  assert.deepEqual(record.proof, f.proof);
  const bytes = await fs.readFile(record.evidencePath);
  assert.equal(bytes.toString(), JSON.stringify(f.proof, null, 2) + '\n');
  assert.equal(hash(bytes), record.evidenceSha256);
  assert.equal(index.lastRestoreAttempt.status, 'passed');
  assert.deepEqual(index.restoreHistory, [f.previous, record]);
}

test('round2 cancellation after the successful index CAS completes publication', async t => {
  const f = await fixture(t), controller = new AbortController();
  const module = await harness(t, f.home, { index: async (actual, args) => { const result = await actual(...args); controller.abort(); return result; } });
  module.seedPublicationFixture(f.proof, f.execution(controller.signal));
  await withMaintenanceLock(f.home, 'publish', lease => module.recordRestore(f.home, f.proof, { lease, pin: 'own-pin' }));
  assert.equal(controller.signal.aborted, true);
  await assertPublished(f);
});

test('round2 uncertain CAS response reconciles exact committed index and evidence', async t => {
  const f = await fixture(t);
  const module = await harness(t, f.home, { index: async (actual, args) => { await actual(...args); throw Error('synthetic lost CAS response'); } });
  module.seedPublicationFixture(f.proof, f.execution());
  await withMaintenanceLock(f.home, 'publish', lease => module.recordRestore(f.home, f.proof, { lease, pin: 'own-pin' }));
  await assertPublished(f);
});

test('round2 lost final native ACK reconciles exact committed publication', async t => {
  const f = await fixture(t);
  const module = await harness(t, f.home, { native: async (actual, args) => { const result = await actual(...args); if (args[0] === 'restore-publication') throw Error('synthetic lost final ACK'); return result; } });
  module.seedPublicationFixture(f.proof, f.execution());
  await withMaintenanceLock(f.home, 'publish', lease => module.recordRestore(f.home, f.proof, { lease, pin: 'own-pin' }));
  await assertPublished(f);
});

test('round2 uncertain uncommitted CAS preserves old index and cannot claim success', async t => {
  const f = await fixture(t);
  const module = await harness(t, f.home, { index: async (actual, args) => {
    await args[2](await f.index());
    throw Error('synthetic uncertain CAS without a committed replacement');
  } });
  module.seedPublicationFixture(f.proof, f.execution());
  await withMaintenanceLock(f.home, 'publish', lease => assert.rejects(() => module.recordRestore(f.home, f.proof, { lease, pin: 'own-pin' }), { code: 'RESTORE_PUBLICATION_UNCERTAIN' }));
  assert.deepEqual((await f.index()).lastVerified, f.previous);
  const directory = path.join(f.home, 'maintenance-state', 'restore-evidence'), files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.equal(await fs.readFile(path.join(directory, files[0]), 'utf8'), JSON.stringify(f.proof, null, 2) + '\n');
});

test('round2 cancellation before the index CAS explicitly rolls back prepared evidence', async t => {
  const f = await fixture(t), controller = new AbortController();
  const module = await harness(t, f.home, { index: async (actual, args) => { controller.abort(); return actual(...args); } });
  module.seedPublicationFixture(f.proof, f.execution(controller.signal));
  await withMaintenanceLock(f.home, 'publish', lease => assert.rejects(() => module.recordRestore(f.home, f.proof, { lease, pin: 'own-pin' }), { code: 'INTERRUPTED' }));
  assert.deepEqual((await f.index()).lastVerified, f.previous);
  assert.deepEqual(await fs.readdir(path.join(f.home, 'maintenance-state', 'restore-evidence')), []);
});

test('round2 managed commit-ready EOF preserves exact evidence and explicit proof', async t => {
  const f = await fixture(t, { output: true }), evidence = path.join(f.home, 'maintenance-state', 'restore-evidence', randomUUID() + '.json');
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  const data = JSON.stringify(f.proof, null, 2) + '\n';
  await assert.rejects(() => nativeArchiveOperation('restore-publication', {
    target: f.home, destination: f.point.id, file: f.archive.path, archiveSha256: f.archive.sha256,
    targetFingerprint: f.archive.contentFingerprint, archiveMetadataSha256: f.archive.metadataSha256,
    outputTarget: f.proof.output.directory, outputIdentity: f.proof.output.identity, ownedEntries: f.outputEntries,
    writes: [{ path: evidence, data, overwrite: false }], proofData: data,
  }, async phase => { if (phase === 'commit') throw Error('synthetic EOF with unknown CAS outcome'); return true; }), /synthetic EOF/);
  assert.equal(await fs.readFile(evidence, 'utf8'), data);
  assert.equal(await fs.readFile(path.join(f.proof.output.directory, 'recovery-proof.json'), 'utf8'), data);
  assert.deepEqual((await f.index()).lastVerified, f.previous);
});

test('round2 explicit pre-CAS rollback removes only its unpublished proof files', async t => {
  const f = await fixture(t, { output: true }), evidence = path.join(f.home, 'maintenance-state', 'restore-evidence', randomUUID() + '.json');
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  const data = JSON.stringify(f.proof) + '\n';
  const result = await nativeArchiveOperation('restore-publication', {
    target: f.home, destination: f.point.id, file: f.archive.path, archiveSha256: f.archive.sha256,
    targetFingerprint: f.archive.contentFingerprint, archiveMetadataSha256: f.archive.metadataSha256,
    outputTarget: f.proof.output.directory, outputIdentity: f.proof.output.identity, ownedEntries: f.outputEntries,
    writes: [{ path: evidence, data, overwrite: false }], proofData: data,
  }, async phase => phase !== 'commit');
  assert.equal(result.status, 'skipped');
  await assert.rejects(() => fs.stat(evidence), { code: 'ENOENT' });
  await assert.rejects(() => fs.stat(path.join(f.proof.output.directory, 'recovery-proof.json')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.proof.output.directory, 'tiny.txt'), 'utf8'), 'abc');
});

test('round2 standalone external ZIP publishes explicit proof without changing managed evidence', async t => {
  const f = await fixture(t, { external: true, output: true });
  let stages = 0;
  const module = await harness(t, f.home, { native: async (actual, args) => {
    if (args[0] === 'restore-publication') {
      const authorize = args[2];
      args[2] = async (...phase) => {
        stages++;
        for (const file of [f.archive.path, f.archive.path + '.manifest.json', path.join(f.proof.output.directory, 'tiny.txt')]) {
          await assert.rejects(() => fs.writeFile(file, 'late mutation'));
          await assert.rejects(() => fs.writeFile(file + ':late', 'late ADS'));
        }
        return authorize(...phase);
      };
    }
    return actual(...args);
  } });
  const previous = await f.index();
  module.seedPublicationFixture(f.proof, f.execution());
  await withMaintenanceLock(f.home, 'publish', lease => module.recordRestore(f.home, f.proof, { lease }));
  assert.equal(await fs.readFile(path.join(f.proof.output.directory, 'recovery-proof.json'), 'utf8'), JSON.stringify(f.proof, null, 2) + '\n');
  assert.equal(await fs.readFile(path.join(f.proof.output.directory, 'tiny.txt'), 'utf8'), 'abc');
  assert.deepEqual(await f.index(), previous);
  assert.equal(stages, 2);
  await assert.rejects(() => fs.stat(path.join(f.home, 'maintenance-state', 'restore-evidence')), { code: 'ENOENT' });
});
