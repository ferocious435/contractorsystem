import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { completeDocx, replayExtractedDocxText } from './fixtures/docx-reading-verification.mjs';
import './radar-point-1-3-harness.mjs';

const history = await import('../src/utils/radar-issue-history.ts').catch(() => ({}));
const issue = { subject: 'MTM', location: 'יהלום' };
const document = (id, date, text) => ({ ...completeDocx, ocr_status: 'COMPLETED', id, title: `פרוטוקול ${date}.docx`,
  extracted_text: `${date ? `תאריך: ${date}\n` : ''}${text}` });
const assess = (documents, rest = {}) => {
  assert.equal(typeof history.buildIssueHistory, 'function', 'Product history builder must exist');
  return history.buildIssueHistory({ issue, documents, asOf: '2025-06-24', ...rest });
};

test('mtm_unsigned_is_not_refused: blank contract signature wording proves neither signing nor refusal', () => {
  const result = assess([document('annex', '', 'נספח לחוזה התקשרות\nשנחתם ביום ______ לחודש _____ בשנת 2024\nמעבר לשיטת קידוח MTM ברחוב יהלום בכפוף להתחייבויות הקבלן.\nלא יחול כל שינוי בתמורה.\nולראיה באו הצדדים על החתום:\n__________________')]);
  assert.equal(result.aspects.SIGNATURE.state, 'UNKNOWN');
  assert.equal(result.aspects.PRICE.state, 'PROPOSED');
  assert.ok(!result.events.some(event => ['SIGNED', 'REFUSED', 'AGREED'].includes(event.state)));
});

test('conditional_approval_is_not_closed', () => {
  const result = assess([document('method', '02.01.2025', 'קידוח MTM ברחוב יהלום: התקבל אישור עקרוני. עד לחתימה על נספח אין לקבלן אישור לפעול לקידום השיטה.')]);
  assert.equal(result.aspects.METHOD.state, 'CONDITIONAL');
  assert.equal(result.closed, false);
});

test('same_topic_other_aspect_does_not_close_issue', () => {
  const result = assess([document('price', '01.01.2025', 'קידוח MTM ברחוב יהלום: ניתוח המחיר טרם אושר.'),
    document('method', '02.01.2025', 'קידוח MTM ברחוב יהלום אושר לביצוע.')]);
  assert.equal(result.aspects.METHOD.state, 'APPROVED');
  assert.equal(result.aspects.PRICE.state, 'PENDING');
  assert.equal(result.closed, false);
});

test('future_owner_note_does_not_change_past_state', () => {
  const documents = [document('letter', '24.06.2025', 'טרם חתמתם על מסמך מעבר לשיטת קידוח מיקרוטאנלינג ברחוב יהלום.')];
  const result = assess(documents, { ownerNotes: [{ id: 'owner-signing', aspect: 'SIGNATURE', state: 'SIGNED',
    text: 'Позднее документ был подписан; подтверждения в доступных материалах нет.', date: null, origin: 'OWNER_NOTE' }] });
  assert.equal(result.aspects.SIGNATURE.state, 'NOT_SIGNED');
  assert.equal(result.ownerNotes.length, 1);
  assert.equal(result.ownerNotes[0].date, null);
  assert.equal(result.closed, false);
});

test('date_from_filename_does_not_prove_resolution', () => {
  const result = assess([{ ...completeDocx, ocr_status: 'COMPLETED', id: 'method', title: 'פרוטוקול 02.01.2025.docx', extracted_text: 'קידוח MTM ברחוב יהלום אושר לביצוע.' }]);
  assert.notEqual(result.aspects.METHOD.state, 'APPROVED');
  assert.ok(result.gaps.some(gap => gap.reason === 'EVENT_DATE_UNCONFIRMED'));
});

