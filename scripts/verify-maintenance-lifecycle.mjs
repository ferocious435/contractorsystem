import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsBindings, * as fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { withMaintenanceLock } from './maintenance/guard.mjs';
import { readTask, updateTask } from './maintenance/inventory.mjs';
import { planStorage, prepareStoragePlan } from './maintenance/storage.mjs';

const execute = promisify(execFile);
const windows = process.platform === 'win32';
const windowsTest = (name, run) => test(name, { skip: !windows }, run);
const gib = 1024 ** 3;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const write = async (file, bytes) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
};

async function fixture(t, { cliHome = false } = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'contractor-lifecycle-')));
  t.after(async () => {
    const resolved = await fs.realpath(base);
    assert.equal(resolved, base);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    assert.match(path.basename(resolved), /^contractor-lifecycle-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const repo = path.join(base, 'repo'), home = path.join(base, cliHome ? 'ContractorSystem' : 'home');
  const outputRoot = path.join(repo, '.superpowers', 'receipts');
  await fs.mkdir(repo);
  await fs.mkdir(home);
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args],
    { windowsHide: true, encoding: 'utf8' }).trim();
  git('init', '-q');
  await write(path.join(repo, '.gitignore'), '.superpowers/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture');
  const commit = git('rev-parse', 'HEAD');
  const task = { id: 'long-lived-task-36', status: 'active', result: null, commit, dirty: true,
    pid: null, processStartedAt: null, pins: [], worktree: repo, build: null, candidate: null };
  await withMaintenanceLock(home, 'fixture', lease => updateTask(home, lease, task));
  const lock = '{"packages":{"node_modules/next":{"version":"1.0.0"}}}';
  const inputs = { 'package.json': '{}', 'package-lock.json': lock, 'tsconfig.json': '{"include":[]}',
    'next-env.d.ts': '// fixture', 'src/utils/local-ocr-mcp.ts': "export const LOCAL_OCR_MCP_VERSION = '1.2.3';\n" };
  for (const [file, bytes] of Object.entries(inputs)) await write(path.join(repo, file), bytes);
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  for (const name of ['local-system-backup.mjs', 'local-system-restore.mjs', 'local-system-launch.mjs',
    'local-system-maintenance.mjs', 'local-system-build.mjs', 'local-system-package.mjs']) {
    await write(path.join(repo, 'scripts', name), await fs.readFile(path.join(scripts, name)));
  }
  await fs.cp(path.join(scripts, 'maintenance'), path.join(repo, 'scripts', 'maintenance'), { recursive: true });
  await write(path.join(repo, 'ops', 'backup-schema.json'), '{}');
  const deps = path.join(home, 'dependencies', 'synthetic', 'node_modules');
  await write(path.join(path.dirname(deps), 'package-lock.json'), lock);
  await write(path.join(deps, 'next', 'package.json'), '{"name":"next","version":"1.0.0"}');
  await write(path.join(deps, 'next', 'dist', 'bin', 'next'), [
    "const fs = require('node:fs');",
    "if (process.argv[2] !== 'build') process.exit(2);",
    "fs.writeFileSync(process.env.CONTRACTOR_NEXT_DIST_DIR + '/BUILD_ID', 'synthetic-build');",
  ].join('\n'));
  await write(path.join(deps, 'dotenv', 'index.js'), 'exports.parse = () => ({});');
  await write(path.join(home, 'config', 'system.env'), 'FIXTURE=1\n');
  const verifiedReceipt = path.join(outputRoot, '1-tsc.json');
  await write(verifiedReceipt, JSON.stringify({ status: 0, sourceUnchanged: true, dependencyRoot: deps,
    files: Object.entries(inputs).map(([name, bytes]) => ({ path: name, sha256: sha256(bytes) })) }));
  return { base, home, repo, outputRoot, verifiedReceipt, deps, task };
}

async function rejectAfterPackageCopy(runPackage, options) {
  const original = fs.copyFile;
  fsBindings.copyFile = async (from, to, ...flags) => {
    if (to.startsWith(options.home + path.sep) && to.endsWith(path.join('src', 'utils', 'local-ocr-mcp.ts'))) {
      throw Object.assign(Error('fixture copy failed after starting the package'), { code: 'EIO' });
    }
    return original(from, to, ...flags);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(runPackage(options), /fixture copy failed/);
  } finally {
    fsBindings.copyFile = original;
    syncBuiltinESMExports();
  }
}

test('buildReservesDiskBeforeCopy', async () => {
  const { mayStart } = await import('./maintenance/storage.mjs');
  assert.equal(await mayStart({ freeGiB: 13, estimatedGiB: 2 }), false);
  assert.equal(await mayStart({ freeGiB: 14, estimatedGiB: 2 }), true);
});

test('launcher imports from eval with file URL arguments without starting its CLI', async () => {
  const launcher = new URL('./local-system-launch.mjs', import.meta.url);
  const guard = new URL('./maintenance/guard.mjs', import.meta.url);
  const program = 'await import(' + JSON.stringify(launcher.href) + "); console.log('imported');";
  for (const argument of [null, guard.href, launcher.href, fileURLToPath(guard)]) {
    const args = ['--input-type=module', '-e', program, ...(argument ? [argument] : [])];
    const result = await execute(process.execPath, args, { windowsHide: true });
    assert.equal(result.stdout.trim(), 'imported');
    assert.equal(result.stderr, '');
  }
  const entry = fileURLToPath(launcher);
  for (const file of windows ? [entry, entry.slice(0, -4).toUpperCase() + '.mjs'] : [entry]) {
    await assert.rejects(execute(process.execPath, [file, 'invalid-fixture-mode'], { windowsHide: true }),
      error => error.code === 1 && /Use start, status, stop/.test(error.stderr) && error.stdout === '');
  }
});

test('archive headroom includes the target, source, receipts, new bases and reservations', async () => {
  const { archiveFits } = await import('./maintenance/storage.mjs');
  const parts = { target: 100, source: 200, evidence: 50, bases: 300, reserved: 100 };
  const boundary = 12 * gib + 750;
  assert.equal(archiveFits(boundary, parts.reserved, [parts.target, parts.source, parts.evidence, parts.bases]), true);
  assert.equal(archiveFits(boundary - 1, parts.reserved, [parts.target, parts.source, parts.evidence, parts.bases]), false);
  assert.equal(archiveFits(boundary, parts.reserved, [parts.target, null]), false);
});

test('a completed managed candidate is eligible without filling a working-release slot', () => {
  const home = path.resolve('synthetic-home');
  const directory = path.join(home, 'releases');
  const release = {
    id: 'release:done', kind: 'release', root: directory, path: path.join(directory, 'done'),
    bytes: 200, identity: 'fixture', fingerprint: '0'.repeat(64), protectedBy: [],
    provenance: { closedAt: '2026-11-18T00:00:00Z', evidence: [] },
  };
  const inventory = { at: '2026-11-19T00:00:00Z', current: null, acceptedReleases: [], tasks: [],
    processes: [], uncertainties: [], artifacts: [release] };
  assert.deepEqual(planStorage(inventory).actions.map(action => action.reason), ['managed-candidate-closed']);
  release.protectedBy.push('task:other');
  assert.equal(planStorage(inventory).actions.length, 0);
  release.protectedBy = [];
  release.provenance = null;
  assert.equal(planStorage(inventory).actions.length, 0);
});

