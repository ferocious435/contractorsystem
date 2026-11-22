import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { publishEvidenceArchive } from './maintenance/archive.mjs';
import { archiveHandoff, checkContext } from './maintenance/context.mjs';
import { withLifecycleLock } from './maintenance/guard.mjs';

const branch = 'maintenance-fixture';
const current = 'test-v70';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile);
const maintenanceCli = fileURLToPath(new URL('./local-system-maintenance.mjs', import.meta.url));

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const remote = path.join(root, 'remote');
  await Promise.all([repo, home, remote].map(directory => fs.mkdir(directory)));
  git(remote, 'init', '--bare', '-q');
  git(repo, 'init', '-q', '-b', branch);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'commit', '--allow-empty', '-qm', 'published');
  const published = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'push', '-q', 'origin', branch);
  const handoffPath = path.join(repo, 'HANDOFF.md');
  await fs.writeFile(path.join(home, 'current.json'), JSON.stringify({ releaseId: current, previousId: 'test-v66' }));
  return {
    root, repo, home, remote, handoffPath, published,
    async check({ release = current, commit = published, links = '', extra = '' } = {}) {
      await fs.writeFile(handoffPath, `Ветка: \`${branch}\`\nРабочая папка: \`.\`\nОтправленный коммит: \`${commit}\`\n` +
        `Установленный выпуск: \`${release}\`\nАктивные кандидаты: нет\nСледующий шаг: Сверить проверку.\n${links}\n${extra}`);
      return checkContext({ repo, home, handoffPath });
    },
  };
}

test('detectsWrongInstalledRelease', async t => {
  const caseData = await fixture(t);
  const result = await caseData.check({ release: 'test-v66' });
  assert.equal(result.passed, false);
  assert.deepEqual(result.issues.map(({ code, field, observed }) => ({ code, field, observed })), [
    { code: 'MISMATCH', field: 'Установленный выпуск', observed: 'test-v70' },
  ]);
});

test('doesNotClaimUnpushedCommit', async t => {
  const caseData = await fixture(t);
  git(caseData.repo, 'commit', '--allow-empty', '-qm', 'local only');
  const localOnly = git(caseData.repo, 'rev-parse', 'HEAD');
  assert.equal((await caseData.check()).passed, true);
  const result = await caseData.check({ commit: localOnly });
  assert.equal(result.passed, false);
  assert.equal(result.issues[0].code, 'UNPUBLISHED');
  git(caseData.repo, 'push', '-q', 'origin', branch);
  assert.equal((await caseData.check()).passed, true, 'a published ancestor is valid');
});

test('unavailableRemoteIsUnknown', async t => {
  const caseData = await fixture(t);
  await fs.rename(caseData.remote, caseData.remote + '-offline');
  const result = await caseData.check();
  assert.equal(result.passed, false);
  assert.equal(result.issues[0].code, 'UNKNOWN');
  assert.equal(result.issues[0].field, 'Отправленный коммит');
});

test('cliContextReadsDuringAnIndependentMaintenanceLease', async t => {
  const caseData = await fixture(t);
  await caseData.check();
  const docs = path.join(caseData.repo, 'docs');
  await fs.mkdir(docs);
  await fs.copyFile(caseData.handoffPath, path.join(docs, 'HANDOFF_CURRENT_RU.md'));
  await withLifecycleLock(caseData.home, 'fixture-operation', async () => {
    const command = ['--home', caseData.home, '--repo', caseData.repo];
    const { stdout } = await run(process.execPath, [maintenanceCli, 'context', ...command]);
    assert.equal(JSON.parse(stdout).passed, true);
    const inspected = await run(process.execPath, [maintenanceCli, 'inspect', ...command]);
    assert.equal(JSON.parse(inspected.stdout).context.passed, true);
  });
});

test('resolvesArchivedEvidence', { skip: process.platform !== 'win32' }, async t => {
  const caseData = await fixture(t);
  const source = path.join(caseData.repo, 'evidence');
  const state = path.join(caseData.home, 'maintenance-state');
  const archives = path.join(state, 'evidence-archives');
  const index = path.join(state, 'evidence-index');
  const name = 'small.json';
  const bytes = Buffer.from('{"fixture":true}\n');
  await Promise.all([source, archives, index].map(directory => fs.mkdir(directory, { recursive: true })));
  const original = path.join(source, name);
  await fs.writeFile(original, bytes);
  const key = 'a'.repeat(64);
  const archive = await publishEvidenceArchive({ destination: path.join(archives, key + '.zip'),
    groups: [{ source, prefix: 'artifact', files: [name] }] });
  await fs.writeFile(path.join(index, key + '.json'), JSON.stringify({ version: 1, originalPath: source,
    artifactPrefix: 'artifact/', archive: { path: archive.path, sha256: archive.sha256 }, evidence: [] }));
  await fs.unlink(original);
  const links = '[Локальная квитанция](evidence/small.json)';
  const result = await caseData.check({ links });
  assert.equal(result.passed, true);
  assert.equal(result.facts.evidence['evidence/small.json'].entry, 'artifact/small.json');
  await fs.appendFile(archive.path, 'modified');
  const altered = await caseData.check({ links });
  assert.equal(altered.passed, false);
  assert.equal(altered.issues[0].field, 'evidence/small.json');
});

test('refusesConcurrentHandoffOverwrite', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-handoff-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'HANDOFF.md');
  const replacement = Buffer.from('Параллельное изменение.');
  await fs.writeFile(file, replacement);
  const historyRoot = path.join(root, 'history');
  await assert.rejects(archiveHandoff({ path: file, expectedSha256: digest('Старая версия'), historyRoot }),
    { code: 'REFUSED' });
  assert.deepEqual(await fs.readFile(file), replacement);
  await assert.rejects(fs.readdir(historyRoot), { code: 'ENOENT' });
});

test('preservesHistoricalHandoffBytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-handoff-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'HANDOFF.md');
  const bytes = Buffer.from('\ufeffСостояние\r\nעברית\nПоследняя строка');
  await fs.writeFile(file, bytes);
  const historyRoot = path.join(root, 'history');
  const archived = await archiveHandoff({ path: file, expectedSha256: digest(bytes), historyRoot });
  assert.equal(archived.sha256, digest(bytes));
  assert.equal(path.dirname(archived.path), historyRoot);
  assert.deepEqual(await fs.readFile(archived.path), bytes);
  assert.deepEqual(await fs.readFile(file), bytes);
});
