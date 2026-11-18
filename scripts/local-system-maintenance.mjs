import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { nativeArchiveOperation, readGuardedRecords } from './maintenance/archive.mjs';
import { resolveMaintenanceHome, withMaintenanceLock } from './maintenance/guard.mjs';
import { readInventory } from './maintenance/inventory.mjs';
import { assertNarrowRoot, refusal } from './maintenance/policy.mjs';
import { applyStorage, importLegacyEvidence, prepareStoragePlan, runStorageEvent } from './maintenance/storage.mjs';

const execute = promisify(execFile);
const commands = {
  inspect: ['--json'],
  plan: ['--output'],
  apply: ['--plan'],
  run: ['--event', '--task'],
  'import-legacy': ['--input'],
};

function parseArgs(args) {
  const [first] = args;
  const command = !first || first.startsWith('--') ? 'inspect' : args.shift();
  if (!Object.hasOwn(commands, command)) throw refusal('Unknown maintenance command');
  const flags = new Map();
  const repos = [];
  while (args.length) {
    const option = args.shift();
    if (![...commands[command], '--home', '--repo'].includes(option) || flags.has(option)) {
      throw refusal('Unexpected maintenance option');
    }
    const value = option === '--json' ? true : args.shift();
    if (!value || (typeof value === 'string' && value.startsWith('--'))) throw refusal('A maintenance option is missing its value');
    if (option === '--repo') repos.push(assertNarrowRoot(path.resolve(value)));
    else flags.set(option, value);
  }
  const required = option => {
    const value = flags.get(option);
    if (!value) throw refusal('A required maintenance option is missing');
    return value;
  };
  return { command, flags, repos, required };
}

async function repoRoots(explicit) {
  if (explicit.length) return explicit;
  const scriptRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const root of [process.cwd(), scriptRoot]) {
    try {
      const { stdout } = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel'], { windowsHide: true, timeout: 15000 });
      return [assertNarrowRoot(stdout.trim())];
    } catch { /* An installed copy can be used outside a Git working directory. */ }
  }
  return [];
}

async function input(file) {
  file = assertNarrowRoot(path.resolve(file));
  const bytes = (await readGuardedRecords([file])).get(file);
  if (!bytes) throw refusal('The maintenance input cannot be read safely');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

async function main(args) {
  const { command, flags, repos, required } = parseArgs(args);
  const override = flags.get('--home');
  const home = await resolveMaintenanceHome({ explicitHome: override === undefined ? undefined : path.resolve(override) });
  const options = { home, repoRoots: await repoRoots(repos) };
  if (command === 'inspect') return readInventory(options);
  if (command === 'plan') {
    const destination = assertNarrowRoot(path.resolve(required('--output')));
    const plan = await prepareStoragePlan(options);
    await nativeArchiveOperation('write', { writes: [{
      path: destination, data: JSON.stringify(plan, null, 2) + '\n', overwrite: false,
    }] });
    return plan;
  }
  if (command === 'apply') {
    const plan = await input(required('--plan'));
    return withMaintenanceLock(home, command, lease => applyStorage(plan, { ...options, lease }));
  }
  if (command === 'import-legacy') {
    const index = await input(required('--input'));
    return withMaintenanceLock(home, command, lease => importLegacyEvidence(index, { ...options, lease }));
  }
  const event = required('--event');
  const task = required('--task');
  return withMaintenanceLock(home, command + ':' + event, lease => runStorageEvent(event, task, { ...options, lease }));
}

try {
  const receipt = await main(process.argv.slice(2));
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.failed?.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'FAILED', message: error.message }));
  process.exitCode = error.code === 'BUSY' ? 2 : 1;
}