windowsTest('packageFailureRetainsBuild', async t => {
  const f = await fixture(t);
  const { runBuild } = await import('./local-system-build.mjs');
  const { runPackage } = await import('./local-system-package.mjs');
  const { closeManagedBuild } = await import('./maintenance/lifecycle.mjs');
  const build = await runBuild({ ...f, taskId: f.task.id, receiptLabel: 'task5-final',
    dist: '.next-synthetic', getFreeBytes: async () => 40 * gib });
  assert.match(path.basename(build.receipt), /^\d+-task5-final-build-checks\.json$/);
  await assert.rejects(runPackage({ ...f, id: 'broken', taskId: f.task.id, source: build.source, dist: build.dist,
    dependencies: f.deps, checks: build.receipt, getFreeBytes: async () => 40 * gib }), /OCR|reader/);
  const plan = await prepareStoragePlan({ home: f.home, repoRoots: [f.repo] });
  const target = path.join(build.source, build.dist);
  assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'synthetic-build');
  assert.ok(plan.protected.some(row => row.path === target), 'the failed package must leave a protected build');
  await assert.rejects(fs.stat(path.join(f.home, 'releases', 'broken')), { code: 'ENOENT' });
  await t.test('explicit owned failure closure enters the existing build retention policy', async () => {
    const unknown = path.join(f.outputRoot, 'build-1-unknown');
    await fs.mkdir(path.join(unknown, '.next-synthetic'), { recursive: true });
    await withMaintenanceLock(f.home, 'close failed build', async lease => {
      const close = (taskId, source) => closeManagedBuild({ home: f.home, lease, taskId, source, result: 'rejected' });
      await assert.rejects(close(f.task.id, build.source), /closed task/i);
      const current = await readTask(f.home, f.task.id);
      await updateTask(f.home, lease, { ...current, status: 'closed' });
      await updateTask(f.home, lease, { ...f.task, id: 'other-owner', status: 'closed' });
      await assert.rejects(close('other-owner', build.source), /does not belong/i);
      await assert.rejects(close(f.task.id, unknown), /does not belong/i);
      await close(f.task.id, build.source);
    });
    const options = { home: f.home, repoRoots: [f.repo] };
    const retained = (await prepareStoragePlan(options)).protected.find(item => item.path === target);
    assert.ok(retained?.reasons.includes('recent-failed-build'));
    assert.equal(retained.reasons.includes('failed-build-unresolved'), false);
    const outsideRetention = await prepareStoragePlan({ ...options, policy: { failedBuildRetentionMs: 0 } });
    assert.ok(outsideRetention.actions.some(item => item.path === target && item.reason === 'resolved-failure-outside-retention'));
    assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'synthetic-build');
  });
});

