import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runPackage } from './local-system-package.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const toolPath = 'data/tools/kreuzberg/4.10.4/bin';
const windowsTest = (name, run) => test(name, { skip: process.platform !== 'win32' }, run);

function fixture(t, { assets = true, dll = true } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-release-assets-')));
  const source = path.join(directory, 'source'), home = path.join(directory, 'home');
  const write = (root, name, content) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  };
  const builtFiles = [];
  const input = (file, content) => {
    write(source, file, content);
    builtFiles.push({ path: file, sha256: digest(content) });
  };
  input('package.json', '{"private":true}');
  input('package-lock.json', '{"name":"package-regression-fixture","lockfileVersion":3}');
  write(source, '.next-fixture/BUILD_ID', 'fixture-build');
  input('src/utils/local-ocr-mcp.ts', "export const LOCAL_OCR_MCP_VERSION = '4.10.4';\n");
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  for (const name of ['local-system-backup.mjs', 'local-system-restore.mjs', 'local-system-build.mjs',
    'local-system-package.mjs', 'local-system-maintenance.mjs', 'local-system-launch.mjs']) {
    input('scripts/' + name, fs.readFileSync(path.join(scripts, name)));
  }
  for (const name of fs.readdirSync(path.join(scripts, 'maintenance'))) {
    input('scripts/maintenance/' + name, fs.readFileSync(path.join(scripts, 'maintenance', name)));
  }
  input('ops/backup-schema.json', '{}');
  if (assets) {
    input(toolPath + '/kreuzberg.exe', 'synthetic reader binary; never executed');
    if (dll) input(toolPath + '/onnxruntime.dll', 'synthetic runtime library; never executed');
    input(toolPath + '/LICENSE', 'synthetic license');
  }
  const checks = path.join(directory, 'checks.json');
  write(directory, 'checks.json', JSON.stringify({ source, sourceUnchanged: true,
    checks: [{ status: 0 }, { status: 0 }], builtFiles }));
  write(directory, 'deps/placeholder.txt', 'fixture dependency');
  write(home, 'config/system.env', 'CONTRACTOR_TEST_FIXTURE=1\n');
  write(directory, 'fixture-node.exe', 'synthetic Node; never executed');
  const nodeExecutable = path.join(directory, 'fixture-node.exe');
  t.after(() => {
    const resolved = fs.realpathSync(directory), temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temp);
    assert.match(path.basename(resolved), /^contractor-release-assets-/);
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const run = () => runPackage({ id: 'reader-fixture', source, home, dist: '.next-fixture',
    dependencies: path.join(directory, 'deps'), checks, nodeExecutable, codexExe: nodeExecutable,
    getFreeBytes: async () => 40 * 1024 ** 3 });
  return { source, home, release: path.join(home, 'releases', 'reader-fixture'), run };
}

windowsTest('a packaged release contains the fallback reader and its runtime in the sealed manifest', async t => {
  const f = fixture(t);
  await f.run();
  const costs = JSON.parse(fs.readFileSync(path.join(f.home, 'maintenance-state', 'lifecycle-costs.json')));
  const attempts = path.join(f.home, 'maintenance-state', 'package-attempts');
  const slot = fs.readdirSync(attempts).find(name => /^[a-f0-9]{64}\.json$/.test(name));
  assert.equal(costs.lastReceipt.packageSlot, JSON.parse(fs.readFileSync(path.join(attempts, slot))).slot);
  assert.equal(costs.active.length, 0);
  const release = JSON.parse(fs.readFileSync(path.join(f.release, 'release.json')));
  for (const name of ['kreuzberg.exe', 'onnxruntime.dll', 'LICENSE']) {
    const relative = toolPath + '/' + name, source = fs.readFileSync(path.join(f.source, relative));
    assert.deepEqual(fs.readFileSync(path.join(f.release, relative)), source);
    assert.equal(release.files.find(file => file.path === relative)?.sha256, digest(source));
  }
});

windowsTest('missing fallback reader prevents publishing an incomplete release', async t => {
  const f = fixture(t, { assets: false });
  await assert.rejects(f.run(), /reader|OCR|kreuzberg/i);
  assert.equal(fs.existsSync(f.release), false, 'Reject missing assets before creating the release');
});

windowsTest('missing reader runtime library prevents publishing an incomplete release', async t => {
  const f = fixture(t, { dll: false });
  await assert.rejects(f.run(), /onnxruntime|runtime|OCR/i);
  assert.equal(fs.existsSync(f.release), false);
});
