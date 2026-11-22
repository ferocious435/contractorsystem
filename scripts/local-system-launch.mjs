import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { archiveName } from './maintenance/archive.mjs';
import { inheritedMaintenanceLease, processSnapshot, resolveMaintenanceHome, withLifecycleLock } from './maintenance/guard.mjs';
import {
  completeStandaloneVerification, guardedJson, hasObservedStandalone, packagedRelease, registerInstalledRelease, withLifecycleOperation,
  registerStandaloneFailure,
} from './maintenance/lifecycle.mjs';
import { isBuildName, isReleaseId, localHomes, pathInMaintenanceHome, pathKey, refusal } from './maintenance/policy.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verifyPorts = [3007, 3008, 3009, 3010];
const standaloneAttempts = new WeakMap();

function issueStandaloneAttempt(context, details) {
  const attempt = Object.freeze({});
  standaloneAttempts.set(attempt, { home: context.home, lease: context.lease, details });
  return attempt;
}

// Consumption is public to the lifecycle module. Only this module can issue an
// attempt, and only the actual standalone branch below supplies the evidence.
export function consumeStandaloneAttempt(attempt, context, passed) {
  const observation = standaloneAttempts.get(attempt);
  if (!observation || observation.details.passed !== passed || observation.lease !== context.lease ||
      pathKey(observation.home) !== pathKey(context.home)) throw refusal('An observed standalone attempt is required');
  standaloneAttempts.delete(attempt);
  return observation.details;
}

function readRelease(home, id) {
  if (!isReleaseId(id)) throw refusal('Invalid release identity');
  const root = path.join(home, 'releases', id);
  const release = JSON.parse(privateFile(path.join(root, 'release.json')).toString('utf8'));
  const nodeExe = pathInMaintenanceHome(home, release.nodeExe);
  const dependencyRoot = pathInMaintenanceHome(home, release.dependencyRoot);
  if (release.id !== id || pathKey(pathInMaintenanceHome(home, release.root)) !== pathKey(root) ||
      pathKey(path.dirname(nodeExe)) !== pathKey(path.join(home, 'runtime')) ||
      pathKey(path.dirname(dependencyRoot)) !== pathKey(path.join(home, 'dependencies')) ||
      !isBuildName(release.dist) || typeof release.buildId !== 'string' || !release.buildId.trim()) {
    throw refusal('Release path or identity differs');
  }
  return { ...release, root, nodeExe, dependencyRoot };
}

function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || pathKey(fs.realpathSync(file)) !== pathKey(file)) {
    throw refusal('A release file is linked or not an ordinary file: ' + path.basename(file));
  }
  return fs.readFileSync(file);
}

function verifyRelease(release) {
  const listed = new Set();
  for (const file of release.files) {
    const name = archiveName(file.path.replaceAll('\\', '/'));
    if (listed.has(name.toLowerCase()) || hash(privateFile(path.join(release.root, name))) !== file.sha256) {
      throw refusal('Release file changed: ' + name);
    }
    listed.add(name.toLowerCase());
  }
  const buildPath = release.dist + '/BUILD_ID';
  if (!listed.has(buildPath.toLowerCase()) || privateFile(path.join(release.root, buildPath)).toString('utf8').trim() !== release.buildId) {
    throw refusal('The sealed build identifier differs');
  }
  if (hash(privateFile(release.nodeExe)) !== release.nodeSha256) throw refusal('Saved Node runtime changed');
  const modules = path.join(release.root, 'node_modules'), anchor = path.join(release.root, 'package.json');
  const info = fs.lstatSync(modules);
  if (!info.isDirectory() || info.isSymbolicLink() || pathKey(fs.realpathSync(modules)) !== pathKey(modules)) {
    throw refusal('A private physical dependency copy is required');
  }
  const require = createRequire(anchor);
  for (const name of ['dotenv', 'next', 'officeparser', '@supabase/supabase-js']) {
    const target = require.resolve(name);
    const relative = path.relative(modules, fs.realpathSync(target));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw refusal('A release dependency resolves outside its physical copy');
    }
  }
  const lockBytes = privateFile(path.join(release.root, 'package-lock.json'));
  if (release.dependencyLockSha256 && hash(lockBytes) !== release.dependencyLockSha256) {
    throw refusal('The release dependency lock changed');
  }
  const lock = JSON.parse(lockBytes.toString('utf8'));
  for (const name of ['next', 'dotenv', 'officeparser']) {
    const actual = JSON.parse(privateFile(path.join(modules, name, 'package.json')).toString('utf8')).version;
    if (actual !== lock.packages?.['node_modules/' + name]?.version) throw refusal('Dependency version differs: ' + name);
  }
  return { modules, anchor, require };
}

