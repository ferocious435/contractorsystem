import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { absolutePath, assertNarrowRoot, refusal, relativeWithin } from './policy.mjs';
import { windowsInspectionSource } from './windows-inspection.mjs';

const workerFile = fileURLToPath(new URL('./archive-worker.ps1', import.meta.url));
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function nativeArchiveOperation(operation, payload, authorize) {
  if (process.platform !== 'win32') throw refusal('The native ZIP helper is available on Windows');
  const system = absolutePath(process.env.SystemRoot || 'C:\\Windows');
  const executable = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', workerFile], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: AbortSignal.timeout(40 * 60 * 1000),
  });
  const done = new Promise(resolve => child.once('close', resolve));
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.stdin.on('error', () => {});
  let diagnostics = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(0, 4096); });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const message = JSON.stringify(windowsInspectionSource) + '\n' + JSON.stringify({ operation, ...payload }) + '\n';
  if (authorize) child.stdin.write(message);
  else child.stdin.end(message);
  try {
    let response = await lines.next();
    while (!response.done && JSON.parse(response.value)?.ready === true) {
      if (!authorize) throw refusal('Unexpected native authorization request');
      const { phase } = JSON.parse(response.value);
      const authorized = await authorize(phase);
      child.stdin.write(authorized ? 'delete\n' : 'skip\n');
      response = await lines.next();
    }
    if (!(await lines.next()).done || await done !== 0 || response.done) {
      throw refusal(spawnError?.message ?? (diagnostics.trim() || 'The native ZIP operation failed'));
    }
    return JSON.parse(response.value);
  } finally {
    child.stdin.end();
    await done;
  }
}

export function archiveName(value) {
  if (typeof value !== 'string' || !value || value.length >= 32700 ||
    value.split('/').some(part => !part || part.length > 255 || part === '.' || part === '..' ||
      /[\\<>:"|?*\x00-\x1f]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw refusal('An archive entry has an unsafe name');
  }
  return value;
}

function zipPath(file) {
  const result = assertNarrowRoot(file);
  if (!result.toLowerCase().endsWith('.zip')) throw refusal('A ZIP path is required');
  return result;
}

export async function createVerifiedArchive({ source, files, destination }) {
  source = assertNarrowRoot(source);
  destination = zipPath(destination);
  if (relativeWithin(source, destination) !== null) throw refusal('An archive cannot be written inside its source');
  if (!Array.isArray(files) || !files.length) throw refusal('An explicit list of ordinary files is required');
  const checked = files.map(archiveName);
  if (new Set(checked.map(name => name.toLowerCase())).size !== checked.length) {
    throw refusal('The archive lists a file more than once');
  }
  return nativeArchiveOperation('publish', { destination, publicRequest: true, groups: [{ source, files: checked }] });
}

export async function verifyArchive(file) {
  return nativeArchiveOperation('verify', { file: zipPath(file) });
}

export async function extractVerifiedArchive(file, destination) {
  return nativeArchiveOperation('extract', { file: zipPath(file), destination: assertNarrowRoot(destination) });
}

export async function readGuardedRecords(files, pinnedTarget = null) {
  if (!files.length) return new Map();
  const rows = await nativeArchiveOperation('read', { records: files.map(absolutePath), target: pinnedTarget });
  if (!Array.isArray(rows) || rows.length !== files.length) throw refusal('An incomplete set of guarded records was returned');
  return new Map(rows.map(row => [row.path, row.bytes === null ? null : Buffer.from(row.bytes, 'base64')]));
}

export async function catalogArchiveGroups(groups) {
  return nativeArchiveOperation('catalog', { groups });
}

export async function publishEvidenceArchive({
  groups, destination, references, omittedJunctions, baseline = false, targetFingerprint, targetIdentity, publicationTarget,
}) {
  return nativeArchiveOperation(baseline ? 'publish-base' : 'publish', {
    groups, destination: zipPath(destination), references, omittedJunctions, targetFingerprint, targetIdentity,
    publicationTarget: publicationTarget === undefined ? undefined : assertNarrowRoot(publicationTarget),
  });
}

export async function measureArchiveTargets(files) {
  if (!files.length) return [];
  return nativeArchiveOperation('measure', { records: files.map(assertNarrowRoot) });
}

export async function deleteArchivedTarget({ archive, target, targetFingerprint, targetIdentity, resume }, authorize) {
  if (!validDigest(archive.sha256) || !validDigest(targetFingerprint) || typeof targetIdentity !== 'string') {
    throw refusal('A verified archive and planned target are required');
  }
  return nativeArchiveOperation('delete', {
    file: zipPath(archive.path), archiveSha256: archive.sha256, target: assertNarrowRoot(target),
    targetIdentity, targetFingerprint, resume,
  }, authorize);
}
