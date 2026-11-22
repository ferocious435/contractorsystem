import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { withMaintenanceLock } from './maintenance/guard.mjs';
import {
  catalogArchiveGroups, createVerifiedArchive, deleteArchivedTarget, extractVerifiedArchive, measureArchiveTargets,
  publishEvidenceArchive, verifyArchive,
} from './maintenance/archive.mjs';
import {
  applyStorage, captureGeneratedBuild, importLegacyEvidence, planStorage, prepareStoragePlan, registerLifecycleEvidence,
} from './maintenance/storage.mjs';
import { pathKey } from './maintenance/policy.mjs';

const write = async (file, content) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};
const json = (file, value) => write(file, JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const windows = process.platform === 'win32';
const filesystemTest = (name, run) => test(name, { skip: !windows }, run);
const notFound = file => assert.rejects(fs.access(file), { code: 'ENOENT' });
const lockfile = '{"name":"fixture","lockfileVersion":3}';
const execute = promisify(childProcess.execFile);

filesystemTest('Windows named streams on a file or directory prevent archiving and measuring', async t => {
  const base = await directory(t);
  const source = path.join(base, 'source');
  const item = path.join(source, 'safe.txt');
  const folder = path.join(source, 'nested');
  const empty = path.join(source, 'empty');
  await write(item, 'primary');
  await write(path.join(folder, 'child'), 'nested primary');
  await fs.mkdir(empty);
  for (const [file, entry] of [[item, 'safe.txt'], [folder, 'nested/child'], [empty, null]]) {
    const stream = file + ':private';
    await fs.writeFile(stream, 'hidden bytes');
    const destination = path.join(base, 'archive.zip');
    if (entry) await assert.rejects(createVerifiedArchive({ source, files: [entry], destination }), /named stream/i);
    const [measured] = await measureArchiveTargets([source]);
    assert.equal(measured.fingerprint, null);
    assert.equal(await fs.readFile(stream, 'utf8'), 'hidden bytes');
    await notFound(destination);
    await fs.unlink(stream);
  }
});

filesystemTest('a late named stream blocks deletion and an open deletion transaction blocks a new stream', async t => {
  const base = await directory(t);
  const target = path.join(base, 'target');
  const evidence = path.join(target, 'marker.txt');
  await write(evidence, 'primary');
  const [captured] = await measureArchiveTargets([target]);
  const { groups } = await catalogArchiveGroups([{ source: target, prefix: 'artifact' }]);
  const archive = await publishEvidenceArchive({
    groups, destination: path.join(base, 'artifact.zip'), targetFingerprint: captured.fingerprint,
  });
  const operation = {
    archive, target, targetFingerprint: captured.fingerprint, targetIdentity: captured.identity, resume: false,
  };
  await fs.writeFile(evidence + ':late', 'after planning');
  await assert.rejects(deleteArchivedTarget(operation, async () => false), /named stream/i);
  assert.equal(await fs.readFile(evidence + ':late', 'utf8'), 'after planning');
  await fs.unlink(evidence + ':late');
  await assert.rejects(deleteArchivedTarget(operation, async phase => {
    if (phase === 'commit') {
      assert.equal(await fs.readFile(evidence, 'utf8'), 'primary');
      await assert.rejects(fs.writeFile(evidence + ':during-commit', 'racing bytes'));
      throw new Error('simulated loss of authorization');
    }
    return true;
  }), /loss of authorization/);
  assert.equal(await fs.readFile(evidence, 'utf8'), 'primary');
  const result = await deleteArchivedTarget(operation, async phase => {
    if (phase === 'commit') return true;
    await assert.rejects(fs.writeFile(evidence + ':during', 'racing bytes'));
    await assert.rejects(fs.writeFile(target + ':during', 'racing directory bytes'));
    return true;
  });
  assert.equal(result.status, 'completed');
  await notFound(target);
});

async function directory(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'contractor-storage-')));
  t.after(async () => {
    const checked = await fs.realpath(root);
    assert.equal(checked, root);
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function smallFixtureForecast(t, f) {
  const base = await fs.realpath(path.dirname(f.home));
  assert.equal(path.dirname(base), await fs.realpath(os.tmpdir()));
  assert.match(path.basename(base), /^contractor-storage-/);
  let bytes = 0;
  const visit = async directory => {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name), info = await fs.lstat(file);
      if (info.isSymbolicLink()) {
        const relative = path.relative(base, await fs.realpath(file));
        assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
      } else if (info.isDirectory()) await visit(file);
      else {
        assert.ok(info.isFile());
        bytes += info.size;
        assert.ok(bytes < 4 * 1024 ** 2, 'modeled archive forecasts are limited to tiny owned fixtures');
      }
    }
  };
  await visit(base);
  t.diagnostic(JSON.stringify({ fixtureBytes: bytes, modeledArchiveFreeBytes: 20 * gib }));
  return { getFreeBytes: async () => 20 * gib };
}

async function releases(t, count = 4) {
  const base = await directory(t);
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repo');
  await fs.mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args], { windowsHide: true });
  git('init', '-q');
  await write(path.join(repo, '.gitignore'), '.superpowers/\n.next*/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture');
  const nodeExe = path.join(home, 'runtime', 'node.exe');
  const dependencyRoot = path.join(home, 'dependencies', 'baseline');
  await write(nodeExe, 'node');
  await write(path.join(dependencyRoot, 'node_modules', 'dependency.js'), 'dependency');
  const index = { version: 1, releases: [], builds: [], evidence: [] };
  const evidence = path.join(repo, '.superpowers', 'history');
  const record = async (file, value) => {
    await json(file, value);
    const bytes = await fs.readFile(file);
    index.evidence.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
  };
  const ids = Array.from({ length: count }, (_, i) => 'v' + (i + 1));
  const roots = new Map();
  for (const [i, id] of ids.entries()) {
    const folder = path.join(home, 'releases', id);
    const buildId = id + '-build';
    const createdAt = new Date(Date.UTC(2025, 0, i + 1)).toISOString();
    const root = path.join(folder, 'release.json');
    const dist = '.next-test';
    await write(path.join(folder, 'node_modules', 'dependency.js'), 'dependency');
    await write(path.join(folder, dist, 'BUILD_ID'), buildId);
    await write(path.join(folder, 'a-unique.bin'), 'unknown-' + id);
    await json(root, { version: 1, id, root: folder, nodeExe, dependencyRoot, dist, buildId, createdAt,
      dependencyLockSha256: hash(lockfile), nodeSha256: hash('node') });
    roots.set(id, folder);
    const at = new Date(Date.UTC(2025, 0, i + 1, 1)).toISOString();
    const install = path.join(evidence, id + '-install.json');
    const stdout = path.join(evidence, id + '-install.stdout.log');
    const stderr = path.join(evidence, id + '-install.stderr.log');
    const previousId = ids[i - 1] ?? null;
    await record(stdout, { release: id, buildId, running: true });
    await record(stderr, '');
    await record(install, {
      at, action: 'install', release: id, buildId, passed: true, profileUnchanged: true,
      current: { releaseId: id, previousId }, stdout, stderr,
    });
    index.releases.push({ id, installationReceipts: [{ evidence: install }], verificationReceipts: [],
      packageReceipts: [], buildReceipts: [] });
  }
  await json(path.join(home, 'current.json'), { releaseId: ids.at(-1), previousId: ids.at(-2) });
  const repoRoots = [repo];
  const readOptions = { home, repoRoots };
  const importIndex = () => withMaintenanceLock(home, 'fixture-import', lease =>
    importLegacyEvidence(index, { ...readOptions, lease }));
  const apply = (plan, { getFreeBytes } = {}) => withMaintenanceLock(home, 'fixture-apply', lease =>
    applyStorage(plan, { ...readOptions, lease, getFreeBytes }));
  return { home, repo, evidence, ids, roots, index, record, importIndex, apply,
    plan: () => prepareStoragePlan(readOptions) };
}

