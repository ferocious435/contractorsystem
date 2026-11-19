import { spawnSync } from 'node:child_process';
import { constants as filesystem } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { archiveName, measureArchiveTargets, nativeArchiveOperation } from './maintenance/archive.mjs';
import { inheritedMaintenanceLease, probePaths, requirePlainPath, resolveMaintenanceHome } from './maintenance/guard.mjs';
import { updateTask } from './maintenance/inventory.mjs';
import {
  activeTask, beginBuildEvidence, finishBuildEvidence, guardedJson, measuredBytes, plainFiles, readRecords,
  registerBuildResult, registeredBuild, sha256, withLifecycleOperation, writeRecords,
} from './maintenance/lifecycle.mjs';
import { assertNarrowRoot, isBuildName, pathInMaintenanceHome, pathKey, refusal, relativeWithin } from './maintenance/policy.mjs';
import { captureGeneratedBuild } from './maintenance/storage.mjs';

async function byteHash(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink !== 1 || pathKey(await fs.realpath(file)) !== pathKey(file)) {
    throw refusal('A verified input is not an ordinary file');
  }
  return sha256(await fs.readFile(file));
}

const filePath = (root, name) => path.join(root, archiveName(name.replaceAll('\\', '/')));

async function buildInputs(repo, receipt, dist) {
  if (!Array.isArray(receipt.files) || !receipt.files.length) throw refusal('The source check has no input manifest');
  const inputs = new Map();
  for (const item of receipt.files) {
    const name = archiveName(item.path.replaceAll('\\', '/'));
    const first = name.split('/')[0].toLowerCase();
    if (inputs.has(name.toLowerCase()) || first === 'node_modules' || first === '.superpowers' || first === '.git' ||
        first.startsWith('.env') || isBuildName(first) || first === dist.toLowerCase() ||
        !/^[a-f0-9]{64}$/.test(item.sha256)) throw refusal('The source check lists an unsafe input');
    inputs.set(name.toLowerCase(), { path: name, sha256: item.sha256 });
  }
  const files = ['ops/backup-schema.json', 'scripts/local-system-backup.mjs', 'scripts/local-system-restore.mjs',
    'scripts/local-system-launch.mjs', 'scripts/local-system-build.mjs', 'scripts/local-system-package.mjs',
    'scripts/local-system-maintenance.mjs'];
  if ((await probePaths([path.join(repo, 'scripts', 'maintenance')]))[0] === 'plain') {
    files.push(...(await plainFiles(path.join(repo, 'scripts', 'maintenance'))).map(file => 'scripts/maintenance/' + file));
  }
  const additional = files.filter(file => !inputs.has(file.toLowerCase()));
  const states = await probePaths(additional.map(file => filePath(repo, file)));
  for (const [index, file] of additional.entries()) {
    if (states[index] === 'unverified') throw refusal('A packaging input cannot be verified: ' + file);
    if (states[index] === 'plain') inputs.set(file.toLowerCase(), { path: file, sha256: await byteHash(filePath(repo, file)) });
  }
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) {
    if (!inputs.has(name)) throw refusal('The source check omits a required build input');
  }
  return [...inputs.values()];
}

async function checkFiles(root, files) {
  for (const item of files) {
    const file = filePath(root, item.path);
    if (await byteHash(file) !== item.sha256) throw refusal('Verified source changed: ' + item.path);
  }
}

async function copyInputs(repo, source, files) {
  const directories = new Set([source]);
  for (const item of files) {
    const from = filePath(repo, item.path), to = filePath(source, item.path);
    if (!directories.has(path.dirname(to))) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      directories.add(path.dirname(to));
    }
    const bytes = await fs.readFile(from);
    if (sha256(bytes) !== item.sha256) throw refusal('Verified source changed: ' + item.path);
    await fs.writeFile(to, bytes, { flag: 'wx' });
  }
}

async function installedBuildRuntime(home, modules) {
  try {
    const pointer = await guardedJson(path.join(home, 'current.json'));
    if (!/^[a-z0-9-]{1,90}$/.test(pointer.releaseId)) return null;
    const manifest = await guardedJson(path.join(home, 'releases', pointer.releaseId, 'release.json'));
    const nodeExe = pathInMaintenanceHome(home, manifest.nodeExe);
    if (manifest.id !== pointer.releaseId || pathKey(path.dirname(nodeExe)) !== pathKey(path.join(home, 'runtime')) ||
        pathKey(path.dirname(path.dirname(modules))) !== pathKey(path.join(home, 'dependencies'))) return null;
    const [node, [deps]] = await Promise.all([
      nativeArchiveOperation('hash-file', { target: nodeExe }), measureArchiveTargets([modules]),
    ]);
    if (!deps?.fingerprint || !node?.sha256 || manifest.nodeSha256 !== node.sha256 || node.size <= 0) return null;
    return { nodeExe, nodeSha256: node.sha256, nodeSize: node.size, dependencyRoot: modules,
      dependencyFingerprint: deps.fingerprint, dependencyBytes: deps.bytes };
  } catch {
    return null;
  }
}

