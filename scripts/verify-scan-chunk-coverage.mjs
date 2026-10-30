import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { completeDocx } from './fixtures/docx-reading-verification.mjs';

const projectHook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const chunkModule = await import('../src/utils/document-scan-chunks.ts');
projectHook.deregister();

test('a complete instruction of one line is not dropped because of its length', () => {
  assert.equal(chunkModule.hasUsefulDocumentScanText({ ...completeDocx, title: 'הנחיה.docx', ocr_status: 'COMPLETED',
    extracted_text: 'יש להשאיר את המעבר פתוח.' }), true);
});

test('a short readable letter reaches analysis after its complete extraction is confirmed', () => {
  const letter = {
    ...completeDocx,
    title: 'מכתב נלווה לבקשה להיתר.docx',
    ocr_status: 'REQUIRES_REVIEW',
    extracted_text: 'נדון: בקשה לאישור עבודות הגנה על עמוד מתח עליון מס\' 10822/16\nלכבוד חח"י,\nבהתאם לתכנון וביצוע עבודות תשתית באזור תעשיה קרית גת תבע מזרחית הננו פונים אליכם בבקשה לאישור ביצוע עבודות הגנה על עמוד מתח עליון מס\' 10822/16.\nעבודות אלו נדרשות לשם הבטחת שלמות העמוד והמערכות הצמודות אליו, וזאת בהתאם להנחיות שקיבלנו מכם בפגישות משותפות. כמו כן, העבודות יתבצעו תוך תיאום מלא עם הגורמים המקצועיים הרלוונטיים בחברת החשמל ותוך שמירה על כל הכללים המחייבים.',
  };
  assert.equal(chunkModule.hasUsefulDocumentScanText(letter), false);
  assert.equal(chunkModule.hasUsefulDocumentScanText({ ...letter, ocr_status: 'COMPLETED' }), true);
  assert.equal(chunkModule.buildDocumentScanChunks([{ ...letter, id: 'permit' }]).length, 1);
});

test('a short PDF price excerpt is readable only after extraction is complete', () => {
  const excerpt = {
    title: 'סעיף מחיר.pdf',
    parsed_json: { source_reading: { version: 'page-coverage-v1', complete: true,
      totalPages: 1, readPages: [1], unreadablePages: [] } },
    extracted_text: '51.001.0075 פירוק מבנה כבישים ומדרכות הכולל אספלט, מצע, תשתית ומילוי עד עומק שמונים סנטימטרים, לרבות פינוי הפסולת לאתר מורשה.',
  };
  assert.equal(chunkModule.hasUsefulDocumentScanText({ ...excerpt, ocr_status: 'COMPLETED' }), true);
  assert.equal(chunkModule.hasUsefulDocumentScanText({ ...excerpt, ocr_status: 'REQUIRES_REVIEW' }), false);
  assert.equal(chunkModule.hasUsefulDocumentScanText({ ...excerpt, ocr_status: 'ERROR' }), false);
  assert.equal(chunkModule.hasUsefulDocumentScanText(excerpt), false);
});

test('empty text, a page counter, and an extracted header do not count as a read document', () => {
  for (const extracted_text of ['', '-- 1 of 1 --', '2090365.pdf 20.10.2026', 'QA.19.01.05C 28.11.23']) {
    assert.equal(chunkModule.hasUsefulDocumentScanText({ title: 'letter.docx', extracted_text }), false);
  }
});

test('partial OCR cannot become a successful read just because a long header was extracted', () => {
  assert.equal(chunkModule.hasUsefulDocumentScanText({
    title: 'scanned-report.pdf', ocr_status: 'REQUIRES_REVIEW',
    extracted_text: 'This text is readable but other pages could not be recognized. '.repeat(30),
  }), false);
});

test('PDF extraction status is respected when the PDF extension exists only in storage metadata', () => {
  assert.equal(chunkModule.hasUsefulDocumentScanText({
    title: 'scanned report', storage_path: 'project/report.pdf', ocr_status: 'ERROR',
    extracted_text: 'This text is readable but other pages could not be recognized. '.repeat(30),
  }), false);
});

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

test('reference comparison preserves native context when no reference applies and retains both relevant source excerpts otherwise', () => {
  const native = chunkModule.buildDocumentScanChunks([{ id: 'project', title: 'מפרט מיוחד', extracted_text: 'על עבודות הצנרת יחול פרק 57 של המפרט הכללי מהדורת 2023.' }]);
  assert.equal(chunkModule.formatContractComparisonContext(native, [], 'צנרת'), chunkModule.formatContractChunkContext(native));
  const requirement = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.';
  const reference = chunkModule.buildDocumentScanChunks([{ id: 'reference-page', title: 'מפרט כללי',
    extracted_text: `${'טקסט כללי '.repeat(150)} ${requirement} ${'טקסט כללי '.repeat(150)}` }]);
  const context = chunkModule.formatContractComparisonContext(native, reference, 'עטיפת הצינור בחול מצומנט');
  assert.ok(context.includes('Document ID: project'));
  assert.ok(context.includes('Document ID: reference-page'));
  assert.ok(context.includes(requirement));
});

test('scan preparation collapses layout whitespace before chunking', () => {
  const meaningfulText = Array.from({ length: 900 }, (_, index) => `מילה${index % 100}`).join(' ');
  const layoutHeavyText = meaningfulText.replaceAll(' ', ' '.repeat(20));
  const chunks = chunkModule.buildDocumentScanChunks([
    { id: 'docx-table', title: 'Protocol.docx', category: 'EXECUTION', extracted_text: layoutHeavyText },
  ], 6_000, 300);

  assert.equal(chunks.length, 2);
  assert.ok(chunks.map((chunk) => chunk.text).join(' ').includes('מילה99'));
  assert.equal(chunks.some((chunk) => / {2,}/.test(chunk.text)), false);
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
  const route = fs.readFileSync('src/server/ai/radar-service.server.ts', 'utf8').replace(/\r\n/g, '\n');

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
    route.indexOf('await replacePreviousScanFindings') > route.indexOf('for (const workChunk of workChunks)'),
    'obsolete automatic findings must be replaced only after every chunk finished successfully',
  );
});

test('paused scan is not reported as finished when unreadable documents exist', () => {
  const hook = fs.readFileSync(
    'src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts',
    'utf8',
  ).replace(/\r\n/g, '\n');

  const pausedBranch = hook.indexOf("scanStatus.status === 'PAUSED'");
  const skippedBranch = hook.indexOf("(scanStatus.skipped || 0) > 0");

  assert.ok(pausedBranch >= 0, 'paused scan branch must exist');
  assert.ok(skippedBranch >= 0, 'unreadable-document branch must exist');
  assert.ok(pausedBranch < skippedBranch, 'paused state must take precedence over unreadable documents');
});