export async function resolveVerifiedRelease({ home, releaseId } = {}) {
  home = await resolveMaintenanceHome({ explicitHome: home });
  if (!releaseId) releaseId = (await guardedJson(path.join(home, 'current.json'))).releaseId;
  const release = readRelease(home, releaseId);
  const dependencies = verifyRelease(release);
  return { home, release, dependencyRoot: dependencies.modules, require: dependencies.require };
}

function buildId(html) {
  const ids = new Set();
  for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    let frame;
    try { frame = JSON.parse(match[1]); } catch { continue; }
    if (frame[0] === 1 && typeof frame[1] === 'string') {
      const value = frame[1].match(/"b":"([^"\r\n]+)"/);
      if (value) ids.add(value[1]);
    }
  }
  if (ids.size !== 1) throw refusal('Cannot identify the running build');
  return [...ids][0];
}

async function probe(release, port) {
  const response = await fetch('http://127.0.0.1:' + port, { signal: AbortSignal.timeout(12000), redirect: 'manual' });
  if (response.status !== 200 || buildId(await response.text()) !== release.buildId) {
    throw refusal('The running program does not match the release');
  }
}

function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw refusal('Invalid process identity');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid +
    "' | Select-Object ProcessId,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress"],
  { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) throw refusal('Saved process is absent');
  return JSON.parse(result.stdout);
}

function matchingProcess(expected, actual) {
  return expected && actual.ProcessId === expected.ProcessId &&
    actual.CommandLine === expected.CommandLine && actual.CreationDate === expected.CreationDate &&
    actual.ExecutablePath === expected.ExecutablePath;
}

function requireMatchingProcess(expected, actual) {
  if (!matchingProcess(expected, actual)) throw refusal('Process identity changed');
}

async function inspectOwned(current) {
  try {
    const [found] = await processSnapshot(current.pid);
    if (!found) return 'gone';
    const actual = processInfo(current.pid);
    if (matchingProcess(current.process, actual)) return 'owned';
    if (actual.CreationDate && current.process?.CreationDate && actual.CreationDate !== current.process.CreationDate) {
      return 'gone';
    }
  } catch { /* An unreadable identity is not evidence of absence. */ }
  return 'unknown';
}

function stopPid(pid, expected) {
  requireMatchingProcess(expected, processInfo(pid));
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw refusal('Cannot stop the owned program process');
}

