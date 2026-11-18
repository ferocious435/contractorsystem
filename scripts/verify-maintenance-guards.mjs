import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const windows = process.platform === 'win32';
const lockFile = home => path.join(home, 'maintenance-state', 'maintenance.lock');
const guardModule = () => import('./maintenance/guard.mjs');
const inventoryModule = () => import('./maintenance/inventory.mjs');

async function sandbox(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'contractor-guard-')));
  t.after(async () => {
    assert.equal(path.dirname(base), await fs.realpath(os.tmpdir()));
    assert.match(path.basename(base), /^contractor-guard-/);
    await fs.rm(base, { recursive: true, force: true });
  });
  return base;
}

async function mkdir(base, name) {
  const dir = path.join(base, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function child(home, localAppData, hold = false, wait = false) {
  const worker = fork(script, ['--worker', home, hold ? 'hold' : 'check', wait ? 'wait' : 'go'], {
    env: { ...process.env, LOCALAPPDATA: localAppData ?? process.env.LOCALAPPDATA },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const result = once(worker, 'message').then(([message]) => message);
  const done = once(worker, 'exit');
  return { worker, result, done };
}

if (process.argv[2] === '--worker') {
  try {
    if (process.argv[5] === 'wait') await once(process, 'message');
    const { withMaintenanceLock } = await guardModule();
    await withMaintenanceLock(process.argv[3], 'test', async lease => {
      process.send({ code: 'ACQUIRED', lease });
      if (process.argv[4] === 'hold') await once(process, 'message');
    });
  } catch (error) {
    process.send({ code: error.code ?? error.name });
  } finally {
    process.disconnect();
  }
} else {
  // Fails if a string-prefix match treats a neighboring directory as a descendant.
  test('rejectsSiblingPrefix', async t => {
    const { inspectTarget } = await guardModule();
    const base = await sandbox(t);
    const root = await mkdir(base, 'releases');
    const sibling = await mkdir(base, 'releases-old/v1');
    await assert.rejects(inspectTarget(root, sibling), { code: 'REFUSED' });
  });

  // Fails if either an ancestor above the supplied root or an entry inside the target is followed.
  test('rejectsJunctionAncestor', async t => {
    const { inspectTarget } = await guardModule();
    const base = await sandbox(t);
    const actual = await mkdir(base, 'actual/releases/candidate');
    const junction = path.join(base, 'alias');
    await fs.symlink(path.join(base, 'actual'), junction, windows ? 'junction' : 'dir');
    await assert.rejects(inspectTarget(path.join(junction, 'releases'), path.join(junction, 'releases/candidate')), { code: 'REFUSED' });
    await fs.symlink(base, path.join(actual, 'nested-alias'), windows ? 'junction' : 'dir');
    await assert.rejects(inspectTarget(path.dirname(actual), actual), { code: 'REFUSED' });
  });

  // Fails when same-size byte changes or renamed files leave the fingerprint unchanged.
  test('fingerprintIncludesFilesBytesAndPaths', async t => {
    const { inspectTarget } = await guardModule();
    const base = await sandbox(t);
    const root = await mkdir(base, 'Releases');
    const target = await mkdir(root, 'candidate');
    const file = path.join(target, 'evidence.txt');
    await fs.writeFile(file, 'abc');
    const first = await inspectTarget(windows ? path.join(base, 'releases') : root, target);
    assert.equal(first.path, target);
    assert.equal(first.files, 1);
    assert.equal(first.bytes, 3);
    assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
    await fs.writeFile(file, 'xyz');
    const changed = await inspectTarget(root, target);
    assert.notEqual(changed.fingerprint, first.fingerprint);
    await fs.rename(file, path.join(target, 'other.txt'));
    assert.notEqual((await inspectTarget(root, target)).fingerprint, changed.fingerprint);
  });

  // Fails when different Windows names of one installation use different locks, or lock writes are nonexclusive.
  test('twoProcessesShareOneLock', { timeout: 30000 }, async t => {
    const { resolveMaintenanceHome } = await guardModule();
    const local = await sandbox(t);
    const logical = await mkdir(local, 'ContractorSystem/ai-runtime').then(path.dirname);
    const physical = windows
      ? await mkdir(local, 'Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/ContractorSystem')
      : logical;
    await fs.writeFile(path.join(physical, 'current.json'), JSON.stringify({ releaseId: 'v1' }));
    const first = child(logical, local, true);
    try {
      const started = await first.result;
      assert.equal(started.code, 'ACQUIRED');
      assert.equal(started.lease.home, physical);
      assert.equal(started.lease.pid, first.worker.pid);
      assert.match(started.lease.processStartedAt, /^\d{4}-/);
      const second = child(windows ? path.join(path.dirname(physical), 'contractorsystem') : physical, local);
      assert.equal((await second.result).code, 'BUSY');
      await second.done;
    } finally {
      if (first.worker.connected) first.worker.send('finish');
      await first.done;
    }
    await assert.rejects(fs.lstat(lockFile(physical)), { code: 'ENOENT' });
    assert.equal(await resolveMaintenanceHome({ explicitHome: physical }), physical);
  });

  // Fails if the exact logical MSIX name is rejected when Windows exposes it as a junction.
  test('knownMsixJunctionResolvesToThePhysicalHome', { skip: !windows, timeout: 30000 }, async t => {
    await guardModule();
    const local = await sandbox(t);
    const physical = await mkdir(local, 'Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/ContractorSystem');
    const logical = path.join(local, 'ContractorSystem');
    await fs.symlink(physical, logical, 'junction');
    await fs.writeFile(path.join(physical, 'current.json'), JSON.stringify({ releaseId: 'v1' }));
    const first = child(logical, local);
    assert.equal((await first.result).lease?.home, physical);
    await first.done;
  });

  // Fails if an expired heartbeat can take a lock whose original owner is still alive.
  test('expiredTimestampDoesNotUnlock', { timeout: 30000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const base = await sandbox(t);
    const home = await mkdir(base, 'home');
    const first = child(home, undefined, true);
    try {
      assert.equal((await first.result).code, 'ACQUIRED');
      const prior = JSON.parse(await fs.readFile(lockFile(home), 'utf8'));
      await fs.writeFile(lockFile(home), JSON.stringify({ ...prior, heartbeatAt: '2001-01-01T00:00:00.000Z' }));
      const old = new Date('2001-01-01T00:00:00.000Z');
      await fs.utimes(lockFile(home), old, old);
      await assert.rejects(withMaintenanceLock(home, 'check', () => assert.fail('second owner entered')), { code: 'BUSY' });
    } finally {
      if (first.worker.connected) first.worker.send('finish');
      await first.done;
    }
  });

  // Fails if malformed owner identity can be reaped, or absence of process evidence drops an unfinished task pin.
  test('unknownProcessProtects', { timeout: 30000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const { readInventory } = await inventoryModule();
    const base = await sandbox(t);
    const home = await mkdir(base, 'home');
    const registry = await mkdir(home, 'maintenance-state/tasks');
    const build = await mkdir(base, 'repo/.next-unknown');
    const record = { id: 'unknown', status: 'active', worktree: path.dirname(build), build, pid: process.pid, processStartedAt: null, pins: [] };
    await fs.writeFile(path.join(registry, 'unknown.json'), JSON.stringify(record));
    await fs.writeFile(lockFile(home), JSON.stringify({ home, token: randomUUID(), pid: process.pid, heartbeatAt: '2001-01-01T00:00:00.000Z' }));
    await assert.rejects(withMaintenanceLock(home, 'check', () => assert.fail('unknown identity was unlocked')), { code: 'BUSY' });
    const inventory = await readInventory({ home, repoRoots: [] });
    const item = inventory.artifacts.find(artifact => artifact.path === build);
    assert.ok(item?.protectedBy.includes('task:unknown'));
    assert.ok(inventory.uncertainties.some(entry => entry.scope === 'task:unknown'));
  });

  // Fails if reused PIDs are treated as the old process, or competing reapers can both replace the stale lock.
  test('reusedPidAllowsOnlyOneReplacement', { timeout: 30000 }, async t => {
    await guardModule();
    const base = await sandbox(t);
    const home = await mkdir(base, 'home');
    await mkdir(home, 'maintenance-state');
    await fs.writeFile(lockFile(home), JSON.stringify({
      token: randomUUID(), pid: process.pid, processStartedAt: '2001-01-01T00:00:00.000Z', home,
    }));
    const workers = [child(home, undefined, true, true), child(home, undefined, true, true)];
    try {
      for (const { worker } of workers) worker.send('start');
      const results = await Promise.all(workers.map(worker => worker.result));
      assert.deepEqual(results.map(result => result.code).sort(), ['ACQUIRED', 'BUSY']);
      const saved = JSON.parse(await fs.readFile(lockFile(home), 'utf8'));
      assert.equal(saved.token, results.find(result => result.lease).lease.token);
    } finally {
      for (const { worker } of workers) if (worker.connected) worker.send('finish');
      await Promise.all(workers.map(worker => worker.done));
    }
  });

  // Fails if lock cleanup blindly unlinks a file after its lease has been replaced.
  test('releaseRechecksOwner', { timeout: 30000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const home = await sandbox(t);
    const token = randomUUID();
    await withMaintenanceLock(home, 'check', async lease => {
      await fs.writeFile(lockFile(home), JSON.stringify({ ...lease, token }));
    });
    assert.equal(JSON.parse(await fs.readFile(lockFile(home), 'utf8')).token, token);
  });

  // Fails if clean/dirty status ignores untracked changes or worktree registration is flattened.
  test('dirtyWorktreeIsProtected', { timeout: 30000 }, async t => {
    const { readInventory } = await inventoryModule();
    const base = await sandbox(t);
    const home = await mkdir(base, 'home');
    const repo = await mkdir(base, 'repo');
    const linked = path.join(base, 'linked repository');
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '--quiet');
    await fs.writeFile(path.join(repo, '.gitignore'), '/.next-*/\n');
    git('add', '.gitignore');
    git('-c', 'user.name=Test', '-c', 'user.email=maintenance@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    git('worktree', 'add', '--quiet', '--detach', linked);
    const build = await mkdir(linked, '.next-build');
    await fs.writeFile(path.join(linked, 'user-note'), 'unsaved work');
    const inventory = await readInventory({ home, repoRoots: [repo] });
    const item = inventory.artifacts.find(artifact => artifact.path === build);
    assert.ok(item?.protectedBy.includes('dirty-worktree'));
    assert.equal(item.status, 'PROTECTED');
    assert.equal(item.fingerprint, null);
  });

  // Fails if writes accept a foreign lease, escape the registry, or lose task fields when closing.
  test('updateTaskRequiresTheHeldLeaseAndPersistsExplicitState', { timeout: 30000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const { updateTask } = await inventoryModule();
    const home = await sandbox(t);
    const record = {
      id: 'task-one', status: 'closed', worktree: path.join(home, 'repo'), commit: 'a'.repeat(40),
      dirty: true, build: path.join(home, 'repo/.next-build'), candidate: null,
      pid: process.pid, processStartedAt: null, result: 'verified', pins: ['release:v1'],
    };
    const complete = await withMaintenanceLock(home, 'test', async lease => {
      const saved = { ...record, processStartedAt: lease.processStartedAt };
      await assert.rejects(updateTask(home, { ...lease, token: randomUUID() }, saved), { code: 'BUSY' });
      await assert.rejects(updateTask(home, lease, { ...saved, id: '../escape' }), { code: 'REFUSED' });
      await updateTask(home, lease, saved);
      return saved;
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'maintenance-state/tasks/task-one.json'), 'utf8')), complete);
  });

  // Fails if release creation is treated as acceptance, or current/previous dependency and Node paths are unprotected.
  test('inventoryProtectsAcceptedReleasesWithoutHashingThem', { timeout: 30000 }, async t => {
    const { readInventory } = await inventoryModule();
    const home = await sandbox(t);
    const dependencyRoot = await mkdir(home, 'dependencies/private-copy');
    const nodeExe = path.join(await mkdir(home, 'runtime'), 'node.exe');
    await fs.writeFile(nodeExe, 'node fixture');
    for (const [id, acceptedAt] of [['current', null], ['previous', null], ['accepted', '2026-11-17T08:00:00.000Z'], ['unverified', null]]) {
      const root = await mkdir(home, 'releases/' + id);
      await fs.writeFile(path.join(root, 'release.json'), JSON.stringify({ id, root, dependencyRoot, nodeExe, createdAt: '2026-11-17T10:00:00.000Z', acceptedAt }));
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'previous' }));
    const inventory = await readInventory({ home, repoRoots: [] });
    assert.deepEqual(inventory.acceptedReleases.map(release => release.id).sort(), ['accepted', 'current', 'previous']);
    for (const item of inventory.artifacts) assert.equal(item.fingerprint, null);
    assert.ok(inventory.artifacts.find(item => item.path === dependencyRoot)?.protectedBy.includes('release:current'));
    assert.ok(inventory.artifacts.find(item => item.path === nodeExe)?.protectedBy.includes('release:current'));
    assert.equal(inventory.artifacts.find(item => item.id === 'release:unverified')?.status, 'UNCLASSIFIED');
  });

  // Fails if missing acceptance evidence allows an unclassified historical release to lose protection.
  test('incompleteAcceptanceHistoryProtectsOtherReleases', { timeout: 30000 }, async t => {
    const { readInventory } = await inventoryModule();
    const home = await sandbox(t);
    const dependencyRoot = await mkdir(home, 'dependencies/private');
    const nodeExe = path.join(await mkdir(home, 'runtime'), 'node.exe');
    await fs.writeFile(nodeExe, 'fixture');
    for (const id of ['current', 'previous', 'unknown']) {
      const root = await mkdir(home, 'releases/' + id);
      await fs.writeFile(path.join(root, 'release.json'), JSON.stringify({ id, root, dependencyRoot, nodeExe }));
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'previous' }));
    const inventory = await readInventory({ home, repoRoots: [] });
    assert.ok(inventory.uncertainties.some(item => item.reason === 'accepted-history-incomplete'));
    assert.equal(inventory.artifacts.find(item => item.id === 'release:unknown')?.status, 'PROTECTED');
  });
}
