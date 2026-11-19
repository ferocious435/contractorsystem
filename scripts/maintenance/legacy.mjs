import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { archiveName, nativeArchiveOperation, readGuardedRecords } from './archive.mjs';
import { requireHeldLease } from './guard.mjs';
import {
  absolutePath, assertNarrowRoot, isBuildName, isHistoricalBuildSource, isReleaseId, pathKey, refusal, relativeWithin,
} from './policy.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const dateIsValid = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const hashIsValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const provenanceFile = (home, lifecycle) => path.join(home, 'maintenance-state',
  lifecycle ? 'lifecycle-provenance.json' : 'legacy-provenance.json');

function historyLocation(file, registered) {
  file = assertNarrowRoot(file);
  for (const { path: repository, commit } of registered) {
    const relative = relativeWithin(repository, file);
    const parts = relative?.split(path.sep);
    if (parts?.length >= 3 && parts[0] === '.superpowers' &&
        /^[a-z0-9][a-z0-9_-]{0,89}$/i.test(parts[1])) {
      return { repository, commit, folder: path.join(repository, ...parts.slice(0, 2)), taskId: parts[1] };
    }
  }
  return null;
}

function registeredSnapshot(source, registered) {
  const location = historyLocation(source, registered);
  return location && isHistoricalBuildSource(relativeWithin(location.folder, source)) ? location : null;
}

