import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { execFileSync, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(import.meta.url);
const windows = process.platform === 'win32';
const lockFile = home => path.join(home, 'maintenance-state', 'maintenance.lock');
const gateFile = home => lockFile(home) + '-acquire';
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
  const mode = typeof hold === 'string' ? hold : hold ? 'hold' : 'check';
  const worker = fork(script, ['--worker', home, mode, wait ? 'wait' : 'go'], {
    env: { ...process.env, LOCALAPPDATA: localAppData ?? process.env.LOCALAPPDATA },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const result = once(worker, 'message').then(([message]) => message);
  const done = once(worker, 'exit');
  return { worker, result, done };
}

function faultGateAfterClaim(spawn, executable, args, options) {
  const command = Buffer.from(args.at(-1), 'base64').toString('utf16le') + '\nexit 23\n';
  const helper = spawn(executable, [...args.slice(0, -1), Buffer.from(command, 'utf16le').toString('base64')], options);
  const end = helper.stdin.end.bind(helper.stdin);
  helper.stdin.end = () => end();
  return helper;
}

async function releaseFixture(home, { id, createdAt = '2026-11-10T12:00:00Z', acceptedAt = null, broken = false }) {
  const root = await mkdir(home, 'releases/' + id);
  const dependencyRoot = await mkdir(home, 'dependencies/shared');
  const nodeExe = path.join(await mkdir(home, 'runtime'), broken ? 'missing.exe' : 'node.exe');
  await mkdir(root, 'node_modules');
  await mkdir(dependencyRoot, 'node_modules');
  if (!broken) await fs.writeFile(nodeExe, 'node fixture');
  await fs.writeFile(path.join(root, 'release.json'), JSON.stringify({ id, root, dependencyRoot, nodeExe, createdAt, acceptedAt }));
}

if (process.argv[2] === '--inventory-worker') {
  const [home, scenario, rawPid] = process.argv.slice(3);
  const pid = Number(rawPid);
  const exec = childProcess.execFile;
  const wrap = (...args) => exec(...args);
  // Simulate a WMI result which omits one live process and refuses a direct lookup.
  // All filesystem and inventory logic, and every other Windows query, stay real.
  wrap[promisify.custom] = async (file, args, options) => {
    const query = options.env.CODEX_MAINTENANCE_QUERY;
    if (scenario === 'no-details' && Number(query) === pid) throw Error('PID query unavailable');
    const response = await exec[promisify.custom](file, args, options);
    if (query !== 'null') return response;
    const rows = JSON.parse(response.stdout);
    if (scenario === 'no-details') {
      return { ...response, stdout: JSON.stringify(rows.filter(row => row.pid !== pid)) };
    }
    const relative = rows.find(row => row.pid === pid);
    relative.commandLine = 'node .\\node_modules\\next\\dist\\bin\\next build';
    return { ...response, stdout: JSON.stringify(rows) };
  };
  childProcess.execFile = wrap;
  syncBuiltinESMExports();
  try {
    const { readInventory } = await inventoryModule();
    process.send(await readInventory({ home, repoRoots: [] }));
  } finally {
    process.disconnect();
  }
} else if (process.argv[2] === '--worker') {
  try {
    if (process.argv[5] === 'wait') await once(process, 'message');
    const home = process.argv[3];
    if (process.argv[4] === 'exit-during-acquire') {
      const open = fs.open;
      const file = lockFile(await fs.realpath(home));
      fs.open = async (target, flags, ...args) => {
        if (target === file && flags === 'wx') {
          process.send({ code: 'EXITING' }, () => process.exit(0));
          return new Promise(() => {});
        }
        return open(target, flags, ...args);
      };
      syncBuiltinESMExports();
    }
    const { withMaintenanceLock } = await guardModule();
    await withMaintenanceLock(home, 'test', async lease => {
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

  // Fails if successful pin messages let Node read a tree after the helper's handles are gone.
  test('helperDeathCannotLeaveAnUnpinnedReader', { skip: !windows, timeout: 30000 }, async t => {
    const { inspectTarget } = await guardModule();
    const base = await sandbox(t);
    const owned = await mkdir(base, 'owned');
    const root = await mkdir(owned, 'releases');
    const target = await mkdir(root, 'candidate');
    const outsider = await mkdir(base, 'other/releases/candidate');
    await fs.writeFile(path.join(target, 'inside'), 'inside');
    await fs.writeFile(path.join(outsider, 'outside'), 'outside');
    const spawn = childProcess.spawn;
    let closed;
    t.mock.method(childProcess, 'spawn', (executable, args, options) => {
      const query = JSON.parse(options.env?.CODEX_MAINTENANCE_QUERY ?? 'null');
      if (query?.target !== target) return spawn(executable, args, options);
      const original = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      const compileEnd = original.indexOf('\n  $result =');
      assert.ok(compileEnd > 0, 'the fault is injected after the actual native compilation');
      const fault = original.slice(0, compileEnd) + String.raw`
        $held = [ContractorInspection]::OpenPlain($query.owned, $true)
        [Console]::WriteLine('ready')
        $null = [Console]::ReadLine()
        [Console]::WriteLine('ready')
        exit 25
      `;
      const command = Buffer.from(fault, 'utf16le').toString('base64');
      const env = { ...options.env, CODEX_MAINTENANCE_QUERY: JSON.stringify({ ...query, owned }) };
      const helper = spawn(executable, [...args.slice(0, -1), command], { ...options, env });
      closed = once(helper, 'close');
      return helper;
    });
    let changed;
    const replaceAncestor = () => changed ??= (async () => {
      assert.deepEqual(await closed, [25, null]);
      await fs.rename(owned, path.join(base, 'before-swap'));
      await fs.symlink(path.join(base, 'other'), owned, 'junction');
    })();
    const readdir = fs.readdir;
    let outsideListed = false;
    let nodeEnumerated = false;
    t.mock.method(fs, 'readdir', async (file, ...args) => {
      if (file === target) {
        nodeEnumerated = true;
        await replaceAncestor();
      }
      const entries = await readdir(file, ...args);
      if (file === target && entries.includes('outside')) outsideListed = true;
      return entries;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(inspectTarget(root, target), { code: 'REFUSED' });
      assert.ok(closed, 'a real helper was started');
      await replaceAncestor();
      assert.equal((await fs.lstat(owned)).isSymbolicLink(), true);
      assert.equal(outsideListed, false, 'Node read a replacement junction after the helper died');
      assert.equal(nodeEnumerated, false);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
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

  test('reservation helper holds its native handle beyond the handshake budget', { skip: !windows, timeout: 60000 }, async t => {
    const { withMaintenanceLock, withReservationGate } = await guardModule();
    const home = await sandbox(t);
    const gate = path.join(home, 'maintenance-state', 'reservation-gate');
    const timeout = 4000;
    const oldTimeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', value => oldTimeout(value === 45 * 60 * 1000 ? timeout : value));
    await withMaintenanceLock(home, 'long-reservation-fixture', async lease => {
      const result = await withReservationGate(home, lease, async () => {
        await delay(timeout + 250);
        await assert.rejects(fs.readFile(gate), error => ['EBUSY', 'EPERM', 'EACCES'].includes(error.code));
        await assert.rejects(withReservationGate(home, lease, () => assert.fail('A contender entered the held gate'), { timeout }),
          { code: 'BUSY' });
        return 'operation completed';
      }, { timeout });
      assert.equal(result, 'operation completed');
      assert.equal(JSON.parse(await fs.readFile(gate, 'utf8')).state, 'idle');
      assert.equal(await withReservationGate(home, lease, () => 'next operation', { timeout }), 'next operation');
    });
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
      for (const { worker } of workers) if (worker.connected) worker.send('finish', () => {});
      await Promise.all(workers.map(worker => worker.done));
    }
  });

  // Fails if a dead acquisition owner cannot be recovered, or both contenders acquire the main lock.
  test('deadAcquireOwnerAllowsOnlyOneReplacement', { timeout: 45000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const home = await sandbox(t);
    const departed = child(home, undefined, 'exit-during-acquire');
    assert.equal((await departed.result).code, 'EXITING');
    assert.deepEqual(await departed.done, [0, null]);
    let savedGate;
    for (let attempt = 0; attempt < 40 && savedGate === undefined; attempt++) {
      try {
        savedGate = JSON.parse(await fs.readFile(gateFile(home), 'utf8'));
      } catch (error) {
        if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
        await delay(50);
      }
    }
    assert.equal(savedGate?.pid, departed.worker.pid);
    assert.match(savedGate?.processStartedAt, /^\d{4}-/);
    const workers = [child(home, undefined, true, true), child(home, undefined, true, true)];
    try {
      for (const { worker } of workers) worker.send('start');
      const results = await Promise.all(workers.map(worker => worker.result));
      assert.deepEqual(results.map(result => result.code).sort(), ['ACQUIRED', 'BUSY']);
      const saved = JSON.parse(await fs.readFile(lockFile(home), 'utf8'));
      assert.equal(saved.token, results.find(result => result.lease).lease.token);
    } finally {
      for (const { worker } of workers) if (worker.connected) worker.send('finish', () => {});
      await Promise.all(workers.map(worker => worker.done));
    }
    await withMaintenanceLock(home, 'again', () => 'reusable');
    await fs.writeFile(gateFile(home), '{"token":');
    await assert.rejects(withMaintenanceLock(home, 'check', () => assert.fail('Partial gate owner was ignored')), { code: 'BUSY' });
  });

  // Fails if a helper failure after the primary write leaks either owned record until Node exits,
  // including when the initial attempt to clean up that gate also fails.
  test('failedGateHelperReleasesOwnedRecordsInSameProcess', { skip: !windows, timeout: 60000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const base = await sandbox(t);
    const spawn = childProcess.spawn;
    let home;
    let failRecovery = false;
    let faultInjected = false;
    t.mock.method(childProcess, 'spawn', (executable, args, options) => {
      const query = JSON.parse(options.env?.CODEX_MAINTENANCE_QUERY ?? 'null');
      if (failRecovery && query?.file === gateFile(home) && query.recoverOwn) {
        failRecovery = false;
        const command = Buffer.from('exit 24', 'utf16le').toString('base64');
        return spawn(executable, [...args.slice(0, -1), command], options);
      }
      if (!faultInjected && query?.file === gateFile(home)) {
        faultInjected = true;
        return faultGateAfterClaim(spawn, executable, args, options);
      }
      return spawn(executable, args, options);
    });
    syncBuiltinESMExports();
    try {
      for (const recoveryFails of [false, true]) {
        home = await mkdir(base, recoveryFails ? 'fails-twice' : 'fails-once');
        failRecovery = recoveryFails;
        faultInjected = false;
        await assert.rejects(withMaintenanceLock(home, 'test', () => assert.fail('A failed acquire entered its callback')), { code: 'BUSY' });
        assert.equal(faultInjected, true);
        assert.equal(failRecovery, false);
        await assert.rejects(fs.lstat(lockFile(home)), { code: 'ENOENT' });
        assert.equal(await withMaintenanceLock(home, 'retry', lease => lease.pid), process.pid);
      }
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  // Fails if two cleanups both validate an old record and the delayed unlink removes the next owner.
  test('overlappingUnwindCannotRemoveNewPrimaryLease', { skip: !windows, timeout: 60000 }, async t => {
    const { withMaintenanceLock } = await guardModule();
    const home = await sandbox(t);
    const spawn = childProcess.spawn;
    const unlink = fs.unlink;
    const firstUnlink = Promise.withResolvers();
    const secondUnlink = Promise.withResolvers();
    const resumeFirst = Promise.withResolvers();
    const resumeSecond = Promise.withResolvers();
    let unlinkCount = 0;
    let faultInjected = false;
    t.mock.method(childProcess, 'spawn', (executable, args, options) => {
      const query = JSON.parse(options.env?.CODEX_MAINTENANCE_QUERY ?? 'null');
      if (!faultInjected && query?.file === gateFile(home)) {
        faultInjected = true;
        return faultGateAfterClaim(spawn, executable, args, options);
      }
      return spawn(executable, args, options);
    });
    t.mock.method(fs, 'unlink', async file => {
      if (file === lockFile(home)) {
        unlinkCount++;
        if (unlinkCount === 1) {
          firstUnlink.resolve();
          await resumeFirst.promise;
        } else if (unlinkCount === 2) {
          secondUnlink.resolve();
          await resumeSecond.promise;
        }
      }
      return unlink(file);
    });
    syncBuiltinESMExports();
    let newer;
    try {
      const first = withMaintenanceLock(home, 'failed', () => 'entered').catch(error => error.code);
      assert.equal(await Promise.race([first, firstUnlink.promise]), undefined);
      const retry = withMaintenanceLock(home, 'retry', () => 'entered').catch(error => error.code);
      const overlap = await Promise.race([retry, secondUnlink.promise.then(() => 'SECOND_UNLINK')]);
      resumeFirst.resolve();
      assert.equal(await first, 'BUSY');
      newer = child(home, undefined, true);
      const started = await newer.result;
      assert.equal(started.code, 'ACQUIRED');
      resumeSecond.resolve();
      await retry;
      const saved = await fs.readFile(lockFile(home), 'utf8').then(JSON.parse, () => null);
      assert.equal(saved?.token, started.lease.token, 'the old cleanup removed the new owner');
      assert.equal(overlap, 'BUSY');
    } finally {
      resumeFirst.resolve();
      resumeSecond.resolve();
      if (newer?.worker.connected) newer.worker.send('finish', () => {});
      if (newer) await newer.done;
      t.mock.restoreAll();
      syncBuiltinESMExports();
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

  // Fails if a build alias to a registered worktree, or a build containing one, can pass policy.
  test('overlappingRegisteredWorktreesAreProtected', { timeout: 45000 }, async t => {
    const { readInventory } = await inventoryModule();
    const { artifactRoot } = await import('./maintenance/policy.mjs');
    const base = await sandbox(t);
    const home = await mkdir(base, 'home');
    const repo = await mkdir(base, 'repo');
    const same = path.join(repo, '.next-overlap');
    const ancestor = await mkdir(repo, '.next-wrapper');
    const nested = path.join(ancestor, 'linked');
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '--quiet');
    await fs.writeFile(path.join(repo, '.gitignore'), '/.next-*/\n');
    git('add', '.gitignore');
    git('-c', 'user.name=Test', '-c', 'user.email=maintenance@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    for (const dir of [same, nested]) git('worktree', 'add', '--quiet', '--detach', dir);
    const inventory = await readInventory({ home, repoRoots: [repo] });
    const scope = { home, repoRoots: inventory.artifacts.filter(item => item.kind === 'worktree').map(item => item.path) };
    assert.equal(inventory.artifacts.find(item => item.kind === 'worktree' && item.path === repo).dirty, false);
    for (const file of [same, ancestor]) {
      const build = inventory.artifacts.find(item => item.kind === 'build' && item.path === file);
      assert.equal(build?.status, 'PROTECTED');
      assert.throws(() => artifactRoot(scope, build), { code: 'REFUSED' });
    }
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
    for (const [id, acceptedAt] of [['current', null], ['previous', null], ['accepted', '2026-11-17T08:00:00.000Z'], ['unverified', null]]) {
      await releaseFixture(home, { id, acceptedAt });
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'previous' }));
    const inventory = await readInventory({ home, repoRoots: [] });
    assert.deepEqual(inventory.acceptedReleases.map(release => release.id).sort(), ['current', 'previous']);
    for (const item of inventory.artifacts) assert.equal(item.fingerprint, null);
    assert.ok(inventory.artifacts.find(item => item.id === 'dependency:shared')?.protectedBy.includes('release:current'));
    assert.ok(inventory.artifacts.find(item => item.id === 'runtime:node.exe')?.protectedBy.includes('release:current'));
    for (const id of ['accepted', 'unverified']) {
      assert.ok(inventory.artifacts.find(item => item.id === 'release:' + id)?.protectedBy.includes('acceptance-evidence-unverified'));
    }
  });

  // Fails if missing acceptance evidence allows an unclassified historical release to lose protection.
  test('incompleteAcceptanceHistoryProtectsOtherReleases', { timeout: 30000 }, async t => {
    const { readInventory } = await inventoryModule();
    const home = await sandbox(t);
    for (const id of ['current', 'previous', 'unknown']) {
      await releaseFixture(home, { id });
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'previous' }));
    const inventory = await readInventory({ home, repoRoots: [] });
    assert.ok(inventory.uncertainties.some(item => item.reason === 'accepted-history-incomplete'));
    assert.equal(inventory.artifacts.find(item => item.id === 'release:unknown')?.status, 'PROTECTED');
  });

  // Release files are not proof of acceptance, even if their runtime paths are present.
  test('unprovenManifestDatesCannotFillRetentionSlots', { timeout: 45000 }, async t => {
    const { readInventory } = await inventoryModule();
    const home = await sandbox(t);
    for (const [id, day, broken] of [['current', null], ['old-link', 12], ['newest', 17], ['second', 16],
      ['older', 15], ['broken', 18, true], ['bad-time', 9]]) {
      await releaseFixture(home, { id, acceptedAt: day ? '2026-11-' + String(day).padStart(2, '0') + 'T15:00:00Z' : null, broken });
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'old-link' }));
    const inventory = await readInventory({ home, repoRoots: [] });
    const find = id => inventory.artifacts.find(item => item.id === 'release:' + id);
    assert.deepEqual(inventory.acceptedReleases.map(item => item.id), ['current', 'old-link']);
    assert.ok(find('old-link')?.protectedBy.includes('previous-release'));
    for (const id of ['newest', 'second', 'older', 'broken', 'bad-time']) {
      assert.ok(find(id)?.protectedBy.includes('acceptance-evidence-unverified'), id);
    }
    assert.ok(inventory.uncertainties.some(item => item.reason === 'accepted-history-incomplete'));
  });

  // Fails if an omitted PID automatically unpins a closed task or an unbound relative Next launch is ignored.
  test('unavailablePidAndRelativeLaunchKeepTheirProtection', { skip: !windows, timeout: 60000 }, async t => {
    const home = await sandbox(t);
    const { processSnapshot } = await guardModule();
    const [proc] = await processSnapshot(process.pid);
    const registry = await mkdir(home, 'maintenance-state/tasks');
    for (const id of ['current', 'previous', 'older', 'closed-candidate', 'unbound-candidate']) {
      await releaseFixture(home, { id, acceptedAt: ['previous', 'older'].includes(id) ? '2026-11-15T12:00:00Z' : null });
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'previous' }));
    const candidate = path.join(home, 'releases', 'closed-candidate');
    await fs.writeFile(path.join(registry, 'closed.json'), JSON.stringify({
      id: 'closed', status: 'closed', worktree: path.join(home, 'repo'), commit: 'a'.repeat(40),
      dirty: false, build: null, candidate, pid: proc.pid, processStartedAt: proc.processStartedAt, result: 'finished', pins: [],
    }));
    async function run(scenario) {
      const worker = fork(script, ['--inventory-worker', home, scenario, String(proc.pid)], {
        execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      const done = once(worker, 'exit');
      const [inventory] = await once(worker, 'message');
      assert.deepEqual(await done, [0, null]);
      return inventory;
    }
    const unknown = await run('no-details');
    assert.ok(unknown.artifacts.find(item => item.path === candidate)?.protectedBy.includes('task:closed'));
    assert.ok(unknown.uncertainties.some(item => item.scope === 'task:closed' && item.reason === 'task-process-unverified'));
    // Simulate a relative launch after the registered task intentionally leaves the scene.
    await fs.unlink(path.join(registry, 'closed.json'));
    const relative = await run('relative');
    assert.equal(relative.artifacts.find(item => item.id === 'release:unbound-candidate')?.status, 'PROTECTED');
    assert.ok(relative.uncertainties.some(item => item.reason === 'process-path-unverified'));
  });

  // Fails if a port argument hides Next start, or a standalone server with an unknown working directory is ignored.
  test('liveRelativeNextAndStandaloneCommandsProtectCandidates', { skip: !windows, timeout: 60000 }, async t => {
    const { readInventory } = await inventoryModule();
    const base = await sandbox(t);
    const home = await mkdir(base, 'home');
    const cwd = await mkdir(base, 'example-project');
    for (const id of ['current', 'one', 'two', 'candidate']) {
      await releaseFixture(home, { id, acceptedAt: ['one', 'two'].includes(id) ? '2026-11-16T12:00:00Z' : null });
    }
    await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: 'current', previousId: 'one' }));
    const commands = [
      ['.\\node_modules\\next\\dist\\bin\\next', 'start', '-p', '3000'],
      ['.next/standalone/server.js'],
      ['server.js'],
    ];
    for (const command of commands) {
      const file = path.join(cwd, command[0]);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "process.stdin.resume(); console.log('ready');");
      const proc = childProcess.spawn(process.execPath, command, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
      const done = once(proc, 'exit');
      try {
        await once(proc.stdout, 'data');
        const inventory = await readInventory({ home, repoRoots: [] });
        assert.ok(inventory.uncertainties.some(item => item.scope === 'process:' + proc.pid &&
          item.reason === 'process-path-unverified'), command.join(' '));
        assert.ok(inventory.artifacts.find(item => item.id === 'release:candidate')?.protectedBy.includes('process-path-unverified'));
      } finally {
        proc.stdin.end();
        assert.deepEqual(await done, [0, null]);
      }
    }
  });
}
