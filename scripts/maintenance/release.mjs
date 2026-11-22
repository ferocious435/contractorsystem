import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { archiveName, readGuardedRecords } from './archive.mjs';
import { resolveMaintenanceHome } from './guard.mjs';
import { isBuildName, isReleaseId, pathInMaintenanceHome, pathKey, refusal } from './policy.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function releaseJson(file) {
  const bytes = (await readGuardedRecords([file])).get(file);
  if (!bytes) throw refusal('The current release pointer is missing');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

export function readRelease(home, id, manifestSha256) {
  if (!isReleaseId(id)) throw refusal('Invalid release identity');
  const root = path.join(home, 'releases', id);
  const bytes = privateFile(path.join(root, 'release.json'));
  if (manifestSha256 !== undefined && hash(bytes) !== manifestSha256) throw refusal('The candidate manifest changed after packaging');
  const release = JSON.parse(bytes.toString('utf8'));
  const nodeExe = pathInMaintenanceHome(home, release.nodeExe);
  const dependencyRoot = pathInMaintenanceHome(home, release.dependencyRoot);
  if (release.id !== id || pathKey(pathInMaintenanceHome(home, release.root)) !== pathKey(root) ||
      pathKey(path.dirname(nodeExe)) !== pathKey(path.join(home, 'runtime')) ||
      pathKey(path.dirname(dependencyRoot)) !== pathKey(path.join(home, 'dependencies')) ||
      !isBuildName(release.dist) || typeof release.buildId !== 'string' || !release.buildId.trim()) {
    throw refusal('Release path or identity differs');
  }
  return { ...release, root, nodeExe, dependencyRoot };
}

export function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || pathKey(fs.realpathSync(file)) !== pathKey(file)) {
    throw refusal('A release file is linked or not an ordinary file: ' + path.basename(file));
  }
  return fs.readFileSync(file);
}

export function verifyRelease(release) {
  const listed = new Set();
  for (const file of release.files) {
    const name = archiveName(file.path.replaceAll('\\', '/'));
    if (listed.has(name.toLowerCase()) || hash(privateFile(path.join(release.root, name))) !== file.sha256) {
      throw refusal('Release file changed: ' + name);
    }
    listed.add(name.toLowerCase());
  }
  const buildPath = release.dist + '/BUILD_ID';
  if (!listed.has(buildPath.toLowerCase()) || privateFile(path.join(release.root, buildPath)).toString('utf8').trim() !== release.buildId) {
    throw refusal('The sealed build identifier differs');
  }
  if (hash(privateFile(release.nodeExe)) !== release.nodeSha256) throw refusal('Saved Node runtime changed');
  const modules = path.join(release.root, 'node_modules'), anchor = path.join(release.root, 'package.json');
  const info = fs.lstatSync(modules);
  if (!info.isDirectory() || info.isSymbolicLink() || pathKey(fs.realpathSync(modules)) !== pathKey(modules)) {
    throw refusal('A private physical dependency copy is required');
  }
  const require = createRequire(anchor);
  for (const name of ['dotenv', 'next', 'officeparser', '@supabase/supabase-js']) {
    const target = require.resolve(name);
    const relative = path.relative(modules, fs.realpathSync(target));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw refusal('A release dependency resolves outside its physical copy');
    }
  }
  const lockBytes = privateFile(path.join(release.root, 'package-lock.json'));
  if (release.dependencyLockSha256 && hash(lockBytes) !== release.dependencyLockSha256) {
    throw refusal('The release dependency lock changed');
  }
  const lock = JSON.parse(lockBytes.toString('utf8'));
  for (const name of ['next', 'dotenv', 'officeparser']) {
    const actual = JSON.parse(privateFile(path.join(modules, name, 'package.json')).toString('utf8')).version;
    if (actual !== lock.packages?.['node_modules/' + name]?.version) throw refusal('Dependency version differs: ' + name);
  }
  return { modules, anchor, require };
}

export async function resolveVerifiedRelease({ home, releaseId } = {}) {
  home = await resolveMaintenanceHome({ explicitHome: home });
  if (!releaseId) releaseId = (await releaseJson(path.join(home, 'current.json'))).releaseId;
  const release = readRelease(home, releaseId);
  const dependencies = verifyRelease(release);
  return { home, release, dependencyRoot: dependencies.modules, require: dependencies.require };
}