function readJson(bytes) {
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readCommandResult(bytes) {
  const complete = readJson(bytes);
  if (complete) return complete;
  const lines = bytes?.toString('utf8').trim().split(/\r?\n/) ?? [];
  for (const line of lines.reverse()) {
    const parsed = readJson(Buffer.from(line));
    if (parsed) return parsed;
  }
  return null;
}

function indexRecord(index, registered) {
  if (index?.version !== 1 || !Array.isArray(index.releases) || !Array.isArray(index.builds) ||
      !Array.isArray(index.evidence)) throw refusal('The legacy evidence index is malformed');
  const sources = new Map();
  for (const record of index.evidence) {
    let file;
    try {
      file = absolutePath(record.path);
      if (!historyLocation(file, registered) || !hashIsValid(record.sha256) ||
          !Number.isSafeInteger(record.bytes) || record.bytes < 0) continue;
    } catch {
      continue;
    }
    const key = pathKey(file);
    if (sources.has(key)) throw refusal('A legacy evidence path occurs twice');
    sources.set(key, { path: file, bytes: record.bytes, sha256: record.sha256 });
  }
  const find = file => {
    try { return sources.get(pathKey(file)); } catch { return undefined; }
  };
  const receipts = rows => Array.isArray(rows)
    ? rows.map(row => find(row?.evidence)).filter(Boolean)
    : [];
  const releases = index.releases.filter(row => isReleaseId(row?.id)).map(row => ({
    id: row.id, install: receipts(row.installationReceipts), verify: receipts(row.verificationReceipts),
    package: receipts(row.packageReceipts), build: (row.buildReceipts ?? []).map(find).filter(Boolean),
  }));
  const builds = index.builds.map(row => find(row?.receipt?.evidence)).filter(Boolean);
  const unknownSnapshots = [];
  for (const row of index.legacySnapshotDirs ?? []) {
    try {
      const source = absolutePath(row?.source);
      if (registeredSnapshot(source, registered)) unknownSnapshots.push(source);
    } catch { /* An unrelated path cannot be registered. */ }
  }
  return { version: 1, releases, builds, unknownSnapshots, evidence: [...sources.values()] };
}

function references(record, registered) {
  const safe = new Map();
  for (const item of record.evidence) {
    try {
      if (historyLocation(item.path, registered) && hashIsValid(item.sha256) &&
          Number.isSafeInteger(item.bytes) && item.bytes >= 0) safe.set(pathKey(item.path), item);
    } catch { /* Invalid paths cannot be inspected. */ }
  }
  return safe;
}

async function analyzeLegacy(record, registered, manifests, pinnedTarget = null, lifecycle = false) {
  const known = references(record, registered);
  const artifactFiles = new Map();
  const addArtifactFile = file => artifactFiles.set(pathKey(file), file);
  for (const manifest of manifests.values()) {
    if (isBuildName(manifest.dist ?? '') && typeof manifest.buildId === 'string' && manifest.buildId.trim()) {
      addArtifactFile(path.join(manifest.path, manifest.dist, 'BUILD_ID'));
    }
  }
  const originals = await readGuardedRecords([...known.values()].map(item => item.path));
  const matched = new Map();
  for (const [key, item] of known) {
    const bytes = originals.get(item.path);
    if (bytes && bytes.length === item.bytes && digest(bytes) === item.sha256) matched.set(key, { item, bytes });
  }
  const match = file => {
    try { return matched.get(pathKey(file)); } catch { return undefined; }
  };
  const collectRelated = (location, file) => {
    const row = typeof file === 'string' && !path.isAbsolute(file)
      ? match(path.join(location.folder, file)) : match(file);
    return row && relativeWithin(location.folder, row.item.path) ? row : null;
  };
  const proofs = new Map();
  const candidates = new Map();
  for (const ref of record.builds) {
    const proof = match(ref?.path);
    const build = readJson(proof?.bytes);
    if (!build || !dateIsValid(build.at) || !isBuildName(build.dist ?? '') ||
        typeof build.passed !== 'boolean' || typeof build.source !== 'string') continue;
    try {
      const source = absolutePath(build.source);
      const location = historyLocation(proof.item.path, registered);
      const sourceName = relativeWithin(location.folder, source);
      if (!isHistoricalBuildSource(sourceName) ||
          pathKey(path.dirname(proof.item.path)) !== pathKey(location.folder) ||
          typeof build.buildId !== 'string' || !build.buildId.trim()) continue;
      const target = path.join(source, build.dist);
      const checkFile = path.join(target, 'BUILD_ID');
      addArtifactFile(checkFile);
      const expectedFiles = Object.create(null);
      if (!Array.isArray(build.builtFiles) || !build.builtFiles.length) continue;
      for (const file of build.builtFiles) {
        const relative = archiveName(file.path.replaceAll('\\', '/'));
        if (!hashIsValid(file.sha256) || Object.hasOwn(expectedFiles, relative)) throw refusal('Bad build source receipt');
        expectedFiles[relative] = file.sha256;
      }
      const log = collectRelated(location, build.log);
      const typecheck = Array.isArray(build.checks) ? build.checks.find(row => row?.name === 'typecheck') : null;
      const production = Array.isArray(build.checks) ? build.checks.find(row => row?.name === 'production') : null;
      const checked = collectRelated(location, typecheck?.receipt);
      if (!log || !checked || !dateIsValid(build.at)) continue;
      if (build.passed && (build.sourceUnchanged !== true || production?.status !== 0 || typecheck?.status !== 0)) continue;
      const generated = lifecycle ? collectRelated(location, build.generatedDist?.path) : null;
      const captured = readJson(generated?.bytes);
      const matchesCapture = captured?.version === 1 && generated.item.sha256 === build.generatedDist.sha256 &&
        pathKey(captured.target) === pathKey(target) && typeof captured.identity === 'string' &&
        Array.isArray(captured.entries) && captured.entries.every(row => row.path === archiveName(row.path) &&
          row.path.startsWith('cache/') && Number.isSafeInteger(row.size) && row.size >= 0 && hashIsValid(row.sha256));
      candidates.set(pathKey(proof.item.path), { proof, build, source, location, target, checkFile, expectedFiles,
        evidence: [proof.item, log.item, checked.item, ...(matchesCapture ? [generated.item] : [])] });
    } catch { /* An unmatched build is never admitted. */ }
  }
  const observed = await readGuardedRecords([...artifactFiles.values()], pinnedTarget);
  const observedId = file => observed.get(file)?.toString('utf8').trim();

  const actionReceipt = (references, action, manifest) => {
    const results = [];
    for (const ref of references) {
      const found = match(ref?.path);
      const value = readJson(found?.bytes);
      if (!value || value.action !== action || value.release !== manifest.id ||
          value.buildId !== manifest.buildId || value.passed !== true || value.profileUnchanged !== true ||
          !dateIsValid(value.at) || !dateIsValid(manifest.createdAt) || Date.parse(value.at) < Date.parse(manifest.createdAt)) continue;
      const location = historyLocation(found.item.path, registered);
      const stdout = collectRelated(location, value.stdout);
      const stderr = collectRelated(location, value.stderr);
      const result = readCommandResult(stdout?.bytes);
      if (!result || !stderr || result.release !== manifest.id || result.buildId !== manifest.buildId) continue;
      if (action === 'verify' && (result.verified !== true || result.stopped !== true)) continue;
      if (action === 'install' && (result.running !== true || value.current?.releaseId !== manifest.id)) continue;
      results.push({ value, result, evidence: [found.item, stdout.item, stderr.item] });
    }
    return results.sort((left, right) => Date.parse(right.value.at) - Date.parse(left.value.at));
  };
  const releaseBuilds = new Map();
  for (const row of record.releases) {
    const manifest = manifests.get(row?.id);
    if (!manifest || !isBuildName(manifest.dist ?? '') ||
        observedId(path.join(manifest.path, manifest.dist, 'BUILD_ID')) !== manifest.buildId) continue;
    const [install] = actionReceipt(row.install, 'install', manifest);
    const [verified] = actionReceipt(row.verify, 'verify', manifest);
    const [packaged] = actionReceipt(row.package, 'package', manifest);
    if (install) proofs.set(manifest.id, {
      acceptedAt: install.value.at, buildId: manifest.buildId, dependencyRoot: manifest.dependencyRoot,
      previousId: isReleaseId(install.value.current.previousId) ? install.value.current.previousId : null,
      evidence: [...install.evidence, ...(verified?.evidence ?? []), ...(packaged?.evidence ?? [])],
    });
    if ((install || lifecycle) && verified && packaged && Date.parse(verified.value.at) >= Date.parse(packaged.value.at)) {
      for (const build of row.build) {
        try {
          const key = pathKey(build.path);
          const candidate = candidates.get(key);
          if (candidate?.build.buildId === manifest.buildId && candidate.build.dist === manifest.dist &&
              Date.parse(candidate.build.at) <= Date.parse(packaged.value.at)) {
            releaseBuilds.set(key, {
              releaseId: manifest.id,
              managedTask: lifecycle && verified.result.managedTask === packaged.result.managedTask
                ? verified.result.managedTask : null,
              evidence: [...(install?.evidence ?? []), ...verified.evidence, ...packaged.evidence],
            });
          }
        } catch { /* An invalid reference confirms no build. */ }
      }
    }
  }

  const builds = new Map();
  for (const [key, candidate] of candidates) {
    const { target, source, location, checkFile, build } = candidate;
    if (observedId(checkFile) !== build.buildId) continue;
    const final = releaseBuilds.get(key);
    const entry = {
      path: target, root: source, taskId: location.taskId, worktree: location.repository, commit: location.commit,
      provenance: {
        at: build.at, buildId: build.buildId, outcome: build.passed ? 'passed' : 'failed',
        packageVerified: Boolean(final), releaseId: final?.releaseId ?? null, managedTask: final?.managedTask ?? null,
        unresolved: !build.passed || !final,
        expectedFiles: candidate.expectedFiles, evidence: [...candidate.evidence, ...(final?.evidence ?? [])],
      },
    };
    const previous = builds.get(pathKey(target));
    if (!previous || Number(entry.provenance.packageVerified) > Number(previous.provenance.packageVerified) ||
        (entry.provenance.packageVerified === previous.provenance.packageVerified &&
          Date.parse(entry.provenance.at) > Date.parse(previous.provenance.at))) builds.set(pathKey(target), entry);
  }
  const unknownSnapshots = [];
  for (const source of record.unknownSnapshots ?? []) {
    try {
      const location = registeredSnapshot(source, registered);
      if (location) unknownSnapshots.push({ path: source, worktree: location.repository, taskId: location.taskId });
    } catch { /* This hint cannot grant any cleanup permission. */ }
  }
  return { releases: proofs, builds, unknownSnapshots, hash: digest(Buffer.from(JSON.stringify(record))) };
}

async function readRegistry(home, registered, manifests, pinnedTarget, lifecycle) {
  const empty = { releases: new Map(), builds: new Map(), unknownSnapshots: [], hash: null };
  const file = provenanceFile(home, lifecycle);
  try {
    await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return empty;
    throw error;
  }
  const record = readJson((await readGuardedRecords([file])).get(file));
  if (record?.version !== 1 || !Array.isArray(record.evidence) || !Array.isArray(record.releases) ||
      !Array.isArray(record.builds)) throw refusal('Stored legacy evidence is invalid');
  return analyzeLegacy(record, registered, manifests, pinnedTarget, lifecycle);
}

export async function readLegacyProvenance(home, registered, manifests, pinnedTarget) {
  const historical = await readRegistry(home, registered, manifests, pinnedTarget, false);
  const lifecycle = await readRegistry(home, registered, manifests, pinnedTarget, true);
  return {
    releases: new Map([...historical.releases, ...lifecycle.releases]),
    builds: new Map([...historical.builds, ...lifecycle.builds]),
    unknownSnapshots: [...historical.unknownSnapshots, ...lifecycle.unknownSnapshots],
    hash: historical.hash || lifecycle.hash ? digest(Buffer.from(JSON.stringify([historical.hash, lifecycle.hash]))) : null,
  };
}

export async function registerLegacyProvenance(index, { home, lease, registered, manifests, lifecycle = false }) {
  home = await requireHeldLease(home, lease);
  let record = indexRecord(index, registered);
  const file = provenanceFile(home, lifecycle);
  if (lifecycle) {
    const saved = (await readGuardedRecords([file])).get(file);
    if (saved) {
      const existing = readJson(saved);
      if (existing?.version !== 1 || !Array.isArray(existing.evidence) || !Array.isArray(existing.releases) ||
          !Array.isArray(existing.builds)) throw refusal('The lifecycle evidence registry is invalid');
      const merge = (prior, next, key) => [...new Map([...prior, ...next].map(item => [key(item), item])).values()];
      const releaseRows = new Map(existing.releases.map(row => [row.id, row]));
      for (const row of record.releases) {
        const previous = releaseRows.get(row.id);
        releaseRows.set(row.id, previous ? {
          id: row.id,
          ...Object.fromEntries(['install', 'verify', 'package', 'build'].map(key =>
            [key, merge(previous[key], row[key], item => pathKey(item.path))])),
        } : row);
      }
      record = {
        version: 1,
        releases: [...releaseRows.values()],
        builds: merge(existing.builds, record.builds, row => pathKey(row.path)),
        unknownSnapshots: merge(existing.unknownSnapshots ?? [], record.unknownSnapshots, pathKey),
        evidence: merge(existing.evidence, record.evidence, row => pathKey(row.path)),
      };
    }
  }
  const analyzed = await analyzeLegacy(record, registered, manifests, null, lifecycle);
  if (!analyzed.releases.size && !analyzed.builds.size) throw refusal('The index contains no verifiable legacy evidence');
  await requireHeldLease(home, lease);
  await nativeArchiveOperation('write', { writes: [{
    path: file, data: JSON.stringify(record, null, 2) + '\n', overwrite: true,
  }] });
  return {
    releases: [...analyzed.releases.keys()],
    builds: [...analyzed.builds.values()].map(item => ({ path: item.path, packageVerified: item.provenance.packageVerified })),
    evidenceFingerprint: analyzed.hash,
  };
}
