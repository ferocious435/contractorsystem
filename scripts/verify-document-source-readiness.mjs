import assert from 'node:assert/strict';
import test from 'node:test';

const readiness = await import('../src/utils/document-source-readiness.ts');
const completePdf = { parsed_json: { source_reading: { version: readiness.DOCUMENT_READING_VERSION,
  complete: true, totalPages: 1, readPages: [1], unreadablePages: [] } } };

test('a complete one-line document is readable without a minimum character count', () => {
  const result = readiness.assessDocumentSourceReadiness({ title: 'הנחיה.docx', ocr_status: 'COMPLETED',
    extracted_text: 'יש להשאיר את המעבר פתוח.' });
  assert.equal(result.canCompare, true);
  assert.equal(result.status, 'READABLE');
});

test('an incomplete extraction cannot become complete because it contains many characters', () => {
  const result = readiness.assessDocumentSourceReadiness({ title: 'report.pdf', ocr_status: 'REQUIRES_REVIEW',
    extracted_text: 'Readable first page. '.repeat(100) });
  assert.equal(result.canCompare, false);
  assert.equal(result.status, 'EXTRACTION_INCOMPLETE');
});

test('page counters, filenames, and form identifiers are not a document body', () => {
  for (const text of ['', '-- 1 of 30 --\n-- 2 of 30 --', '2090365.pdf 20.10.2026', 'QA.19.01.05C 28.11.23']) {
    assert.equal(readiness.hasDocumentBodyText(text), false, text);
  }
});

test('a short native letter with a legacy review status needs fresh extraction before comparison', () => {
  assert.equal(readiness.assessDocumentSourceReadiness({ title: 'letter.docx', ocr_status: 'REQUIRES_REVIEW',
    extracted_text: 'נא לשמור על גישה חופשית למבנה.' }).canCompare, false);
});

test('explicit draft markers prevent use as a current instruction even after successful text extraction', () => {
  for (const document of [
    { title: 'פרוטוקול - טיוטה.docx', extracted_text: 'המעבר ייסגר ביום ראשון.' },
    { title: 'protocol.pdf', extracted_text: 'DRAFT — FOR REVIEW ONLY\nThe access road shall be closed.' },
    { title: 'protocol.docx', extracted_text: 'טיוטה לעיון בלבד\nהמעבר ייסגר ביום ראשון.' },
  ]) {
    const result = readiness.assessDocumentSourceReadiness({ ...completePdf, ...document, ocr_status: 'COMPLETED' });
    assert.equal(result.canCompare, false);
    assert.equal(result.status, 'DRAFT');
    assert.ok(result.markerQuote);
  }
});

test('a final letter discussing somebody else\'s draft is not itself a draft', () => {
  assert.equal(readiness.assessDocumentSourceReadiness({ title: 'מענה על טיוטת ההסכם.docx', ocr_status: 'COMPLETED',
    extracted_text: 'בהמשך לטיוטה ששלחתם, ההנחיה הסופית היא להשאיר את המעבר פתוח.' }).canCompare, true);
});

test('an explicitly identified fragment is retained for context but is not a complete current source', () => {
  const result = readiness.assessDocumentSourceReadiness({ title: 'copy.docx', ocr_status: 'COMPLETED',
    extracted_text: 'קטע מתוך פרוטוקול ישיבה\nיש לסגור את המעבר.' });
  assert.equal(result.status, 'FRAGMENT');
  assert.equal(result.canCompare, false);
  assert.equal(result.hasReadableText, true);
});

test('a version number alone does not prove a draft or that a newer version superseded it', () => {
  assert.equal(readiness.assessDocumentSourceReadiness({ title: 'תכנית V1.3.pdf', ocr_status: 'COMPLETED',
    ...completePdf,
    extracted_text: 'המעבר יישאר פתוח לאורך ביצוע העבודות.' }).canCompare, true);
});

test('a legacy COMPLETED flag or a false page total cannot stand in for verified page coverage', () => {
  for (const parsed_json of [undefined, { source_reading: { ...completePdf.parsed_json.source_reading, totalPages: 2 } }]) {
    assert.equal(readiness.assessDocumentSourceReadiness({ title: 'report.pdf', ocr_status: 'COMPLETED',
      extracted_text: 'There is readable text on the first page.', parsed_json }).canCompare, false);
  }
});

test('a paragraph about a draft is not mistaken for a draft header', () => {
  assert.equal(readiness.assessDocumentSourceReadiness({ title: 'response.txt', ocr_status: 'COMPLETED',
    extracted_text: 'Draft approved in today’s meeting; the final access instruction follows.' }).canCompare, true);
});

test('mixed PDFs request OCR for unread pages even when the other pages exceed the old global limit', () => {
  assert.deepEqual(readiness.pdfPagesNeedingOcr([
    { num: 1, text: 'Readable signed instruction. '.repeat(70) },
    { num: 2, text: '-- 2 of 2 --' },
  ], 2), [2]);
  assert.deepEqual(readiness.pdfPagesNeedingOcr([{ num: 1, text: 'יש להשאיר את המעבר פתוח.' }], 1), [1]);
  assert.deepEqual(readiness.pdfPagesNeedingOcr([], 3), [1, 2, 3]);
});

test('missing pages or weak individual OCR pages cannot be hidden by a good document average', () => {
  assert.equal(readiness.hasCompleteOcrPageCoverage([
    { page: 1, text: 'Readable page', confidence: 99 }, { page: 2, text: '', confidence: 0 },
  ], [1, 2]), false);
  assert.equal(readiness.hasCompleteOcrPageCoverage([
    { page: 1, text: 'Readable page', confidence: 99 }, { page: 2, text: 'Almost unreadable', confidence: 40 },
  ], [1, 2]), false);
  assert.equal(readiness.hasCompleteOcrPageCoverage([
    { page: 1, text: 'יש להשאיר את המעבר פתוח.', confidence: 90 },
  ], [1]), true);
});
