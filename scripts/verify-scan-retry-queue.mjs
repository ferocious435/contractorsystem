import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScanRetryQueue } from '../src/utils/scan-retry-queue.ts';

test('retry selects only currently skipped or failed documents at their real cursors', () => {
  assert.deepEqual(buildScanRetryQueue([{ id: 'done' }, { id: 'short' }, { id: 'new' }, { id: 'ocr' }], [
    { work_doc_id: 'done', status: 'COMPLETED', updated_at: '2026-10-21T06:00:00Z' },
    { work_doc_id: 'short', status: 'SKIPPED', updated_at: '2026-10-21T06:00:00Z' },
    { work_doc_id: 'ocr', status: 'ERROR', updated_at: '2026-10-21T06:00:00Z' },
    { work_doc_id: 'missing', status: 'SKIPPED' },
  ]), [{ id: 'short', cursor: 1 }, { id: 'ocr', cursor: 3 }]);
});

test('a later completed result suppresses an older skipped state regardless of row order', () => {
  assert.deepEqual(buildScanRetryQueue([{ id: 'letter' }], [
    { work_doc_id: 'letter', status: 'SKIPPED', updated_at: '2026-10-20T00:00:00Z' },
    { work_doc_id: 'letter', status: 'COMPLETED', updated_at: '2026-10-21T00:00:00Z' },
  ]), []);
});

test('an active document cannot be started by the retry queue', () => {
  assert.deepEqual(buildScanRetryQueue([{ id: 'active' }], [
    { work_doc_id: 'active', status: 'IN_PROGRESS', updated_at: '2026-10-21T00:00:00Z' },
    { work_doc_id: 'active', status: 'ERROR', updated_at: '2026-10-20T00:00:00Z' },
  ]), []);
});
