import os from 'node:os';
import path from 'node:path';

const windows = process.platform === 'win32';
const gib = 1024 ** 3;
export const maintenancePolicy = Object.freeze({
  protectedPreviousReleases: 2,
  failedBuildsPerTask: 2,
  failedBuildRetentionMs: 7 * 24 * 60 * 60 * 1000,
  buildBudgetBytes: 4 * gib,
  releaseBudgetBytes: 6 * gib,
  minimumFreeBytes: 12 * gib,
  warningFreeBytes: 20 * gib,
});

export const isReleaseId = id => typeof id === 'string' && /^[a-z0-9-]{1,90}$/.test(id);
export const isBuildName = name => /^\.next(?:-[a-z0-9][a-z0-9-]*)?$/i.test(name);

export function refusal(message) {
  return Object.assign(new Error(message), { code: 'REFUSED' });
}

export function absolutePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw refusal('An absolute local path is required');
  }
  if (windows && !/^[a-z]:[/\\]/i.test(value)) throw refusal('A local drive path is required');
  const parts = value.slice(path.parse(value).root.length).split(windows ? /[/\\]/ : '/');
  if (parts.some(part => part === '.' || part === '..' ||
    (windows && (/[<>:"|?*\x00-\x1f]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))))) {
    throw refusal('The path contains an ambiguous component');
  }
  return path.resolve(value);
}

export function pathKey(value) {
  const normalized = absolutePath(value);
  return windows ? normalized.toLowerCase() : normalized;
}

export function relativeWithin(root, target) {
  const relative = path.relative(absolutePath(root), absolutePath(target));
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
    ? null : relative;
}

export function localHomes() {
  const local = absolutePath(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'));
  const logical = path.join(local, 'ContractorSystem');
  const physical = windows
    ? path.join(local, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Local', 'ContractorSystem')
    : logical;
  return { logical, physical };
}

export function pathInMaintenanceHome(home, value) {
  const { logical, physical } = localHomes();
  const canonical = absolutePath(home);
  const actual = absolutePath(value);
  const within = relativeWithin(canonical, actual);
  if (within !== null) return path.join(canonical, within);
  if (pathKey(canonical) === pathKey(physical)) {
    const legacy = relativeWithin(logical, actual);
    if (legacy !== null) return path.join(canonical, legacy);
  }
  throw refusal('The path is outside this installation');
}

export function assertNarrowRoot(value) {
  const root = absolutePath(value);
  const profile = absolutePath(os.homedir());
  const appData = path.dirname(localHomes().logical);
  if (root === path.parse(root).root || relativeWithin(root, profile) !== null ||
      relativeWithin(root, appData) !== null) {
    throw refusal('A drive or profile cannot be used as an operation root');
  }
  const parts = root.split(path.sep);
  if (parts.some(part => /^(?:oneDrive(?: - .+)?|\$Recycle\.Bin|רייכשטט הנדסה|\.git)$/i.test(part))) {
    throw refusal('The path is in protected storage');
  }
  return root;
}

// Use only with the exact home and worktrees returned by readInventory.
export function artifactRoot({ home, repoRoots }, artifact) {
  const target = assertNarrowRoot(artifact.path);
  if (repoRoots.some(root => relativeWithin(target, root) !== null)) {
    throw refusal('The target is or contains a registered worktree');
  }
  const parent = path.dirname(target);
  const name = path.basename(target);
  if (artifact.kind === 'build' && isBuildName(name) && repoRoots.some(root => pathKey(root) === pathKey(parent))) {
    return assertNarrowRoot(parent);
  }
  if (['release', 'rejected-release'].includes(artifact.kind) && isReleaseId(name)) {
    const directory = artifact.kind === 'release' ? 'releases' : 'releases-rejected';
    const expected = path.join(assertNarrowRoot(home), directory);
    if (pathKey(parent) === pathKey(expected)) return expected;
  }
  throw refusal('The artifact is outside the registered operation roots');
}
