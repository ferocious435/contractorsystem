import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const memory = await import('../src/utils/document-scan-memory.ts');

const baseDocument = {
  id: 'document-1',
  title: 'Protocol 01.01.25.docx',
  category: 'EXECUTION',
  storage_bucket: 'documents',
  storage_path: 'project/document-1.docx',
  content_hash: 'file-hash-1',
  extracted_text: 'approved hydrants',
  extracted_text_hash: 'text-hash-1',
};

test('document fingerprint ignores a date-only database update', () => {
  const first = memory.buildDocumentFingerprint({ ...baseDocument, updated_at: '2026-01-01' });
  const second = memory.buildDocumentFingerprint({ ...baseDocument, updated_at: '2026-09-07' });

  assert.equal(first, second);
});

test('document fingerprint changes when file or extracted text changes', () => {
  const original = memory.buildDocumentFingerprint(baseDocument);
  const changedFile = memory.buildDocumentFingerprint({ ...baseDocument, content_hash: 'file-hash-2' });
  const changedText = memory.buildDocumentFingerprint({
    ...baseDocument,
    extracted_text: 'approved hydrants with two suppliers',
    extracted_text_hash: null,
  });

  assert.notEqual(original, changedFile);
  assert.notEqual(original, changedText);
});

test('related document fingerprint is stable regardless of database order', () => {
  const secondDocument = { ...baseDocument, id: 'document-2', content_hash: 'file-hash-2' };

  assert.equal(
    memory.buildDocumentSetFingerprint([baseDocument, secondDocument]),
    memory.buildDocumentSetFingerprint([secondDocument, baseDocument]),
  );
});

test('scan memory changes only when the work, contract, related context, model, or engine changes', () => {
  const base = {
    engineVersion: 'memory-v1',
    projectId: 'project-1',
    contractFingerprint: 'contract-1',
    workFingerprint: 'work-1',
    relatedWorkFingerprint: 'related-1',
    aiIdentity: 'ollama:qwen3:4b',
  };
  const original = memory.buildScanMemorySignature(base);

  assert.equal(original, memory.buildScanMemorySignature({ ...base }));
  assert.notEqual(original, memory.buildScanMemorySignature({ ...base, workFingerprint: 'work-2' }));
  assert.notEqual(original, memory.buildScanMemorySignature({ ...base, relatedWorkFingerprint: 'related-2' }));
});

test('scan route uses per-document related memory and upload stores the file hash', () => {
  const route = fs.readFileSync('src/app/api/scan/route.ts', 'utf8');
  const uploadRoute = fs.readFileSync('src/app/api/documents/route.ts', 'utf8');

  assert.ok(route.includes('relatedWorkChunksByIndex'));
  assert.ok(route.includes('relatedWorkSignature'));
  assert.ok(route.includes('__cachedDocuments'));
  assert.ok(route.includes('__scannedDocuments'));
  assert.ok(route.includes('WORK_ROLES.has(storedCategory)'));
  assert.ok(route.includes('documents.map((doc): ScanDocumentWithRole'));
  assert.equal(route.includes('const validatedDocuments ='), false);
  assert.ok(route.includes('generateScanChunkFindings'));
  assert.ok(route.includes('numPredict: 320'));
  assert.ok(route.includes('Return at most one decisive finding'));
  assert.ok(route.includes('withScanHeartbeat'));
  assert.ok(route.includes('const SCAN_HEARTBEAT_MS = 15_000'));
  assert.equal(route.includes('const projectWorkSignature ='), false);
  assert.ok(uploadRoute.includes('createHash("sha256").update(fileBuffer).digest("hex")'));
  assert.ok(uploadRoute.includes('content_hash: contentHash'));
});
