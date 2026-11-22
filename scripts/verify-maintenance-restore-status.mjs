import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const source = await fs.readFile(new URL('./local-system-restore.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Execute the exact terminal orchestration and availability bodies in memory.
// The publication seam has already finished; no SQL/native/filesystem lifecycle
// runs here. The writer keeps real CAS semantics: a rejected draft is not saved.
const terminalStart = source.indexOf('  try {\n    checkInterrupt();\n    if(pinnedId||detail.output)await recordRestore');
const terminalEnd = source.indexOf('\n}\n\nexport async function recordRestore', terminalStart);
if (terminalStart < 0 || terminalEnd < 0) throw Error('Cannot locate terminal restore orchestration');
const finishRestore = new AsyncFunction('context', `
  const {home,lease,detail,pinnedId,token,cleanupEvidence,signal,checkInterrupt,recordRestore,updateBackupIndex}=context;
  let primary;
  ${source.slice(terminalStart, terminalEnd)}
`);
const availableStart = source.indexOf('export async function maintainAvailableRestore(');
const availableEnd = source.indexOf('\nexport async function restoreMain', availableStart);
if (availableStart < 0 || availableEnd < 0) throw Error('Cannot locate availability orchestration');
const createAvailable = new Function('dependencies', `
  const {requireHeldLease,backupStatus,path,readGuardedRecords,digest,rotationEvidenceMatches,verifyArchive,restoreDue,restoreBackup,updateBackupIndex}=dependencies;
  return ${source.slice(availableStart, availableEnd).replace('export async function', 'async function')};
`);

async function runScenario({ uncertain }) {
  const home = 'C:\\synthetic-memory-only', id = 'point-synthetic', controller = new AbortController();
  const previous = { evidencePath: 'memory-only-previous-proof', proof: { passed: true, marker: 'previous' } };
  const published = { evidencePath: 'memory-only-new-proof', proof: { passed: true, marker: 'new' } };
  let state = { points: [{ id, complete: true, archive: { path: 'memory-only.zip' }, restorePins: ['foreign-pin', 'own-pin'] }],
    lastComplete: { id }, lastVerified: previous, restoreHistory: [previous], lastRestoreAttempt: { status: 'passed', marker: 'previous' } };
  const primary = Object.assign(Error('Publication response is uncertain'), { code: 'RESTORE_PUBLICATION_UNCERTAIN' });
  let unpinAttempts = 0, subsequentWrites = 0, seenError;
  const updateBackupIndex = async (home, lease, mutate) => {
    const draft = structuredClone(state);
    await mutate(draft);
    if (!draft.points[0].restorePins.includes('own-pin') && !unpinAttempts++) {
      throw Object.assign(Error('Synthetic pin release is busy'), { code: 'BUSY' });
    }
    subsequentWrites++;
    state = draft;
  };
  const restoreBackup = async () => {
    try {
      return await finishRestore({ home, lease: {}, detail: { passed: true, status: 'passed' }, pinnedId: id,
        token: 'own-pin', cleanupEvidence: [], signal: controller.signal,
        checkInterrupt() { if (controller.signal.aborted) throw Object.assign(Error('Interrupted'), { code: 'INTERRUPTED' }); },
        async recordRestore() {
          if (uncertain) throw primary;
          state.lastVerified = structuredClone(published);
          state.restoreHistory.push(structuredClone(published));
          state.lastRestoreAttempt = { status: 'passed', marker: 'new' };
          controller.abort(); // Cancellation is already too late to undo publication.
        }, updateBackupIndex });
    } catch (error) { seenError = error; throw error; }
  };
  const forbidden = () => { throw Error('The in-memory scenario must not inspect file bytes or start an engine'); };
  const available = createAvailable({ path, requireHeldLease: async () => home, backupStatus: async () => structuredClone(state),
    readGuardedRecords: forbidden, digest: forbidden, rotationEvidenceMatches: forbidden, verifyArchive: forbidden,
    restoreDue: () => true, restoreBackup, updateBackupIndex });
  const result = await available({ home, lease: {}, signal: controller.signal });
  const snapshot = structuredClone(state);
  await updateBackupIndex(home, {}, () => {}); // Later writes succeed; only unpin was rejected.
  return { result, state: snapshot, previous, published, primary, seenError, unpinAttempts, subsequentWrites };
}

test('round3 busy unpin preserves confirmed passed publication and reports separate cleanup failure', async () => {
  const f = await runScenario({ uncertain: false });
  assert.equal(f.result.passed, true);
  assert.equal(f.result.status, 'passed');
  assert.deepEqual(f.state.lastVerified, f.published);
  assert.deepEqual(f.state.restoreHistory, [f.previous, f.published]);
  assert.deepEqual(f.state.lastRestoreAttempt, { status: 'passed', marker: 'new' });
  assert.deepEqual(f.state.points[0].restorePins, ['foreign-pin', 'own-pin']);
  assert.deepEqual(f.result.cleanupProblems, [{ stage: 'restore-pin', code: 'BUSY', releaseConfirmed: false, backupId: 'point-synthetic', runId: 'own-pin' }]);
  assert.equal(f.unpinAttempts, 1);
  assert.equal(f.subsequentWrites, 1);
});

test('round3 busy unpin preserves uncertain primary outcome and previous authoritative status', async () => {
  const f = await runScenario({ uncertain: true });
  assert.equal(f.result.code, 'RESTORE_PUBLICATION_UNCERTAIN');
  assert.equal(f.seenError, f.primary);
  assert.deepEqual(f.state.lastVerified, f.previous);
  assert.deepEqual(f.state.restoreHistory, [f.previous]);
  assert.deepEqual(f.state.lastRestoreAttempt, { status: 'passed', marker: 'previous' });
  assert.deepEqual(f.state.points[0].restorePins, ['foreign-pin', 'own-pin']);
  assert.deepEqual(f.result.cleanupProblems, [{ stage: 'restore-pin', code: 'BUSY', releaseConfirmed: false, backupId: 'point-synthetic', runId: 'own-pin' }]);
  assert.equal(f.unpinAttempts, 1);
  assert.equal(f.subsequentWrites, 1);
});
