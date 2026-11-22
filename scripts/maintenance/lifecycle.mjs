import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { consumeStandaloneAttempt } from '../local-system-launch.mjs';
import { archiveName, measureArchiveTargets, nativeArchiveOperation, readGuardedRecords } from './archive.mjs';
import { probePaths, requireHeldLease, withLifecycleLock } from './guard.mjs';
import { readTask, updateTask } from './inventory.mjs';
import { closePackageStage } from './package-staging.mjs';
import { assertNarrowRoot, isBuildName, isReleaseId, pathKey, refusal, relativeWithin } from './policy.mjs';
import { registerLifecycleEvidence, runLifecycle } from './storage.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readRecords(files, pinnedTarget = null) {
  const records = await readGuardedRecords(files, pinnedTarget);
  return files.map(file => {
    const bytes = records.get(file);
    if (!bytes) throw refusal('A required verified input is missing: ' + path.basename(file));
    return bytes;
  });
}

export async function guardedJson(file) {
  const [bytes] = await readRecords([file]);
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

export async function writeRecords(writes) {
  return nativeArchiveOperation('write', { writes: writes.map(({ path: file, value, overwrite = false }) => ({
    path: file,
    data: typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    overwrite,
  })) });
}

export async function withLifecycleOperation(event, context, run) {
  return withLifecycleLock(context.home, event, async lease => {
    const options = { ...context, home: lease.home, lease };
    const reservation = await runLifecycle(event, options);
    let result, passed = false;
    try {
      result = await run(options, reservation);
      passed = result?.passed !== false;
      return result;
    } finally {
      await runLifecycle(event, { ...options, phase: 'finish', reservation,
        passed, measuredBytes: result?.measuredBytes }).catch(error => {
        process.stderr.write('Maintenance receipt could not be recorded: ' + error.message + '\n');
      });
    }
  }, context.lease);
}

export async function activeTask(context, taskId, repo) {
  await requireHeldLease(context.home, context.lease);
  const task = await readTask(context.home, taskId);
  if (!task || task.status !== 'active' || (repo && pathKey(task.worktree) !== pathKey(repo))) {
    throw refusal('Register an active task for this worktree before building or packaging');
  }
  return task;
}

function evidenceFile(home, kind, id) {
  return path.join(home, 'maintenance-state', 'lifecycle-artifacts', kind + '-' + id + '.json');
}

async function optionalJson(file) {
  const [status] = await probePaths([file]);
  if (status === 'missing') return null;
  if (status !== 'plain') throw refusal('The lifecycle evidence file is unsafe');
  return guardedJson(file);
}

const sealFile = home => path.join(home, 'maintenance-state', 'lifecycle-seal.json');

function artifactDigest(key, file, value) {
  if (!/^[a-f0-9]{64}$/.test(key ?? '')) throw refusal('The managed lifecycle seal is invalid');
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update(JSON.stringify([pathKey(file), value])).digest();
}

async function readArtifact(home, file) {
  const [state, keyState] = await probePaths([file, sealFile(home)]);
  if (state === 'missing') return null;
  if (state !== 'plain' || keyState !== 'plain') throw refusal('The managed lifecycle evidence cannot be verified');
  const [bytes, keyBytes] = await readRecords([file, sealFile(home)]);
  const { seal, ...value } = JSON.parse(bytes);
  if (!/^[a-f0-9]{64}$/.test(seal ?? '') ||
      !timingSafeEqual(Buffer.from(seal, 'hex'), artifactDigest(JSON.parse(keyBytes).key, file, value))) {
    throw refusal('The managed lifecycle evidence has changed');
  }
  return value;
}

async function writeArtifact(context, kind, id, value, overwrite = false) {
  const file = evidenceFile(context.home, kind, id);
  await requireHeldLease(context.home, context.lease);
  await nativeArchiveOperation('ensure-directories', { records: [path.dirname(file)] });
  const keyFile = sealFile(context.home);
  let secret = await optionalJson(keyFile);
  if (!secret) {
    secret = { key: randomBytes(32).toString('hex') };
    await writeRecords([{ path: keyFile, value: secret }]);
  }
  const seal = artifactDigest(secret.key, file, value).toString('hex');
  await writeRecords([{ path: file, value: { ...value, seal }, overwrite }]);
  return file;
}

function buildKey(source, dist) {
  return sha256(pathKey(path.join(source, dist)));
}

// This state is issued before the output exists. A build receipt or a late capture
// alone never gives storage permission to omit cache bytes.
export async function beginBuildEvidence(context, build) {
  const key = buildKey(build.source, build.dist);
  if ((await probePaths([build.source, path.join(build.source, build.dist)])).some(state => state !== 'missing')) {
    throw refusal('A managed build needs a new empty snapshot');
  }
  const state = { version: 1, ...build, startedAt: new Date().toISOString(), leaseToken: context.lease.token };
  await writeArtifact(context, 'build', key, state);
  return key;
}

export async function finishBuildEvidence(context, key, result) {
  await requireHeldLease(context.home, context.lease);
  const file = evidenceFile(context.home, 'build', key);
  const state = await readArtifact(context.home, file);
  if (state?.leaseToken !== context.lease.token || state.result ||
      key !== buildKey(state.source, state.dist)) throw refusal('The build is not the reserved execution');
  await writeArtifact(context, 'build', key, { ...state, result }, true);
}

export async function registeredBuild(home, source, dist) {
  const state = await readArtifact(home, evidenceFile(home, 'build', buildKey(source, dist)));
  if (state?.version !== 1 || !state.result || pathKey(state.source) !== pathKey(source) || state.dist !== dist) return null;
  return state;
}

async function evidence(files) {
  files = [...new Set(files)];
  const hashes = await readRecords(files);
  return files.map((file, index) => ({ path: file, bytes: hashes[index].length, sha256: sha256(hashes[index]) }));
}

async function lifecycleEvidence(context, build, release) {
  const file = build?.result.receipt;
  const actionFiles = release ? Object.values(release.actions).flatMap(action => [action.receipt, action.stdout, action.stderr]) : [];
  const buildFiles = file ? [file, build.result.typecheck, build.result.log, ...(build.result.generated ? [build.result.generated.path] : [])] : [];
  const actions = name => release.actions[name] ? [{ evidence: release.actions[name].receipt }] : [];
  const index = {
    version: 1,
    builds: file ? [{ receipt: { evidence: file } }] : [],
    releases: release ? [{ id: release.id, buildReceipts: file ? [file] : [],
      packageReceipts: actions('package'), verificationReceipts: actions('verify'),
      installationReceipts: actions('install') }] : [],
    evidence: await evidence([...buildFiles, ...actionFiles]),
  };
  return registerLifecycleEvidence(index, { ...context, repoRoots: [build?.repo ?? release.repo, ...(context.repoRoots ?? [])] });
}

export async function registerBuildResult(context, build) {
  return lifecycleEvidence(context, build);
}

async function recordAction(outputRoot, action, result) {
  const stem = path.join(outputRoot, result.release + '-' + action + '-' + Date.now() + '-' + process.pid);
  const stdout = stem + '.stdout.log', stderr = stem + '.stderr.log', receipt = stem + '.json';
  const value = { at: new Date().toISOString(), action, release: result.release, buildId: result.buildId,
    passed: result.passed !== false, profileUnchanged: true, stdout, stderr,
    ...(result.current ? { current: result.current } : {}) };
  await writeRecords([
    { path: stdout, value: JSON.stringify(result) + '\n' }, { path: stderr, value: '' }, { path: receipt, value },
  ]);
  return { receipt, stdout, stderr, evidence: await evidence([receipt, stdout, stderr]) };
}

export async function packagedRelease(home, id, pinnedTarget = null) {
  if (!isReleaseId(id)) throw refusal('Invalid release identity');
  const state = await readArtifact(home, evidenceFile(home, 'release', id));
  if (!state) return null;
  if (state.version !== 1 || state.id !== id || !state.actions?.package || !state.repo) {
    throw refusal('The packaged release evidence is malformed');
  }
  const manifest = path.join(home, 'releases', id, 'release.json');
  const [bytes] = await readRecords([manifest], pinnedTarget);
  if (sha256(bytes) !== state.manifestSha256 || JSON.parse(bytes.toString('utf8')).buildId !== state.buildId) {
    throw refusal('The candidate manifest changed after packaging');
  }
  return state;
}

export async function registerPackagedRelease(context, build, result) {
  if (!build) return;
  const manifest = path.join(context.home, 'releases', result.release, 'release.json');
  const [bytes] = await readRecords([manifest]);
  const existing = await packagedRelease(context.home, result.release);
  if (existing) {
    if (existing.manifestSha256 !== sha256(bytes) || existing.buildId !== result.buildId ||
        existing.task !== build.task || pathKey(existing.source) !== pathKey(build.source) || existing.dist !== build.dist) {
      throw refusal('The existing package evidence belongs to a different release');
    }
    return lifecycleEvidence(context, build, existing);
  }
  const packaged = { version: 1, id: result.release, buildId: result.buildId, repo: build.repo,
    source: build.source, dist: build.dist, task: build.task, manifestSha256: sha256(bytes),
    actions: { package: await recordAction(path.dirname(build.result.receipt), 'package', { ...result, managedTask: build.task }) } };
  await writeArtifact(context, 'release', packaged.id, packaged);
  return lifecycleEvidence(context, build, packaged);
}

export async function completeStandaloneVerification(attempt, context) {
  const { result, stoppedProcess } = consumeStandaloneAttempt(attempt, context, true);
  await requireHeldLease(context.home, context.lease);
  const release = await packagedRelease(context.home, result.release);
  if (!release) return null; // Pre-existing immutable release; no managed build to release.
  const build = await registeredBuild(context.home, release.source, release.dist);
  if (!build || result.buildId !== release.buildId || build.result.buildId !== result.buildId) {
    throw refusal('The standalone result does not match its package and build');
  }
  const target = path.join(build.source, build.dist);
  if (!hasObservedStandalone(release)) {
    release.actions.verify = await recordAction(path.dirname(build.result.receipt), 'verify', { ...result, managedTask: build.task });
    release.observationVersion = 2;
    release.observedStandalone = stoppedProcess;
    await writeArtifact(context, 'release', release.id, release, true);
  }
  const repos = [...new Set([release.repo, ...(context.repoRoots ?? [])])];
  const [targetState] = await probePaths([target]);
  if (targetState === 'missing') return null;
  if (targetState !== 'plain') throw refusal('The source build cannot be verified');
  await lifecycleEvidence({ ...context, repoRoots: repos }, build, release);
  const task = await readTask(context.home, build.task);
  if (task?.build && pathKey(task.build) === pathKey(target)) {
    await updateTask(context.home, context.lease, { ...task, build: null, detachedBuild: target });
  }
  const reservation = await runLifecycle('verify', { ...context, repoRoots: repos, task: build.task, target, cleanup: true });
  await runLifecycle('verify', { ...context, task: build.task, phase: 'finish', reservation, passed: true });
  return reservation.cleanup;
}

export async function registerInstalledRelease(context, result) {
  const release = await packagedRelease(context.home, result.release);
  if (!release) return null;
  const build = await registeredBuild(context.home, release.source, release.dist);
  if (!build || result.running !== true || result.buildId !== release.buildId || result.current?.releaseId !== release.id ||
      !hasObservedStandalone(release)) throw refusal('The installed release has not passed standalone verification');
  release.actions.install = await recordAction(path.dirname(build.result.receipt), 'install', result);
  await writeArtifact(context, 'release', release.id, release, true);
  return lifecycleEvidence(context, build, release);
}

export async function registerStandaloneFailure(attempt, context) {
  const { release: releaseId, port, error } = consumeStandaloneAttempt(attempt, context, false);
  const release = await packagedRelease(context.home, releaseId);
  if (!release || release.closed) return;
  const build = await registeredBuild(context.home, release.source, release.dist);
  if (!build || build.task !== release.task) return;
  release.actions.failedVerify = await recordAction(path.dirname(build.result.receipt), 'verify-failed', {
    release: releaseId, buildId: release.buildId, port, passed: false, error,
  });
  await writeArtifact(context, 'release', release.id, release, true);
}

const closingResults = ['superseded', 'rejected', 'unused'];

export function hasObservedStandalone(release) {
  return release?.observationVersion === 2 && Boolean(release.observedStandalone && release.actions?.verify);
}

export async function observedStandaloneBinding(home, releaseId, pinnedTarget) {
  const release = await packagedRelease(home, releaseId, pinnedTarget);
  if (!hasObservedStandalone(release)) return null;
  const build = await registeredBuild(home, release.source, release.dist);
  if (!build || build.result.buildId !== release.buildId || build.task !== release.task) return null;
  return {
    verify: release.actions.verify.evidence, package: release.actions.package.evidence,
    build: { path: build.result.receipt, sha256: build.result.receiptSha256 },
  };
}

async function checkedAction(action, name, release, passed) {
  if (action?.evidence?.length !== 3) throw refusal('A signed candidate receipt is missing');
  const paths = [action.receipt, action.stdout, action.stderr];
  const bytes = await readRecords(paths);
  if (paths.some((file, index) => pathKey(file) !== pathKey(action.evidence[index].path) ||
      bytes[index].length !== action.evidence[index].bytes || sha256(bytes[index]) !== action.evidence[index].sha256)) {
    throw refusal('A signed candidate receipt changed');
  }
  const receipt = JSON.parse(bytes[0]), result = JSON.parse(bytes[1]);
  if (receipt.action !== name || receipt.passed !== passed || result.release !== release.id ||
      result.buildId !== release.buildId || receipt.release !== release.id || receipt.buildId !== release.buildId ||
      !Number.isFinite(Date.parse(receipt.at))) throw refusal('The candidate receipt does not match its package');
  return { receipt, result, evidence: action.evidence };
}

async function candidateOutcome(release) {
  const packaged = await checkedAction(release.actions.package, 'package', release, true);
  if (hasObservedStandalone(release)) {
    const attempt = await checkedAction(release.actions.verify, 'verify', release, true);
    if (attempt.result.verified !== true || attempt.result.stopped !== true) {
      throw refusal('The standalone receipt does not confirm the candidate');
    }
    return { at: attempt.receipt.at, passed: true, evidence: [...packaged.evidence, ...attempt.evidence] };
  }
  if (!release.actions.failedVerify) throw refusal('A recorded standalone attempt is required');
  const attempt = await checkedAction(release.actions.failedVerify, 'verify-failed', release, false);
  if (attempt.result.passed !== false) throw refusal('The failed standalone attempt is not proven');
  return { at: attempt.receipt.at, passed: false, evidence: [...packaged.evidence, ...attempt.evidence] };
}

export async function closeManagedCandidate({ home, lease, taskId, releaseId, result, source, dist }) {
  if (!closingResults.includes(result)) throw refusal('Choose superseded, rejected or unused as the candidate result');
  home = await requireHeldLease(home, lease);
  const task = await readTask(home, taskId);
  if (source !== undefined || dist !== undefined) {
    return closePackageStage({ home, lease }, { taskId, releaseId, source, dist, result, task });
  }
  if (task?.status !== 'closed') throw refusal('A closed task is required to close a candidate');
  const release = await packagedRelease(home, releaseId);
  if (!release) return closePackageStage({ home, lease }, { taskId, releaseId, result, task });
  if (!release || release.task !== taskId || pathKey(release.repo) !== pathKey(task.worktree) || release.actions.install) {
    throw refusal('The uninstalled candidate does not belong to the closed task');
  }
  const outcome = await candidateOutcome(release);
  const build = await registeredBuild(home, release.source, release.dist);
  if (!build || build.task !== taskId || build.result.buildId !== release.buildId) {
    throw refusal('The build of the managed candidate cannot be verified');
  }
  if (release.closed && release.closed.result !== result) throw refusal('The candidate already has a different conclusion');
  if (!release.closed) {
    const receipt = await recordAction(path.dirname(build.result.receipt), 'close', {
      release: release.id, buildId: release.buildId, task: taskId, conclusion: result,
    });
    release.closed = { taskId, result, receipt };
    await writeArtifact({ home, lease }, 'release', release.id, release, true);
  }
  let updated = task;
  if (!outcome.passed) {
    if (!build.closed) {
      build.failedStandalone = { id: release.id, package: release.actions.package, failure: release.actions.failedVerify };
    }
    await buildFailure(build);
    updated = await concludeBuild({ home, lease }, task, build, build.closed?.result ?? result);
  }
  await updateTask(home, lease, { ...updated,
    closedCandidates: [...new Set([...(updated.closedCandidates ?? []), release.id])] });
  return { task: taskId, release: release.id, result };
}

export async function verifiedCandidateClosure(home, manifest, task, pinnedTarget) {
  const release = await packagedRelease(home, manifest.id, pinnedTarget);
  if (!release || release.closed?.taskId !== task.id || release.task !== task.id || release.actions.install ||
      pathKey(release.repo) !== pathKey(task.worktree) || !closingResults.includes(release.closed.result)) return null;
  const closure = await checkedAction(release.closed.receipt, 'close', release, true);
  if (closure.result.task !== task.id || closure.result.conclusion !== release.closed.result) return null;
  const outcome = await candidateOutcome(release);
  const build = await registeredBuild(home, release.source, release.dist);
  if (!build || build.task !== task.id || build.result.buildId !== manifest.buildId) return null;
  const { records: buildEvidence } = await managedBuildEvidence(build);
  return {
    closedAt: closure.receipt.at, evidence: [...outcome.evidence, ...closure.evidence, ...buildEvidence],
  };
}

async function managedBuildEvidence(build) {
  const files = [build.result.receipt, build.result.typecheck, build.result.log];
  const bytes = await readRecords(files);
  const hashes = [build.result.receiptSha256, build.typecheckSha256, build.result.logSha256];
  const records = files.map((file, index) => ({ path: file, bytes: bytes[index].length, sha256: sha256(bytes[index]) }));
  if (records.some((file, index) => file.sha256 !== hashes[index])) throw refusal('The signed build diagnosis has changed');
  const receipt = JSON.parse(bytes[0]);
  if (pathKey(receipt.source) !== pathKey(build.source) || receipt.dist !== build.dist ||
      (receipt.buildId ?? null) !== build.result.buildId || receipt.passed !== build.result.passed ||
      !Array.isArray(receipt.builtFiles) || !receipt.builtFiles.length) throw refusal('The signed build receipt does not match');
  const expectedFiles = Object.create(null);
  for (const input of receipt.builtFiles) {
    const relative = archiveName(input.path.replaceAll('\\', '/'));
    if (Object.hasOwn(expectedFiles, relative) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw refusal('Invalid checked inputs');
    expectedFiles[relative] = input.sha256;
  }
  return { records, receipt, expectedFiles };
}

export async function registerPackageFailure(context, build, releaseId, error) {
  const admitted = await activeTask(context, build.task, build.repo);
  const current = await registeredBuild(context.home, build.source, build.dist);
  if (admitted.id !== current?.task || current.closed || current.result.passed !== true ||
      current.result.receiptSha256 !== build.result.receiptSha256 || await packagedRelease(context.home, releaseId)) return;
  const failure = await recordAction(path.dirname(current.result.receipt), 'package-failed', {
    release: releaseId, buildId: current.result.buildId, passed: false, error: error.message,
  });
  current.failedPackage = { id: releaseId, failure };
  await writeArtifact(context, 'build', buildKey(current.source, current.dist), current, true);
}

function validateManagedSource(source, worktree) {
  source = assertNarrowRoot(source);
  const parts = relativeWithin(worktree, source)?.split(path.sep);
  if (parts?.length !== 3 || parts[0] !== '.superpowers' || !/^[a-z0-9][a-z0-9_-]{0,89}$/i.test(parts[1]) ||
      !/^build-[0-9]+-[a-z0-9][a-z0-9-]*$/i.test(parts[2])) {
    throw refusal('The source must be the exact managed snapshot of this task');
  }
  return source;
}

async function buildFailure(build) {
  const proof = await managedBuildEvidence(build);
  if (build.result.passed === false && proof.receipt.checks?.some(check => check.name === 'production' && check.status !== 0) &&
      Number.isFinite(Date.parse(proof.receipt.at))) return { ...proof, at: proof.receipt.at };
  if (build.failedStandalone) {
    const attempt = build.failedStandalone;
    const release = { id: attempt.id, buildId: build.result.buildId };
    const packaged = await checkedAction(attempt.package, 'package', release, true);
    const failed = await checkedAction(attempt.failure, 'verify-failed', release, false);
    if (failed.result.passed !== false) throw refusal('The failed standalone attempt is not proven');
    return { ...proof, at: failed.receipt.at, records: [...proof.records, ...packaged.evidence, ...failed.evidence] };
  }
  if (!build.failedPackage) throw refusal('A recorded failed build or package is required');
  const attempt = await checkedAction(build.failedPackage.failure, 'package-failed',
    { id: build.failedPackage.id, buildId: build.result.buildId }, false);
  if (attempt.result.passed !== false) throw refusal('The failed package attempt is not proven');
  return { ...proof, at: attempt.receipt.at, records: [...proof.records, ...attempt.evidence] };
}

export async function closeManagedBuild({ home, lease, taskId, source, result }) {
  if (!closingResults.includes(result)) throw refusal('Choose superseded, rejected or unused as the build result');
  home = await requireHeldLease(home, lease);
  const task = await readTask(home, taskId);
  if (task?.status !== 'closed') throw refusal('A closed task is required to close a build');
  source = validateManagedSource(source, task.worktree);
  if ((await probePaths([source]))[0] !== 'plain') throw refusal('The managed snapshot is unavailable');
  const possibilities = await Promise.all((await fs.readdir(source, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && isBuildName(entry.name))
    .map(entry => registeredBuild(home, source, entry.name)));
  const builds = possibilities.filter(Boolean);
  if (builds.length !== 1 || builds[0].task !== taskId || pathKey(builds[0].repo) !== pathKey(task.worktree)) {
    throw refusal('The managed snapshot does not belong to the closed task');
  }
  const [build] = builds;
  await buildFailure(build);
  await updateTask(home, lease, await concludeBuild({ home, lease }, task, build, result));
  return { task: taskId, source, dist: build.dist, result };
}

async function concludeBuild({ home, lease }, task, build, result) {
  if (build.closed && build.closed.result !== result) throw refusal('The build already has a different conclusion');
  const { source, dist } = build;
  if (!build.closed) {
    const receipt = await recordAction(path.dirname(build.result.receipt), 'close-build', {
      release: path.basename(source), buildId: build.result.buildId, task: task.id, conclusion: result,
    });
    build.closed = { taskId: task.id, result, receipt };
    await writeArtifact({ home, lease }, 'build', buildKey(source, dist), build, true);
  }
  const subjects = task.closedBuilds ?? [];
  const known = subjects.some(item => pathKey(item.source) === pathKey(source) && item.dist === dist);
  return known ? task : { ...task, closedBuilds: [...subjects, { source, dist }] };
}

export async function verifiedBuildClosure(home, subject, task) {
  const source = validateManagedSource(subject.source, task.worktree);
  const build = await registeredBuild(home, source, subject.dist);
  if (!build || build.closed?.taskId !== task.id || build.task !== task.id ||
      pathKey(build.repo) !== pathKey(task.worktree) || !closingResults.includes(build.closed.result)) return null;
  const closure = await checkedAction(build.closed.receipt, 'close-build',
    { id: path.basename(source), buildId: build.result.buildId }, true);
  if (closure.result.task !== task.id || closure.result.conclusion !== build.closed.result) return null;
  const proof = await buildFailure(build);
  return {
    at: proof.at, buildId: build.result.buildId, outcome: 'failed', unresolved: false, managedFailure: true,
    expectedFiles: proof.expectedFiles, evidence: [...proof.records, ...closure.evidence],
  };
}

export async function managedCacheProof(home, artifact, manifest) {
  const id = artifact.provenance?.releaseId;
  if (!id || id !== manifest?.id || artifact.provenance.packageVerified !== true) return null;
  const build = await registeredBuild(home, artifact.root, path.basename(artifact.path));
  const runtime = build?.runtime, execution = build?.result?.execution, proof = build?.result?.generated;
  if (!proof || !runtime || execution?.startedEmpty !== true || !execution.distIdentity ||
      pathKey(execution.nodeExe) !== pathKey(runtime.nodeExe) || execution.argv?.length !== 1 ||
      execution.argv[0] !== 'build' || build.result.buildId !== manifest.buildId || runtime.nodeSha256 !== manifest.nodeSha256) return null;
  const release = await packagedRelease(home, id);
  const observation = release?.observedStandalone;
  if (!hasObservedStandalone(release) || observation.releaseId !== id ||
      pathKey(release.source) !== pathKey(artifact.root) || release.buildId !== build.result.buildId ||
      pathKey(observation.process.ExecutablePath) !== pathKey(manifest.nodeExe)) return null;
  const registered = artifact.provenance.evidence;
  const expected = new Map(registered.map(item => [pathKey(item.path), item.sha256]));
  const lock = path.join(build.source, 'package-lock.json');
  const [captureBytes, buildReceipt, typecheck, lockBytes] = await readRecords([
    proof.path, build.result.receipt, build.result.typecheck, lock,
  ]);
  if (sha256(captureBytes) !== proof.sha256 || expected.get(pathKey(proof.path)) !== proof.sha256 ||
      sha256(buildReceipt) !== build.result.receiptSha256 || expected.get(pathKey(build.result.receipt)) !== build.result.receiptSha256 ||
      sha256(typecheck) !== build.typecheckSha256 || sha256(typecheck) !== expected.get(pathKey(build.result.typecheck)) ||
      sha256(lockBytes) !== manifest.dependencyLockSha256) return null;
  const capture = JSON.parse(captureBytes);
  if (capture.identity !== execution.distIdentity || capture.fingerprint !== proof.fingerprint ||
      pathKey(capture.target) !== pathKey(artifact.path) || capture.basis?.nodeSha256 !== runtime.nodeSha256 ||
      capture.basis?.dependencyFingerprint !== runtime.dependencyFingerprint ||
      pathKey(capture.basis.dependencyRoot) !== pathKey(runtime.dependencyRoot)) return null;
  if (pathKey(observation.process.ExecutablePath) !== pathKey(runtime.nodeExe) &&
      sha256(await fs.readFile(manifest.nodeExe)) !== runtime.nodeSha256) return null;
  const managedProofSha256 = sha256(JSON.stringify([build.source, build.dist, build.task, build.typecheckSha256,
    build.runtime, build.result, release.manifestSha256, release.actions.verify, observation]));
  return { managedProofSha256, runtime, proof, capture };
}

export async function plainFiles(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) result.push(archiveName(path.relative(root, file).replaceAll('\\', '/')));
      else throw refusal('A linked or unsupported input cannot be copied');
    }
  }
  await walk(assertNarrowRoot(root));
  return result.sort();
}