function cliDirectory(release) {
  if (release.codexExe && fs.existsSync(release.codexExe)) return path.dirname(release.codexExe);
  const root = path.join(path.dirname(localHomes().logical), 'OpenAI', 'Codex', 'bin');
  if (!fs.existsSync(root)) throw refusal('The installed Codex business runtime is not available');
  const executable = fs.readdirSync(root).map(name => path.join(root, name, 'codex.exe'))
    .filter(file => fs.existsSync(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!executable) throw refusal('The installed Codex business runtime is not available');
  return path.dirname(executable);
}

async function portIsFree(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); reject(refusal('The local port could not be verified')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve(true) : reject(error));
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(home, release, port, previousId) {
  const { require } = verifyRelease(release);
  if (!await portIsFree(port)) throw refusal('The local port is already occupied');
  const { parse } = require('dotenv');
  const env = { ...process.env, ...parse(privateFile(path.join(home, 'config', 'system.env'))),
    CONTRACTOR_NEXT_DIST_DIR: release.dist, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' };
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_OPTIONS|NODE_PATH|CONTRACTOR_MAINTENANCE_LEASE)$/i.test(key)) delete env[key];
  }
  const cli = cliDirectory(release);
  env.PATH = cli + path.delimiter + (env.PATH || env.Path || '');
  const logs = path.join(home, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const stdout = fs.openSync(path.join(logs, 'server.stdout.log'), 'a');
  let stderr, child, spawnError, owned;
  const next = path.join(release.root, 'node_modules/next/dist/bin/next');
  try {
    stderr = fs.openSync(path.join(logs, 'server.stderr.log'), 'a');
    child = spawn(release.nodeExe, [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
      { cwd: release.root, env, stdio: ['ignore', stdout, stderr], detached: true, windowsHide: true });
    child.once('error', error => { spawnError = error; });
    child.unref();
  } finally {
    fs.closeSync(stdout);
    if (stderr !== undefined) fs.closeSync(stderr);
  }
  try {
    for (let attempt = 0; attempt < 25; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw refusal('The saved runtime terminated');
      try {
        const actual = processInfo(child.pid);
        if (typeof actual.CommandLine !== 'string' || !actual.CommandLine.includes(next) ||
            pathKey(actual.ExecutablePath) !== pathKey(release.nodeExe)) throw refusal('The launched process cannot be identified');
        owned ??= actual;
        requireMatchingProcess(owned, actual);
        await probe(release, port);
        return { releaseId: release.id, pid: child.pid, previousId, process: owned, startedAt: new Date().toISOString() };
      } catch (error) {
        if (attempt === 24) throw error;
      }
      await wait(400);
    }
  } catch (error) {
    if (owned) {
      try { stopPid(child.pid, owned); } catch { /* A different or absent process cannot be stopped. */ }
      error.failedProcess = { releaseId: release.id, pid: child.pid, process: owned };
    }
    throw error;
  }
}

export async function switchRelease(id, { current, readRelease, verify, stop, launch, store,
  inspect, portFree, stopOwned = stop }) {
  if (id === current.releaseId) throw refusal('This release is already selected');
  const previous = readRelease(current.releaseId), next = readRelease(id);
  await verify(next);
  await verify(previous);
  let started;
  try {
    await stop(current);
    started = await launch(next, current.releaseId);
    await store(started);
    return started;
  } catch (error) {
    const candidate = started ?? error.failedProcess;
    if (!candidate && await inspect(current) === 'owned') throw error;
    try {
      if (candidate && await inspect(candidate) === 'owned') {
        // The process remains owned even when its HTTP endpoint is broken.
        await stopOwned(candidate).catch(() => {});
      }
      if (await inspect(current) !== 'gone' || (candidate && await inspect(candidate) !== 'gone') || !await portFree()) {
        throw refusal('The ownership or the local port could not be confirmed for recovery');
      }
      const restored = await launch(previous, current.previousId);
      try {
        await store(restored);
      } catch (pointerError) {
        throw Object.assign(Error('The previous program is running, but its current pointer could not be saved.'),
          { cause: pointerError });
      }
    } catch (recovery) {
      throw new AggregateError([error, recovery], 'Installation failed. ' + recovery.message);
    }
    throw Object.assign(Error('Installation failed. The previous program was restored.'), { cause: error });
  }
}

export async function runAvailabilityEvent(event, { readRunning, change, after, report = error => {
  process.stderr.write('The program is running. Maintenance is pending: ' + error.message + '\n');
} }) {
  const publish = async (result, context) => {
    try {
      await after(event, result, context);
    } catch (error) {
      report(error);
    }
    return result;
  };
  if (event === 'start') {
    const existing = await readRunning();
    if (existing?.running === true) return publish(existing);
  }
  try {
    return await change(publish);
  } catch (error) {
    if (event !== 'start' || error.code !== 'BUSY') throw error;
    const existing = await readRunning();
    if (existing?.running === true) return publish(existing);
    throw error;
  }
}

export async function runLauncher(args = process.argv.slice(2), options = {}) {
  const mode = args[0] ?? 'start';
  if (!['start', 'status', 'stop', 'verify', 'install', 'rollback', 'adopt'].includes(mode)) {
    throw refusal('Use start, status, stop, verify, install, rollback or adopt');
  }
  const flags = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--release', '--port', '--pid'].includes(flag) || !value || flags.has(flag)) throw refusal('Invalid launcher options');
    flags.set(flag, value);
  }
  const checking = mode === 'verify', port = checking ? Number(flags.get('--port')) : 3002;
  if (checking && !verifyPorts.includes(port)) throw refusal('Use a separate local verification port');
  const home = await resolveMaintenanceHome({ explicitHome: options.home });
  const currentFile = path.join(home, 'current.json');
  const readCurrent = () => guardedJson(currentFile);
  const read = id => readRelease(home, id);
  const store = value => {
    const temp = currentFile + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, currentFile);
  };
  const portFree = () => portIsFree(port);
  const stopOwned = async current => {
    stopPid(current.pid, current.process);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await inspectOwned(current) === 'gone' && await portFree()) return;
      await wait(200);
    }
    throw refusal('The stopped process or the local port could not be confirmed');
  };
  const stop = async current => {
    await probe(read(current.releaseId), port);
    await stopOwned(current);
  };
  const start = (release, previousId = null) => launch(home, release, port, previousId);
  const running = async current => {
    const release = read(current.releaseId);
    await probe(release, port);
    return { running: true, url: 'http://127.0.0.1:' + port + '/', release: release.id, buildId: release.buildId, pid: current.pid };
  };
  if (mode === 'status') return running(await readCurrent());
  const readRunning = async () => {
    const current = await readCurrent();
    verifyRelease(read(current.releaseId));
    return running(current).catch(() => null);
  };
  const lifecycleContext = async (releaseId, lease = options.lease) => {
    const binding = await packagedRelease(home, releaseId);
    const repoRoots = [...new Set([binding?.repo, ...(options.repoRoots ?? [])].filter(Boolean))];
    return { home, task: binding?.task ?? 'local-launch', releaseId, repoRoots, lease, binding };
  };
  const after = async (event, result, context) => {
    const eventContext = context ?? await lifecycleContext(result.release);
    await withLifecycleOperation(event, { ...eventContext, releaseId: result.release, cleanup: true }, async held => {
      const live = await running(await readCurrent());
      if (live.release !== result.release || live.pid !== result.pid) throw refusal('The selected program changed before maintenance');
      await options.onAvailable?.(event, { home, lease: held.lease, repoRoots: held.repoRoots,
        releaseId: live.release, result: live });
      return live;
    });
  };
  const change = async (publish = value => value) => {
    const requested = flags.get('--release');
    const releaseId = requested ?? (mode === 'adopt' ? null : (await readCurrent()).releaseId);
    if (!isReleaseId(releaseId)) throw refusal('A valid release is required');
    const operation = await lifecycleContext(releaseId);
    const step = async context => {
      const { binding } = operation;
      const release = read(releaseId);
      if (checking) {
        let started;
        try {
          started = await start(release);
          await stop(started);
        } catch (error) {
          const failed = issueStandaloneAttempt(context, { passed: false, release: release.id, port, error: error.message });
          await registerStandaloneFailure(failed, context).catch(receiptError => {
            process.stderr.write('The failed standalone receipt could not be recorded: ' + receiptError.message + '\n');
          });
          throw error;
        }
        const result = { verified: true, release: release.id, buildId: release.buildId, port, stopped: true };
        const observed = issueStandaloneAttempt(context, { passed: true, result, stoppedProcess: started });
        await completeStandaloneVerification(observed, context);
        return result;
      }
      if (mode === 'adopt') {
        if (fs.existsSync(currentFile)) throw refusal('A managed release is already registered');
        const pid = Number(flags.get('--pid')), info = processInfo(pid);
        verifyRelease(release);
        await probe(release, port);
        if (!/next.+start.+(?:-p|--port)\s+3002/.test(info.CommandLine) || !info.CommandLine.includes('127.0.0.1')) {
          throw refusal('The existing local process does not match');
        }
        const current = { releaseId: release.id, pid, previousId: null, process: info, legacyProcess: true };
        store(current);
        return running(current);
      }
      const current = await readCurrent();
      if (mode === 'stop') { await stop(current); return; }
      if (mode === 'start') {
        const live = await running(current).catch(() => null);
        if (live) return publish(live, context);
        const started = await start(read(current.releaseId), current.previousId);
        store(started);
        return publish(await running(started), context);
      }
      if (mode === 'install' && binding && (!hasObservedStandalone(binding) || binding.closed)) {
        throw refusal('An open candidate must pass standalone verification before installation');
      }
      const target = mode === 'rollback' ? current.previousId : release.id;
      if (!target) throw refusal('No previous release');
      const started = await switchRelease(target, { current, readRelease: read, verify: verifyRelease,
        stop, stopOwned, portFree, inspect: inspectOwned, launch: start, store });
      const result = await running(started);
      if (mode === 'install' && binding) {
        try {
          await registerInstalledRelease(context, { ...result, current: started });
        } catch (error) {
          process.stderr.write('The installed program is running. Its maintenance receipt is pending: ' + error.message + '\n');
        }
      }
      return publish(result, context);
    };
    if (checking) return withLifecycleOperation(mode, { ...operation, cleanup: false }, step);
    return withLifecycleLock(home, mode, lease => step({ ...operation, lease }), operation.lease);
  };
  if (['start', 'install', 'rollback'].includes(mode)) return runAvailabilityEvent(mode, { readRunning, change, after });
  return change();
}

export async function launcherMain(args = process.argv.slice(2)) {
  try {
    const result = await runLauncher(args, { lease: inheritedMaintenanceLease() });
    if (result) console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.code === 'BUSY' ? 2 : 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl && (process.platform === 'win32'
  ? entryUrl.toLowerCase() === import.meta.url.toLowerCase()
  : entryUrl === import.meta.url)) {
  await launcherMain();
}
