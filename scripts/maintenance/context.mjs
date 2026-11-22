import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { archiveName, nativeArchiveOperation, readGuardedRecords, verifyArchive } from './archive.mjs';
import { probePaths, requirePlainPath, resolveMaintenanceHome } from './guard.mjs';
import { readContextInventory } from './inventory.mjs';
import { assertNarrowRoot, isReleaseId, pathKey, refusal, relativeWithin } from './policy.mjs';

const run = promisify(execFile);
const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = ['Ветка', 'Рабочая папка', 'Отправленный коммит', 'Установленный выпуск', 'Активные кандидаты', 'Следующий шаг'];
const unquote = value => value.replace(/^`([^`]+)`$/, '$1');

async function git(repo, ...args) {
  const { stdout } = await run('git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_NO_REPLACE_OBJECTS: '1' },
    timeout: 10000, windowsHide: true,
  });
  return stdout.trim();
}

async function remoteBranch(repo, branch) {
  let remote = 'origin';
  let ref = 'refs/heads/' + branch;
  try {
    remote = await git(repo, 'config', '--get', `branch.${branch}.remote`);
    ref = await git(repo, 'config', '--get', `branch.${branch}.merge`);
  } catch (error) {
    if (error.code !== 1) return { status: 'UNKNOWN', reason: 'upstream-unavailable' };
  }
  if (!remote || remote === '.' || !ref.startsWith('refs/heads/')) {
    return { status: 'UNKNOWN', reason: 'upstream-unverified' };
  }
  try {
    const output = await git(repo, 'ls-remote', '--exit-code', '--heads', '--', remote, ref);
    const [head, observedRef] = output.split('\t');
    if (observedRef !== ref || !commitId.test(head)) return { status: 'UNKNOWN', reason: 'remote-response-unverified' };
    return { status: 'PASS', head };
  } catch (error) {
    if (error.code === 2) return { status: 'MISSING', reason: 'remote-branch-absent' };
    return { status: 'UNKNOWN', reason: 'remote-unavailable' };
  }
}

async function publication(repo, commit, remote) {
  if (commit === 'UNKNOWN') return { code: 'UNKNOWN', observed: remote.head ?? remote.reason };
  if (!commitId.test(commit)) return { code: 'INVALID', observed: 'expected-published-sha-or-UNKNOWN' };
  if (remote.status === 'MISSING') return { code: 'UNPUBLISHED', observed: remote.reason };
  if (remote.status !== 'PASS') return { code: 'UNKNOWN', observed: remote.reason };
  if (remote.head === commit) return null;
  try {
    await git(repo, 'merge-base', '--is-ancestor', commit, remote.head);
    return null;
  } catch (error) {
    if (error.code === 1 && await git(repo, 'rev-parse', '--is-shallow-repository').catch(() => '') === 'false') {
      return { code: 'UNPUBLISHED', observed: remote.head };
    }
    return { code: 'UNKNOWN', observed: 'remote-ancestry-unverified' };
  }
}

async function readRecord(file) {
  if (process.platform === 'win32') {
    const bytes = (await readGuardedRecords([file])).get(file);
    if (!bytes) throw refusal('The local context record is unavailable');
    return bytes;
  }
  await requirePlainPath(file);
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink !== 1) throw refusal('The local context record is not a plain file');
  return fs.readFile(file);
}

async function evidenceRecords(home) {
  const state = path.join(home, 'maintenance-state');
  const directory = path.join(state, 'evidence-index');
  const [kind] = await probePaths([directory]);
  if (kind === 'missing') return [];
  if (kind !== 'plain') throw refusal('The evidence index is unavailable');
  const files = (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .map(name => path.join(directory, name));
  const bytes = await readGuardedRecords(files);
  return files.map(file => {
    const record = JSON.parse(bytes.get(file).toString('utf8'));
    const archive = path.join(state, 'evidence-archives', path.basename(file, '.json') + '.zip');
    if (record.version !== 1 || pathKey(record.archive?.path) !== pathKey(archive) ||
        !/^[a-f0-9]{64}$/.test(record.archive.sha256) || record.artifactPrefix !== 'artifact/' || !Array.isArray(record.evidence)) {
      throw refusal('An evidence index record is invalid');
    }
    return record;
  });
}

function archiveLocation(record, file) {
  const exact = record.evidence.find(item => pathKey(item.path) === pathKey(file));
  if (exact) {
    if (!/^[a-f0-9]{64}$/.test(exact.sha256) || !Number.isSafeInteger(exact.bytes) || exact.bytes < 0) {
      throw refusal('The evidence checksum is unverified');
    }
    return { entry: archiveName(exact.entry), sha256: exact.sha256, bytes: exact.bytes };
  }
  for (const [root, prefix] of [[record.originalPath, record.artifactPrefix], [record.source?.originalPath, 'source/']]) {
    if (!root) continue;
    const relative = relativeWithin(root, file);
    if (relative !== null) return { entry: relative ? archiveName(prefix + relative.split(path.sep).join('/')) : prefix };
  }
  return null;
}

async function checkEvidence(repo, home, handoffPath, document, facts, issue) {
  const links = new Set([...document.matchAll(/\]\((<[^>]+>|[^\s()]+)(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1].replace(/^<|>$/g, '').split('#')[0])
    .filter(link => link && !/^https?:\/\//i.test(link) && !/^mailto:/i.test(link)));
  const missing = [];
  const files = [];
  for (const link of links) {
    try {
      const decoded = decodeURIComponent(link);
      if (path.isAbsolute(decoded) || /[\\:\0]/.test(decoded)) throw refusal('Use a relative local evidence link');
      const file = path.resolve(path.dirname(handoffPath), decoded);
      if (relativeWithin(repo, file) === null) throw refusal('Evidence link is outside the worktree');
      files.push({ link, file });
    } catch {
      issue('INVALID', link, 'invalid-local-link');
    }
  }
  const states = await probePaths(files.map(({ file }) => file)).catch(() => files.map(() => 'unverified'));
  for (const [index, entry] of files.entries()) {
    if (states[index] === 'plain') facts.evidence[entry.link] = { status: 'LOCAL' };
    else if (states[index] === 'missing') missing.push(entry);
    else issue('UNKNOWN', entry.link, 'local-link-unverified');
  }
  if (!missing.length) return;
  const records = home ? await evidenceRecords(home).catch(() => []) : [];
  const verified = new Map();
  for (const { link, file } of missing) {
    try {
      for (const record of records) {
        const location = archiveLocation(record, file);
        if (!location) continue;
        if (!verified.has(record.archive.path)) {
          verified.set(record.archive.path, verifyArchive(record.archive.path).catch(() => null));
        }
        const archive = await verified.get(record.archive.path);
        if (archive?.sha256 !== record.archive.sha256) continue;
        if (archive.entries.some(entry => location.sha256
          ? entry.path === location.entry && entry.sha256 === location.sha256 && entry.size === location.bytes
          : entry.path === location.entry || entry.path.startsWith(location.entry.replace(/\/?$/, '/')))) {
          facts.evidence[link] = { status: 'ARCHIVED', archive: record.archive.path, entry: location.entry };
          break;
        }
      }
    } catch { /* An unverified index entry is never accepted. */ }
    if (!Object.hasOwn(facts.evidence, link)) issue('UNKNOWN', link, 'local-evidence-not-verified');
  }
}

export async function checkContext({ repo, home, handoffPath } = {}) {
  const issues = [];
  const facts = { repo: null, branch: null, remote: null, installed: null, candidates: null, evidence: Object.create(null) };
  const issue = (code, field, observed) => issues.push({ code, field, observed });
  const result = () => ({ passed: issues.length === 0, issues, facts });
  let document;
  try {
    repo = assertNarrowRoot(repo);
    await requirePlainPath(repo);
    facts.repo = await git(repo, 'rev-parse', '--show-toplevel');
    if (pathKey(repo) !== pathKey(facts.repo)) throw refusal('The repository must be its worktree root');
    handoffPath = assertNarrowRoot(handoffPath ?? path.join(repo, 'docs', 'HANDOFF_CURRENT_RU.md'));
    if (!relativeWithin(repo, handoffPath)) throw refusal('The handoff must be inside the worktree');
    document = new TextDecoder('utf-8', { fatal: true }).decode(await readRecord(handoffPath));
  } catch {
    issue('UNKNOWN', 'HANDOFF', 'worktree-or-handoff-unavailable');
    return result();
  }
  const values = new Map();
  const lines = document.split(/\r?\n/);
  for (const field of fields) {
    const matches = lines.filter(line => line.startsWith(field + ':')).map(line => line.slice(field.length + 1).trim());
    if (matches.length === 1 && matches[0]) values.set(field, unquote(matches[0]));
    else issue('INVALID', field, 'expected-one-nonempty-line');
  }
  const compare = (field, value, matches) => {
    if (!values.has(field)) return;
    if (value === null || values.get(field) === 'UNKNOWN') issue('UNKNOWN', field, value ?? 'unverified');
    else if (!matches(values.get(field), value)) issue('MISMATCH', field, value);
  };
  const [branch, resolvedHome] = await Promise.all([
    git(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => null),
    resolveMaintenanceHome({ explicitHome: home }).catch(() => null),
  ]);
  facts.branch = branch;
  const [remote, inventory] = await Promise.all([
    branch ? remoteBranch(repo, branch) : { status: 'UNKNOWN', reason: 'local-branch-unavailable' },
    resolvedHome ? readContextInventory(resolvedHome, repo).catch(() => null) : null,
  ]);
  facts.remote = remote;
  facts.installed = inventory?.current ?? null;
  facts.candidates = inventory?.candidates ?? null;
  const equal = (expected, actual) => expected === actual;
  compare('Ветка', branch, equal);
  compare('Рабочая папка', facts.repo, (expected, actual) => {
    try { return expected === '.' || pathKey(expected) === pathKey(actual); } catch { return false; }
  });
  const sent = values.get('Отправленный коммит');
  if (sent) {
    const reason = await publication(repo, sent, remote);
    if (reason) issue(reason.code, 'Отправленный коммит', reason.observed);
  }
  compare('Установленный выпуск', facts.installed?.releaseId ?? null, equal);
  compare('Активные кандидаты', facts.candidates, (expected, actual) => {
    const ids = expected === 'нет' ? [] : expected.split(',').map(id => unquote(id.trim())).sort();
    return ids.every(isReleaseId) && JSON.stringify(ids) === JSON.stringify(actual);
  });
  if (/^(?:UNKNOWN|[-—])$/i.test(values.get('Следующий шаг') ?? '')) {
    issue('INVALID', 'Следующий шаг', 'expected-action');
  }
  await checkEvidence(repo, resolvedHome, handoffPath, document, facts, issue);
  return result();
}

export async function archiveHandoff({ path: file, expectedSha256, historyRoot }) {
  file = assertNarrowRoot(file);
  historyRoot = assertNarrowRoot(historyRoot);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw refusal('The expected handoff SHA256 is required');
  const bytes = await readRecord(file);
  if (sha256(bytes) !== expectedSha256) throw refusal('The handoff changed. Read it again before replacing it');
  if (process.platform === 'win32') await nativeArchiveOperation('ensure-directories', { records: [historyRoot] });
  else await fs.mkdir(historyRoot, { recursive: true });
  await requirePlainPath(historyRoot);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archived = path.join(historyRoot, `handoff-${timestamp}-${randomUUID()}.md`);
  await fs.writeFile(archived, bytes, { flag: 'wx', mode: 0o600 });
  if (sha256(await readRecord(archived)) !== expectedSha256 || sha256(await readRecord(file)) !== expectedSha256) {
    throw refusal('The history or handoff changed. Read it again before replacing it');
  }
  return { path: archived, sha256: expectedSha256 };
}