test('own date takes precedence over filename and referenced foreign letter', () => {
  const doc = { ...completeDocx, ocr_status: 'COMPLETED', id: 'header', title: 'מענה לפרוטוקול מיום 12.03.2025.docx',
    extracted_text: 'תאריך: 17.03.2025\nבהמשך למכתב מיום 12.03.2025.\nקידוח MTM ברחוב יהלום אושר לביצוע.' };
  const result = assess([doc]);
  assert.equal(result.events[0].date, '2025-03-17');
  assert.equal(result.events[0].dateSource, 'CONTENT');
  assert.equal(result.aspects.METHOD.state, 'APPROVED');
  assert.equal(doc.extracted_text.slice(result.events[0].dateAnchor.start, result.events[0].dateAnchor.end), result.events[0].dateAnchor.quote);
});

test('a foreign letter date in body text cannot date this document', () => {
  const result = assess([{ id: 'reply', title: 'reply 02.01.2025.docx',
    extracted_text: 'בהמשך למכתב הקבלן, תאריך: 02.01.2025\nקידוח MTM ברחוב יהלום אושר לביצוע.' }]);
  assert.notEqual(result.aspects.METHOD.state, 'APPROVED');
});
test('the own header date is anchored in the original full text, not a quoted protocol deep in the body', () => {
  const text = `תאריך: 17.03.2025\n${'תוכן מסמך ארוך '.repeat(2000)}\nציטוט מפרוטוקול קודם: תאריך הישיבה 01.01.2024`;
  const result = history.documentEventDate({ id: 'long', title: 'long.docx', extracted_text: text });
  assert.equal(result.date, '2025-03-17');
  assert.equal(text.slice(result.dateAnchor.start, result.dateAnchor.end), result.dateAnchor.quote);
  const withoutHeader = history.documentEventDate({ id: 'foreign', title: 'foreign.docx', extracted_text: text.slice(text.indexOf('\n') + 1) });
  assert.equal(withoutHeader.date, null);
});

test('a subject heading includes its price and signature bullets but stops before another subject', () => {
  const result = assess([document('method', '01.01.2025', 'קידוח MTM ברחוב יהלום: התקבל אישור עקרוני בכפוף לחתימת הנספח.'),
    document('letter', '02.01.2025', 'נדרש להתייחס לנושא קידוח MTM ברחוב יהלום:\n- לא התקבלה חתימתך על הנספח ולא נמסר ניתוח מחיר.\nכמו כן, מחיר ההידרנטים אושר בהסכמה בין הצדדים.')]);
  assert.equal(result.aspects.SIGNATURE.state, 'NOT_SIGNED');
  assert.equal(result.aspects.PRICE.state, 'PENDING');
  assert.equal(result.aspects.METHOD.state, 'CONDITIONAL');
});

test('adjacent subject approval and subcontractor approval are not approval of the MTM method', () => {
  const result = assess([document('protocol', '02.01.2025', 'קידוח MTM ברחוב יהלום: קבלן המשנה אושר לביצוע העבודות. הידרנטים – המחיר להידרנטים אושר בהסכמה בין הצדדים.')]);
  assert.notEqual(result.aspects.METHOD.state, 'APPROVED');
  assert.notEqual(result.aspects.PRICE.state, 'AGREED');
  assert.ok(result.events.every(event => !event.anchor.quote.includes('הידרנטים')));
});

test('same-date opposing decisions stay disputed, independent of input order', () => {
  const docs = [document('approved', '02.01.2025', 'המחיר לקידוח MTM ברחוב יהלום אושר בהסכמה בין הצדדים.'),
    document('not-approved', '02.01.2025', 'המחיר לקידוח MTM ברחוב יהלום טרם אושר.')];
  const a = assess(docs), b = assess([...docs].reverse());
  assert.equal(a.aspects.PRICE.state, 'DISPUTED');
  assert.deepEqual(a, b);
});

