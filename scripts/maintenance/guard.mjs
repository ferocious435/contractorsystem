import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { absolutePath, assertNarrowRoot, localHomes, pathKey, refusal, relativeWithin } from './policy.mjs';

const windows = process.platform === 'win32';
const execute = promisify(execFile);
const heldLeases = new WeakSet();
const busy = () => Object.assign(new Error('The maintenance lock is held or cannot be verified'), { code: 'BUSY' });

async function windowsQuery(script, input, timeout = 20000) {
  if (!windows) throw new Error('Windows metadata is unavailable');
  const system = absolutePath(process.env.SystemRoot || 'C:\\Windows');
  const executable = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);\n" + script;
  const { stdout } = await execute(executable, [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64'),
  ], {
    env: { ...process.env, CODEX_MAINTENANCE_QUERY: JSON.stringify(input) },
    windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
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
export async function probePaths(values, { tree = false } = {}) {
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
          $flags = Assert-Plain $cursor
          foreach ($part in $file.Substring($root.Length).Split('\')) {
            if ($part) { $cursor = [IO.Path]::Combine($cursor, $part); $flags = Assert-Plain $cursor }
          }
          if ($query.tree -and ($flags -band [IO.FileAttributes]::Directory)) {
            $pending = [Collections.Generic.Stack[string]]::new()
            $pending.Push($file)
            while ($pending.Count) {
              $directory = $pending.Pop()
              $null = Assert-Plain $directory
              foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($directory)) {
                if ((Assert-Plain $entry) -band [IO.FileAttributes]::Directory) { $pending.Push($entry) }
              }
            }
          }
          'plain'
        } catch {
          $reason = $_.Exception.GetBaseException()
          if (!$query.tree -and ($reason -is [IO.FileNotFoundException] -or $reason -is [IO.DirectoryNotFoundException])) {
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
        results.push(...await windowsQuery(script, { paths: batch, tree }, 60000));
        batch = [];
        length = 0;
      }
      batch.push(file);
      length += file.length;
    }
    results.push(...await windowsQuery(script, { paths: batch, tree }, 60000));
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

export async function requirePlainPath(file, options) {
  if ((await probePaths([file], options))[0] !== 'plain') throw refusal('The path cannot be verified');
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

async function readLease(file, home) {
  const metadata = await fs.lstat(file);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16384) throw busy();
  await requirePlainPath(file);
  const lease = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!lease || typeof lease.token !== 'string' || !lease.token || typeof lease.home !== 'string' ||
      pathKey(lease.home) !== pathKey(home) || !Number.isInteger(lease.pid) || lease.pid < 1 ||
      typeof lease.processStartedAt !== 'string' || !Number.isFinite(Date.parse(lease.processStartedAt))) throw busy();
  return lease;
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

async function acquireLease(file, gate, lease, operation) {
  // Every acquirer takes the gate before touching the main lock. An interrupted
  // gate deliberately stays BUSY until it can be investigated.
  await createLease(gate, lease, operation);
  try {
    try {
      await createLease(file, lease, operation);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readLease(file, lease.home);
      const [actual] = await processSnapshot(previous.pid);
      if (actual && (!actual.processStartedAt || actual.processStartedAt === previous.processStartedAt ||
          Date.parse(actual.processStartedAt) <= Date.parse(previous.processStartedAt))) throw busy();
      if (!sameLease(await readLease(file, lease.home), previous)) throw busy();
      await fs.unlink(file);
      await createLease(file, lease, operation);
    }
  } finally {
    await releaseLease(gate, lease);
  }
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
    return actualHome;
  } catch {
    throw busy();
  }
}

const unchanged = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);

export async function inspectTarget(root, target) {
  try {
    root = assertNarrowRoot(root);
    target = assertNarrowRoot(target);
    if (!relativeWithin(root, target)) throw refusal('The target must be strictly inside the operation root');
    await requirePlainPath(target, { tree: true });
    const actual = await fs.realpath(target);
    if (pathKey(actual) !== pathKey(target)) throw refusal('The target resolves to a different path');
    const fingerprint = createHash('sha256');
    let files = 0;
    let bytes = 0;
    async function inspect(file) {
      const before = await fs.lstat(file, { bigint: true });
      const relative = path.relative(actual, file).split(path.sep).join('/');
      if (before.isDirectory()) {
        fingerprint.update(JSON.stringify(['directory', relative]) + '\n');
        for (const name of (await fs.readdir(file)).sort()) await inspect(path.join(file, name));
      } else if (before.isFile()) {
        if (before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER - bytes)) throw refusal('The file cannot be measured safely');
        const handle = await fs.open(file, 'r');
        const hash = createHash('sha256');
        let count = 0;
        try {
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
      if (!unchanged(before, await fs.lstat(file, { bigint: true }))) throw refusal('The tree changed during inspection');
    }
    await inspect(actual);
    return { path: actual, files, bytes, fingerprint: fingerprint.digest('hex') };
  } catch (error) {
    if (error.code === 'REFUSED') throw error;
    throw refusal('The target cannot be inspected safely');
  }
}