filesystemTest('deletion disregards only its own archive worker inside a registered worktree', async t => {
  for (const withForeignWorker of [false, true]) {
    const f = await releases(t);
    const scripts = path.join(f.repo, '.superpowers', 'worker', 'scripts');
    await fs.mkdir(scripts, { recursive: true });
    await fs.cp(new URL('./maintenance', import.meta.url), path.join(scripts, 'maintenance'), { recursive: true });
    for (const name of ['local-system-backup.mjs', 'local-system-launch.mjs']) {
      await fs.copyFile(new URL('./' + name, import.meta.url), path.join(scripts, name));
    }
    const local = name => import(pathToFileURL(path.join(scripts, 'maintenance', name)).href);
    const guard = await local('guard.mjs');
    const storage = await local('storage.mjs');
    const options = { home: f.home, repoRoots: [f.repo] };
    const forecast = await smallFixtureForecast(t, f);
    await guard.withMaintenanceLock(f.home, 'worker fixture import', lease =>
      storage.importLegacyEvidence(f.index, { ...options, lease }));
    const plan = await storage.prepareStoragePlan(options);
    const target = f.roots.get('v1');
    const marker = path.join(target, 'a-unique.bin');
    assert.deepEqual(plan.actions.map(action => action.path), [target]);

    let foreign, closed;
    const getFreeBytes = async () => {
      if (withForeignWorker && !foreign) {
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const worker = path.join(scripts, 'maintenance', 'archive-worker.ps1');
        foreign = childProcess.spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', worker],
          { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
        closed = new Promise(resolve => foreign.once('close', resolve));
        foreign.on('error', () => {});
        foreign.stdin.on('error', () => {});
        const [row] = await guard.processSnapshot(foreign.pid);
        assert.equal(row?.parentPid, process.pid);
        assert.ok(row.processStartedAt && row.commandLine.toLowerCase().includes(worker.toLowerCase()));
      }
      return forecast.getFreeBytes();
    };
    try {
      const receipt = await guard.withMaintenanceLock(f.home, 'worker fixture apply', lease =>
        storage.applyStorage(plan, { ...options, lease, getFreeBytes }));
      assert.deepEqual(receipt.failed, []);
      if (withForeignWorker) {
        assert.ok(foreign);
        assert.deepEqual(receipt.completed, []);
        assert.equal(receipt.skipped[0]?.reason, 'protection-or-scope-changed');
        assert.equal(await fs.readFile(marker, 'utf8'), 'unknown-v1');
      } else {
        assert.deepEqual(receipt.completed.map(action => action.id), ['release:v1']);
        await notFound(marker);
      }
    } finally {
      if (foreign) {
        foreign.stdin.end();
        await closed;
      }
    }
  }
});

filesystemTest('round2 public archive apply excludes a sibling admission and lifecycle cleanup reuses its gate', async t => {
  const f = await releases(t, 5);
  await f.importIndex();
  const measured = await measureArchiveTargets([f.home, f.repo]);
  const fixtureBytes = measured.reduce((sum, row) => sum + row.bytes, 0);
  assert.ok(Number.isSafeInteger(fixtureBytes) && fixtureBytes < 4 * 1024 ** 2);
  t.diagnostic(JSON.stringify({ fixtureBytes, modeledFreeBytes: 14 * gib }));
  const plan = await f.plan();
  assert.equal(plan.actions.length, 2);
  plan.actions = plan.actions.slice(0, 1);
  const root = path.dirname(f.home);
  const files = Object.fromEntries(['plan', 'budget', 'entered', 'release'].map(name => [name, path.join(root, name + '.fixture')]));
  await json(files.plan, plan);
  await write(files.budget, String(14 * gib));
  const guard = new URL('./maintenance/guard.mjs', import.meta.url).href;
  const storage = new URL('./maintenance/storage.mjs', import.meta.url).href;
  const program = [
    "const fs=await import('node:fs/promises');",
    "const {withLifecycleLock,inheritedMaintenanceLease}=await import(process.argv[1]);",
    "const {applyStorage,runLifecycle}=await import(process.argv[2]);",
    "const c=JSON.parse(process.argv[3]); let entered=false;",
    "try { const result=await withLifecycleLock(c.home,'budget-child',async lease=>{",
    "const free=async()=>Number(await fs.readFile(c.budget,'utf8'));",
    "if(c.mode==='build') return runLifecycle('build',{home:c.home,lease,task:'sibling-build',cleanup:false,getFreeBytes:free});",
    "return applyStorage(JSON.parse(await fs.readFile(c.plan,'utf8')),{home:c.home,repoRoots:[c.repo],lease,coordinatorLease:lease,getFreeBytes:async()=>{",
    "if(!entered){entered=true;await fs.writeFile(c.entered,'ready');const until=Date.now()+120000;",
    "while(!await fs.access(c.release).then(()=>true,()=>false)){if(Date.now()>until)throw Error('fixture barrier timeout');await new Promise(r=>setTimeout(r,20));}}return free();}});",
    "},inheritedMaintenanceLease());console.log(JSON.stringify({ok:true,result}));}",
    "catch(e){console.log(JSON.stringify({ok:false,code:e.code,message:e.message}));}",
  ].join('');
  await withMaintenanceLock(f.home, 'archive admission parent', async lease => {
    const child = async mode => JSON.parse((await execute(process.execPath,
      ['--input-type=module', '-e', program, guard, storage, JSON.stringify({ home: f.home, repo: f.repo, ...files, mode })],
      { windowsHide: true, env: { ...process.env, CONTRACTOR_MAINTENANCE_LEASE: JSON.stringify(lease) } })).stdout.trim());
    const archive = child('apply');
    let sibling;
    let setupFailure;
    try {
      const ready = async () => {
        const until = Date.now() + 120000;
        while (!await fs.access(files.entered).then(() => true, () => false)) {
          if (Date.now() > until) throw Error('fixture apply did not reach its budget check');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      await Promise.race([ready(), archive.then(result => { throw Error('archive ended before barrier: ' + JSON.stringify(result)); })]);
      sibling = await child('build');
    } catch (error) {
      setupFailure = error;
    } finally {
      await write(files.release, 'continue');
    }
    const applied = await archive;
    if (setupFailure) throw setupFailure;
    assert.equal(sibling.ok, false, 'an archive and a sibling build cannot both obtain the shared forecast');
    assert.equal(sibling.code, 'BUSY');
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.result.completed.length, 1, JSON.stringify(applied));
    const archiveRoot = path.join(f.home, 'maintenance-state', 'evidence-archives');
    const written = (await Promise.all((await fs.readdir(archiveRoot)).map(async name => (await fs.stat(path.join(archiveRoot, name))).size)))
      .reduce((sum, bytes) => sum + bytes, 0);
    assert.ok(written > 0);
    await write(files.budget, String(14 * gib - written));
    const after = await child('build');
    assert.equal(after.ok, false);
    assert.equal(after.code, 'LOW_DISK');
    const { runLifecycle } = await import('./maintenance/storage.mjs');
    const nested = await runLifecycle('build', { home: f.home, repoRoots: [f.repo], lease,
      task: 'nested-cleanup', getFreeBytes: async () => 40 * gib });
    assert.equal(nested.cleanup?.completed.length, 1, JSON.stringify(nested));
    await runLifecycle('build', { home: f.home, lease, task: 'nested-cleanup', phase: 'finish', reservation: nested, passed: true });
  });
});

filesystemTest('round3 an admitted sibling finishes after public apply refuses without writes', async t => {
  const f = await releases(t);
  await f.importIndex();
  const forecast = await smallFixtureForecast(t, f);
  const plan = await f.plan();
  assert.equal(plan.actions.length, 1);
  const base = path.dirname(f.home);
  const files = Object.fromEntries(['ticket', 'release'].map(name => [name, path.join(base, name + '.fixture')]));
  const guard = new URL('./maintenance/guard.mjs', import.meta.url).href;
  const lifecycle = new URL('./maintenance/lifecycle.mjs', import.meta.url).href;
  const storage = new URL('./maintenance/storage.mjs', import.meta.url).href;
  const packageContext = { home: f.home, task: 'admitted-package', packageSlot: hash('admitted-package'),
    build: path.join(f.repo, '.next-admitted'), releaseId: 'admitted-release' };
  const program = "const fs=await import('node:fs/promises');" +
    "const {inheritedMaintenanceLease}=await import(process.argv[1]);const {withLifecycleOperation}=await import(process.argv[2]);" +
    "const c=JSON.parse(process.argv[3]);try{const result=await withLifecycleOperation('package',{...c,lease:inheritedMaintenanceLease(),cleanup:false,getFreeBytes:async()=>40*1024**3},async(o,r)=>{" +
    "await fs.writeFile(c.ticket,JSON.stringify(r));const until=Date.now()+120000;while(!await fs.access(c.release).then(()=>true,()=>false)){if(Date.now()>until)throw Error('package barrier timeout');await new Promise(r=>setTimeout(r,20));}return {passed:true};});console.log(JSON.stringify({ok:true,result}));}" +
    "catch(e){console.log(JSON.stringify({ok:false,code:e.code,message:e.message}));}";
  const snapshot = async () => {
    const rows = [];
    const visit = async folder => {
      for (const name of (await fs.readdir(folder)).sort()) {
        const file = path.join(folder, name), info = await fs.lstat(file);
        assert.equal(info.isSymbolicLink(), false);
        rows.push([path.relative(f.home, file), info.isDirectory() ? 'directory' : hash(await fs.readFile(file))]);
        if (info.isDirectory()) await visit(file);
      }
    };
    await visit(f.home);
    return rows;
  };
  await withMaintenanceLock(f.home, 'admitted package parent', async lease => {
    const env = { ...process.env, CONTRACTOR_MAINTENANCE_LEASE: JSON.stringify(lease) };
    const child = execute(process.execPath, ['--input-type=module', '-e', program, guard, lifecycle,
      JSON.stringify({ ...packageContext, ...files })], { windowsHide: true, env });
    let failure;
    let ticket;
    try {
      const until = Date.now() + 120000;
      while (!await fs.access(files.ticket).then(() => true, () => false)) {
        if (Date.now() > until) throw Error('package admission did not finish');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      ticket = JSON.parse(await fs.readFile(files.ticket, 'utf8'));
      const before = await snapshot();
      const applyProgram = "const {withLifecycleLock,inheritedMaintenanceLease}=await import(process.argv[1]);const {applyStorage}=await import(process.argv[2]);const c=JSON.parse(process.argv[3]);" +
        "try{const result=await withLifecycleLock(c.home,'public-apply-child',lease=>applyStorage(c.plan,{home:c.home,repoRoots:[c.repo],lease,getFreeBytes:async()=>{throw Error('apply reached archive budget');}}),inheritedMaintenanceLease());console.log(JSON.stringify({ok:true,result}));}catch(e){console.log(JSON.stringify({ok:false,code:e.code,message:e.message}));}";
      const applied = JSON.parse((await execute(process.execPath, ['--input-type=module', '-e', applyProgram, guard, storage,
        JSON.stringify({ home: f.home, repo: f.repo, plan })], { windowsHide: true, env })).stdout.trim());
      assert.equal(applied.ok, false, JSON.stringify(applied));
      assert.equal(applied.code, 'BUSY');
      assert.deepEqual(await snapshot(), before, 'refused apply must not write archives journals receipts or reservations');
    } catch (error) { failure = error; }
    finally { await write(files.release, 'finish'); }
    const finished = await child;
    assert.equal(JSON.parse(finished.stdout.trim()).ok, true, finished.stdout);
    assert.equal(finished.stderr, '', 'the operation must record its finish successfully');
    const costs = JSON.parse(await fs.readFile(path.join(f.home, 'maintenance-state', 'lifecycle-costs.json'), 'utf8'));
    assert.deepEqual(costs.active, []);
    assert.equal(costs.lastReceipt.id, ticket.id);
    if (failure) throw failure;
    const { runLifecycle } = await import('./maintenance/storage.mjs');
    const next = await runLifecycle('package', { ...packageContext, lease, cleanup: false, getFreeBytes: async () => 40 * gib });
    assert.notEqual(next.id, ticket.id);
    await runLifecycle('package', { ...packageContext, lease, phase: 'finish', reservation: next, passed: true });
    const applied = await applyStorage(plan, { home: f.home, repoRoots: [f.repo], lease, ...forecast });
    assert.equal(applied.completed.length, 1, JSON.stringify(applied));
  });
});

filesystemTest('lifecycle warns below 20 GiB without changing the admission floor', async t => {
  const home = await directory(t);
  const storage = new URL('./maintenance/storage.mjs', import.meta.url).href;
  const guard = new URL('./maintenance/guard.mjs', import.meta.url).href;
  const program = `
    import * as fs from 'node:fs/promises';
    import path from 'node:path';
    const [storage, guard, home] = process.argv.slice(1);
    const { runLifecycle } = await import(storage);
    const { withLifecycleLock } = await import(guard);
    const receipts = path.join(home, 'maintenance-state', 'lifecycle-costs.json');
    const lastReceipt = async () => JSON.parse(await fs.readFile(receipts, 'utf8')).lastReceipt;
    const gib = 1024 ** 3;
    const result = await withLifecycleLock(home, 'disk-warning-fixture', async lease => {
      const context = { home, lease, task: 'disk-warning-fixture', cleanup: false };
      const packageAt = (free, details = {}) => runLifecycle('package', {
        ...context, getFreeBytes: async () => free, ...details,
      });
      const admitted = await packageAt(20 * gib);
      const at20 = [admitted.lowFreeSpace, (await lastReceipt()).lowFreeSpace];
      const resized = await packageAt(19 * gib, { phase: 'resize', reservation: admitted });
      const afterResize = [resized.lowFreeSpace, (await lastReceipt()).lowFreeSpace];
      const finished = await packageAt(19 * gib, { phase: 'finish', reservation: admitted, passed: true });
      const afterFinish = [finished.lowFreeSpace, (await lastReceipt()).lowFreeSpace];
      const at19 = await runLifecycle('build', { ...context, getFreeBytes: async () => 19 * gib });
      const blocked = await packageAt(16 * gib - 1).catch(error => error.code);
      const unknown = await runLifecycle('start', { ...context, getFreeBytes: async () => null });
      return { at20, afterResize, afterFinish, at19: at19.lowFreeSpace, blocked, unknown: unknown.lowFreeSpace };
    });
    console.log(JSON.stringify(result));
  `;
  const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '-e', program, storage, guard, home],
    { windowsHide: true });
  assert.deepEqual(JSON.parse(stdout), {
    at20: [false, false], afterResize: [true, true], afterFinish: [true, true],
    at19: true, blocked: 'LOW_DISK', unknown: null,
  });
  assert.equal(stderr.trim().split(/\r?\n/).length, 1);
  assert.match(stderr, /20 ГиБ/);
});

filesystemTest('round3 finish recovers a real short gate collision for only its matching reservation', async t => {
  const base = await directory(t), home = path.join(base, 'home');
  await fs.mkdir(home);
  const collision = path.join(base, 'gate-collision.fixture');
  const { withReservationGate } = await import('./maintenance/guard.mjs');
  const { runLifecycle } = await import('./maintenance/storage.mjs');
  const context = { home, task: 'finishing-package', packageSlot: hash('finishing-package'), cleanup: false,
    getFreeBytes: async () => 40 * gib };
  const guard = new URL('./maintenance/guard.mjs', import.meta.url).href;
  const storage = new URL('./maintenance/storage.mjs', import.meta.url).href;
  const program = "const cp=(await import('node:child_process')).default;const {writeFileSync}=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');const c=JSON.parse(process.argv[3]);let collisions=0;const spawn=cp.spawn;" +
    "cp.spawn=(exe,args,options)=>{const child=spawn(exe,args,options);const q=JSON.parse(options.env?.CODEX_MAINTENANCE_QUERY??'null');if(q?.file?.endsWith('reservation-gate'))child.once('close',code=>{if(code!==0){collisions++;writeFileSync(c.collision,'failed native exclusive open');}});return child;};syncBuiltinESMExports();" +
    "const {withLifecycleLock,inheritedMaintenanceLease}=await import(process.argv[1]);const {runLifecycle}=await import(process.argv[2]);try{const result=await withLifecycleLock(c.home,'finish-child',lease=>runLifecycle('package',{...c,lease,phase:'finish',passed:true}),inheritedMaintenanceLease());console.log(JSON.stringify({ok:true,result,collisions}));}catch(e){console.log(JSON.stringify({ok:false,code:e.code,collisions}));}";
  await withMaintenanceLock(home, 'finish collision parent', async lease => {
    const first = await runLifecycle('package', { ...context, lease });
    const other = await runLifecycle('build', { home, task: 'unrelated-build', lease, cleanup: false, getFreeBytes: context.getFreeBytes });
    let finish;
    await withReservationGate(home, lease, async () => {
      finish = execute(process.execPath, ['--input-type=module', '-e', program, guard, storage,
        JSON.stringify({ home, task: context.task, reservation: first, collision })],
      { windowsHide: true, env: { ...process.env, CONTRACTOR_MAINTENANCE_LEASE: JSON.stringify(lease) } });
      const until = Date.now() + 120000;
      while (!await fs.access(collision).then(() => true, () => false)) {
        if (Date.now() > until) throw Error('finish did not encounter the held native gate');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    const result = JSON.parse((await finish).stdout.trim());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.collisions >= 1, 'the real exclusive gate open must have failed before recovery');
    assert.equal(result.result.id, first.id);
    const file = path.join(home, 'maintenance-state', 'lifecycle-costs.json');
    const costs = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(costs.active.map(row => row.id), [other.id]);
    const before = await fs.readFile(file);
    await assert.rejects(runLifecycle('package', { ...context, lease, phase: 'finish', reservation: other }), /matching disk reservation/);
    assert.ok((await fs.readFile(file)).equals(before));
    const next = await runLifecycle('package', { ...context, lease });
    assert.notEqual(next.id, first.id);
    await runLifecycle('package', { ...context, lease, phase: 'finish', reservation: next });
    await runLifecycle('build', { home, task: 'unrelated-build', lease, phase: 'finish', reservation: other });
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).active, []);
  });
});

filesystemTest('preservesThreeAcceptedReleases over twenty real tiny packages', async t => {
  const f = await releases(t, 20);
  await f.importIndex();
  const plan = await f.plan();
  const retained = plan.protected.filter(item => item.reasons.some(reason => ['current-release', 'previous-release'].includes(reason)));
  assert.deepEqual(retained.filter(item => item.kind === 'release').map(item => item.id).sort(),
    ['release:v18', 'release:v19', 'release:v20']);
  assert.equal(plan.actions.length, 17);
  // One real deletion already covers restoration. Keeping the other 16 examples tiny
  // tests the planner without spending time compressing the same fixture repeatedly.
  assert.equal(plan.actions[0].id, 'release:v1');
});

filesystemTest('manifest timestamps cannot displace a proven former release', async t => {
  const f = await releases(t, 5);
  for (const id of ['candidate-one', 'candidate-two']) {
    const root = path.join(f.home, 'releases', id);
    const prior = JSON.parse(await fs.readFile(path.join(f.roots.get('v5'), 'release.json'), 'utf8'));
    await write(path.join(root, 'node_modules', 'dependency.js'), 'dependency');
    await json(path.join(root, 'release.json'), { ...prior, root, id, acceptedAt: '2026-11-17T01:02:03Z' });
  }
  await f.importIndex();
  const plan = await f.plan();
  assert.deepEqual(plan.actions.map(item => item.id), ['release:v1', 'release:v2']);
  assert.ok(plan.protected.find(item => item.id === 'release:v3').reasons.includes('previous-release'));
});

const gib = 1024 ** 3;
const at = '2026-11-18T12:00:00.000Z';
const tracked = (id, options) => ({
  id, path: options.kind === 'build' ? path.resolve('fixtures/repo/.next-' + id) : path.resolve('fixtures/home/releases/' + id),
  root: options.kind === 'build' ? path.resolve('fixtures/repo') : path.resolve('fixtures/home/releases'),
  taskId: 'sample', bytes: 2 * gib, fingerprint: '0'.repeat(64), identity: 'fixture-' + id,
  protectedBy: [], status: 'UNCLASSIFIED', ...options,
});
const inventoryFixture = artifacts => ({
  at, current: null, acceptedReleases: [], tasks: [], artifacts, processes: [], uncertainties: [], freeBytes: 19 * gib,
});

test('pinsOverrideAgeAndBudget and the protected excess is shown', () => {
  const oversized = tracked('old-pinned', {
    kind: 'release', bytes: 8 * gib, protectedBy: ['pin:sample'], provenance: { acceptedAt: '2025-01-01T00:00:00Z' },
  });
  const plan = planStorage(inventoryFixture([oversized]));
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.protected[0].id, 'old-pinned');
  assert.equal(plan.budgets.releases.limitBytes, 6 * gib);
  assert.equal(plan.budgets.releases.protectedOverageBytes, 2 * gib);
  assert.equal(plan.budgets.builds.limitBytes, 4 * gib);
});

