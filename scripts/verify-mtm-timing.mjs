import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { quality } from './radar-point-1-3-harness.mjs';
import { completeDocx, replayExtractedDocxText } from './fixtures/docx-reading-verification.mjs';
const timing = await import('../src/utils/radar-issue-timing.ts').catch(() => ({}));
const doc = (id, date, text, category = 'EXECUTION') => ({ ...completeDocx, ocr_status: 'COMPLETED', id, category, title: `${id}.docx`, extracted_text: `תאריך: ${date}\n${text}` });
function review(documents) {
  assert.equal(typeof timing.reviewIssueTiming, 'function');
  return timing.reviewIssueTiming({ issue: { subject: 'MTM', location: 'יהלום' }, documents, asOf: '2025-06-24' });
}
const duty = doc('agreement', '01.01.2025', 'הסכם חתום על ידי שני הצדדים. הקבלן מתחייב לחתום על נספח קידוח MTM ברחוב יהלום עד ליום 01.06.2025.', 'CONTRACT');

test('unsigned as of a period is not a breach without a dated applicable duty', () => {
  const result = review([doc('status', '24.06.2025', 'מסמך קידוח MTM ברחוב יהלום טרם נחתם.')]);
  assert.equal(result.confirmedConflicts.length, 0);
  assert.equal(result.status, 'NO_PROVEN_TIMING_CONFLICT');
});
test('an explicit signing duty and a dated missed signing prove the temporal conflict', () => {
  const result = review([duty, doc('status', '24.06.2025', 'טרם חתמתם על נספח קידוח MTM ברחוב יהלום.')]);
  assert.equal(result.confirmedConflicts.length, 1);
  assert.equal(result.confirmedConflicts[0].action, 'SIGN');
  assert.equal(result.confirmedConflicts[0].dueDate, '2025-06-01');
  assert.equal(result.confirmedConflicts[0].statusDate, '2025-06-24');
});
test('status before the due date and another street do not prove a timing conflict', () => {
  assert.equal(review([duty, doc('early', '01.05.2025', 'טרם חתמתם על נספח קידוח MTM ברחוב יהלום.')]).confirmedConflicts.length, 0);
  assert.equal(review([duty, doc('other', '24.06.2025', 'טרם חתמתם על נספח קידוח MTM ברחוב הרצל.')]).confirmedConflicts.length, 0);
});
test('a price submission deadline is not a price approval deadline', () => {
  const source = doc('price-duty', '01.01.2025', 'הסכם חתום על ידי שני הצדדים. הקבלן מתחייב להגיש ניתוח מחיר לקידוח MTM ברחוב יהלום עד ליום 01.06.2025.', 'CONTRACT');
  assert.equal(review([source, doc('price', '24.06.2025', 'המחיר לקידוח MTM ברחוב יהלום טרם אושר.')]).confirmedConflicts.length, 0);
  assert.equal(review([source, doc('price', '24.06.2025', 'לקידוח MTM ברחוב יהלום לא נמסר ניתוח מחיר.')]).confirmedConflicts.length, 1);
});
test('48 hours for the schedule must not become the MTM signing deadline', () => {
  const result = review([doc('warning', '24.06.2025', 'טרם חתמתם על מסמך קידוח MTM ברחוב יהלום.\nלהמציא תוך 48 שעות לוח זמנים מפורט.')]);
  assert.ok(!result.requirements.some(item => item.action === 'SIGN' && item.clock === 'RELATIVE'));
  assert.equal(result.confirmedConflicts.length, 0);
});
test('an optional method change and a requested response are not agreed signing duties', () => {
  const result = review([doc('protocol', '26.03.2025', 'קידוח MTM ברחוב יהלום: ככל שהקבלן מעוניין בביצוע בשיטה זו, עליו להעביר אישור מפורש עד לשעה 14:00. אם לא, עליו לבצע לפי המכרז.'),
    doc('letter', '12.05.2025', 'קידוח MTM ברחוב יהלום:\n- טרם התקבלה חתימתך.\nנבקש את תגובתך בתוך 3 ימי עבודה ממועד קבלת המכתב.')]);
  assert.equal(result.confirmedConflicts.length, 0);
});
test('an undated unsigned annex cannot establish an operative signing deadline', () => {
  const unsigned = { ...duty, extracted_text: 'נספח לחוזה\nשנחתם ביום _____\nהקבלן מתחייב לחתום על נספח קידוח MTM ברחוב יהלום עד ליום 01.06.2025.\n__________________' };
  assert.equal(review([unsigned, doc('status', '24.06.2025', 'מסמך קידוח MTM ברחוב יהלום טרם נחתם.')]).confirmedConflicts.length, 0);
});
test('a later signature and method approval do not erase a previously proved missed deadline', () => {
  const original = doc('original', '01.01.2025', 'מסמך קידוח MTM ברחוב יהלום טרם נחתם.');
  const lateStatus = doc('late', '24.06.2025', 'מסמך קידוח MTM ברחוב יהלום טרם נחתם.');
  const laterAgreement = doc('later', '25.06.2025', 'קידוח MTM ברחוב יהלום אושר לביצוע.\nמסמך קידוח MTM ברחוב יהלום נחתם על ידי שני הצדדים.\nהמחיר לקידוח MTM ברחוב יהלום אושר בהסכמה בין הצדדים.');
  assert.equal(quality.findingIsSupersededByLaterEvidence({ finding: { work_quote: 'מסמך קידוח MTM ברחוב יהלום טרם נחתם.' },
    currentWorkDocument: original, relatedWorkDocuments: [duty, lateStatus, laterAgreement], contractDocuments: [duty] }), false);
});
const historicalMtmSnapshot=process.env.RADAR_MTM_SNAPSHOT||'data/point1-audit/point13-step4-mtm-corpus-before-20261022.json';
test('actual available corpus: signature status, response demands and completion reference remain distinct', {skip:!fs.existsSync(historicalMtmSnapshot)&&'Historical acceptance snapshot unavailable; current project acceptance is separate'}, () => {
  const filename = historicalMtmSnapshot;
  const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const documents = saved.documents.map(source => replayExtractedDocxText({ ...source, parsed_json: { source_reading: source.source_reading } }));
  const result = review(documents);
  assert.equal(result.confirmedConflicts.length, 0);
  assert.ok(result.requirements.some(item => item.documentId.startsWith('935fb9ad') && item.action === 'RESPOND'));
  assert.ok(result.requirements.some(item => item.documentId.startsWith('ef74c34f') && item.action === 'RESPOND'
    && item.scope === 'LETTER_RESPONSE' && item.clock === 'RELATIVE'));
  assert.ok(result.requirements.every(item => item.authority !== 'SIGNED_AGREEMENT'));
  for (const item of result.requirements) {
    const source = documents.find(source => source.id === item.documentId).extracted_text;
    assert.equal(source.slice(item.anchor.start, item.anchor.end), item.anchor.quote);
  }
});