export async function publishLauncherBundle({ home, lease, source, nodeExe }) {
  home = await requireHeldLease(home, lease);
  const scripts = ['local-system-launch.mjs', 'local-system-maintenance.mjs', 'local-system-backup.mjs', 'local-system-restore.mjs'];
  const library = await plainFiles(path.join(source, 'maintenance'));
  const names = [...scripts, ...library.map(file => 'maintenance/' + file)];
  const bytes = await Promise.all(names.map(async name => {
    const file = path.join(source, name);
    const info = await fs.lstat(file);
    if (!info.isFile() || info.nlink !== 1) throw refusal('A launcher input is not a plain file');
    return fs.readFile(file);
  }));
  const version = sha256(JSON.stringify(names.map((name, index) => [name, sha256(bytes[index])])));
  const code = path.join(home, 'maintenance');
  const root = path.join(code, version);
  const destinations = names.map(name => path.join(root, name));
  const directories = new Set([code, root]);
  for (const file of destinations) {
    const parents = [];
    for (let directory = path.dirname(file); directory !== root; directory = path.dirname(directory)) parents.unshift(directory);
    for (const directory of parents) directories.add(directory);
  }
  await nativeArchiveOperation('ensure-directories', { records: [...directories] });
  const states = await probePaths(destinations);
  for (const [index, file] of destinations.entries()) {
    if (states[index] === 'missing') await fs.writeFile(file, bytes[index], { flag: 'wx' });
    else if (states[index] !== 'plain' || sha256(await fs.readFile(file)) !== sha256(bytes[index])) {
      throw refusal('An existing launcher bundle contains different bytes');
    }
  }
  await requireHeldLease(home, lease);
  const modulePath = './maintenance/' + version + '/';
  const bootstrap = [
    "if (process.argv[2] === 'maintenance') {",
    '  const { maintenanceMain } = await import(' + JSON.stringify(modulePath + 'local-system-maintenance.mjs') + ');',
    '  await maintenanceMain(process.argv.slice(3));',
    '} else {',
    '  const { launcherMain } = await import(' + JSON.stringify(modulePath + 'local-system-launch.mjs') + ');',
    '  if (launcherMain) await launcherMain();',
    '}',
  ].join('\n') + '\n';
  await writeRecords([{ path: path.join(home, 'launcher.mjs'), value: bootstrap, overwrite: true }]);
  if (nodeExe) {
    const command = '@echo off\r\n"' + nodeExe + '" "' + path.join(home, 'launcher.mjs') +
      '" start\r\nif errorlevel 1 pause\r\n';
    await writeRecords(['Запустить ContractorSystem.cmd', 'start.cmd'].map(name =>
      ({ path: path.join(home, name), value: command, overwrite: true })));
  }
  return { version, root };
}

export async function measuredBytes(root) {
  try {
    const [measurement] = await measureArchiveTargets([root]);
    return measurement?.bytes;
  } catch {
    return undefined;
  }
}
