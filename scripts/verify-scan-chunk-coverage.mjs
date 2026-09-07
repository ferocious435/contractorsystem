import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chunkModule = await import('../src/utils/document-scan-chunks.ts');

test('long document chunks cover the complete source without gaps', () => {
  const source = Array.from({ length: 320 }, (_, index) => `SECTION-${index.toString().padStart(3, '0')} ${'תוכן '.repeat(20)}`).join('\n');
  const chunks = chunkModule.chunkDocumentText(source, 1_200, 120);

  assert.ok(chunks.length > 2);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1).end, source.length);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].start <= chunks[index - 1].end, 'adjacent chunks must overlap or touch');
  }
  assert.ok(chunks.some((chunk) => chunk.text.includes('SECTION-319')));
});

test('retrieval can select evidence located after the former contract limit', () => {
  const contractText = `${'כללי החוזה '.repeat(5_000)}\n57.90.0018 הידרנט תוצרת רפאל או הכוכב`;
  const chunks = chunkModule.buildDocumentScanChunks([
    { id: 'contract-1', title: 'BOQ', category: 'BOQ', extracted_text: contractText },
  ], 4_000, 200);
  const selected = chunkModule.selectRelevantContractChunks(chunks, 'הידרנט רפאל 57.90.0018', 8_000, 2);

  assert.ok(selected.some((chunk) => chunk.text.includes('57.90.0018')));
  assert.ok(selected.some((chunk) => chunk.start > 35_000));
});

test('project timeline retrieval connects later protocols about the same issue', () => {
  const chunks = chunkModule.buildDocumentScanChunks([
    {
      id: 'protocol-2024',
      title: 'Protocol 16.12.24',
      category: 'EXECUTION',
      extracted_text: 'הקבלן העביר לאישור הידרנטים של רפאל ונדרש אישור מתכנן',
    },
    {
      id: 'protocol-2025',
      title: 'Protocol 22.01.25',
      category: 'EXECUTION',
      extracted_text: 'הידרנטים ומגופים אושרו על ידי המתכנן החומרים שהוגשו על ידי הקבלן',
    },
    {
      id: 'unrelated',
      title: 'Unrelated protocol',
      category: 'EXECUTION',
      extracted_text: 'עבודות ניקוז ומדידות בכביש',
    },
  ], 500, 50);
  const selected = chunkModule.selectRelevantProjectChunks(
    chunks,
    'הקבלן העביר לאישור הידרנטים של רפאל',
    2_000,
    10,
    'protocol-2024',
  );
  const timeline = chunkModule.formatRelatedWorkTimeline(selected, 'אישור הידרנטים רפאל');

  assert.ok(selected.some((chunk) => chunk.documentId === 'protocol-2025'));
  assert.equal(selected.some((chunk) => chunk.documentId === 'unrelated'), false);
  assert.ok(timeline.includes('אושרו על ידי המתכנן'));
});

test('project retrieval connects Hebrew words with common prefixes', () => {
  const chunks = chunkModule.buildDocumentScanChunks([
    {
      id: 'original',
      title: '16.12.24',
      category: 'EXECUTION',
      extracted_text: 'נדרש לקבל אישור להידרנטים',
    },
    {
      id: 'approval',
      title: '01.01.25',
      category: 'EXECUTION',
      extracted_text: 'הידרנטים ומגופים אושרו על ידי המתכנן',
    },
  ], 500, 50);
  const selected = chunkModule.selectRelevantProjectChunks(
    chunks,
    'עיכוב אפשרי באישור להידרנטים',
    1_000,
    10,
    'original',
  );

  assert.ok(selected.some((chunk) => chunk.documentId === 'approval'));
});

test('project retrieval keeps early and late documents when one document has many chunks', () => {
  const documents = [
    {
      id: 'early-approval',
      title: '\u200fפרוטוקול 01.01.25.docx',
      category: 'EXECUTION',
      extracted_text: 'הידרנטים ומגופים אושרו על ידי המתכנן',
    },
    {
      id: 'late-action',
      title: 'פרוטוקול 04.06.2025.docx',
      category: 'EXECUTION',
      extracted_text: 'נדרשת חלוקת הידרנטים לפי אזורים וספקים',
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `middle-${index}`,
      title: `פרוטוקול ${String(index + 1).padStart(2, '0')}.03.25.docx`,
      category: 'EXECUTION',
      extracted_text: `${'דיון הידרנטים '.repeat(80)} ${index}`,
    })),
  ];
  const chunks = chunkModule.buildDocumentScanChunks(documents, 500, 50);
  const selected = chunkModule.selectRelevantProjectChunks(
    chunks,
    'מצב אישור להידרנטים',
    8_000,
    10,
  );

  assert.ok(selected.some((chunk) => chunk.documentId === 'early-approval'));
  assert.ok(selected.some((chunk) => chunk.documentId === 'late-action'));
  assert.equal(new Set(selected.map((chunk) => chunk.documentId)).size, selected.length);
});

test('scan route processes every work chunk and records complete coverage', () => {
  const route = fs.readFileSync('src/app/api/scan/route.ts', 'utf8').replace(/\r\n/g, '\n');

  assert.ok(route.includes('buildDocumentScanChunks'));
  assert.ok(route.includes('selectRelevantContractChunks'));
  assert.ok(route.includes('selectRelevantProjectChunks'));
  assert.ok(route.includes('formatRelatedWorkTimeline'));
  assert.ok(route.includes('relatedWorkSignature'));
  assert.ok(route.includes('relatedWorkChunksByIndex'));
  assert.equal(route.includes('const projectWorkSignature ='), false);
  assert.ok(route.includes('for (const workChunk of workChunks)'));
  assert.ok(route.includes('work_context_truncated: false'));
  assert.ok(route.includes('work_chunks_processed: workChunks.length'));
  assert.ok(route.includes('project_timeline_context_enabled: true'));
  assert.equal(route.includes('.slice(0, MAX_WORK_CONTEXT_CHARS)'), false);
  assert.ok(
    route.indexOf('A complete replacement scan finished successfully') > route.indexOf('for (const workChunk of workChunks)'),
    'old findings must be archived only after every chunk finished successfully',
  );
});