test('failedBuildsKeepTwoForSevenDays while an unresolved check remains protected', () => {
  const repro = (id, date, unresolved = false) => tracked(id, {
    kind: 'build', provenance: { outcome: 'failed', at: date, unresolved },
  });
  const plan = planStorage(inventoryFixture([
    repro('newest', '2026-11-17T10:00:00Z'), repro('second', '2026-11-16T10:00:00Z'),
    repro('third', '2026-11-15T10:00:00Z'), repro('expired', '2026-11-10T10:00:00Z'),
    repro('unresolved', '2026-11-01T10:00:00Z', true),
  ]));
  assert.deepEqual(plan.protected.map(item => item.id).sort(), ['newest', 'second', 'unresolved']);
  assert.deepEqual(plan.actions.map(item => item.id), ['expired', 'third']);
  assert.equal(plan.budgets.builds.protectedOverageBytes, 2 * gib);
});

filesystemTest('changedPlanSkipsDeletion when the artifact content changes', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  assert.equal(plan.actions.length, 1);
  await write(path.join(f.roots.get('v1'), 'a-unique.bin'), 'changed after plan');
  const receipt = await f.apply(plan);
  assert.equal(receipt.completed.length, 0);
  assert.equal(receipt.skipped.length, 1);
  assert.equal(await fs.readFile(path.join(f.roots.get('v1'), 'a-unique.bin'), 'utf8'), 'changed after plan');
});

