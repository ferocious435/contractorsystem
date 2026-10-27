import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Compare only named baseline sources; this function never repairs or deletes them. */
export function compareProtectedFiles(root, baseline, allowedChanges) {
  const absoluteRoot = realpathSync(root);
  const normalize = name => {
    if (typeof name !== 'string' || path.isAbsolute(name)) throw new Error('Manifest path must be relative to root');
    const absolute = path.resolve(absoluteRoot, name);
    const relative = path.relative(absoluteRoot, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Manifest path is outside root');
    return { absolute, relative: relative.split(path.sep).join('/') };
  };
  const allowed = new Set([...allowedChanges].map(name => normalize(name).relative));
  const unexpected = [], missing = [];
  for (const source of baseline) {
    const {absolute, relative} = normalize(source.path);
    if (!existsSync(absolute)) { missing.push(relative); continue; }
    // Resolve junctions too: a manifest cannot read an unrelated external tree.
    const physical = path.relative(absoluteRoot, realpathSync(absolute));
    if (physical === '..' || physical.startsWith(`..${path.sep}`) || path.isAbsolute(physical)) throw new Error('Manifest path resolves outside root');
    const actual = createHash('sha256').update(readFileSync(absolute)).digest('hex');
    if (actual !== source.sha256 && !allowed.has(relative)) unexpected.push(relative);
  }
  return { unexpected: unexpected.sort(), missing: missing.sort() };
}