test('different place and unread PDF cannot resolve this issue', () => {
  const result = assess([document('price', '01.01.2025', 'המחיר לקידוח MTM ברחוב יהלום טרם אושר.'),
    document('other-street', '02.01.2025', 'המחיר לקידוח MTM ברחוב הרצל אושר בהסכמה בין הצדדים.'),
    { ...document('unread', '03.01.2025', 'המחיר לקידוח MTM ברחוב יהלום אושר בהסכמה בין הצדדים.'), title: 'הסכם.pdf', ocr_status: 'COMPLETED' }]);
  assert.equal(result.aspects.PRICE.state, 'PENDING');
  assert.ok(result.gaps.some(gap => gap.documentId === 'unread' && gap.reason === 'SOURCE_NOT_READY'));
});

test('layout spaces inside the microtunneling name do not hide an unread related source', () => {
  const result = assess([{ id: 'spaced-pdf', title: 'מענה לפרוטוקול.pdf', ocr_status: 'COMPLETED',
    extracted_text: 'קידוח מיקרוט\tאנלינ\tג ברחוב יהלום. המסמך טרם נחתם.' }]);
  assert.ok(result.gaps.some(gap => gap.documentId === 'spaced-pdf' && gap.reason === 'SOURCE_NOT_READY'));
  assert.equal(result.events.length, 0);
});

test('asOf excludes a later documentary signing and signature never proves price agreement', () => {
  const docs = [document('unsigned', '01.01.2025', 'מסמך קידוח MTM ברחוב יהלום טרם נחתם.'),
    document('signed', '01.07.2025', 'מסמך קידוח MTM ברחוב יהלום נחתם על ידי שני הצדדים.')];
  assert.equal(assess(docs).aspects.SIGNATURE.state, 'NOT_SIGNED');
  const later = assess(docs, { asOf: '2025-07-02' });
  assert.equal(later.aspects.SIGNATURE.state, 'SIGNED');
  assert.equal(later.aspects.PRICE.state, 'UNKNOWN');
});

test('a verified final decision for all three aspects can close the issue', () => {
  const result = assess([document('decision', '24.06.2025', 'קידוח MTM ברחוב יהלום אושר לביצוע.\nמסמך קידוח MTM ברחוב יהלום נחתם על ידי שני הצדדים.\nהמחיר לקידוח MTM ברחוב יהלום אושר בהסכמה בין הצדדים.')]);
  assert.equal(result.closed, true);
  assert.equal(result.aspects.METHOD.state, 'APPROVED');
  assert.equal(result.aspects.SIGNATURE.state, 'SIGNED');
  assert.equal(result.aspects.PRICE.state, 'AGREED');
});

test('actual saved MTM corpus: verifiable anchors, June unsigned, filename mismatch, no invented agreed price', () => {
  const filename = process.env.RADAR_MTM_SNAPSHOT || 'data/point1-audit/point13-step4-mtm-corpus-before-20261022.json';
  assert.ok(fs.existsSync(filename), 'Full saved source corpus is required for this acceptance test');
  const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const documents = saved.documents.map(doc => replayExtractedDocxText({ ...doc, parsed_json: { source_reading: doc.source_reading } }));
  const result = assess(documents);
  assert.equal(result.aspects.SIGNATURE.state, 'NOT_SIGNED');
  assert.equal(result.aspects.PRICE.state, 'PENDING');
  assert.equal(result.aspects.METHOD.state, 'CONDITIONAL');
  assert.equal(result.closed, false);
  assert.ok(!result.events.some(event => event.state === 'REFUSED'));
  const december = result.events.filter(event => event.anchor.documentId.startsWith('5da1e4d5'));
  assert.ok(december.length > 0);
  assert.ok(december.every(event => event.date === '2024-12-17'));
  for (const event of result.events) {
    const source = documents.find(doc => doc.id === event.anchor.documentId).extracted_text;
    for (const anchor of [event.anchor, event.dateAnchor].filter(Boolean)) {
      assert.equal(source.slice(anchor.start, anchor.end), anchor.quote, `${event.id}: exact saved source anchor`);
    }
  }
});