filesystemTest('newCandidatePreventsDeletion after planning', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  assert.equal(plan.actions.length, 1);
  const candidate = path.join(f.home, 'releases', 'new-candidate');
  await write(path.join(candidate, 'keep.bin'), 'active candidate');
  const result = await f.apply(plan);
  assert.equal(result.completed.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(await fs.readFile(path.join(candidate, 'keep.bin'), 'utf8'), 'active candidate');
  await fs.access(f.roots.get('v1'));
});

filesystemTest('changedCurrent invalidates the old plan', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  assert.equal(plan.actions[0].id, 'release:v1');
  await json(path.join(f.home, 'current.json'), { releaseId: 'v1', previousId: 'v4' });
  const result = await f.apply(plan);
  assert.equal(result.completed.length, 0);
  assert.equal(result.skipped.length, 1);
  await fs.access(f.roots.get('v1'));
});

filesystemTest('changing current between staging and commit rolls back the whole deletion', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  const spawn = childProcess.spawn;
  let changed = false;
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    const child = spawn(executable, args, options);
    if (args.some(arg => typeof arg === 'string' && arg.endsWith('archive-worker.ps1'))) {
      let last = '';
      child.stdout?.on('data', chunk => {
        last = (last + chunk.toString('utf8')).slice(-200);
        if (!changed && last.includes('"phase":"commit"')) {
          writeFileSync(path.join(f.home, 'current.json'), JSON.stringify({ releaseId: 'v1', previousId: 'v4' }));
          changed = true;
        }
      });
    }
    return child;
  });
  syncBuiltinESMExports();
  try {
    const result = await f.apply(plan);
    assert.equal(changed, true, JSON.stringify(result));
    assert.equal(result.completed.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.deletedBytes, 0);
    assert.equal(await fs.readFile(path.join(f.roots.get('v1'), 'a-unique.bin'), 'utf8'), 'unknown-v1');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

filesystemTest('unknownFilesSurvive removal of the verified old package', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  assert.equal(plan.actions.length, 1);
  const original = f.roots.get('v1');
  const unknown = path.join(original, 'a-unique.bin');
  const sourceHash = hash(await fs.readFile(unknown));
  const result = await f.apply(plan);
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(result.completed.length, 1, JSON.stringify(result));
  assert.ok(result.deletedBytes > 0);
  await notFound(original);
  const archive = result.completed[0].archive;
  assert.equal(archive.references.length, 1);
  assert.equal(archive.references[0].prefix, 'artifact/node_modules');
  const restored = path.join(f.home, 'fixture-restore');
  await extractVerifiedArchive(archive.path, restored);
  assert.equal(hash(await fs.readFile(path.join(restored, 'artifact', 'a-unique.bin'))), sourceHash);
  assert.equal(await fs.readFile(path.join(restored, 'artifact', 'node_modules', 'dependency.js'), 'utf8'), 'dependency');
  const tombstone = JSON.parse(await fs.readFile(result.completed[0].tombstone, 'utf8'));
  assert.equal(tombstone.originalPath, original);
  assert.equal(tombstone.archive.sha256, archive.sha256);
  const base = path.join(path.dirname(archive.path), archive.references[0].file);
  await fs.truncate(base, 17);
  await assert.rejects(verifyArchive(archive.path));
  await assert.rejects(extractVerifiedArchive(archive.path, path.join(f.home, 'corrupt-base-restore')));
  await notFound(path.join(f.home, 'corrupt-base-restore'));
});