windowsTest('standalone flags and a fabricated process cannot detach the build', async t => {
  const f = await fixture(t);
  const { runBuild } = await import('./local-system-build.mjs');
  const { runPackage } = await import('./local-system-package.mjs');
  const { completeStandaloneVerification, registeredBuild } = await import('./maintenance/lifecycle.mjs');
  const free = async () => 40 * gib;
  const dependencies = f.deps;
  const reader = path.join(f.repo, 'data', 'tools', 'kreuzberg', '1.2.3', 'bin');
  await write(path.join(reader, 'kreuzberg.exe'), 'synthetic binary');
  await write(path.join(reader, 'onnxruntime.dll'), 'synthetic library');
  const nodeExecutable = path.join(f.base, 'node.exe');
  await write(nodeExecutable, 'synthetic executable; never run');
  const dist = '.next-synthetic';
  const first = await runBuild({ ...f, taskId: f.task.id, dist, getFreeBytes: free });
  const states = path.join(f.home, 'maintenance-state', 'lifecycle-artifacts');
  const proof = path.join(states, (await fs.readdir(states)).find(name => name.startsWith('build-')));
  const genuine = await fs.readFile(proof);
  const forged = JSON.parse(genuine);
  forged.result.execution.startedEmpty = true;
  await fs.writeFile(proof, JSON.stringify(forged));
  await assert.rejects(registeredBuild(f.home, first.source, dist), /evidence has changed/i);
  await fs.writeFile(proof, genuine);
  const packageOptions = { ...f, id: 'candidate', taskId: f.task.id, source: first.source, dist, dependencies,
    checks: first.receipt, nodeExecutable, codexExe: nodeExecutable, getFreeBytes: free };
  try {
    await runPackage(packageOptions);
  } catch (error) {
    const staging = path.join(f.home, 'package-staging');
    const names = await fs.readdir(staging).catch(failure => [failure.code]);
    const paths = [f.base, f.home, staging, ...names.map(name => path.join(staging, name))];
    const observed = await Promise.all(paths.map(async file => ({ file,
      state: await fs.lstat(file).then(info => info.isDirectory() ? 'directory' : 'other', failure => failure.code) })));
    const records = path.join(f.home, 'maintenance-state', 'package-attempts');
    const attempts = await Promise.all((await fs.readdir(records).catch(() => []))
      .filter(name => name !== 'seal.json').map(async name => {
        const record = JSON.parse(await fs.readFile(path.join(records, name)));
        return { stage: record.stage, status: record.status, release: record.releaseId, failure: record.failure };
      }));
    t.diagnostic(JSON.stringify({ firstPackageFailure: error.code, observed, attempts }));
    throw error;
  }
  await t.test('same-ID package resumes only the owned staged copy after a real file write failure', async () => {
    const retryOptions = { ...packageOptions, id: 'retry-candidate' };
    await rejectAfterPackageCopy(runPackage, retryOptions);
    await assert.rejects(fs.stat(path.join(f.home, 'releases', 'retry-candidate')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(first.source, dist, 'BUILD_ID'), 'utf8'), 'synthetic-build');
    const { registeredBuild } = await import('./maintenance/lifecycle.mjs');
    const state = await registeredBuild(f.home, first.source, dist);
    assert.match(await fs.readFile(state.failedPackage.failure.stdout, 'utf8'), /fixture copy failed/);
    await assert.rejects(runPackage({ ...packageOptions, id: 'different-id' }), /unfinished|staging/i);
    const root = path.join(f.home, 'package-staging');
    const [slot] = await fs.readdir(root);
    const unknown = path.join(root, slot, 'release', 'unexpected.fixture');
    await write(unknown, 'an unexpected byte cannot be overwritten');
    await assert.rejects(runPackage(retryOptions), /unknown file/i);
    assert.match(await fs.readFile(unknown, 'utf8'), /cannot be overwritten/);
    await fs.unlink(unknown);
    const packaged = await runPackage(retryOptions);
    assert.equal(packaged.release, 'retry-candidate');
    assert.equal(await fs.readFile(path.join(packaged.root, dist, 'BUILD_ID'), 'utf8'), 'synthetic-build');
  });
  const target = path.join(first.source, dist);
  await withMaintenanceLock(f.home, 'verify', async lease => {
    const context = { home: f.home, lease, repoRoots: [f.repo], getFreeBytes: free };
    await assert.rejects(completeStandaloneVerification(
      { release: 'candidate', buildId: 'synthetic-build', verified: true, stopped: false }, context));
    assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'synthetic-build');
    const standalone = { release: 'candidate', buildId: 'synthetic-build', verified: true, stopped: true, port: 3007 };
    await assert.rejects(completeStandaloneVerification(standalone, context), /observed|independent/i);
    await assert.rejects(completeStandaloneVerification(standalone, context, {
      releaseId: 'candidate', pid: 76543,
      process: { ProcessId: 76543, CommandLine: 'fiction', CreationDate: 'fiction', ExecutablePath: nodeExecutable },
    }), /observed|independent/i);
    assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'synthetic-build');
    assert.equal((await readTask(f.home, f.task.id)).build, target);
    const { packagedRelease } = await import('./maintenance/lifecycle.mjs');
    const binding = await packagedRelease(f.home, 'candidate');
    assert.equal(binding.actions.verify, undefined);
    assert.equal(binding.observedStandalone, undefined);
  });
  const plan = await prepareStoragePlan({ home: f.home, repoRoots: [f.repo] });
  await t.test('candidateRemainsPinned', () => {
    assert.ok(plan.protected.some(row => row.id === 'release:retry-candidate' && row.reasons.some(reason => reason.includes(f.task.id))));
  });
  await t.test('explicit package closure archives an owned stage and respects a foreign source pin', async () => {
    const { closeManagedCandidate } = await import('./maintenance/lifecycle.mjs');
    const { applyStorage } = await import('./maintenance/storage.mjs');
    const { verifyArchive } = await import('./maintenance/archive.mjs');
    await rejectAfterPackageCopy(runPackage, { ...packageOptions, id: 'terminal-stage' });
    const directory = path.join(f.home, 'package-staging');
    const [slot] = await fs.readdir(directory);
    const stage = path.join(directory, slot);
    const unknown = path.join(directory, 'f'.repeat(64));
    await write(path.join(unknown, 'unknown.fixture'), 'unclaimed bytes');
    const options = { home: f.home, repoRoots: [f.repo] };
    await withMaintenanceLock(f.home, 'close the staging fixture', async lease => {
      const close = taskId => closeManagedCandidate({ ...options, lease, taskId, releaseId: 'terminal-stage', result: 'unused' });
      await assert.rejects(close(f.task.id), /closed task/i);
      await updateTask(f.home, lease, { ...f.task, status: 'closed' });
      await updateTask(f.home, lease, { ...f.task, id: 'foreign-stage', status: 'closed' });
      await assert.rejects(close('foreign-stage'), /no matching/i);
      await updateTask(f.home, lease, { ...f.task, id: 'foreign-stage', pins: [target] });
      await close(f.task.id);
    });
    const pinned = await prepareStoragePlan(options);
    assert.ok(pinned.protected.some(item => item.path === stage && item.reasons.includes('pin:foreign-stage')));
    assert.ok(pinned.protected.some(item => item.path === unknown && item.reasons.includes('package-stage-unverified')));
    await withMaintenanceLock(f.home, 'unpin and retain the staged bytes', async lease => {
      await updateTask(f.home, lease, { ...f.task, id: 'foreign-stage', status: 'closed' });
      const ready = await prepareStoragePlan(options);
      assert.deepEqual(ready.actions.map(item => item.path), [stage]);
      const { measureArchiveTargets } = await import('./maintenance/archive.mjs');
      const [small] = await measureArchiveTargets([f.home]);
      assert.ok(small.bytes < 4 * 1024 ** 2, 'the modeled archive budget is limited to the tiny owned fixture');
      const result = await applyStorage(ready, { ...options, lease, getFreeBytes: free });
      t.diagnostic(JSON.stringify({ fixtureBytes: small.bytes, modeledArchiveFreeBytes: 40 * gib,
        actualFreeBytesBefore: result.freeBytesBefore, actualFreeBytesAfter: result.freeBytesAfter }));
      assert.equal(result.completed.length, 1, JSON.stringify(result));
      const archive = await verifyArchive(result.completed[0].archive.path);
      assert.ok(archive.entries.some(item => item.path === 'artifact/release/' + dist + '/BUILD_ID'));
      assert.ok(archive.entries.some(item => item.path.startsWith('evidence/')));
    });
    assert.equal(await fs.readFile(path.join(unknown, 'unknown.fixture'), 'utf8'), 'unclaimed bytes');
    assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'synthetic-build');
  });
});