async function ocrInput(repo) {
  const file = path.join(repo, 'src/utils/local-ocr-mcp.ts');
  if ((await probePaths([file]))[0] !== 'plain') return null;
  const version = (await fs.readFile(file, 'utf8')).match(/export const LOCAL_OCR_MCP_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/)?.[1];
  if (!version) return null;
  const root = path.join(repo, 'data', 'tools', 'kreuzberg', version, 'bin');
  if ((await probePaths([root]))[0] !== 'plain') return null;
  const [snapshot] = await measureArchiveTargets([root]);
  return snapshot?.fingerprint ? { root, version, fingerprint: snapshot.fingerprint } : null;
}

async function checkDependencies(home, receipt, lockFile) {
  const modules = pathInMaintenanceHome(home, receipt.dependencyRoot);
  if (path.basename(modules) !== 'node_modules' ||
      pathKey(path.dirname(path.dirname(modules))) !== pathKey(path.join(home, 'dependencies'))) {
    throw refusal('Typecheck dependencies do not come from the installed dependency store');
  }
  const lock = await fs.readFile(lockFile);
  if (!lock.equals(await fs.readFile(path.join(path.dirname(modules), 'package-lock.json')))) {
    throw refusal('The checked dependency lock does not match the installed dependency lock');
  }
  const next = path.join(modules, 'next', 'dist', 'bin', 'next');
  await requirePlainPath(next);
  const expected = JSON.parse(lock).packages?.['node_modules/next']?.version;
  const present = JSON.parse(await fs.readFile(path.join(modules, 'next', 'package.json'))).version;
  if (!expected || expected !== present) throw refusal('The installed Next version differs from the checked lock');
  return { modules, next };
}

function cleanBuildEnvironment(homeConfig, dist) {
  const env = { ...process.env, ...homeConfig, CONTRACTOR_NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_OPTIONS|NODE_PATH|CONTRACTOR_MAINTENANCE_LEASE)$/i.test(key)) delete env[key];
  }
  return env;
}

