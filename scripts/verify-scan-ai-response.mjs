import assert from 'node:assert/strict';
import test from 'node:test';

const { parseScanFindings } = await import('../src/utils/scan-ai-response.ts');

test('scan response accepts an array', () => {
  assert.equal(parseScanFindings('[{"title":"פער"}]')[0].title, 'פער');
});

test('scan response accepts a findings wrapper', () => {
  assert.equal(parseScanFindings('{"findings":[{"title":"פער"}]}')[0].title, 'פער');
});

test('scan response accepts a nested finding wrapper', () => {
  assert.equal(parseScanFindings('{"result":{"finding":{"title":"פער"}}}')[0].title, 'פער');
});

test('scan response accepts one finding object', () => {
  assert.equal(parseScanFindings('{"title":"פער","category":"סתירה"}')[0].title, 'פער');
});

test('scan response treats an empty object as no findings', () => {
  assert.deepEqual(parseScanFindings('{}'), []);
});

test('scan response rejects unrelated JSON', () => {
  assert.throws(() => parseScanFindings('{"message":"hello"}'));
});