windowsTest('round2 initial preparation failures preserve unknown bytes and allow exact missing retry', async t => {
  const f = await fixture(t);
  const { openPackageStage, readPackageStage } = await import('./maintenance/package-staging.mjs');
  const { closeManagedCandidate } = await import('./maintenance/lifecycle.mjs');
  await withMaintenanceLock(f.home, 'initial boundary fixture', async lease => {
    const context = { home: f.home, lease };
    const descriptor = { releaseId: 'initial-candidate', task: f.task.id, owner: { id: f.task.id, worktree: f.repo },
      source: f.repo, dist: '.next-initial-fixture', recipe: sha256('initial boundary') };
    const fault = async (descriptor, after) => {
      const mkdir = fs.mkdir;
      let reached = false;
      fsBindings.mkdir = async (file, ...options) => {
        if (typeof file === 'string' && path.dirname(file) === path.join(f.home, 'package-staging')) {
          reached = true;
          if (after) await mkdir(file, ...options);
          throw Object.assign(Error(after ? 'fixture failure after mkdir before identity' : 'fixture failure before mkdir'), { code: 'EIO' });
        }
        return mkdir(file, ...options);
      };
      syncBuiltinESMExports();
      try { await assert.rejects(openPackageStage(context, descriptor), /fixture failure/); }
      finally { fsBindings.mkdir = mkdir; syncBuiltinESMExports(); }
      assert.equal(reached, true);
    };
    await fault(descriptor, true);
    const directory = path.join(f.home, 'maintenance-state', 'package-attempts');
    const slot = (await fs.readdir(directory)).find(name => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, -5);
    const initial = await readPackageStage(f.home, slot);
    assert.equal(initial.record.status, 'initial');
    assert.equal(initial.record.identity, undefined);
    const marker = path.join(initial.record.stage, 'unknown.fixture');
    await write(marker, 'unknown bytes after the preparation interruption');
    const bytes = await fs.readFile(marker), diagnostic = await fs.readFile(initial.evidence.path);
    await assert.rejects(openPackageStage(context, descriptor), /taken over|unverified|unfinished/i);
    const close = taskId => closeManagedCandidate({ ...context, taskId, releaseId: descriptor.releaseId, result: 'unused' });
    await assert.rejects(close(f.task.id), /closed task/i);
    await updateTask(f.home, lease, { ...f.task, status: 'closed' });
    await updateTask(f.home, lease, { ...f.task, id: 'foreign-initial-owner', status: 'closed' });
    await assert.rejects(close('foreign-initial-owner'), /matching|belong/i);
    const closed = await close(f.task.id);
    assert.equal(closed.stageUnverified, true);
    assert.deepEqual(await fs.readFile(marker), bytes);
    assert.deepEqual(await fs.readFile(closed.diagnostic.path), diagnostic);
    await assert.rejects(openPackageStage(context, { ...descriptor, releaseId: 'another-id' }));
    const plan = await prepareStoragePlan({ home: f.home, repoRoots: [f.repo] });
    assert.equal(plan.actions.some(action => action.path === initial.record.stage), false);
    assert.ok(plan.protected.some(item => item.path === initial.record.stage));

    const task = { ...f.task, id: 'missing-initial-owner' };
    await updateTask(f.home, lease, task);
    const missing = { ...descriptor, task: task.id, owner: { id: task.id, worktree: f.repo }, releaseId: 'missing-initial' };
    await fault(missing, false);
    const before = (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const own = (await Promise.all(before.map(name => readPackageStage(f.home, name.slice(0, -5)))))
      .find(item => item.record.task === task.id);
    const original = await fs.readFile(own.evidence.path);
    await assert.rejects(openPackageStage(context, { ...missing, releaseId: 'wrong-id' }), /unfinished|match|initial/i);
    assert.deepEqual(await fs.readFile(own.evidence.path), original);
    const resumed = await openPackageStage(context, missing);
    assert.equal(resumed.status, 'copying');
    assert.equal(resumed.startedAt, own.record.startedAt);
    assert.equal(typeof resumed.identity, 'string');
  });
});

windowsTest('round2 stale staging callbacks cannot overwrite publication or a newer attempt', async t => {
  const f = await fixture(t);
  const { openPackageStage, markPackageReady, markPackagePublished, recordPackageStageFailure } = await import('./maintenance/package-staging.mjs');
  const { measureArchiveTargets } = await import('./maintenance/archive.mjs');
  await withMaintenanceLock(f.home, 'stale stage fixture', async lease => {
    const context = { home: f.home, lease };
    const descriptor = { releaseId: 'race-candidate', task: f.task.id, owner: { id: f.task.id, worktree: f.repo },
      source: f.repo, dist: '.next-race-fixture', recipe: sha256('race attempt') };
    const first = await openPackageStage(context, descriptor);
    const stale = await openPackageStage(context, descriptor);
    const [payload] = await measureArchiveTargets([first.stage]);
    const ready = await markPackageReady(context, first, payload, sha256('manifest'));
    const staleReady = await openPackageStage(context, descriptor);
    await markPackagePublished(context, ready);
    const file = path.join(f.home, 'maintenance-state', 'package-attempts', first.slot + '.json');
    const published = await fs.readFile(file);
    const failure = await recordPackageStageFailure(context, stale, Error('late failure from the old copying attempt'));
    assert.equal((await fs.readFile(file)).equals(published), true, 'a stale copying callback must preserve the published record');
    assert.equal(failure.stale, true);
    assert.match(await fs.readFile(failure.diagnostic.path, 'utf8'), /late failure from the old copying attempt/);
    const retained = await fs.readFile(failure.diagnostic.path);
    const next = await openPackageStage(context, { ...descriptor, releaseId: 'newer-candidate', recipe: sha256('newer attempt') });
    const newer = await fs.readFile(file);
    await assert.rejects(markPackageReady(context, stale, payload, sha256('old manifest')), /stale|changed/i);
    await assert.rejects(markPackagePublished(context, staleReady), /stale|changed/i);
    await recordPackageStageFailure(context, stale, Error('late failure after slot reuse'));
    assert.deepEqual(await fs.readFile(file), newer);
    assert.deepEqual(await fs.readFile(failure.diagnostic.path), retained);
    assert.deepEqual(await fs.readdir(next.stage), []);
  });
});

windowsTest('round2 package admissions exclude matching slots sources and final releases', async t => {
  const f = await fixture(t);
  const guard = new URL('./maintenance/guard.mjs', import.meta.url).href;
  const storage = new URL('./maintenance/storage.mjs', import.meta.url).href;
  const program = "const {withLifecycleLock,inheritedMaintenanceLease}=await import(process.argv[1]);" +
    "const {runLifecycle}=await import(process.argv[2]);const c=JSON.parse(process.argv[3]);" +
    "try{const r=await withLifecycleLock(c.home,'package-admission',lease=>runLifecycle('package',{...c,lease,cleanup:false,getFreeBytes:async()=>40*1024**3}),inheritedMaintenanceLease());console.log(JSON.stringify({ok:true,result:r}));}" +
    "catch(e){console.log(JSON.stringify({ok:false,code:e.code}));}";
  await withMaintenanceLock(f.home, 'package admission parent', async lease => {
    const child = async context => JSON.parse((await execute(process.execPath,
      ['--input-type=module', '-e', program, guard, storage, JSON.stringify({ home: f.home, ...context })],
      { windowsHide: true, env: { ...process.env, CONTRACTOR_MAINTENANCE_LEASE: JSON.stringify(lease) } })).stdout.trim());
    const one = { task: f.task.id, packageSlot: sha256(JSON.stringify(['task', f.task.id])),
      build: path.join(f.repo, '.next-one'), releaseId: 'one-candidate' };
    assert.equal((await child(one)).ok, true);
    const sameSlot = await child({ ...one, build: path.join(f.repo, '.next-two'), releaseId: 'two-candidate' });
    assert.deepEqual(sameSlot, { ok: false, code: 'BUSY' });
    const other = { task: 'other-package-task', packageSlot: sha256(JSON.stringify(['task', 'other-package-task'])),
      build: path.join(f.repo, '.next-two'), releaseId: 'two-candidate' };
    assert.deepEqual(await child({ ...other, build: one.build }), { ok: false, code: 'BUSY' });
    assert.deepEqual(await child({ ...other, releaseId: one.releaseId.toUpperCase() }), { ok: false, code: 'BUSY' });
    const distinct = await child(other);
    assert.equal(distinct.ok, true);
    assert.equal(distinct.result.reservedBytes, 2 * gib);
  });
});

windowsTest('an owned missing stage can close without an archive and retains its diagnostic bytes', async t => {
  const f = await fixture(t);
  const { openPackageStage, readPackageStage, recordPackageStageFailure } = await import('./maintenance/package-staging.mjs');
  const { closeManagedCandidate } = await import('./maintenance/lifecycle.mjs');
  await withMaintenanceLock(f.home, 'missing stage fixture', async lease => {
    const context = { home: f.home, lease };
    const descriptor = { releaseId: 'missing-candidate', task: f.task.id,
      owner: { id: f.task.id, worktree: f.repo }, source: f.repo, dist: '.next-missing-fixture', recipe: sha256('first attempt') };
    const attempt = await openPackageStage(context, descriptor);
    await recordPackageStageFailure(context, attempt, Error('retained original failure: עברית'));
    const state = path.join(f.home, 'maintenance-state', 'package-attempts', attempt.slot + '.json');
    const originalDiagnostic = await fs.readFile(state);
    assert.deepEqual(await fs.readdir(attempt.stage), []);
    await fs.rmdir(attempt.stage); // Only the newly created, empty, owned TEMP directory.
    await assert.rejects(openPackageStage(context, descriptor), /missing/i);
    const close = taskId => closeManagedCandidate({ ...context, taskId, releaseId: descriptor.releaseId, result: 'unused' });
    await assert.rejects(close(f.task.id), /closed task/i);
    await updateTask(f.home, lease, { ...f.task, status: 'closed' });
    await updateTask(f.home, lease, { ...f.task, id: 'other-stage-owner', status: 'closed' });
    await assert.rejects(close('other-stage-owner'), /matching|belong/i);
    const release = path.join(f.home, 'releases', descriptor.releaseId);
    await fs.mkdir(release, { recursive: true });
    await assert.rejects(close(f.task.id));
    await fs.rmdir(release);
    const closed = await close(f.task.id);
    assert.equal(closed.stageMissing, true);
    assert.deepEqual(await fs.readFile(closed.diagnostic.path), originalDiagnostic);
    const conclusion = await fs.readFile(closed.receipt.path);
    assert.equal(JSON.parse(conclusion).stageMissing, true);
    await assert.rejects(fs.stat(path.join(f.home, 'maintenance-state', 'evidence-archives')), { code: 'ENOENT' });
    const repeated = await close(f.task.id);
    assert.deepEqual(repeated, closed);
    const next = { ...descriptor, releaseId: 'replacement-candidate', recipe: sha256('next attempt') };
    await write(path.join(attempt.stage, 'foreign.fixture'), 'a reappeared tree is not owned by the new attempt');
    await assert.rejects(close(f.task.id));
    await assert.rejects(openPackageStage(context, next), /taken over|changed|unsafe/i);
    assert.match(await fs.readFile(path.join(attempt.stage, 'foreign.fixture'), 'utf8'), /not owned/);
    await fs.unlink(path.join(attempt.stage, 'foreign.fixture'));
    await fs.rmdir(attempt.stage);
    await updateTask(f.home, lease, f.task);
    const replacement = await openPackageStage(context, next);
    assert.equal(replacement.releaseId, 'replacement-candidate');
    assert.deepEqual(await fs.readFile(closed.diagnostic.path), originalDiagnostic);
    assert.deepEqual(await fs.readFile(closed.receipt.path), conclusion);
    const current = (await readPackageStage(f.home, replacement.slot)).record;
    assert.equal(current.releaseId, 'replacement-candidate');
    await updateTask(f.home, lease, { ...f.task, status: 'closed' });
    const ordinary = await closeManagedCandidate({ ...context, taskId: f.task.id, releaseId: replacement.releaseId, result: 'unused' });
    assert.equal(ordinary.stageMissing, undefined);
    assert.deepEqual(await fs.readdir(replacement.stage), []);
  });
});

windowsTest('a returned missing stage stays protected with its original directory identity', async t => {
  const f = await fixture(t);
  const { openPackageStage } = await import('./maintenance/package-staging.mjs');
  const { closeManagedCandidate } = await import('./maintenance/lifecycle.mjs');
  let stage;
  await withMaintenanceLock(f.home, 'returned stage fixture', async lease => {
    const context = { home: f.home, lease };
    const attempt = await openPackageStage(context, { releaseId: 'returned-candidate', task: f.task.id,
      owner: { id: f.task.id, worktree: f.repo }, source: f.repo, dist: '.next-returned-fixture', recipe: sha256('returned stage') });
    stage = attempt.stage;
    const parked = path.join(f.base, 'parked-empty-stage');
    await fs.rename(stage, parked);
    await updateTask(f.home, lease, { ...f.task, status: 'closed' });
    await closeManagedCandidate({ ...context, taskId: f.task.id, releaseId: 'returned-candidate', result: 'unused' });
    await fs.rename(parked, stage);
    await write(path.join(stage, 'foreign.fixture'), 'the same directory returned after its missing conclusion');
  });
  const plan = await prepareStoragePlan({ home: f.home, repoRoots: [f.repo] });
  assert.equal(plan.actions.some(action => action.path === stage), false, 'a same-identity returned stage must stay protected');
  assert.ok(plan.protected.some(item => item.path === stage));
  assert.match(await fs.readFile(path.join(stage, 'foreign.fixture'), 'utf8'), /same directory returned/);
});

test('installRollbackPreservesBoth', async () => {
  const { switchRelease } = await import('./local-system-launch.mjs');
  const old = { releaseId: 'old', previousId: 'earlier' };
  let pointer = old;
  let listener = old;
  await assert.rejects(switchRelease('new', {
    current: old, readRelease: id => ({ id }), verify: async () => {},
    stop: async process => { assert.equal(listener, process); listener = null; },
    inspect: async process => listener === process ? 'owned' : 'gone',
    portFree: async () => listener === null,
    launch: async (release, previousId) => {
      if (release.id === 'new') throw Error('failed candidate');
      return listener = { releaseId: release.id, previousId, pid: 42 };
    },
    store: async value => { pointer = value; },
  }), /previous program was restored/i);
  assert.deepEqual(pointer, { releaseId: 'old', previousId: 'earlier', pid: 42 });
});

test('rollback inspects both processes after stop and current-write failures', async t => {
  const { switchRelease } = await import('./local-system-launch.mjs');
  for (const fault of ['before-stop', 'after-stop', 'candidate-store']) {
    await t.test(fault, async () => {
      const current = { releaseId: 'old', previousId: 'prior', pid: 1 };
      let listener = current, pointer = current;
      const started = [], recovered = [];
      const stop = async process => {
        assert.equal(listener, process);
        if (process === current && fault === 'before-stop') throw Error('preflight before termination');
        listener = null;
        if (process === current && fault === 'after-stop') throw Error('post-stop port check');
      };
      await assert.rejects(switchRelease('new', {
        current, readRelease: id => ({ id }), verify: () => {}, stop,
        inspect: async process => listener === process ? 'owned' : 'gone',
        portFree: async () => listener === null,
        stopOwned: async process => { assert.equal(listener, process); recovered.push(process.releaseId); listener = null; },
        launch: async ({ id }, previousId) => {
          assert.equal(listener, null);
          started.push(id);
          return listener = { releaseId: id, pid: 17 + started.length, previousId };
        },
        store: async process => {
          if (process.releaseId === 'new' && fault === 'candidate-store') throw Error('cannot write current');
          pointer = process;
        },
      }), fault === 'before-stop' ? /before termination/ : /previous program was restored/);
      assert.equal(listener.releaseId, 'old');
      assert.equal(pointer, listener);
      assert.deepEqual(started, fault === 'before-stop' ? [] : fault === 'after-stop' ? ['old'] : ['new', 'old']);
      assert.deepEqual(recovered, fault === 'candidate-store' ? ['new'] : []);
    });
  }
});

test('an already-running start dispatches maintenance and preserves availability on BUSY', async () => {
  const { runAvailabilityEvent } = await import('./local-system-launch.mjs');
  const live = { running: true, release: 'already-running', pid: 55 };
  const calls = [];
  const result = await runAvailabilityEvent('start', {
    readRunning: async () => live,
    change: () => assert.fail('a healthy process must not restart'),
    after: async (event, ready) => {
      calls.push([event, ready.release]);
      throw Object.assign(Error('busy fixture'), { code: 'BUSY' });
    },
    report: error => calls.push(error.code),
  });
  assert.strictEqual(result, live);
  assert.deepEqual(calls, [['start', 'already-running'], 'BUSY']);
});

test('an installed program dispatches maintenance only after availability under its lease', async () => {
  const { runAvailabilityEvent, switchRelease } = await import('./local-system-launch.mjs');
  const calls = [];
  const held = { lease: {} };
  const ready = await runAvailabilityEvent('install', {
    readRunning: () => assert.fail('the old release must not produce the install event'),
    change: async publish => {
      const started = await switchRelease('next', {
        current: { releaseId: 'old' },
        readRelease: id => ({ id }),
        verify: () => {},
        stop: () => { calls.push('stop-old'); },
        launch: async release => { calls.push('run-' + release.id); return { releaseId: release.id, pid: 42 }; },
        store: () => { calls.push('current-saved'); },
      });
      return publish({ running: true, release: started.releaseId, pid: started.pid }, held);
    },
    after: (event, result, context) => {
      assert.strictEqual(context.lease, held.lease);
      calls.push(event + '-' + result.release);
    },
  });
  assert.equal(ready.running, true);
  assert.deepEqual(calls, ['stop-old', 'run-next', 'current-saved', 'install-next']);
});

windowsTest('installedLauncherResolvesOwnLibrary', async t => {
  const f = await fixture(t);
  const { publishLauncherBundle } = await import('./maintenance/lifecycle.mjs');
  const source = path.join(f.base, 'scripts');
  await write(path.join(source, 'local-system-launch.mjs'),
    "import { value } from './maintenance/proof.mjs'; console.log(value);");
  await write(path.join(source, 'local-system-maintenance.mjs'), 'export {};');
  await write(path.join(source, 'local-system-backup.mjs'), 'export {};');
  await write(path.join(source, 'local-system-restore.mjs'), 'export {};');
  await write(path.join(source, 'maintenance', 'proof.mjs'), "export const value = 'own bundle';");
  await withMaintenanceLock(f.home, 'fixture', async lease => {
    await publishLauncherBundle({ home: f.home, lease, source });
    await publishLauncherBundle({ home: f.home, lease, source });
  });
  assert.equal((await fs.readdir(path.join(f.home, 'maintenance'))).length, 1);
  const launch = () => execute(process.execPath, [path.join(f.home, 'launcher.mjs')], { cwd: f.repo, windowsHide: true });
  assert.equal((await launch()).stdout.trim(), 'own bundle');
  await fs.unlink(path.join(source, 'local-system-maintenance.mjs'));
  await withMaintenanceLock(f.home, 'fixture', lease =>
    assert.rejects(publishLauncherBundle({ home: f.home, lease, source })));
  assert.equal((await launch()).stdout.trim(), 'own bundle');
});

windowsTest('two live children keep each reservation under the same verified parent', async t => {
  const f = await fixture(t);
  const guard = new URL('./maintenance/guard.mjs', import.meta.url).href;
  const storage = new URL('./maintenance/storage.mjs', import.meta.url).href;
  const program = "const { withLifecycleLock, inheritedMaintenanceLease } = await import(process.argv[1]);" +
    "const { runLifecycle } = await import(process.argv[2]);" +
    "try { await withLifecycleLock(process.argv[3], 'child', async lease => {" +
    " const ticket = await runLifecycle('build', { home: lease.home, lease, task: process.argv[4], cleanup: false," +
    " getFreeBytes: async () => { console.log('checking'); await new Promise(resolve => setTimeout(resolve, 1500)); return 20 * 1024 ** 3; } });" +
    " console.log(JSON.stringify(ticket)); }, inheritedMaintenanceLease()); } catch(e) { console.error(e.code); process.exitCode = 2; }";
  const child = (lease, label) => execute(process.execPath, ['--input-type=module', '-e', program, guard, storage, f.home, label],
    { windowsHide: true, env: { ...process.env, CONTRACTOR_MAINTENANCE_LEASE: JSON.stringify(lease) } });
  await withMaintenanceLock(f.home, 'parent', async lease => {
    await assert.rejects(child({ ...lease, token: 'other' }, 'bad-token'), { code: 2, stderr: 'BUSY\n' });
    const pair = await Promise.allSettled([child(lease, 'one'), child(lease, 'two')]);
    const accepted = pair.filter(item => item.status === 'fulfilled');
    assert.ok(accepted.length >= 1);
    for (const result of pair.filter(item => item.status === 'rejected')) assert.match(result.reason.stderr, /BUSY/);
    const third = await child(lease, 'three');
    const reserve = JSON.parse(third.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(reserve.reservedBytes, accepted.length * 2 * gib);
    const journal = JSON.parse(await fs.readFile(path.join(f.home, 'maintenance-state', 'lifecycle-costs.json'), 'utf8'));
    assert.equal(journal.active.length, accepted.length + 1);
  });
});


windowsTest('verified managed Next output omits only unchanged cache packs', async t => {
  const f = await fixture(t);
  const { runBuild } = await import('./local-system-build.mjs');
  const { runPackage } = await import('./local-system-package.mjs');
  const { runLauncher, resolveVerifiedRelease } = await import('./local-system-launch.mjs');
  const { processSnapshot } = await import('./maintenance/guard.mjs');
  const { extractVerifiedArchive, verifyArchive } = await import('./maintenance/archive.mjs');
  const { closeManagedCandidate } = await import('./maintenance/lifecycle.mjs');
  const { applyStorage, importLegacyEvidence } = await import('./maintenance/storage.mjs');
  const dist = '.next-managed-fixture';
  f.outputRoot = path.join(f.repo, '.superpowers', f.task.id);
  const free = async () => 40 * gib;
  const reader = path.join(f.repo, 'data', 'tools', 'kreuzberg', '1.2.3', 'bin');
  await write(path.join(reader, 'kreuzberg.exe'), 'small fixture reader');
  await write(path.join(reader, 'onnxruntime.dll'), 'small fixture OCR runtime');
  const lockFile = path.join(f.repo, 'package-lock.json');
  const lock = JSON.parse(await fs.readFile(lockFile));
  for (const name of ['next', 'dotenv', 'officeparser', '@supabase/supabase-js']) {
    lock.packages['node_modules/' + name] = { version: '1.0.0' };
    await write(path.join(f.deps, name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    await write(path.join(f.deps, name, 'index.js'), name === 'dotenv' ? 'exports.parse = () => ({});' : 'module.exports = {};');
  }
  const sealedLock = JSON.stringify(lock);
  await write(lockFile, sealedLock);
  await write(path.join(path.dirname(f.deps), 'package-lock.json'), sealedLock);
  const checked = JSON.parse(await fs.readFile(f.verifiedReceipt));
  checked.files.find(file => file.path === 'package-lock.json').sha256 = sha256(sealedLock);
  await write(f.verifiedReceipt, JSON.stringify(checked));
  const next = path.join(f.deps, 'next', 'dist', 'bin', 'next');
  await write(next, [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const buildId = 'managed-fixture';",
    "if (process.argv[2] === 'build') {",
    "  const root = process.env.CONTRACTOR_NEXT_DIST_DIR;",
    "  const folder = path.join(root, 'cache/webpack/server-production');",
    "  fs.mkdirSync(folder, {recursive:true});",
    "  for (const name of ['index.pack', '1.pack']) {",
    "    const pack = Buffer.alloc(24, 7);",
    "    pack.writeUInt32LE(0x01637077, 0);",
    "    pack.writeUInt32LE(1, 4);",
    "    pack.writeInt32LE(pack.length - 12, 8);",
    "    fs.writeFileSync(path.join(folder,name), pack);",
    "  }",
    "  fs.writeFileSync(path.join(root, 'BUILD_ID'), buildId);",
    "} else if (process.argv[2] === 'start') {",
    "  if (path.basename(process.cwd()) === 'failed-candidate') process.exit(9);",
    "  const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
    "  fs.writeFileSync(process.env.CONTRACTOR_FIXTURE_SERVER, JSON.stringify({pid:process.pid}));",
    "  require('node:http').createServer((_request, response) => {",
    "    const frame = JSON.stringify([1, JSON.stringify({b:buildId})]);",
    "    response.end('<script>self.__next_f.push(' + frame + ')</script>');",
    "  }).listen(port, '127.0.0.1');",
    "} else process.exit(1);",
  ].join('\n'));

  // A small executable forwards to this test's Node. It avoids copying the full Node
  // distribution merely to exercise executable fingerprinting and process ownership.
  const source = path.join(f.base, 'fixture-runtime.cs'), executable = path.join(f.base, 'fixture-runtime.exe');
  await write(source, [
    'using System;',
    'using System.Diagnostics;',
    'public static class FixtureRuntime {',
    '  public static int Main(string[] args) {',
    '    var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("CONTRACTOR_FIXTURE_NODE"));',
    '    start.Arguments = string.Join(" ", Array.ConvertAll(args, item => "\\\"" + item + "\\\""));',
    '    start.UseShellExecute = false;',
    '    start.CreateNoWindow = true;',
    '    using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }',
    '  }',
    '}',
  ].join('\n'));
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await execute(shell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([IO.File]::ReadAllText($env:CONTRACTOR_FIXTURE_SOURCE)) -OutputAssembly $env:CONTRACTOR_FIXTURE_EXE -OutputType ConsoleApplication"],
  { env: { ...process.env, CONTRACTOR_FIXTURE_SOURCE: source, CONTRACTOR_FIXTURE_EXE: executable }, windowsHide: true });
  const executableBytes = await fs.readFile(executable), executableHash = sha256(executableBytes);
  assert.ok(executableBytes.length < 64 * 1024);
  const nodeExe = path.join(f.home, 'runtime', 'node-' + executableHash.slice(0, 16) + '.exe');
  await write(nodeExe, executableBytes);
  const anchor = path.join(f.home, 'releases', 'fixture-runtime');
  const history = { version: 1, releases: [], builds: [], evidence: [] };
  const addProof = async (filename, value) => {
    const file = path.join(f.outputRoot, filename);
    const bytes = typeof value === 'string' ? value : JSON.stringify(value);
    await write(file, bytes);
    history.evidence.push({ path: file, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) });
    return file;
  };
  for (const [index, id] of ['prior-a', 'prior-b', 'fixture-runtime'].entries()) {
    const root = path.join(f.home, 'releases', id);
    await write(path.join(root, '.next-prior', 'BUILD_ID'), id);
    await write(path.join(root, 'node_modules', 'placeholder.js'), 'synthetic prior release');
    await write(path.join(root, 'release.json'), JSON.stringify({ id, root, nodeExe,
      nodeSha256: executableHash, dependencyRoot: path.dirname(f.deps), dist: '.next-prior', buildId: id,
      createdAt: '2025-01-01T00:00:00Z' }));
    if (root === anchor) continue;
    const stdout = await addProof(id + '.stdout.log', { release: id, buildId: id, running: true });
    const stderr = await addProof(id + '.stderr.log', '');
    const install = await addProof(id + '-install.json', { at: new Date(Date.UTC(2025, 1, index + 1)).toISOString(),
      action: 'install', release: id, buildId: id, passed: true, profileUnchanged: true,
      current: { releaseId: id }, stdout, stderr });
    history.releases.push({ id, installationReceipts: [{ evidence: install }], verificationReceipts: [],
      buildReceipts: [], packageReceipts: [] });
  }
  await write(path.join(f.home, 'current.json'), JSON.stringify({ releaseId: 'fixture-runtime' }));
  await withMaintenanceLock(f.home, 'known synthetic history', lease =>
    importLegacyEvidence(history, { home: f.home, lease, repoRoots: [f.repo] }));

  const serverMarker = path.join(f.base, 'own-server.json');
  const env = { CONTRACTOR_FIXTURE_NODE: process.execPath, CONTRACTOR_FIXTURE_SERVER: serverMarker };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    const build = await runBuild({ ...f, taskId: f.task.id, dist, getFreeBytes: free });
    assert.ok(build.generatedDist, 'the wrapper must observe the actual managed build and its compile-time basis');
    const target = path.join(build.source, dist);
    await runPackage({ ...f, id: 'managed-candidate', taskId: f.task.id, source: build.source, dist, dependencies: f.deps,
      checks: build.receipt, codexExe: nodeExe, getFreeBytes: free });
    const resolved = await resolveVerifiedRelease({ home: f.home, releaseId: 'managed-candidate' });
    assert.equal(resolved.dependencyRoot, path.join(f.home, 'releases', 'managed-candidate', 'node_modules'));
    assert.equal(typeof resolved.require('dotenv').parse, 'function');
    const cache = path.join(target, 'cache', 'webpack', 'server-production');
    const changed = Buffer.from(await fs.readFile(path.join(cache, '1.pack')));
    changed[changed.length - 1] = 9;
    await fs.writeFile(path.join(cache, '1.pack'), changed);
    await fs.writeFile(path.join(cache, 'new.txt'), 'unclassified after build');

    const check = () => runLauncher(['verify', '--release', 'managed-candidate', '--port', '3010'],
      { home: f.home, repoRoots: [f.repo] });
    const pin = async pins => withMaintenanceLock(f.home, 'pin package input', async lease => {
      const state = await readTask(f.home, f.task.id);
      await updateTask(f.home, lease, { ...state, pins });
    });
    await pin([target]);
    assert.equal((await check()).stopped, true);
    assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'managed-fixture');
    await pin([]);
    await runPackage({ ...f, id: 'repacked-candidate', taskId: f.task.id, source: build.source, dist,
      dependencies: f.deps, checks: build.receipt, codexExe: nodeExe, getFreeBytes: free });
    assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'managed-fixture');
    const verified = await check();
    assert.equal(verified.stopped, true);
    const remaining = await fs.stat(target).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (remaining) {
      const options = { home: f.home, repoRoots: [f.repo] };
      const plan = await prepareStoragePlan(options);
      const journalDirectory = path.join(f.home, 'maintenance-state', 'storage-journal');
      const names = await fs.readdir(journalDirectory).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const journals = await Promise.all(names.filter(name => name.endsWith('.json'))
        .map(async name => JSON.parse(await fs.readFile(path.join(journalDirectory, name)))));
      assert.fail(JSON.stringify({ target, actions: plan.actions, protected: plan.protected, journals }, null, 2));
    }
    const evidence = path.join(f.home, 'maintenance-state', 'evidence-index');
    const records = await fs.readdir(evidence);
    const archived = JSON.parse(await fs.readFile(path.join(evidence, records[0])));
    assert.equal(archived.originalPath, target);
    const archive = await verifyArchive(archived.archive.path);
    assert.deepEqual(archive.generatedOmissions.map(row => row.path),
      ['artifact/cache/webpack/server-production/index.pack']);
    assert.ok(archive.rebuildBasis.dependencies && archive.rebuildBasis.runtime);
    const output = path.join(f.base, 'restored');
    await extractVerifiedArchive(archive.path, output);
    const restored = path.join(output, 'artifact', 'cache', 'webpack', 'server-production');
    assert.deepEqual(await fs.readFile(path.join(restored, '1.pack')), changed);
    assert.equal(await fs.readFile(path.join(restored, 'new.txt'), 'utf8'), 'unclassified after build');
    await assert.rejects(fs.stat(path.join(restored, 'index.pack')), { code: 'ENOENT' });
    const archiveRoot = path.dirname(archive.path);
    const retained = (await fs.readdir(archiveRoot)).sort();
    assert.equal((await check()).stopped, true);
    assert.deepEqual((await fs.readdir(archiveRoot)).sort(), retained);

    await t.test('explicitly completed successful and failed candidates leave no orphan', async () => {
      const candidate = path.join(f.home, 'releases', 'managed-candidate');
      const failed = path.join(f.home, 'releases', 'failed-candidate');
      const options = { home: f.home, repoRoots: [f.repo] };
      const failedBuild = await runBuild({ ...f, taskId: f.task.id, dist, getFreeBytes: free });
      const failedDist = path.join(failedBuild.source, dist);
      await runPackage({ ...f, id: 'failed-candidate', taskId: f.task.id, source: failedBuild.source, dist, dependencies: f.deps,
        checks: failedBuild.receipt, codexExe: nodeExe, getFreeBytes: free });
      await assert.rejects(runLauncher(['verify', '--release', 'failed-candidate', '--port', '3010'], options));
      assert.equal(await fs.readFile(path.join(failedDist, 'BUILD_ID'), 'utf8'), 'managed-fixture');
      const close = (lease, releaseId, result) => closeManagedCandidate(
        { ...options, lease, taskId: f.task.id, releaseId, result });
      await withMaintenanceLock(f.home, 'close synthetic candidates', async lease => {
        await assert.rejects(close(lease, 'failed-candidate', 'rejected'), /closed task/i);
        const current = await readTask(f.home, f.task.id);
        await updateTask(f.home, lease, { ...current, status: 'closed' });
        await updateTask(f.home, lease, { ...f.task, id: 'still-referenced', candidate });
        await close(lease, 'managed-candidate', 'superseded');
        await close(lease, 'failed-candidate', 'rejected');
      });
      const planned = await prepareStoragePlan(options);
      assert.ok(planned.protected.some(item => item.path === candidate && item.reasons.includes('task:still-referenced')));
      const build = planned.protected.find(item => item.path === failedDist);
      assert.ok(build?.reasons.includes('recent-failed-build'));
      assert.equal(build.reasons.includes('failed-build-unresolved'), false);
      assert.deepEqual(planned.actions.map(action => action.path), [failed]);
      const retired = await withMaintenanceLock(f.home, 'archive failed candidate', lease =>
        applyStorage(planned, { ...options, lease }));
      assert.equal(retired.completed.length, 1, JSON.stringify(retired));
      const archive = await verifyArchive(retired.completed[0].archive.path);
      assert.deepEqual(archive.generatedOmissions, []);
      assert.ok(archive.entries.some(entry => path.basename(entry.path).startsWith('failed-candidate-verify-failed-') &&
        entry.path.endsWith('.json')));
      assert.ok(archive.entries.some(entry => entry.path === 'artifact/' + dist + '/BUILD_ID'));
      await assert.rejects(fs.stat(failed), { code: 'ENOENT' });
      assert.equal((await fs.stat(candidate)).isDirectory(), true);
      const stillRetained = (await prepareStoragePlan(options)).protected.find(item => item.path === failedDist);
      assert.ok(stillRetained?.reasons.includes('recent-failed-build'));
      assert.equal(stillRetained.reasons.includes('failed-build-unresolved'), false);
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const marker = await fs.readFile(serverMarker).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (marker) {
      const { pid } = JSON.parse(marker);
      const [owned] = await processSnapshot(pid);
      const location = path.join(f.home, 'releases', 'managed-candidate', 'node_modules', 'next', 'dist', 'bin', 'next');
      if (owned?.executable?.toLowerCase() === process.execPath.toLowerCase() &&
          owned.commandLine?.includes(location)) process.kill(pid);
    }
  }
});

windowsTest('legacyHelpersCannotBypassGuard', async t => {
  const f = await fixture(t);
  const { runBuild } = await import('./local-system-build.mjs');
  await assert.rejects(runBuild({ ...f, taskId: f.task.id, dist: '.next-denied', getFreeBytes: async () => 13 * gib }),
    { code: 'LOW_DISK' });
  assert.deepEqual(await fs.readdir(f.outputRoot), ['1-tsc.json']);
  const { runPackage } = await import('./local-system-package.mjs');
  await withMaintenanceLock(f.home, 'held elsewhere', async () => {
    await assert.rejects(runPackage({ ...f, id: 'legacy-denied', source: f.repo, dist: '.next-denied',
      legacy: true, dependencies: f.deps }), { code: 'BUSY' });
  });
  await assert.rejects(fs.stat(path.join(f.home, 'releases')), { code: 'ENOENT' });
});

windowsTest('legacy-shaped helper reaches buildMain and leaves output untouched on BUSY and LOW_DISK', async t => {
  const f = await fixture(t, { cliHome: true });
  const helper = path.join(f.outputRoot, 'fixture-build-adapter.mjs');
  const entry = new URL('./local-system-build.mjs', import.meta.url).href;
  await write(helper, [
    'const { buildMain } = await import(' + JSON.stringify(entry) + ');',
    'const [task, checks, output] = process.argv.slice(2);',
    "try { await buildMain(['--task', task, '--checks', checks, '--dist', '.next-fixture', '--output', output], { receiptLabel: 'task5-final' }); }",
    "catch (error) { console.error(error.code); process.exitCode = 3; }",
  ].join('\n'));
  const run = lease => {
    const env = { ...process.env, LOCALAPPDATA: f.base };
    delete env.CONTRACTOR_MAINTENANCE_LEASE;
    if (lease) env.CONTRACTOR_MAINTENANCE_LEASE = JSON.stringify(lease);
    return execute(process.execPath, [helper, f.task.id, f.verifiedReceipt, f.outputRoot],
      { cwd: f.repo, windowsHide: true, env });
  };
  await withMaintenanceLock(f.home, 'outer fixture', async lease => {
    await assert.rejects(run(), error => error.code === 3 && /BUSY/.test(error.stderr));
    const { runLifecycle } = await import('./maintenance/storage.mjs');
    await runLifecycle('build', { home: f.home, task: 'occupied-reserve', lease, cleanup: false,
      expectedAdditionalBytes: 100000 * gib, getFreeBytes: async () => 200000 * gib });
    await assert.rejects(run(lease), error => error.code === 3 && /LOW_DISK/.test(error.stderr));
  });
  assert.deepEqual((await fs.readdir(f.outputRoot)).sort(), ['1-tsc.json', 'fixture-build-adapter.mjs']);
});