filesystemTest('verified archive evidence is published before authorizing target removal', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  assert.equal(plan.actions.length, 1);
  const [action] = plan.actions;
  const key = hash(JSON.stringify([action.id, pathKey(action.path), action.expectedIdentity, action.expectedFingerprint]));
  const index = path.join(f.home, 'maintenance-state', 'evidence-index', key + '.json');
  await fs.mkdir(index, { recursive: true }); // Force this exact pointer write to fail.
  const forecast = await smallFixtureForecast(t, f);
  const blocked = await f.apply(plan, forecast);
  assert.equal(blocked.failed.length, 1);
  assert.equal(blocked.deletedBytes, 0, 'a failed evidence publication must preserve the original');
  assert.equal(await fs.readFile(path.join(action.path, 'a-unique.bin'), 'utf8'), 'unknown-v1');
  assert.equal((await verifyArchive(blocked.failed[0].archive.path)).sha256, blocked.failed[0].archive.sha256);
});

filesystemTest('truncatedArchiveNeverAuthorizesDeletion during a retry', async t => {
  const f = await releases(t);
  await f.importIndex();
  const plan = await f.plan();
  const readonly = path.join(f.roots.get('v1'), 'z-readonly.bin');
  await write(readonly, 'read-only file');
  const finalPlan = await f.plan();
  assert.equal(plan.actions.length, finalPlan.actions.length);
  await fs.chmod(readonly, 0o444);
  try {
    const interrupted = await f.apply(finalPlan);
    assert.equal(interrupted.completed.length, 0);
    assert.equal(interrupted.failed.length, 1, JSON.stringify(interrupted));
    const archive = interrupted.failed[0].archive.path;
    const reference = interrupted.failed[0].archive.references[0];
    const base = path.join(path.dirname(archive), reference.file);
    const originalBase = await fs.readFile(base);
    await fs.unlink(base);
    const missingBase = await f.apply(finalPlan);
    assert.equal(missingBase.completed.length, 0);
    assert.equal(missingBase.deletedBytes, 0);
    await fs.access(readonly);
    await fs.writeFile(base, originalBase);
    await fs.truncate(archive, 31);
    const retry = await f.apply(finalPlan);
    assert.equal(retry.completed.length, 0);
    assert.equal(retry.deletedBytes, 0);
    await fs.access(readonly);
    await assert.rejects(verifyArchive(archive));
  } finally {
    await fs.chmod(readonly, 0o666);
  }
});

filesystemTest('partialDeleteCanResume using the same archive and recording both outcomes', async t => {
  const f = await releases(t);
  await f.importIndex();
  const original = f.roots.get('v1');
  const marker = path.join(original, 'RELEASE.JSON');
  const stagedMarker = path.join(original, 'manifest-rename.fixture');
  await fs.rename(path.join(original, 'release.json'), stagedMarker);
  await fs.rename(stagedMarker, marker);
  const readonly = path.join(original, 'z-readonly.bin');
  await write(readonly, 'read-only file');
  await fs.chmod(readonly, 0o444);
  const forecast = await smallFixtureForecast(t, f);
  try {
    const plan = await f.plan();
    const interrupted = await f.apply(plan, forecast);
    assert.equal(interrupted.completed.length, 0);
    assert.equal(interrupted.failed.length, 1, JSON.stringify(interrupted));
    assert.equal(interrupted.deletedBytes, 0, JSON.stringify(interrupted));
    const archive = await verifyArchive(interrupted.failed[0].archive.path);
    const index = path.join(f.home, 'maintenance-state', 'evidence-index', path.basename(archive.path, '.zip') + '.json');
    const pending = JSON.parse(await fs.readFile(index, 'utf8'));
    assert.equal(pending.archive.sha256, archive.sha256);
    assert.ok(Number.isFinite(Date.parse(pending.archivedAt)));
    assert.equal(pending.removedAt, undefined);
    const leftover = path.join(original, 'a-unique.bin');
    const saved = archive.entries.find(entry => entry.path === 'artifact/a-unique.bin');
    assert.equal(saved?.sha256, hash(await fs.readFile(leftover)));
    // Model a verified, previously interrupted attempt in this temporary tree.
    await fs.unlink(leftover);
    await fs.access(marker);
    await fs.access(path.join(original, '.next-test', 'BUILD_ID'));
    await fs.chmod(readonly, 0o666);
    const retry = await f.apply(await f.plan(), forecast);
    assert.equal(retry.completed.length, 1, JSON.stringify(retry));
    assert.equal(retry.completed[0].archive.path, interrupted.failed[0].archive.path);
    assert.equal(retry.completed[0].archive.sha256, interrupted.failed[0].archive.sha256);
    const completed = JSON.parse(await fs.readFile(index, 'utf8'));
    assert.equal(retry.completed[0].tombstone, index);
    assert.equal(completed.archivedAt, pending.archivedAt);
    assert.ok(Number.isFinite(Date.parse(completed.removedAt)));
    const journal = JSON.parse(await fs.readFile(retry.completed[0].journal, 'utf8'));
    assert.deepEqual(journal.outcomes.map(outcome => outcome.status), ['failed', 'completed']);
    await notFound(original);
  } finally {
    await fs.chmod(readonly, 0o666).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});

const fixtureOcr = 'data/tools/kreuzberg/1.2.3/bin';

async function installFixtureReaders(f) {
  const reader = fixtureOcr;
  for (const root of f.roots.values()) {
    const folder = path.join(root, reader);
    await write(path.join(folder, 'kreuzberg.exe'), 'small synthetic reader');
    await write(path.join(folder, 'onnxruntime.dll'), 'small synthetic library');
    const [observed] = await measureArchiveTargets([folder]);
    const file = path.join(root, 'release.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    await json(file, { ...manifest, ocrAssets: { prefix: reader, fingerprint: observed.fingerprint }, files: [
      { path: reader + '/kreuzberg.exe', sha256: hash('small synthetic reader') },
      { path: reader + '/onnxruntime.dll', sha256: hash('small synthetic library') },
    ] });
    await write(path.join(root, 'data', 'unique.txt'), 'unrelated ' + manifest.id);
  }
}

