import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { quality } from './radar-point-1-3-harness.mjs';

const letter = { id: 'letter', title: 'התראה.docx', category: 'EXECUTION',
  extracted_text: 'במסגרת הסכם המקדמה התחייבתם להשלים את עבודות המים והביוב לא יאוחר מיום 01.06.2025.' };
const contract = { id: 'contract', title: 'חוזה.docx', category: 'CONTRACT', extracted_text: 'תקופת הביצוע תהיה 19 חודשים.' };
function review(documents) {
  assert.equal(typeof quality.reviewCompletionDeadlineBasis, 'function');
  return quality.reviewCompletionDeadlineBasis({ currentWorkDocument: letter, documents });
}

test('an explicit deadline claim is linked to its missing agreement, not to total contract duration', () => {
  const result = review([letter, contract]);
  assert.equal(result.status, 'BASIS_NOT_FOUND_IN_READABLE_SOURCES');
  assert.deepEqual(result.referenceDates, ['2025-06-01']);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].role, 'CLAIM');
  assert.equal(result.documentsChecked, 2);
  assert.equal(letter.extracted_text.slice(result.references[0].anchor.start, result.references[0].anchor.end), result.references[0].anchor.quote);
});

test('a named agreement is located by its own clause without declaring the claim proved', () => {
  const agreement = { id: 'advance', title: 'הסכם מקדמה.docx', category: 'CONTRACT',
    extracted_text: 'הקבלן מתחייב להשלים את עבודות המים והביוב עד ליום 01.06.2025.' };
  const result = review([letter, contract, agreement]);
  assert.equal(result.status, 'BASIS_LOCATED');
  assert.deepEqual(result.agreementSources.map(source => source.documentId), ['advance']);
  assert.equal(result.provesBreach, false);
});

test('an unrelated company advance is not treated as the project completion agreement', () => {
  const unrelated = { id: 'other', title: 'תשתיות תקשורת.docx', category: 'EXECUTION',
    extracted_text: 'חברות התקשורת דורשות מקדמה לפי חשבון מיום 01.06.2025 בסך 200000 ש"ח.' };
  const result = review([letter, unrelated]);
  assert.equal(result.references.length, 1);
  assert.equal(result.status, 'BASIS_NOT_FOUND_IN_READABLE_SOURCES');
});

test('a legacy unread PDF does not become the missing contractual proof', () => {
  const unread = { id: 'unread', title: 'הסכם מקדמה.pdf', category: 'CONTRACT', ocr_status: 'COMPLETED',
    extracted_text: 'הקבלן מתחייב להשלים את העבודות עד ליום 01.06.2025.' };
  const result = review([letter, unread]);
  assert.equal(result.status, 'BASIS_NOT_FOUND_IN_READABLE_SOURCES');
  assert.ok(result.unreadDocumentIds.includes('unread'));
  assert.equal(result.agreementSources.length, 0);
});

test('different stated deadlines remain different reported dates without selecting a contractual truth', () => {
  const other = { ...letter, id: 'other', extracted_text: letter.extracted_text.replace('01.06.2025', '01.03.2025') };
  const result = review([letter, other]);
  assert.deepEqual(result.referenceDates, ['2025-03-01', '2025-06-01']);
  assert.equal(result.referencesDisagree, true);
  assert.equal(result.provesBreach, false);
});

test('the scope belongs to the completion clause, not another work item or the issuer of the letter', () => {
  const projectLetter = { ...letter, id: 'project', extracted_text: 'עבודות המים והביוב מתקדמות. במסגרת הסכם המקדמה התחייבתם להשלים את ביצוע הפרויקט לא יאוחר מיום 01.06.2025, מבלי לגרוע מהזכויות הנתונות לתאגיד.' };
  const unspecified = { ...letter, id: 'unspecified', extracted_text: 'במסגרת הסכם המקדמה התחייבתם להשלים את העבודות לא יאוחר מיום 01.06.2025, מבלי לגרוע מהזכויות הנתונות לתאגיד.' };
  const result = review([projectLetter, unspecified]);
  assert.equal(result.references.find(source => source.documentId === 'project').scope, 'PROJECT');
  assert.equal(result.references.find(source => source.documentId === 'unspecified').scope, 'UNSPECIFIED');
});

test('the available real warning letters are checked without promoting them into the agreement itself', () => {
  const path = new URL('../data/point1-audit/point13-install-deadline-letters-20261021.json', import.meta.url);
  if (!fs.existsSync(path)) return;
  const documents = JSON.parse(fs.readFileSync(path, 'utf8'));
  const result = review(documents);
  assert.equal(result.status, 'BASIS_NOT_FOUND_IN_READABLE_SOURCES');
  assert.ok(result.referenceDates.includes('2025-06-01'));
  assert.ok(result.references.length >= 4);
  assert.equal(result.provesBreach, false);
  for (const source of result.references) {
    const document = documents.find(item => item.id === source.documentId);
    assert.equal(document.extracted_text.slice(source.anchor.start, source.anchor.end), source.anchor.quote);
    if (source.documentId === 'f98e828a-d911-451c-a154-14a95676eb4a') assert.equal(source.scope, 'PROJECT');
  }
});
