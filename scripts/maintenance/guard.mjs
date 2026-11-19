import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { absolutePath, assertNarrowRoot, localHomes, pathKey, refusal, relativeWithin } from './policy.mjs';
import { windowsInspectionScript, windowsInspectionSource } from './windows-inspection.mjs';

const windows = process.platform === 'win32';
const execute = promisify(execFile);
const heldLeases = new WeakSet();
const borrowedLeases = new WeakSet();
const failedAcquisitions = new Map();
const recoveringLeases = new WeakSet();
const busy = () => Object.assign(new Error('The maintenance lock is held or cannot be verified'), { code: 'BUSY' });

function windowsCommand(script, input) {
  if (!windows) throw new Error('Windows metadata is unavailable');
  const system = absolutePath(process.env.SystemRoot || 'C:\\Windows');
  const executable = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);\n" + script;
  const args = [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64'),
  ];
  return [executable, args, { env: { ...process.env, CODEX_MAINTENANCE_QUERY: JSON.stringify(input) }, windowsHide: true }];
}

async function windowsQuery(script, input, timeout = 20000) {
  const [executable, args, options] = windowsCommand(script, input);
  const { stdout } = await execute(executable, args, { ...options, timeout, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function startWindowsHelper(script, input, signal) {
  const [executable, args, options] = windowsCommand(script, input);
  const child = spawn(executable, args, { ...options, stdio: ['pipe', 'pipe', 'ignore'], signal });
  const done = new Promise(resolve => child.once('close', resolve));
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = line => new Promise((resolve, reject) => {
    child.stdin.write(line + '\n', error => error ? reject(error) : resolve());
  });
  return { child, done, lines, send };
}

export async function processSnapshot(pid = null) {
  if (pid !== null && (!Number.isInteger(pid) || pid < 1 || pid > 0xffffffff)) {
    throw new Error('Invalid process identity');
  }
  const processes = await windowsQuery(String.raw`
    $wanted = ConvertFrom-Json -InputObject $env:CODEX_MAINTENANCE_QUERY
    $filter = @{}
    if ($null -ne $wanted) { $filter.Filter = "ProcessId=$wanted" }
    $rows = @(Get-CimInstance Win32_Process @filter | ForEach-Object {
      $start = if ($null -ne $_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }
      @{
        pid = $_.ProcessId; parentPid = $_.ParentProcessId; processStartedAt = $start
        name = $_.Name; executable = $_.ExecutablePath; commandLine = $_.CommandLine
      }
    })
    if ($null -ne $wanted -and $rows.Count -eq 0) {
      try {
        $null = Get-Process -Id $wanted -ErrorAction Stop
        throw 'The process exists but its identity could not be read'
      } catch {
        if ($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenId,*') { throw }
      }
    }
    ConvertTo-Json -InputObject $rows -Compress
  `, pid);
  if (!Array.isArray(processes) || processes.some(proc => !Number.isInteger(proc?.pid)) ||
      (pid !== null && (processes.length > 1 || processes.some(proc => proc.pid !== pid))) ||
      (pid === null && !processes.some(proc => proc.pid === process.pid))) {
    throw new Error('The process inventory is incomplete');
  }
  return processes;
}

// Unknown Windows reparse tags need not appear as symbolic links in Node's lstat.
export async function probePaths(values) {
  const paths = values.map(absolutePath);
  if (paths.length === 0) return [];
  if (windows) {
    const script = String.raw`
      function Assert-Plain($item) {
        $flags = [IO.File]::GetAttributes($item)
        if ($flags -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point' }
        return $flags
      }
      $query = ConvertFrom-Json -InputObject $env:CODEX_MAINTENANCE_QUERY
      $rows = @(foreach ($file in $query.paths) {
        try {
          $root = [IO.Path]::GetPathRoot($file)
          $cursor = $root
          $null = Assert-Plain $cursor
          foreach ($part in $file.Substring($root.Length).Split('\')) {
            if ($part) { $cursor = [IO.Path]::Combine($cursor, $part); $null = Assert-Plain $cursor }
          }
          'plain'
        } catch {
          $reason = $_.Exception.GetBaseException()
          if ($reason -is [IO.FileNotFoundException] -or $reason -is [IO.DirectoryNotFoundException]) {
            'missing'
          } else {
            'unverified'
          }
        }
      })
      ConvertTo-Json -InputObject $rows -Compress
    `;
    // Keep request environment blocks bounded even with many release manifests or worktrees.
    const results = [];
    let batch = [];
    let length = 0;
    for (const file of paths) {
      if (length + file.length > 12000 && batch.length) {
        results.push(...await windowsQuery(script, { paths: batch }, 60000));
        batch = [];
        length = 0;
      }
      batch.push(file);
      length += file.length;
    }
    results.push(...await windowsQuery(script, { paths: batch }, 60000));
    if (results.length !== paths.length || results.some(value => !['plain', 'missing', 'unverified'].includes(value))) {
      throw refusal('Incomplete Windows path verification');
    }
    return results;
  }
  return Promise.all(paths.map(async file => {
    let cursor = path.parse(file).root;
    try {
      for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        if ((await fs.lstat(cursor)).isSymbolicLink()) return 'unverified';
      }
      return 'plain';
    } catch (error) {
      return error.code === 'ENOENT' ? 'missing' : 'unverified';
    }
  }));
}

export async function requirePlainPath(file) {
  if ((await probePaths([file]))[0] !== 'plain') throw refusal('The path cannot be verified');
}

export async function resolveMaintenanceHome({ explicitHome } = {}) {
  const { logical, physical } = localHomes();
  const given = explicitHome === undefined ? logical : assertNarrowRoot(explicitHome);
  const known = pathKey(given) === pathKey(logical) || pathKey(given) === pathKey(physical);
  let home = given;
  if (known && logical !== physical) {
    const [logicalCurrent, physicalCurrent, logicalReleases, physicalReleases, physicalRoot] = await probePaths([
      path.join(logical, 'current.json'), path.join(physical, 'current.json'),
      path.join(logical, 'releases'), path.join(physical, 'releases'), physical,
    ]);
    const logicalUnverified = [logicalCurrent, logicalReleases].includes('unverified');
    const physicalUnverified = [physicalCurrent, physicalReleases, physicalRoot].includes('unverified');
    if (physicalUnverified) throw refusal('The installation locations cannot be verified');
    if (logicalUnverified) {
      // The one supported alias can be a junction. Check its immediate target
      // without opening anything through it, then use only the physical path.
      const link = await fs.lstat(logical);
      if (!link.isSymbolicLink() || physicalRoot !== 'plain' ||
          pathKey(await fs.readlink(logical)) !== pathKey(physical)) {
        throw refusal('The installation locations cannot be verified');
      }
      home = physical;
    } else if (logicalCurrent === 'plain' || logicalReleases === 'plain') {
      if (physicalCurrent === 'plain' || physicalReleases === 'plain') {
        throw refusal('Multiple ContractorSystem installations were found');
      }
      home = logical;
    } else if (physicalRoot === 'plain') {
      home = physical;
    } else if (pathKey(given) === pathKey(physical)) {
      throw refusal('The installation locations cannot be verified');
    }
  }
  await requirePlainPath(assertNarrowRoot(home));
  const actual = await fs.realpath(home);
  if (pathKey(actual) !== pathKey(home) || !(await fs.lstat(actual)).isDirectory()) {
    throw refusal('The installation root cannot be verified');
  }
  return actual;
}

async function maintenanceState(home) {
  const dir = path.join(home, 'maintenance-state');
  const [status] = await probePaths([dir]);
  if (status === 'missing') {
    await fs.mkdir(dir).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await requirePlainPath(dir);
  } else if (status !== 'plain') {
    throw refusal('The maintenance state directory cannot be verified');
  }
  if (!(await fs.lstat(dir)).isDirectory()) throw refusal('The maintenance state path is not a directory');
  return dir;
}

function sameLease(left, right) {
  return left?.token === right.token && left.pid === right.pid && left.processStartedAt === right.processStartedAt &&
    typeof left.home === 'string' && pathKey(left.home) === pathKey(right.home);
}

function parseLease(json, home) {
  const lease = JSON.parse(json);
  if (!lease || typeof lease.token !== 'string' || !lease.token || typeof lease.home !== 'string' ||
      pathKey(lease.home) !== pathKey(home) || !Number.isInteger(lease.pid) || lease.pid < 1 ||
      typeof lease.processStartedAt !== 'string' || !Number.isFinite(Date.parse(lease.processStartedAt))) throw busy();
  return lease;
}

async function readLease(file, home) {
  const metadata = await fs.lstat(file);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16384) throw busy();
  await requirePlainPath(file);
  return parseLease(await fs.readFile(file, 'utf8'), home);
}

async function requireObsoleteLease(lease) {
  const [actual] = await processSnapshot(lease.pid);
  if (actual && (!actual.processStartedAt || !(Date.parse(actual.processStartedAt) > Date.parse(lease.processStartedAt)))) {
    throw busy();
  }
}

async function createLease(file, lease, operation) {
  const owner = await fs.open(file, 'wx', 0o600);
  try {
    await owner.writeFile(JSON.stringify({ ...lease, operation }));
    await owner.sync();
  } finally {
    await owner.close();
  }
}

async function releaseLease(file, lease) {
  try {
    if (sameLease(await readLease(file, lease.home), lease)) await fs.unlink(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw busy();
  }
}

const idleGate = '{"version":1,"state":"idle"}';

async function withAcquisitionGate(file, lease, run, { recoverOwn = false, undo, timeout = 45000 } = {}) {
  const info = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (recoverOwn && !info) return;
  if (info && (!info.isFile() || info.nlink !== 1)) throw busy();
  // FileShare.None holds the same gate path exclusively until the helper closes
  // its handle, even after a process crash. The record remains for PID validation.
  const { child, done, lines, send } = startWindowsHelper(String.raw`
    $query = ConvertFrom-Json -InputObject $env:CODEX_MAINTENANCE_QUERY
    $encoding = [Text.UTF8Encoding]::new($false, $true)
    [Console]::InputEncoding = $encoding
    $file = $query.file
    $created = $false
    if (!$query.recoverOwn) {
      try {
        $stream = [IO.File]::Open($file, 'CreateNew', 'ReadWrite', 'None')
        $created = $true
      } catch {
        if ($_.Exception.GetBaseException() -isnot [IO.IOException]) { throw }
      }
    }
    if (!$created) {
      if ([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point' }
      $stream = [IO.File]::Open($file, 'Open', 'ReadWrite', 'None')
    }
    try {
      function Write-Gate([string]$value) {
        $bytes = $encoding.GetBytes($value)
        $stream.Position = 0
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.SetLength($bytes.Length)
        $stream.Flush($true)
      }
      $saved = $null
      if (!$created) {
        if ($stream.Length -gt 16384) { throw 'Gate record too large' }
        $reader = [IO.StreamReader]::new($stream, $encoding, $false, 1024, $true)
        try { $saved = $reader.ReadToEnd() } finally { $reader.Dispose() }
      }
      [Console]::WriteLine((ConvertTo-Json -InputObject @{saved = $saved} -Compress))
      $owner = [Console]::ReadLine()
      if ($null -ne $owner) {
        Write-Gate $owner
        [Console]::WriteLine('claimed')
        if ([Console]::ReadLine() -eq 'idle') {
          Write-Gate $query.idle
          [Console]::WriteLine('idle')
        }
      }
    } finally {
      $stream.Dispose()
    }
  `, { file, idle: idleGate, recoverOwn }, AbortSignal.timeout(timeout));
  let claimed = false;
  let sent = false;
  try {
    const { saved } = JSON.parse((await lines.next()).value);
    if (recoverOwn) {
      if (saved === idleGate || !sameLease(parseLease(saved, lease.home), lease)) return;
    } else if (saved !== null && saved !== idleGate) {
      await requireObsoleteLease(parseLease(saved, lease.home));
    }
    sent = true;
    await send(JSON.stringify(lease));
    if ((await lines.next()).value !== 'claimed') throw busy();
    claimed = true;
    return await run();
  } finally {
    child.stdin.end(claimed ? 'idle\n' : undefined);
    const idle = claimed && (await lines.next()).value === 'idle';
    if (await done !== 0 || (sent && !idle)) {
      if (sent) await undo?.();
      throw busy();
    }
  }
}

async function unwindAcquisition(file, gate, lease) {
  // This lease never reached the callback. Newer owners of either file are
  // left alone. An interrupted recovery stays pending only in this Node.
  if (recoveringLeases.has(lease)) throw busy();
  recoveringLeases.add(lease);
  try {
    await releaseLease(file, lease);
    await withAcquisitionGate(gate, lease, () => {}, { recoverOwn: true });
    if (failedAcquisitions.get(gate) === lease) failedAcquisitions.delete(gate);
  } finally {
    recoveringLeases.delete(lease);
  }
}

async function acquireLease(file, gate, lease, operation) {
  const pending = failedAcquisitions.get(gate);
  if (pending) await unwindAcquisition(file, gate, pending);
  await withAcquisitionGate(gate, lease, async () => {
    try {
      await createLease(file, lease, operation);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const previous = await readLease(file, lease.home);
    await requireObsoleteLease(previous);
    if (!sameLease(await readLease(file, lease.home), previous)) throw busy();
    await fs.unlink(file);
    await createLease(file, lease, operation);
  }, {
    undo: async () => {
      failedAcquisitions.set(gate, lease);
      await unwindAcquisition(file, gate, lease).catch(() => {});
    },
  });
}

export async function withMaintenanceLock(home, operation, run) {
  let lease, file;
  try {
    home = await resolveMaintenanceHome({ explicitHome: home });
    const [actual] = await processSnapshot(process.pid);
    if (!actual?.processStartedAt) throw busy();
    lease = Object.freeze({ token: randomUUID(), pid: process.pid, processStartedAt: actual.processStartedAt, home });
    const state = await maintenanceState(home);
    file = path.join(state, 'maintenance.lock');
    await acquireLease(file, path.join(state, 'maintenance.lock-acquire'), lease, operation);
  } catch {
    throw busy();
  }
  heldLeases.add(lease);
  try {
    return await run(lease);
  } finally {
    heldLeases.delete(lease);
    await releaseLease(file, lease);
  }
}

export async function requireHeldLease(home, lease) {
  if (!heldLeases.has(lease)) throw busy();
  try {
    const actualHome = await resolveMaintenanceHome({ explicitHome: home });
    const file = path.join(actualHome, 'maintenance-state', 'maintenance.lock');
    if (pathKey(actualHome) !== pathKey(lease.home) || !sameLease(await readLease(file, actualHome), lease)) throw busy();
    if (borrowedLeases.has(lease)) {
      const [[parent], [child]] = await Promise.all([processSnapshot(lease.pid), processSnapshot(process.pid)]);
      if (parent?.processStartedAt !== lease.processStartedAt || child?.parentPid !== lease.pid ||
          !(Date.parse(child.processStartedAt) >= Date.parse(parent.processStartedAt))) throw busy();
    }
    return actualHome;
  } catch {
    throw busy();
  }
}

export async function withLifecycleLock(home, operation, run, existing) {
  if (!existing) return withMaintenanceLock(home, operation, run);
  if (heldLeases.has(existing)) {
    await requireHeldLease(home, existing);
    return run(existing);
  }
  const inherited = Object.freeze({ ...existing });
  if (inherited.pid !== process.ppid || inherited.pid === process.pid) throw busy();
  heldLeases.add(inherited);
  borrowedLeases.add(inherited);
  try {
    await requireHeldLease(home, inherited);
    return await run(inherited);
  } finally {
    heldLeases.delete(inherited);
  }
}

export function inheritedMaintenanceLease() {
  const raw = process.env.CONTRACTOR_MAINTENANCE_LEASE;
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw busy();
    return parsed;
  } catch {
    throw busy();
  }
}

export async function withReservationGate(home, lease, run) {
  home = await requireHeldLease(home, lease);
  const [actual] = await processSnapshot(process.pid);
  if (!actual?.processStartedAt) throw busy();
  const owner = { home, token: randomUUID(), pid: process.pid, processStartedAt: actual.processStartedAt };
  const gate = path.join(home, 'maintenance-state', 'reservation-gate');
  let started = false;
  try {
    return await withAcquisitionGate(gate, owner, () => {
      started = true;
      return run();
    }, { timeout: 45 * 60 * 1000 });
  } catch (error) {
    if (!started) throw busy();
    throw error;
  }
}

const unchanged = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);

async function inspectOnWindows(target) {
  const { child, done, lines } = startWindowsHelper(
    windowsInspectionScript, { target, nativeSource: windowsInspectionSource }, AbortSignal.timeout(15 * 60 * 1000),
  );
  child.stdin.end();
  const result = await lines.next();
  const trailer = await lines.next();
  if (await done !== 0 || result.done || !trailer.done) throw refusal('The Windows inspection helper failed');
  const { path: actual, files, bytes, fingerprint } = JSON.parse(result.value);
  if (pathKey(actual) !== pathKey(target) ||
      !Number.isSafeInteger(files) || files < 0 || !Number.isSafeInteger(bytes) || bytes < 0 ||
      typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw refusal('The Windows inspection returned an invalid snapshot');
  }
  return { path: actual, files, bytes, fingerprint };
}

async function capturePath(file) {
  let cursor = path.parse(file).root;
  const components = [cursor];
  for (const name of path.relative(cursor, file).split(path.sep)) {
    cursor = path.join(cursor, name);
    components.push(cursor);
  }
  const chain = [];
  for (const [index, component] of components.entries()) {
    const stats = await fs.lstat(component, { bigint: true });
    if (!(stats.isDirectory() || (index === components.length - 1 && stats.isFile()))) {
      throw refusal('The path changed or contains a link');
    }
    chain.push({ path: component, stats });
  }
  return chain;
}

async function verifyPath(chain) {
  for (const { path: component, stats } of chain) {
    const actual = await fs.lstat(component, { bigint: true });
    if (actual.dev !== stats.dev || actual.ino !== stats.ino ||
        actual.isDirectory() !== stats.isDirectory() || actual.isFile() !== stats.isFile()) {
      throw refusal('The inspected path was replaced');
    }
  }
}

export async function inspectTarget(root, target) {
  try {
    root = assertNarrowRoot(root);
    target = assertNarrowRoot(target);
    if (!relativeWithin(root, target)) throw refusal('The target must be strictly inside the operation root');
    if (windows) return await inspectOnWindows(target);
    return await inspectSnapshot(target);
  } catch (error) {
    if (error.code === 'REFUSED') throw error;
    throw refusal('The target cannot be inspected safely');
  }
}

async function inspectSnapshot(target) {
  const checked = await capturePath(target);
  const actual = await fs.realpath(target);
  if (pathKey(actual) !== pathKey(target)) throw refusal('The target resolves to a different path');
  await verifyPath(checked);
  const fingerprint = createHash('sha256');
  let files = 0;
  let bytes = 0;
  async function inspect(file, ancestors) {
    await verifyPath(ancestors);
    const before = await fs.lstat(file, { bigint: true });
    const relative = path.relative(actual, file).split(path.sep).join('/');
    if (before.isDirectory()) {
      const chain = [...ancestors, { path: file, stats: before }];
      fingerprint.update(JSON.stringify(['directory', relative]) + '\n');
      await verifyPath(chain);
      for (const name of (await fs.readdir(file)).sort()) await inspect(path.join(file, name), chain);
    } else if (before.isFile()) {
      if (before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER - bytes)) throw refusal('The file cannot be measured safely');
      const handle = await fs.open(file, 'r');
      const hash = createHash('sha256');
      let count = 0;
      try {
        await verifyPath(ancestors);
        if (!unchanged(before, await handle.stat({ bigint: true }))) throw refusal('The file changed during inspection');
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          count += chunk.length;
          hash.update(chunk);
        }
        if (BigInt(count) !== before.size || !unchanged(before, await handle.stat({ bigint: true }))) {
          throw refusal('The file changed during inspection');
        }
      } finally {
        await handle.close();
      }
      files++;
      bytes += count;
      fingerprint.update(JSON.stringify(['file', relative, count, hash.digest('hex')]) + '\n');
    } else {
      throw refusal('The tree contains a link or special file');
    }
    await verifyPath(ancestors);
    if (!unchanged(before, await fs.lstat(file, { bigint: true }))) throw refusal('The tree changed during inspection');
  }
  await inspect(actual, checked);
  await verifyPath(checked);
  return { path: actual, files, bytes, fingerprint: fingerprint.digest('hex') };
}