filesystemTest('a missing or corrupt OCR archive base cannot authorize an interrupted release deletion', async t => {
  const f = await releases(t);
  await installFixtureReaders(f);
  await f.importIndex();
  const marker = path.join(f.roots.get('v1'), 'readonly-fixture.bin');
  await write(marker, 'keep the original until the archived reader can be verified');
  await fs.chmod(marker, 0o444);
  try {
    const plan = await f.plan();
    const forecast = await smallFixtureForecast(t, f);
    const interrupted = await f.apply(plan, forecast);
    const archive = interrupted.failed[0]?.archive;
    assert.ok(archive, JSON.stringify(interrupted));
    const reader = archive.references.find(item => item.prefix === 'artifact/' + fixtureOcr);
    assert.ok(reader);
    const base = path.join(path.dirname(archive.path), reader.file);
    await fs.unlink(base);
    const missing = await f.apply(plan, forecast);
    assert.equal(missing.completed.length, 0);
    assert.equal(missing.deletedBytes, 0);
    await fs.writeFile(base, 'corrupt synthetic OCR archive');
    await assert.rejects(verifyArchive(archive.path));
    const corrupt = await f.apply(plan, forecast);
    assert.equal(corrupt.completed.length, 0);
    assert.equal(corrupt.deletedBytes, 0);
    assert.equal(await fs.readFile(path.join(f.roots.get('v1'), fixtureOcr, 'kreuzberg.exe'), 'utf8'), 'small synthetic reader');
    assert.match(await fs.readFile(marker, 'utf8'), /keep the original/);
  } finally {
    await fs.chmod(marker, 0o666);
  }
});

filesystemTest('secondRunIsIdempotent for the same dry run and a fresh dry run', async t => {
  const f = await releases(t, 6);
  const reader = fixtureOcr;
  await installFixtureReaders(f);
  await write(path.join(f.roots.get('v3'), reader, 'untracked.bin'), 'keep this too');
  await f.importIndex();
  const plan = await f.plan();
  const forecast = await smallFixtureForecast(t, f);
  const first = await f.apply(plan, forecast);
  t.diagnostic(JSON.stringify({ actualFreeBytesBefore: first.freeBytesBefore, actualFreeBytesAfter: first.freeBytesAfter }));
  assert.equal(first.completed.length, 3, JSON.stringify(first));
  assert.equal(first.completed[0].archive.references[0].file, first.completed[1].archive.references[0].file);
  const ocr = first.completed.slice(0, 2).map(item => item.archive.references.find(reference => reference.prefix === 'artifact/' + reader));
  assert.ok(ocr.every(Boolean), 'both releases use a verified exact reader copy');
  assert.equal(ocr[0].file, ocr[1].file);
  const directory = path.dirname(first.completed[0].archive.path);
  const zips = async () => {
    const files = (await fs.readdir(directory)).filter(file => file.endsWith('.zip')).sort();
    return Promise.all(files.map(async file => [file, (await fs.stat(path.join(directory, file))).size]));
  };
  const retained = await zips();
  assert.equal(retained.length, 5);
  const restore = path.join(path.dirname(f.home), 'shared-restore');
  await extractVerifiedArchive(first.completed[0].archive.path, restore);
  assert.equal(await fs.readFile(path.join(restore, 'artifact', reader, 'kreuzberg.exe'), 'utf8'), 'small synthetic reader');
  assert.equal(await fs.readFile(path.join(restore, 'artifact/data/unique.txt'), 'utf8'), 'unrelated v1');
  const changed = path.join(path.dirname(f.home), 'changed-restore');
  assert.equal(first.completed[2].archive.references.some(reference => reference.prefix === 'artifact/' + reader), false);
  await extractVerifiedArchive(first.completed[2].archive.path, changed);
  assert.equal(await fs.readFile(path.join(changed, 'artifact', reader, 'untracked.bin'), 'utf8'), 'keep this too');
  assert.equal((await f.apply(plan, forecast)).deletedBytes, 0);
  const second = await f.apply(await f.plan(), forecast);
  assert.equal(second.deletedBytes, 0);
  assert.equal(second.completed.length, 0);
  assert.deepEqual(await zips(), retained);
});

filesystemTest('archive round trip retains ordinary and long names and requires a new folder', async t => {
  const base = await directory(t);
  const source = path.join(base, 'source');
  const nested = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100), 'résumé-עברית.txt'].join('/');
  const bytes = Buffer.from([0, 1, 254, 255]);
  await write(path.join(source, nested), bytes);
  await write(path.join(source, 'odd name $file.txt'), 'known bytes');
  const zip = path.join(base, 'sample.zip');
  const saved = await createVerifiedArchive({ source, files: [nested, 'odd name $file.txt'], destination: zip });
  const destination = path.join(base, 'restored');
  const restored = await extractVerifiedArchive(zip, destination);
  assert.equal(restored.sha256, saved.sha256);
  assert.equal(hash(await fs.readFile(path.join(destination, nested))), hash(bytes));
  await assert.rejects(extractVerifiedArchive(zip, destination));
});

filesystemTest('publication restarts the same staging slot and finishes a ZIP with a staged manifest', async t => {
  const base = await directory(t);
  const source = path.join(base, 'source');
  await write(path.join(source, 'file.txt'), 'retained bytes');
  const destination = path.join(base, 'publish.zip');
  const request = { source, files: ['file.txt'], destination };
  const first = await createVerifiedArchive(request);
  const publications = () => fs.readdir(base).then(names => names.filter(name => name.startsWith('.publication-')));
  const slots = await publications();
  assert.equal(slots.length, 1, 'the published archive needs one identifiable recovery slot');
  const stage = path.join(base, slots[0], 'archive.zip');
  await fs.rename(destination + '.manifest.json', stage + '.manifest.json');
  const finished = await createVerifiedArchive(request);
  assert.equal(finished.sha256, first.sha256);
  await fs.rename(destination, stage);
  await fs.unlink(destination + '.manifest.json');
  await fs.truncate(stage, 17);
  const restarted = await createVerifiedArchive(request);
  assert.deepEqual(restarted.entries, first.entries);
  assert.deepEqual(await publications(), slots);
  await notFound(stage);
  await fs.rename(destination, path.join(base, 'saved.zip'));
  await fs.unlink(destination + '.manifest.json');
  await fs.writeFile(stage, 'a foreign file in the reserved slot');
  await assert.rejects(createVerifiedArchive(request), /not owned/);
  assert.equal(await fs.readFile(stage, 'utf8'), 'a foreign file in the reserved slot');
});

filesystemTest('a public archive cannot return different input files for an occupied destination', async t => {
  const base = await directory(t);
  const source = path.join(base, 'source');
  const destination = path.join(base, 'occupied.zip');
  await write(path.join(source, 'old.txt'), 'original');
  await write(path.join(source, 'new.txt'), 'replacement');
  const first = await createVerifiedArchive({ source, files: ['old.txt'], destination });
  await assert.rejects(createVerifiedArchive({ source, files: ['new.txt'], destination }));
  assert.equal((await verifyArchive(destination)).sha256, first.sha256);
  const slot = (await fs.readdir(base)).find(name => name.startsWith('.publication-'));
  await fs.rename(destination + '.manifest.json', path.join(base, slot, 'archive.zip.manifest.json'));
  await write(path.join(source, 'old.txt'), 'changed while publication was incomplete');
  await assert.rejects(createVerifiedArchive({ source, files: ['old.txt'], destination }), /different input bytes/);
  assert.equal(hash(await fs.readFile(destination)), first.sha256);
  await write(path.join(source, 'old.txt'), 'original');
  assert.equal((await createVerifiedArchive({ source, files: ['old.txt'], destination })).sha256, first.sha256);
});

async function publicationFixture(t) {
  const base = await directory(t);
  const target = path.join(base, 'target');
  const file = path.join(target, 'byte.txt');
  await write(file, 'first state');
  return {
    base, file,
    async request(name) {
      const [snapshot] = await measureArchiveTargets([target]);
      const { groups } = await catalogArchiveGroups([{ source: target, prefix: 'artifact' }]);
      return { groups, destination: path.join(base, name + '.zip'), targetFingerprint: snapshot.fingerprint,
        targetIdentity: snapshot.identity, publicationTarget: target };
    },
    slots: async () => (await fs.readdir(base)).filter(name => name.startsWith('.publication-')),
  };
}

filesystemTest('stale archive plans for one target write no staged payload', async t => {
  const f = await publicationFixture(t);
  for (let i = 0; i < 2; i++) {
    const request = await f.request(String(i).repeat(64));
    await write(f.file, 'changed before publication ' + i);
    await assert.rejects(publishEvidenceArchive(request), /scheduled-target-changed/);
  }
  const slots = await f.slots();
  assert.ok(slots.length <= 1, JSON.stringify(slots));
  for (const slot of slots) await notFound(path.join(f.base, slot, 'archive.zip'));
});

