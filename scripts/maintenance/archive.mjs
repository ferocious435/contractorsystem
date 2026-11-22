import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { absolutePath, assertNarrowRoot, refusal, relativeWithin } from './policy.mjs';
import { windowsInspectionSource } from './windows-inspection.mjs';

const workerFile = fileURLToPath(new URL('./archive-worker.ps1', import.meta.url));
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function nativeArchiveOperation(operation, payload, authorize, commitScope) {
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
  const finish = async response => {
    if (!(await lines.next()).done || await done !== 0 || response.done) {
      throw refusal(spawnError?.message ?? (diagnostics.trim() || 'The native ZIP operation failed'));
    }
    return JSON.parse(response.value);
  };
  try {
    let response = await lines.next();
    while (!response.done && JSON.parse(response.value)?.ready === true) {
      if (!authorize) throw refusal('Unexpected native authorization request');
      const message = JSON.parse(response.value), { phase } = message;
      if (phase === 'commit' && commitScope) return await commitScope(async () => {
        const authorized = await authorize(phase, message);
        child.stdin.write(authorized ? 'delete\n' : 'skip\n');
        return finish(await lines.next());
      });
      const authorized = await authorize(phase, message);
      child.stdin.write(authorized ? 'delete\n' : 'skip\n');
      response = await lines.next();
    }
    return await finish(response);
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

// A streaming, create-only backup sink. The native process keeps the complete
// plain directory chain and output handle pinned until the last bounded chunk.
export async function openBackupFile({ directory, file, maximumBytes }) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw refusal('Invalid native backup write');
  archiveName(file);
  const system = absolutePath(process.env.SystemRoot || 'C:\\Windows');
  const child = spawn(path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', workerFile],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal: AbortSignal.timeout(40 * 60 * 1000) });
  child.stderr.on('data', () => {});
  child.on('error', () => {}); child.stdin.on('error', () => {});
  const done = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = value => new Promise((resolve, reject) => child.stdin.write(value + '\n', error => error ? reject(refusal('Native backup write failed')) : resolve()));
  await send(JSON.stringify(windowsInspectionSource));
  await send(JSON.stringify({ operation: 'backup-write', target: assertNarrowRoot(directory), file, maximumBytes }));
  const ready = await lines.next();
  if (ready.done || JSON.parse(ready.value).phase !== 'write') {
    child.stdin.end(); await done; throw refusal('The backup output cannot be created safely');
  }
  let closed = false;
  return {
    async write(bytes) {
      if (closed) throw refusal('The backup sink is closed');
      for (let offset = 0; offset < bytes.length; offset += 65536) await send(bytes.subarray(offset, offset + 65536).toString('base64'));
    },
    async close() {
      if (closed) return; closed = true;
      try {
        await send('end'); child.stdin.end();
        const response = await lines.next(), extra = await lines.next();
        if (response.done || !extra.done || await done !== 0 || JSON.parse(response.value).written !== maximumBytes) {
          throw refusal('The native backup output is incomplete');
        }
      } finally { child.stdin.end(); await done; }
    },
    async abort() {
      if (closed) return; closed = true;
      child.stdin.end(); await done;
    },
  };
}

function zipPath(file) {
  const result = assertNarrowRoot(file);
  if (!result.toLowerCase().endsWith('.zip')) throw refusal('A ZIP path is required');
  return result;
}

export async function createVerifiedArchive({ source, files, destination, maximumBytes }) {
  source = assertNarrowRoot(source);
  destination = zipPath(destination);
  if (relativeWithin(source, destination) !== null) throw refusal('An archive cannot be written inside its source');
  if (!Array.isArray(files) || !files.length) throw refusal('An explicit list of ordinary files is required');
  const checked = files.map(archiveName);
  if (new Set(checked.map(name => name.toLowerCase())).size !== checked.length) {
    throw refusal('The archive lists a file more than once');
  }
  return nativeArchiveOperation('publish', { destination, publicRequest: true, groups: [{ source, files: checked, maximumBytes }] });
}

export async function verifyArchive(file) {
  return nativeArchiveOperation('verify', { file: zipPath(file) });
}

export async function extractVerifiedArchive(file, destination, owner = {}) {
  const result=await nativeArchiveOperation('extract', {file:zipPath(file),destination:assertNarrowRoot(destination),target:owner.target,targetIdentity:owner.targetIdentity});
  return result.archive?{...result.archive,ownedEntries:result.ownedEntries}:result;
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
  groups, destination, references, omittedJunctions, baseline = false, targetFingerprint, targetIdentity, publicationTarget, generated,
}) {
  const source = publicationTarget ?? (baseline ? groups?.[0]?.source : undefined);
  return nativeArchiveOperation(baseline ? 'publish-base' : 'publish', {
    groups, destination: zipPath(destination), references, omittedJunctions, targetFingerprint, targetIdentity, generated,
    publicationTarget: source === undefined ? undefined : assertNarrowRoot(source),
  });
}

export async function measureArchiveTargets(files) {
  if (!files.length) return [];
  return nativeArchiveOperation('measure', { records: files.map(assertNarrowRoot) });
}

export async function deleteArchivedTarget({ archive, target, targetFingerprint, targetIdentity, resume, managedProofSha256 }, authorize, commitScope) {
  if (!validDigest(archive.sha256) || !validDigest(targetFingerprint) || typeof targetIdentity !== 'string') {
    throw refusal('A verified archive and planned target are required');
  }
  return nativeArchiveOperation('delete', {
    file: zipPath(archive.path), archiveSha256: archive.sha256, target: assertNarrowRoot(target),
    targetIdentity, targetFingerprint, resume, managedProofSha256,
  }, authorize, commitScope);
}
// Guarded streaming read. The native process holds the source (including all
// streams) until the final hash. Only a chunk, never the whole table, is JSON/base64.
export async function readGuardedBackupFile(file, expectedSha256, { chunkBytes = 65536 } = {}) {
  if (!validDigest(expectedSha256) || !Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 65536 || process.platform !== 'win32') throw refusal('Invalid guarded backup stream');
  const system = absolutePath(process.env.SystemRoot || 'C:\\Windows');
  const child = spawn(path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', workerFile],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal: AbortSignal.timeout(40 * 60 * 1000) });
  child.on('error', () => {}); child.stdin.on('error', () => {}); child.stderr.resume();
  const done = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  child.stdin.write(JSON.stringify(windowsInspectionSource) + '\n' + JSON.stringify({ operation: 'backup-stream', file: absolutePath(file), archiveSha256: expectedSha256, maximumBytes: chunkBytes }) + '\n');
  const chunks = [], digest=createHash('sha256'); let bytes = 0, result;
  try {
    const first = await lines.next();
    if (first.done || JSON.parse(first.value).phase !== 'read') throw refusal('Backup source stream cannot be held safely');
    child.stdin.write('next\n');
    for (;;) {
      const row = await lines.next(); if (row.done) throw refusal('Backup stream ended early');
      const value = JSON.parse(row.value);
      if (typeof value.chunk !== 'string') { result = value; break; }
      const chunk = Buffer.from(value.chunk, 'base64');
      if (!chunk.length || chunk.length > chunkBytes) throw refusal('Backup stream chunk exceeds its bound');
      chunks.push(chunk); digest.update(chunk); bytes += chunk.length; child.stdin.write('next\n');
    }
    child.stdin.end();
    if (!(await lines.next()).done || await done !== 0 || result.sha256 !== expectedSha256 || result.bytes !== bytes || digest.digest('hex')!==expectedSha256) throw refusal('Backup stream did not finish with the expected bytes');
    return Buffer.concat(chunks, bytes);
  } finally { child.stdin.end(); await done; }
}
