import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveName, measureArchiveTargets, nativeArchiveOperation } from './maintenance/archive.mjs';
import { inheritedMaintenanceLease, probePaths, requirePlainPath, resolveMaintenanceHome } from './maintenance/guard.mjs';
import { updateTask } from './maintenance/inventory.mjs';
import {
  activeTask, guardedJson, plainFiles, publishLauncherBundle, registerPackagedRelease, registeredBuild,
  registerPackageFailure, sha256, withLifecycleOperation, writeRecords,
} from './maintenance/lifecycle.mjs';
import { assertNarrowRoot, isBuildName, isReleaseId, pathKey, refusal } from './maintenance/policy.mjs';
import { runLifecycle } from './maintenance/storage.mjs';

const scripts = ['local-system-backup.mjs', 'local-system-restore.mjs', 'local-system-launch.mjs',
  'local-system-maintenance.mjs', 'local-system-build.mjs', 'local-system-package.mjs'];
const releaseFiles = ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts', 'postcss.config.mjs'];
const readerBinaries = ['kreuzberg.exe', 'onnxruntime.dll'];
const programScripts = path.dirname(fileURLToPath(import.meta.url));

async function fileHash(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink !== 1 || pathKey(await fs.realpath(file)) !== pathKey(file)) {
    throw refusal('A package input is not an ordinary file');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function checkedSnapshot(source, dist, checks) {
  const receipt = await guardedJson(checks);
  if (pathKey(receipt.source) !== pathKey(source) || (receipt.dist && receipt.dist !== dist) ||
      receipt.passed === false || receipt.sourceUnchanged !== true || receipt.checks?.length !== 2 ||
      receipt.checks.some(check => check.status !== 0) || !receipt.builtFiles?.length) {
    throw refusal('A verified build is required');
  }
  const inputs = new Map();
  for (const entry of receipt.builtFiles) {
    const name = archiveName(entry.path.replaceAll('\\', '/'));
    if (inputs.has(name.toLowerCase()) || await fileHash(path.join(source, name)) !== entry.sha256) {
      throw refusal('Built source changed: ' + name);
    }
    inputs.set(name.toLowerCase(), entry.sha256);
  }
  return { receipt, inputs };
}

async function verifiedReader(source, checked, build) {
  const code = await fs.readFile(path.join(source, 'src/utils/local-ocr-mcp.ts'), 'utf8');
  const version = code.match(/export const LOCAL_OCR_MCP_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/)?.[1];
  if (!version) throw refusal('Unrecognized local OCR reader version in verified source');
  const relative = 'data/tools/kreuzberg/' + version + '/bin';
  const input = build ? build.ocr : { root: path.join(source, relative), version };
  if (!input || input.version !== version) throw refusal('The checked OCR reader assets are unavailable');
  const [rootState] = await probePaths([input.root]);
  if (rootState !== 'plain') throw refusal('The checked OCR reader assets are unavailable');
  for (const file of readerBinaries) {
    const candidate = path.join(input.root, file);
    if ((await probePaths([candidate]))[0] !== 'plain' || !(await fs.lstat(candidate)).isFile()) {
      throw refusal('Required local OCR reader asset is unavailable: ' + file);
    }
  }
  const [snapshot] = await measureArchiveTargets([input.root]);
  if (!snapshot?.fingerprint || (input.fingerprint && snapshot.fingerprint !== input.fingerprint)) {
    throw refusal('The OCR reader assets changed after build');
  }
  if (!build) {
    for (const name of await plainFiles(input.root)) {
      if (await fileHash(path.join(input.root, name)) !== checked.inputs.get((relative + '/' + name).toLowerCase())) {
        throw refusal('An OCR reader file is absent from the checked snapshot: ' + name);
      }
    }
  }
  return { ...input, relative, fingerprint: snapshot.fingerprint, bytes: snapshot.bytes };
}

async function sourceFiles(source, folder, inputs) {
  const from = path.join(source, folder);
  const [status] = await probePaths([from]);
  if (status === 'missing') return [];
  if (status !== 'plain') throw refusal('An input directory is unsafe: ' + folder);
  const files = (await plainFiles(from)).map(name => folder + '/' + name);
  if (inputs && files.some(name => !inputs.has(name.toLowerCase()))) {
    throw refusal('A package input is absent from the checked snapshot: ' + folder);
  }
  return files;
}

async function selectedScripts(source, inputs, legacy) {
  const scriptRoot = legacy ? programScripts : path.join(source, 'scripts');
  const maintenance = await plainFiles(path.join(scriptRoot, 'maintenance'));
  const names = [...scripts, ...maintenance.map(name => 'maintenance/' + name)];
  const files = names.map(name => ({ from: path.join(scriptRoot, name), relative: 'scripts/' + name }));
  const schema = 'ops/backup-schema.json';
  files.push({ from: legacy ? path.join(programScripts, '..', schema) : path.join(source, schema), relative: schema });
  for (const file of files) {
    const hash = await fileHash(file.from);
    if (!legacy && hash !== inputs.get(file.relative.toLowerCase())) throw refusal('The checked package input is missing or changed: ' + file.relative);
  }
  return files;
}

async function copyFile(root, from, relative, expected) {
  const to = path.join(root, relative);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  if (expected && await fileHash(to) !== expected) throw refusal('A packaged file differs from the checked snapshot: ' + relative);
}

async function statBytes(directory) {
  const [measurement] = await measureArchiveTargets([directory]);
  if (!Number.isSafeInteger(measurement?.bytes) || !measurement.fingerprint) throw refusal('The private package input cannot be safely measured');
  return measurement;
}

function runtimeChoice(codexExe) {
  if (codexExe) return codexExe;
  const where = spawnSync('where.exe', ['codex.exe'], { encoding: 'utf8', windowsHide: true });
  if (where.status !== 0) throw refusal('The existing Codex business runtime was not found');
  return where.stdout.trim().split(/\r?\n/)[0];
}

export async function runPackage({ id, source, dist, dependencies = path.resolve('node_modules'), checks, legacy = false,
  home, repo, taskId, lease, getFreeBytes, nodeExecutable, codexExe }) {
  if (!isReleaseId(id) || !isBuildName(dist)) throw refusal('Invalid release identity or build directory');
  source = assertNarrowRoot(path.resolve(source));
  await requirePlainPath(source);
  home = await resolveMaintenanceHome({ explicitHome: home });
  const root = path.join(home, 'releases', id), buildRoot = path.join(source, dist);
  const managed = legacy ? null : await registeredBuild(home, source, dist);
  const task = taskId ?? managed?.task ?? 'local-package';
  const repoRoots = [managed?.repo ?? repo].filter(Boolean);
  const perform = async (context, reservation) => {
    if ((await probePaths([root]))[0] !== 'missing') throw refusal('Release already exists; it will not be overwritten');
    const snapshot = legacy ? null : await checkedSnapshot(source, dist, path.resolve(checks));
    if (managed && (task !== managed.task || managed.result.passed !== true ||
        pathKey(path.resolve(checks)) !== pathKey(managed.result.receipt) ||
        await fileHash(checks) !== managed.result.receiptSha256)) throw refusal('The package does not match the registered build');
    const reader = legacy ? null : await verifiedReader(source, snapshot, managed);
    const extras = await selectedScripts(source, snapshot?.inputs, legacy);
    const dependenciesInput = await fs.realpath(assertNarrowRoot(path.resolve(dependencies)));
    if (managed && pathKey(dependenciesInput) !== pathKey(snapshot.receipt.dependencyRoot)) {
      throw refusal('Package dependencies do not match the checked build');
    }
    await requirePlainPath(dependenciesInput);
    const supplied = await statBytes(dependenciesInput);
    const lock = await fs.readFile(path.join(source, 'package-lock.json'));
    const dependencyId = legacy ? 'working-a-20261029' : sha256(lock).slice(0, 24);
    const dependencyRoot = path.join(home, 'dependencies', dependencyId), stored = path.join(dependencyRoot, 'node_modules');
    const node = nodeExecutable ?? managed?.runtime?.nodeExe ?? process.execPath;
    const nodeSha256 = await fileHash(node), nodeExe = path.join(home, 'runtime', 'node-' + nodeSha256.slice(0, 16) + '.exe');
    const businessRuntime = runtimeChoice(codexExe);
    const output = await statBytes(buildRoot);
    const idFile = path.join(buildRoot, 'BUILD_ID');
    await requirePlainPath(idFile);
    const buildId = (await fs.readFile(idFile, 'utf8')).trim();
    if (!buildId || (snapshot?.receipt.buildId && snapshot.receipt.buildId !== buildId)) throw refusal('The checked build identifier changed');
    const files = [];
    for (const folder of legacy ? ['public'] : ['public', 'src']) {
      for (const name of await sourceFiles(source, folder, snapshot?.inputs)) files.push(name);
    }
    for (const name of releaseFiles) {
      const [state] = await probePaths([path.join(source, name)]);
      if (state === 'plain' && (!snapshot || snapshot.inputs.has(name.toLowerCase()))) files.push(name);
      else if (state === 'unverified') throw refusal('A package input is unsafe: ' + name);
    }
    const configuration = path.join(home, 'config', 'system.env');
    const [configurationState, storeState] = await probePaths([configuration, stored]);
    if (configurationState === 'unverified' || storeState === 'unverified') throw refusal('Installed configuration or dependencies cannot be verified');
    if (configurationState === 'missing') await requirePlainPath(path.join(repo ?? process.cwd(), '.env.local'));
    if (storeState === 'plain') {
      if (!(await fs.readFile(path.join(dependencyRoot, 'package-lock.json'))).equals(lock) ||
          (await statBytes(stored)).fingerprint !== supplied.fingerprint) throw refusal('The installed package dependencies differ');
    }
    const nodeState = (await probePaths([nodeExe]))[0];
    if (nodeState === 'unverified') throw refusal('The saved Node runtime cannot be verified');
    const extraCopies = (storeState === 'missing' ? supplied.bytes : 0) +
      (nodeState === 'missing' ? (await fs.stat(node)).size : 0);
    const checkedInputs = [...files.map(name => path.join(source, name)), ...extras.map(file => file.from)];
    const size = await Promise.all(checkedInputs.map(async file => (await fs.stat(file)).size));
    const knownBytes = supplied.bytes + output.bytes + extraCopies + (reader?.bytes ?? 0) +
      size.reduce((sum, bytes) => sum + bytes, 0);
    if (knownBytes > reservation.bytes) {
      await runLifecycle('package', { ...context, phase: 'resize', reservation, expectedAdditionalBytes: knownBytes });
    }
    const owner = managed || taskId ? await activeTask(context, task, managed?.repo ?? repo) : null;
    if (owner) {
      await updateTask(home, context.lease, { ...owner, candidate: root });
    }
    await nativeArchiveOperation('ensure-directories', { records: [
      path.dirname(dependencyRoot), path.dirname(root), path.dirname(nodeExe), path.dirname(configuration),
    ] });
    if (storeState === 'missing') {
      const staging = dependencyRoot + '.building-' + Date.now();
      await fs.mkdir(staging);
      await fs.cp(dependenciesInput, path.join(staging, 'node_modules'), { recursive: true });
      if ((await statBytes(path.join(staging, 'node_modules'))).fingerprint !== supplied.fingerprint) {
        throw refusal('The copied dependency basis changed');
      }
      await fs.writeFile(path.join(staging, 'package-lock.json'), lock, { flag: 'wx' });
      await fs.rename(staging, dependencyRoot);
    }
    await fs.mkdir(root);
    await fs.cp(buildRoot, path.join(root, dist), { recursive: true,
      filter: file => !path.relative(buildRoot, file).split(path.sep).some(part => part === 'cache' || part === 'trace') });
    for (const name of files) await copyFile(root, path.join(source, name), name, snapshot?.inputs.get(name.toLowerCase()));
    for (const file of extras) await copyFile(root, file.from, file.relative, snapshot?.inputs.get(file.relative.toLowerCase()));
    if (reader) {
      const destination = path.join(root, reader.relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(reader.root, destination, { recursive: true });
      if ((await statBytes(destination)).fingerprint !== reader.fingerprint) throw refusal('The packaged OCR assets changed');
    }
    // The release always has its own physical dependency copy.
    const privateModules = path.join(root, 'node_modules');
    await fs.cp(stored, privateModules, { recursive: true });
    if ((await statBytes(privateModules)).fingerprint !== supplied.fingerprint) throw refusal('The release dependency copy changed');
    if (nodeState === 'missing') await fs.copyFile(node, nodeExe);
    if (await fileHash(nodeExe) !== nodeSha256) throw refusal('The saved Node runtime differs');
    if (configurationState === 'missing') {
      await fs.copyFile(path.join(repo ?? process.cwd(), '.env.local'), configuration);
    }
    const sealed = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const names = entry.isDirectory()
        ? (await plainFiles(path.join(root, entry.name))).map(name => entry.name + '/' + name) : [entry.name];
      for (const name of names) sealed.push({ path: name, sha256: await fileHash(path.join(root, name)) });
    }
    sealed.sort((a, b) => a.path.localeCompare(b.path));
    const release = { version: 1, id, root, dist, buildId, nodeExe, nodeSha256, nodeVersion: process.version,
      codexExe: businessRuntime, dependencyRoot, dependencyLockSha256: sha256(lock), legacyCompiledBuild: legacy,
      files: sealed, createdAt: new Date().toISOString(),
      ...(reader ? { ocrAssets: { prefix: reader.relative, fingerprint: reader.fingerprint } } : {}) };
    await writeRecords([{ path: path.join(root, 'release.json'), value: release }]);
    const result = { release: id, root, buildId, files: sealed.length, nodeExe, dependencies: dependencyRoot,
      legacyCompiledBuild: legacy, measuredBytes: (await statBytes(root)).bytes + extraCopies };
    await registerPackagedRelease(context, managed, result);
    await publishLauncherBundle({ ...context, source: path.join(root, 'scripts'), nodeExe });
    return result;
  };
  return withLifecycleOperation('package', { home, lease, task, repoRoots, build: buildRoot, releaseId: id, getFreeBytes },
    (context, reservation) => perform(context, reservation).catch(async error => {
      if (managed?.task === task) {
        await registerPackageFailure(context, managed, id, error).catch(receiptError => {
          process.stderr.write('The failed package receipt could not be recorded: ' + receiptError.message + '\n');
        });
      }
      throw error;
    }));
}

export async function packageMain(args = process.argv.slice(2)) {
  const legacy = args.includes('--legacy');
  const flags = new Map();
  args = args.filter(arg => arg !== '--legacy');
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--id', '--source', '--dist', '--dependencies', '--checks', '--task'].includes(name) ||
        !value || flags.has(name)) throw refusal('Invalid package options');
    flags.set(name, value);
  }
  const result = await runPackage({ id: flags.get('--id'), source: flags.get('--source') ?? process.cwd(),
    dist: flags.get('--dist'), dependencies: flags.get('--dependencies'), checks: flags.get('--checks'),
    taskId: flags.get('--task'), legacy, lease: inheritedMaintenanceLease() });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && pathKey(path.resolve(process.argv[1])) === pathKey(fileURLToPath(import.meta.url))) {
  await packageMain().catch(error => {
    console.error(error.message);
    process.exitCode = error.code === 'BUSY' ? 2 : 1;
  });
}