filesystemTest('a new fingerprint preserves one unprovable previous payload and adds no slot', async t => {
  const f = await publicationFixture(t);
  const first = await f.request('1'.repeat(64));
  await publishEvidenceArchive(first);
  const [slot] = await f.slots();
  const staged = path.join(f.base, slot, 'archive.zip');
  await fs.rename(first.destination, staged);
  await fs.unlink(first.destination + '.manifest.json');
  await fs.truncate(staged, 17);
  const before = await fs.readFile(staged);
  await write(f.file, 'new plan');
  await assert.rejects(publishEvidenceArchive(await f.request('2'.repeat(64))), /previous unfinished publication/i);
  assert.deepEqual(await f.slots(), [slot]);
  assert.deepEqual(await fs.readFile(staged), before);
});

filesystemTest('a new fingerprint finishes the previous verified publication in the same slot', async t => {
  const f = await publicationFixture(t);
  const first = await f.request('3'.repeat(64));
  const saved = await publishEvidenceArchive(first);
  const [slot] = await f.slots();
  const staged = path.join(f.base, slot, 'archive.zip');
  await fs.rename(first.destination, staged);
  await fs.rename(first.destination + '.manifest.json', staged + '.manifest.json');
  await write(f.file, 'new verified payload');
  const next = await f.request('4'.repeat(64));
  const second = await publishEvidenceArchive(next);
  assert.notEqual(second.sha256, saved.sha256);
  assert.equal((await verifyArchive(first.destination)).sha256, saved.sha256);
  assert.deepEqual(await f.slots(), [slot]);
  await notFound(staged);
  await fs.rename(next.destination + '.manifest.json', staged + '.manifest.json');
  await write(f.file, 'one more verified payload');
  await publishEvidenceArchive(await f.request('5'.repeat(64)));
  assert.equal((await verifyArchive(next.destination)).sha256, second.sha256);
  assert.deepEqual(await f.slots(), [slot]);
});

filesystemTest('foreign bytes in identity markers of a reserved stage are preserved', async t => {
  const f = await publicationFixture(t);
  const first = await f.request('5'.repeat(64));
  await publishEvidenceArchive(first);
  const [slot] = await f.slots();
  const staged = path.join(f.base, slot, 'archive.zip');
  await fs.rename(first.destination, path.join(f.base, 'saved.zip'));
  await fs.unlink(first.destination + '.manifest.json');
  for (const suffix of ['.id.pending', '.id']) {
    const marker = staged + suffix;
    const original = '12345678:1234567890abcdef';
    await write(marker, original);
    await assert.rejects(publishEvidenceArchive(first));
    assert.equal(await fs.readFile(marker, 'utf8'), original);
    await fs.unlink(marker);
  }
});

async function baselinePublicationFixture(t) {
  const base = await directory(t);
  const source = path.join(base, 'node_modules');
  const file = path.join(source, 'package.js');
  await write(file, 'original baseline bytes');
  return {
    base, file,
    async request(expected) {
      const { groups } = await catalogArchiveGroups([{ source }]);
      const fingerprint = expected ?? (await measureArchiveTargets([source]))[0].fingerprint;
      return { groups, destination: path.join(base, 'dependencies-' + fingerprint + '.zip'),
        baseline: true, targetFingerprint: fingerprint };
    },
    slots: async () => (await fs.readdir(base)).filter(name => name.startsWith('.publication-')),
  };
}

filesystemTest('two mismatching baseline fingerprints reserve at most one slot and write no ZIP payload', async t => {
  const f = await baselinePublicationFixture(t);
  for (const fingerprint of ['1'.repeat(64), '2'.repeat(64)]) {
    await assert.rejects(publishEvidenceArchive(await f.request(fingerprint)), /baseline changed/i);
  }
  const slots = await f.slots();
  assert.ok(slots.length <= 1, JSON.stringify(slots));
  for (const slot of slots) await notFound(path.join(f.base, slot, 'archive.zip'));
  assert.equal(await fs.readFile(f.file, 'utf8'), 'original baseline bytes');
});

filesystemTest('a changed baseline finishes an interrupted publication and reuses its original verified bytes', async t => {
  const f = await baselinePublicationFixture(t);
  const first = await f.request();
  const saved = await publishEvidenceArchive(first);
  const [slot] = await f.slots();
  const staged = path.join(f.base, slot, 'archive.zip');
  await fs.rename(first.destination + '.manifest.json', staged + '.manifest.json');
  await write(f.file, 'new baseline bytes');
  const next = await f.request();
  assert.notEqual(next.targetFingerprint, first.targetFingerprint);
  const changed = await publishEvidenceArchive(next);
  assert.notEqual(changed.sha256, saved.sha256);
  const reused = await publishEvidenceArchive(first);
  assert.equal(reused.sha256, saved.sha256);
  assert.deepEqual(await f.slots(), [slot]);
  await notFound(staged);
  const restored = path.join(f.base, 'restored');
  await extractVerifiedArchive(reused.path, restored);
  assert.equal(await fs.readFile(path.join(restored, 'package.js'), 'utf8'), 'original baseline bytes');
  assert.equal(await fs.readFile(f.file, 'utf8'), 'new baseline bytes');
});

filesystemTest('a changed baseline preserves an unprovable interrupted ZIP without allocating a new slot', async t => {
  const f = await baselinePublicationFixture(t);
  const first = await f.request();
  await publishEvidenceArchive(first);
  const [slot] = await f.slots();
  const staged = path.join(f.base, slot, 'archive.zip');
  await fs.rename(first.destination, staged);
  await fs.unlink(first.destination + '.manifest.json');
  await fs.truncate(staged, 17);
  const bytes = await fs.readFile(staged);
  await write(f.file, 'new baseline bytes');
  await assert.rejects(publishEvidenceArchive(await f.request()), /previous unfinished publication/i);
  assert.deepEqual(await f.slots(), [slot]);
  assert.deepEqual(await fs.readFile(staged), bytes);
});

filesystemTest('archiveRejectsTraversalAndDuplicates in input and external ZIP entries', async t => {
  const base = await directory(t);
  const source = path.join(base, 'source');
  await write(path.join(source, 'safe.txt'), 'ordinary');
  const zip = path.join(base, 'unsafe.zip');
  for (const files of [['../outside'], ['safe.txt', 'SAFE.TXT'], ['C:/outside'], ['safe.txt:stream']]) {
    await assert.rejects(createVerifiedArchive({ source, files, destination: zip }));
    await notFound(zip);
  }
  // Standard ZIP central-directory names can be edited without editing entry data.
  await createVerifiedArchive({ source, files: ['safe.txt'], destination: zip });
  const buffer = await fs.readFile(zip);
  for (let offset = buffer.indexOf('safe.txt'); offset !== -1; offset = buffer.indexOf('safe.txt', offset + 8)) {
    buffer.write('../x.txt', offset);
  }
  const manifestFile = zip + '.manifest.json';
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  await write(zip, buffer);
  manifest.sha256 = hash(buffer);
  await json(manifestFile, manifest);
  const output = path.join(base, 'unsafe-restore');
  await assert.rejects(extractVerifiedArchive(zip, output));
  await notFound(output);
  await notFound(path.join(base, 'x.txt'));

  await write(path.join(source, 'next.txt'), 'another entry');
  const duplicate = path.join(base, 'duplicate.zip');
  await createVerifiedArchive({ source, files: ['safe.txt', 'next.txt'], destination: duplicate });
  const bytes = await fs.readFile(duplicate);
  for (let offset = bytes.indexOf('next.txt'); offset !== -1; offset = bytes.indexOf('next.txt', offset + 8)) {
    bytes.write('SAFE.TXT', offset);
  }
  const duplicateManifest = duplicate + '.manifest.json';
  const expected = JSON.parse(await fs.readFile(duplicateManifest, 'utf8'));
  expected.sha256 = hash(bytes);
  await write(duplicate, bytes);
  await json(duplicateManifest, expected);
  await assert.rejects(verifyArchive(duplicate));
});