export async function runBuild({ repo = process.cwd(), taskId, verifiedReceipt, dist, outputRoot,
  home, lease, getFreeBytes, receiptLabel = taskId }) {
  repo = assertNarrowRoot(path.resolve(repo));
  outputRoot = assertNarrowRoot(path.resolve(outputRoot));
  verifiedReceipt = assertNarrowRoot(path.resolve(verifiedReceipt));
  const location = relativeWithin(repo, outputRoot)?.split(path.sep);
  if (location?.length !== 2 || location[0] !== '.superpowers' ||
      !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(location[1]) || !isBuildName(dist) ||
      !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(taskId ?? '') ||
      !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(receiptLabel ?? '')) throw refusal('Invalid task, output folder or build directory');
  await requirePlainPath(repo);
  home = await resolveMaintenanceHome({ explicitHome: home });
  const stem = Date.now() + '-' + receiptLabel.toLowerCase().replaceAll('_', '-');
  const source = path.join(outputRoot, 'build-' + stem), target = path.join(source, dist);
  return withLifecycleOperation('build', { home, task: taskId, build: target, repoRoots: [repo],
    lease, writeRoots: [repo], getFreeBytes }, async context => {
    const task = await activeTask(context, taskId, repo);
    const [verifiedBytes] = await readRecords([verifiedReceipt]);
    const verified = JSON.parse(verifiedBytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (verified.status !== 0 || verified.sourceUnchanged !== true) throw refusal('A successful unchanged typecheck receipt is required');
    const files = await buildInputs(repo, verified, dist);
    await checkFiles(repo, files);
    const { modules, next } = await checkDependencies(home, verified, path.join(repo, 'package-lock.json'));
    const runtime = await installedBuildRuntime(home, modules);
    const ocr = await ocrInput(repo);
    await nativeArchiveOperation('ensure-directories', { records: [path.dirname(outputRoot), outputRoot] });
    await updateTask(home, context.lease, { ...task, build: target, detachedBuild: null });
    const nextSha256 = await byteHash(next);
    const typecheckSha256 = sha256(verifiedBytes);
    const key = await beginBuildEvidence(context, { source, dist, repo, task: taskId, typecheck: verifiedReceipt,
      typecheckSha256, ocr, runtime, nextSha256 });

    await fs.mkdir(source);
    await copyInputs(repo, source, files);
    await fs.symlink(modules, path.join(source, 'node_modules'), 'junction');
    const tsfile = path.join(source, 'tsconfig.json');
    const ts = JSON.parse(await fs.readFile(tsfile, 'utf8'));
    ts.include = ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', 'src/**/*.mts', dist + '/types/**/*.ts'];
    await fs.writeFile(tsfile, JSON.stringify(ts, null, 2));
    const builtFiles = await Promise.all(files.map(async item =>
      ({ path: item.path, sha256: await byteHash(filePath(source, item.path)) })));
    const require = createRequire(path.join(source, 'package.json'));
    const config = await fs.readFile(path.join(home, 'config', 'system.env'));
    const env = cleanBuildEnvironment(require('dotenv').parse(config), dist);
    await fs.mkdir(target);
    const [empty] = runtime ? await measureArchiveTargets([target]) : [];
    if (empty && (empty.files !== 0 || !empty.identity || (await fs.readdir(target)).length)) {
      throw refusal('The managed Next output was not empty before build');
    }
    const executedNode = runtime?.nodeExe ?? process.execPath;
    const log = path.join(outputRoot, stem + '-production.log');
    const descriptor = await fs.open(log, 'wx', 0o600);
    let execution;
    try {
      execution = spawnSync(executedNode, [next, 'build'], { cwd: source, env,
        stdio: ['ignore', descriptor.fd, descriptor.fd], windowsHide: true });
    } finally {
      await descriptor.close();
    }
    await checkFiles(repo, files);
    await checkFiles(source, builtFiles);
    const passed = execution.status === 0;
    const receipt = path.join(outputRoot, stem + '-build-checks.json');
    const savedTypecheck = pathKey(path.dirname(verifiedReceipt)) === pathKey(outputRoot) ? verifiedReceipt :
      path.join(outputRoot, stem + '-typecheck.json');
    if (savedTypecheck !== verifiedReceipt) {
      await fs.copyFile(verifiedReceipt, savedTypecheck, filesystem.COPYFILE_EXCL);
    }
    if (await byteHash(savedTypecheck) !== typecheckSha256) throw refusal('The typecheck receipt changed during build');
    const checks = [{ name: 'typecheck', status: 0, receipt: path.basename(savedTypecheck) },
      { name: 'production', status: execution.status }];
    const result = { at: new Date().toISOString(), source, dist, files: builtFiles, builtFiles, sourceUnchanged: true,
      dependencyRoot: modules, checks, log, passed };
    if (passed) {
      result.buildId = (await fs.readFile(path.join(target, 'BUILD_ID'), 'utf8')).trim();
      if (!result.buildId) throw refusal('The build has no identifier');
    }
    let managed = false;
    if (passed && empty && runtime) {
      try {
        const generated = await captureGeneratedBuild({ ...context, source, dist, nodeExe: runtime.nodeExe });
        const captured = await guardedJson(generated.path);
        const sameEnvironment = config.equals(await fs.readFile(path.join(home, 'config', 'system.env')));
        if (empty.identity === captured.identity && captured.basis?.dependencyFingerprint === runtime.dependencyFingerprint &&
            captured.basis.nodeSha256 === runtime.nodeSha256 && sameEnvironment &&
            nextSha256 === await byteHash(next)) {
          result.generatedDist = generated;
          managed = true;
        }
      } catch { /* A build with uncertain derivation is still preserved in full. */ }
    }
    await writeRecords([{ path: receipt, value: result }]);
    const generated = result.generatedDist;
    await finishBuildEvidence(context, key, { receipt, log, logSha256: await byteHash(log),
      buildId: result.buildId ?? null, passed, generated,
      receiptSha256: await byteHash(receipt), execution: { nodeExe: executedNode, next, argv: ['build'], startedEmpty: managed,
        distIdentity: empty?.identity ?? null }, typecheck: savedTypecheck });
    const build = await registeredBuild(home, source, dist);
    if (passed) await registerBuildResult(context, { ...build, typecheck: savedTypecheck });
    const outputBytes = await measuredBytes(target);
    const sourceBytes = await Promise.all([...builtFiles.map(file => filePath(source, file.path)), log, receipt]
      .map(async file => (await fs.stat(file)).size));
    return { ...result, receipt, measuredBytes: outputBytes === undefined ? undefined :
      outputBytes + sourceBytes.reduce((sum, bytes) => sum + bytes, 0) };
  });
}

export async function buildMain(args = process.argv.slice(2), { receiptLabel } = {}) {
  if (args[0] === '--npm-build' && process.platform !== 'win32') {
    const next = createRequire(path.join(process.cwd(), 'package.json')).resolve('next/dist/bin/next');
    const result = spawnSync(process.execPath, [next, 'build', ...args.slice(1)], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  if (args[0] === '--npm-build') args = args.slice(1);
  const parameters = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--task', '--checks', '--dist', '--output'].includes(name) || !value || parameters.has(name)) throw refusal('Invalid build options');
    parameters.set(name, value);
  }
  if (parameters.size !== 4) throw refusal('Use --task, --checks, --dist and --output for a checked local build');
  const result = await runBuild({ taskId: parameters.get('--task'), verifiedReceipt: parameters.get('--checks'),
    dist: parameters.get('--dist'), outputRoot: parameters.get('--output'), lease: inheritedMaintenanceLease(),
    receiptLabel });
  const tail = (await fs.readFile(result.log, 'utf8')).split(/\r?\n/).slice(-12).join('\n');
  if (tail) console.log(tail);
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks, sourceInputs: result.builtFiles.length,
    receipt: result.receipt, ...(result.passed ? { buildId: result.buildId } : {}) }));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && pathKey(path.resolve(process.argv[1])) === pathKey(fileURLToPath(import.meta.url))) {
  await buildMain().catch(error => {
    console.error(error.message);
    process.exitCode = error.code === 'BUSY' ? 2 : 1;
  });
}
