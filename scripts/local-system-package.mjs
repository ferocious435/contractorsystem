import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
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
import {
  markPackagePublished, markPackageReady, openPackageStage, packageTree, plainFileHash as fileHash,
  recordPackageStageFailure, resumableCopy,
} from './maintenance/package-staging.mjs';

const scripts = ['local-system-backup.mjs', 'local-system-restore.mjs', 'local-system-launch.mjs',
  'local-system-maintenance.mjs', 'local-system-build.mjs', 'local-system-package.mjs'];
const releaseFiles = ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts', 'postcss.config.mjs'];
const readerBinaries = ['kreuzberg.exe', 'onnxruntime.dll'];
const programScripts = path.dirname(fileURLToPath(import.meta.url));

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
    file.sha256 = hash;
  }
  return files;
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
  let attempt;
  const perform = async (context, reservation) => {
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
    const snapshotFiles = [];
    for (const name of files) snapshotFiles.push({ path: name, sha256: snapshot?.inputs.get(name.toLowerCase()) ?? await fileHash(path.join(source, name)) });
    const copyable = relative => !relative.split('/').some(part => part === 'cache' || part === 'trace');
    const recipe = sha256(JSON.stringify([buildId, output.fingerprint, supplied.fingerprint, sha256(lock), nodeSha256,
      businessRuntime, reader?.fingerprint, snapshotFiles, extras, legacy]));
    attempt = await openPackageStage(context, { releaseId: id, task,
      owner: owner ? { id: owner.id, worktree: owner.worktree } : null, source, dist, recipe });
    if (owner) {
      await updateTask(home, context.lease, { ...owner, candidate: root });
    }
    await nativeArchiveOperation('ensure-directories', { records: [
      path.dirname(dependencyRoot), path.dirname(root), path.dirname(nodeExe), path.dirname(configuration),
    ] });
    const payload = path.join(attempt.stage, 'release');
    if (attempt.status === 'copying') {
      if ((await probePaths([root]))[0] !== 'missing') throw refusal('Release already exists; it will not be overwritten');
      const dependenciesTree = await packageTree(dependenciesInput, 'node_modules');
      if (storeState === 'missing') {
        const basis = path.join(attempt.stage, 'basis');
        await resumableCopy(basis, [dependenciesTree, { source, files: [{ path: 'package-lock.json', sha256: sha256(lock) }] }]);
        if ((await statBytes(path.join(basis, 'node_modules'))).fingerprint !== supplied.fingerprint) {
          throw refusal('The copied dependency basis changed');
        }
        await fs.rename(basis, dependencyRoot);
      }
      const groups = [await packageTree(buildRoot, dist, copyable), { source, files: snapshotFiles },
        ...extras.map(file => ({ source: path.dirname(file.from),
          files: [{ path: path.basename(file.from), output: file.relative, sha256: file.sha256 }] }))];
      if (reader) groups.push(await packageTree(reader.root, reader.relative));
      // The runtime always receives a physical private dependency copy.
      await resumableCopy(payload, [...groups, dependenciesTree], { allowed: ['release.json'] });
      if ((await statBytes(path.join(payload, 'node_modules'))).fingerprint !== supplied.fingerprint) {
        throw refusal('The release dependency copy changed');
      }
      if (reader && (await statBytes(path.join(payload, reader.relative))).fingerprint !== reader.fingerprint) {
        throw refusal('The packaged OCR assets changed');
      }
      const sealed = groups.flatMap(({ prefix, files: inputs }) => inputs.map(input =>
        ({ path: [prefix, input.output ?? input.path].filter(Boolean).join('/'), sha256: input.sha256 })));
      sealed.sort((a, b) => a.path.localeCompare(b.path));
      const release = { version: 1, id, root, dist, buildId, nodeExe, nodeSha256, nodeVersion: process.version,
        codexExe: businessRuntime, dependencyRoot, dependencyLockSha256: sha256(lock), legacyCompiledBuild: legacy,
        files: sealed, createdAt: attempt.startedAt,
        ...(reader ? { ocrAssets: { prefix: reader.relative, fingerprint: reader.fingerprint } } : {}) };
      const manifest = path.join(payload, 'release.json');
      const bytes = JSON.stringify(release, null, 2) + '\n';
      const manifestSha256 = sha256(bytes);
      if ((await probePaths([manifest]))[0] === 'missing') await writeRecords([{ path: manifest, value: bytes }]);
      if (await fileHash(manifest) !== manifestSha256) throw refusal('The staged manifest changed');
      attempt = await markPackageReady(context, attempt, await statBytes(payload), manifestSha256);
    }
    const [rootState, payloadState] = await probePaths([root, payload]);
    if (!((rootState === 'missing' && payloadState === 'plain') || (rootState === 'plain' && payloadState === 'missing'))) {
      throw refusal('The release cannot be uniquely located for publication');
    }
    const prepared = rootState === 'missing' ? payload : root;
    const measured = await statBytes(prepared);
    const manifest = path.join(prepared, 'release.json');
    if (measured.identity !== attempt.payloadIdentity || measured.fingerprint !== attempt.payloadFingerprint ||
        await fileHash(manifest) !== attempt.manifestSha256) throw refusal('The sealed release candidate changed');
    if (nodeState === 'missing') {
      const stagedNode = path.join(attempt.stage, 'runtime.exe');
      if ((await probePaths([stagedNode]))[0] === 'missing') await fs.copyFile(node, stagedNode, constants.COPYFILE_EXCL);
      if (await fileHash(stagedNode) !== nodeSha256) throw refusal('The staged Node runtime differs');
      await fs.rename(stagedNode, nodeExe);
    }
    if (await fileHash(nodeExe) !== nodeSha256) throw refusal('The saved Node runtime differs');
    if (configurationState === 'missing') {
      await fs.copyFile(path.join(repo ?? process.cwd(), '.env.local'), configuration, constants.COPYFILE_EXCL);
    }
    const release = await guardedJson(manifest);
    if (rootState === 'missing') await fs.rename(payload, root);
    const result = { release: id, root, buildId, files: release.files.length, nodeExe, dependencies: dependencyRoot,
      legacyCompiledBuild: legacy, measuredBytes: measured.bytes + extraCopies };
    await registerPackagedRelease(context, managed, result);
    await publishLauncherBundle({ ...context, source: path.join(root, 'scripts'), nodeExe });
    await markPackagePublished(context, attempt);
    return result;
  };
  return withLifecycleOperation('package', { home, lease, task, repoRoots, build: buildRoot, releaseId: id, getFreeBytes },
    (context, reservation) => perform(context, reservation).catch(async error => {
      await recordPackageStageFailure(context, attempt, error).catch(receiptError => {
        process.stderr.write('The staged package failure could not be recorded: ' + receiptError.message + '\n');
      });
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