const webpack = 'cache/webpack/server-production/';
function pack(contents) {
  const payload = Buffer.from(contents);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x01637077);
  header.writeUInt32LE(1, 4);
  header.writeInt32LE(payload.byteLength, 8);
  return Buffer.concat([header, payload]);
}

async function generatedFixture(t, { historical = false } = {}) {
  const f = await releases(t, 3);
  const id = 'v3';
  const source = path.join(f.evidence, 'build-123-task');
  const target = path.join(source, '.next-test');
  const sourceText = 'ordinary source bytes';
  await write(path.join(source, 'src', 'app.ts'), sourceText);
  await write(path.join(source, 'package-lock.json'), lockfile);
  await fs.symlink(path.join(f.home, 'dependencies', 'baseline', 'node_modules'),
    path.join(source, 'node_modules'), 'junction');
  await write(path.join(target, 'BUILD_ID'), id + '-build');
  await write(path.join(target, webpack, 'index.pack'), pack('generated cache'));
  await write(path.join(target, webpack, '0.pack'), pack('original cache'));
  const malformed = Buffer.from([0x77, 0x70, 0x63, 1, 1, 0, 0, 0, 20, 0, 0, 0, 8]);
  await write(path.join(target, webpack, '1.pack'), malformed);
  await write(path.join(target, 'cache', 'unknown-before.bin'), 'unique before capture');
  const options = { home: f.home, repoRoots: [f.repo] };
  const nodeExe = path.join(f.home, 'runtime', 'node.exe');
  const generated = await withMaintenanceLock(f.home, 'capture-fixture', lease =>
    captureGeneratedBuild({ ...options, lease, source, dist: '.next-test', nodeExe }));
  await write(path.join(target, webpack, '0.pack'), 'changed after capture');
  await write(path.join(target, 'cache', 'unknown.bin'), 'unique addition');
  const buildFile = path.join(f.evidence, 'verified-build.json');
  const typecheck = path.join(f.evidence, 'typecheck.json');
  const production = path.join(f.evidence, 'production.log');
  await f.record(typecheck, { status: 0 });
  await f.record(production, 'build ok');
  await f.record(buildFile, {
    at: '2025-01-03T00:01:00.000Z', source, dist: '.next-test', buildId: id + '-build', passed: true,
    builtFiles: [{ path: 'src/app.ts', sha256: hash(sourceText) },
      { path: 'package-lock.json', sha256: hash(lockfile) }], sourceUnchanged: true,
    log: production, checks: [{ name: 'typecheck', status: 0, receipt: typecheck }, { name: 'production', status: 0 }],
    generatedDist: generated,
  });
  const command = async (action, at, stdoutValue) => {
    const file = path.join(f.evidence, action + '.json');
    const stdout = path.join(f.evidence, action + '.stdout.log');
    const stderr = path.join(f.evidence, action + '.stderr.log');
    await f.record(stdout, { release: id, buildId: id + '-build', ...stdoutValue });
    await f.record(stderr, '');
    await f.record(file, {
      action, at, release: id, buildId: id + '-build', passed: true, profileUnchanged: true, stdout, stderr,
    });
    return { evidence: file };
  };
  const packaged = await command('package', '2025-01-03T00:10:00.000Z', {});
  const verified = await command('verify', '2025-01-03T00:20:00.000Z', { verified: true, stopped: true });
  f.index.evidence.push({ path: generated.path, bytes: generated.bytes, sha256: generated.sha256 });
  const builds = [{ receipt: { evidence: buildFile } }];
  const packageEvidence = { verificationReceipts: [verified], packageReceipts: [packaged], buildReceipts: [buildFile] };
  if (historical) {
    f.index.builds = builds;
    Object.assign(f.index.releases.find(row => row.id === id), packageEvidence);
    await f.importIndex();
  } else {
    await withMaintenanceLock(f.home, 'register-fixture', lease => registerLifecycleEvidence({
      version: 1, builds, evidence: f.index.evidence,
      releases: [{ id, installationReceipts: [], ...packageEvidence }],
    }, { ...options, lease }));
  }
  return { f, source, target, sourceText, malformed, nodeExe };
}

filesystemTest('an active direct task reference protects a historical snapshot from a different task', async t => {
  const { f, source, target } = await generatedFixture(t, { historical: true });
  await json(path.join(f.home, 'maintenance-state', 'tasks', 'active-other.json'), {
    id: 'active-other', status: 'active', worktree: source, commit: 'a'.repeat(40), dirty: true,
    build: null, candidate: null, pid: null, processStartedAt: null, result: null, pins: [],
  });
  const plan = await f.plan();
  assert.equal(plan.actions.some(action => action.path === target), false);
  assert.ok(plan.protected.find(item => item.path === target).reasons.includes('task:active-other'));
});

filesystemTest('an unobserved lifecycle index cannot release a build', async t => {
  const { f, target } = await generatedFixture(t);
  const plan = await f.plan();
  assert.equal(plan.actions.some(action => action.path === target), false);
  assert.ok(plan.protected.find(item => item.path === target).reasons.includes('standalone-package-not-proven'));
  assert.equal(await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8'), 'v3-build');
});

filesystemTest('a late capture of valid-looking webpack data preserves every cache file', async t => {
  const { f, source, target, sourceText, malformed } = await generatedFixture(t, { historical: true });
  const plan = await f.plan();
  assert.deepEqual(plan.actions.map(action => action.path), [target]);
  const nearFloor = await withMaintenanceLock(f.home, 'archive forecast fixture', lease => applyStorage(plan, {
    home: f.home, repoRoots: [f.repo], lease, prospectiveBytes: 2 * 1024 ** 3,
    getFreeBytes: async () => 14 * 1024 ** 3 + 8 * 1024 ** 2 + Math.ceil(plan.actions[0].bytes * 1.1),
  }));
  assert.deepEqual(nearFloor.skipped.map(item => item.reason), ['archive-space']);
  await fs.access(target);
  await notFound(path.join(f.home, 'maintenance-state', 'evidence-archives'));
  const forecast = await smallFixtureForecast(t, f);
  const result = await f.apply(plan, forecast);
  t.diagnostic(JSON.stringify({ actualFreeBytesBefore: result.freeBytesBefore, actualFreeBytesAfter: result.freeBytesAfter }));
  assert.equal(result.completed.length, 1, JSON.stringify(result));
  await notFound(target);
  await fs.access(path.join(source, 'node_modules', 'dependency.js'));
  const archive = result.completed[0].archive;
  assert.deepEqual(archive.omittedJunctions, ['source/node_modules']);
  assert.deepEqual(archive.generatedOmissions, []);
  const restored = path.join(f.home, 'verified-build-restored');
  await extractVerifiedArchive(archive.path, restored);
  assert.equal(await fs.readFile(path.join(restored, 'source', 'src', 'app.ts'), 'utf8'), sourceText);
  assert.equal(await fs.readFile(path.join(restored, 'artifact', webpack, '0.pack'), 'utf8'), 'changed after capture');
  assert.deepEqual(await fs.readFile(path.join(restored, 'artifact', webpack, '1.pack')), malformed);
  assert.equal(await fs.readFile(path.join(restored, 'artifact', 'cache', 'unknown.bin'), 'utf8'), 'unique addition');
  assert.equal(await fs.readFile(path.join(restored, 'artifact', 'cache', 'unknown-before.bin'), 'utf8'), 'unique before capture');
  assert.deepEqual(await fs.readFile(path.join(restored, 'artifact', webpack, 'index.pack')), pack('generated cache'));
});

filesystemTest('a changed runtime before sealing the basis keeps every cache entry in the ZIP', async t => {
  const { f, target, nodeExe } = await generatedFixture(t, { historical: true });
  await write(nodeExe, 'different runtime');
  const result = await f.apply(await f.plan());
  assert.equal(result.completed.length, 1, JSON.stringify(result));
  await notFound(target);
  const archive = result.completed[0].archive;
  assert.deepEqual(archive.generatedOmissions, []);
  const verified = await verifyArchive(archive.path);
  assert.ok(verified.entries.some(item => item.path === 'artifact/' + webpack + 'index.pack'));
});
