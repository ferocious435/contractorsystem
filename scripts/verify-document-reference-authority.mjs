import assert from 'node:assert/strict';
import test from 'node:test';

const authority = await import('../src/utils/document-reference-authority.ts');
const clause = (text, sectionCode = null, edition = null) => ({ text, sectionCode, edition });
const root = (text) => ({ id: 'contract', title: 'הסכם הפרויקט', role: 'PROJECT_CONTRACT', clauses: [clause(text)] });
const specification = {
  id: 'spec', title: 'מפרט מיוחד לניקוז', role: 'REFERENCE',
  clauses: [clause('על עבודות הניקוז יחול פרק 57 של המפרט הכללי מהדורת 2023.')],
};
const blueBook = { id: 'blue-book', title: 'המפרט הכללי / הספר הכחול', role: 'REFERENCE', referenceType: 'BLUE_BOOK', clauses: [] };
const inclusion = 'המפרט המיוחד לניקוז מהווה חלק בלתי נפרד ממסמכי החוזה.';
const graph = (documents, declaredLinks = []) => authority.buildDocumentReferenceGraph({ documents, declaredLinks });
const resolve = (value, options = {}) => authority.resolveDocumentReferenceAuthority(value, {
  targetDocumentId: 'blue-book', sectionCode: '57.01', edition: '2023', requireEdition: true, ...options,
});

test('a reference through a binding specification retains every exact incorporation quote', () => {
  const result = resolve(graph([root(inclusion), specification, blueBook]));
  assert.equal(result.applicability, 'CONFIRMED');
  assert.deepEqual(result.chain.map((step) => [step.sourceDocumentId, step.targetDocumentId, step.quote]), [
    ['contract', 'spec', inclusion], ['spec', 'blue-book', specification.clauses[0].text],
  ]);
});

test('a three-hop reference chain is followed without promoting the whole reference library', () => {
  const intermediate = { id: 'annex', title: 'נספח בקרת איכות', role: 'REFERENCE',
    clauses: [clause('המפרט המיוחד לניקוז מהווה חלק בלתי נפרד מדרישות נספח זה.')] };
  const value = graph([root('נספח בקרת איכות מהווה חלק בלתי נפרד מהחוזה.'), intermediate, specification, blueBook]);
  assert.equal(resolve(value).chain.length, 3);
});

test('an unincorporated reference and a work letter cannot establish contractual authority', () => {
  const letter = { id: 'letter', title: 'מכתב מענה', role: 'WORK_EVIDENCE', clauses: [clause(inclusion)] };
  for (const documents of [[specification, blueBook], [letter, specification, blueBook]]) {
    assert.notEqual(resolve(graph(documents)).applicability, 'CONFIRMED');
  }
});

test('a reference cycle cannot create its own contractual root', () => {
  const loop = { ...blueBook, clauses: [clause(inclusion)] };
  const value = graph([specification, loop]);
  assert.notEqual(resolve(value).applicability, 'CONFIRMED');
  assert.ok(value.issues.some((issue) => issue.reason === 'reference_cycle'));
});

test('a chapter-specific reference does not authorize a different or unidentified chapter', () => {
  const value = graph([root(inclusion), specification, blueBook]);
  assert.equal(resolve(value, { sectionCode: '34.02' }).applicability, 'REFERENCE_ONLY');
  assert.equal(resolve(value, { sectionCode: null }).applicability, 'NEEDS_REVIEW');
});

test('an explicit chapter list authorizes its listed chapters and does not authorize an unlisted one', () => {
  const value = graph([root('על העבודה יחולו הפרקים: 00 - מוקדמות 57 - קווי מים של המפרט הכללי מהדורת 2023.'), blueBook]);
  assert.equal(resolve(value).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: '34' }).applicability, 'REFERENCE_ONLY');
});

test('an unresolved relative chapter reference cannot silently authorize the whole book', () => {
  const value = graph([root('העבודה תבוצע בהתאם לסעיפים הנ"ל במפרט הכללי מהדורת 2023.'), blueBook]);
  assert.equal(resolve(value).applicability, 'NEEDS_REVIEW');
});

test('the edition must be known and must match the incorporation clause', () => {
  const value = graph([root(inclusion), specification, blueBook]);
  assert.equal(resolve(value, { edition: '2026' }).applicability, 'NEEDS_REVIEW');
  assert.equal(resolve(value, { edition: null }).applicability, 'NEEDS_REVIEW');
});

test('incompatible project edition references are reported instead of choosing whichever matches the library', () => {
  const other = { ...root('על עבודות הניקוז יחול פרק 57 של המפרט הכללי מהדורת 2026.'), id: 'other-project-spec' };
  const value = graph([root(inclusion), specification, other, blueBook]);
  const result = resolve(value);
  assert.equal(result.applicability, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'conflicting_reference_editions');
});

test('a text mentioning several editions does not identify one verified edition', () => {
  assert.equal(authority.referenceEditionFromText('מהדורת 2023 הוחלפה לאחר מכן במהדורת 2026'), null);
});

test('two editions from different months of the same year are not collapsed to the year', () => {
  const value = graph([root('על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023-06.'), blueBook]);
  assert.equal(authority.referenceEditionFromText('מהדורת 2023-06'), '2023-06');
  assert.equal(resolve(value, { edition: '2023-01' }).applicability, 'NEEDS_REVIEW');
});

test('an unspecified required edition is not silently replaced with the loaded edition', () => {
  const noEdition = { ...specification, clauses: [clause('על עבודות הניקוז יחול פרק 57 של המפרט הכללי.')] };
  assert.equal(resolve(graph([root(inclusion), noEdition, blueBook])).applicability, 'NEEDS_REVIEW');
});

test('a scoped intermediate source cannot incorporate a new document from a different chapter', () => {
  const limitedRoot = root('על העבודות יחול פרק 57 של המפרט הכללי מהדורת 2023.');
  const ref = { ...blueBook, clauses: [clause('נספח בקרת איכות מהווה חלק בלתי נפרד מדרישות המפרט.', '34', '2023')] };
  const annex = { id: 'annex', title: 'נספח בקרת איכות', role: 'REFERENCE', clauses: [] };
  assert.notEqual(resolve(graph([limitedRoot, ref, annex]), { targetDocumentId: 'annex', requireEdition: false }).applicability, 'CONFIRMED');
});

test('an unproved intermediate reference edition cannot confer authority on a further standard', () => {
  const ref = { ...blueBook, clauses: [clause('הצנרת תעמוד בדרישות תקן ישראלי 1205 מהדורת 2020.', '57', '2026')] };
  const standard = { id: 'standard', title: 'תקן ישראלי 1205', referenceType: 'ISRAELI_STANDARD', role: 'REFERENCE', clauses: [] };
  const value = graph([root('על עבודות הניקוז יחול פרק 57 של המפרט הכללי.'), ref, standard]);
  assert.equal(resolve(value, { targetDocumentId: 'standard', edition: '2020', sectionCode: null }).applicability, 'NEEDS_REVIEW');
});

test('a long ambiguous reference statement is reported instead of being silently lost or treated as binding', () => {
  const text = `על העבודות יחול המפרט הכללי מהדורת 2023 ${'תנאים נוספים '.repeat(160)}`;
  const value = graph([root(text), blueBook]);
  assert.notEqual(resolve(value).applicability, 'CONFIRMED');
  assert.ok(value.issues.some((issue) => issue.reason === 'reference_context_too_long'));
});

for (const text of [
  'המפרט הכללי נמצא בתיק הפרויקט ונשמר בספרייה.',
  'פרק 57 של המפרט הכללי לא יחול על עבודות הניקוז.',
  'פרק 57 של המפרט הכללי יחול רק אם המזמין יאשר זאת בעתיד.',
  'האם פרק 57 של המפרט הכללי מהדורת 2023 יחול על העבודה?',
  'המפרט הכללי מהווה מקור עזר בלבד ואינו חלק ממסמכי החוזה.',
]) {
  test(`a mention, exclusion, condition or question is not a binding reference: ${text}`, () => {
    assert.notEqual(resolve(graph([root(text), blueBook])).applicability, 'CONFIRMED');
  });
}

test('a declared incorporation must be quoted in the exact named source document', () => {
  const value = graph([root('הסכם לביצוע עבודות.'), specification, blueBook], [{
    sourceDocumentId: 'contract', targetDocumentId: 'blue-book', quote: specification.clauses[0].text, status: 'CONFIRMED',
  }]);
  assert.notEqual(resolve(value).applicability, 'CONFIRMED');
  assert.ok(value.issues.some((issue) => issue.reason === 'incorporation_quote_not_found'));
});

test('a declared excerpt cannot omit a negation or chapter restriction from its surrounding source sentence', () => {
  for (const [source, excerpt, sectionCode] of [
    ['על העבודה לא יחול פרק 57 של המפרט הכללי מהדורת 2023.', 'יחול פרק 57 של המפרט הכללי מהדורת 2023.', '57'],
    ['על פרק 57 בלבד יחול המפרט הכללי מהדורת 2023.', 'יחול המפרט הכללי מהדורת 2023.', '34'],
  ]) {
    const value = graph([root(source), blueBook], [{ sourceDocumentId: 'contract', targetDocumentId: 'blue-book',
      quote: excerpt, status: 'CONFIRMED' }]);
    assert.notEqual(resolve(value, { sectionCode }).applicability, 'CONFIRMED');
  }
});

test('an incorporation cannot be confirmed without an identifiable source document', () => {
  const anonymous = { ...root('על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.'), id: '' };
  assert.notEqual(resolve(graph([anonymous, blueBook])).applicability, 'CONFIRMED');
});

test('a standard is identified by its complete number and is not confused with another standard', () => {
  const standards = [1205, 12050].map((number) => ({ id: `standard-${number}`, title: `תקן ישראלי ${number}`, role: 'REFERENCE',
    referenceType: 'ISRAELI_STANDARD', standardNumber: String(number), clauses: [] }));
  const value = graph([root('הצנרת תעמוד בדרישות תקן ישראלי 1205 מהדורת 2020.'), ...standards]);
  assert.equal(resolve(value, { targetDocumentId: 'standard-1205', sectionCode: null, edition: '2020' }).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { targetDocumentId: 'standard-12050', sectionCode: null, edition: '2020' }).applicability, 'REFERENCE_ONLY');
});

for (const text of [
  'ההידוק יבוצע על פי מפרט נת"י 51.02.04.04.02 ויעמוד בדרישות ההידוק לעבודות עפר ומצעים.',
  'הלוח יהיה בנוי לפי תקן 92634 DIN להתקנת חוץ.',
  'הבדיקה תהיה לפי המפרט/התקן 13 בדיקות אספלט בשטח.',
  'חוברת המכרז מהווה חלק בלתי 2 .',
]) {
  test(`a clause number, foreign standard or Hebrew word ending is not an Israeli-standard identifier: ${text}`, () => {
    const value = graph([root(text)]);
    assert.equal(value.issues.some((issue) => issue.targetLabel.startsWith('תקן ישראלי')), false);
  });
}

test('a quoted Israeli-standard abbreviation with a conjunction is still recognized', () => {
  const value = graph([root('פלדת הזיון תהיה לפי ת"י 31 ות"י 893 ובהתאם לתוכניות.')]);
  assert.deepEqual(value.issues.filter((issue) => issue.reason === 'referenced_document_missing').map((issue) => issue.targetLabel),
    ['תקן ישראלי 31', 'תקן ישראלי 893']);
});

test('a textbook example inside an incorporated library chapter cannot incorporate shelf contract 3210', () => {
  const ref = { ...blueBook, clauses: [clause('דוגמאות: החוזה הממשלתי מדף 3210 הוא נוסח סטנדרטי המחייב את משרדי הממשלה.', '57', '2023')] };
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const value = graph([root('על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.'), ref, shelf]);
  assert.equal(resolve(value, { targetDocumentId: 'shelf', requireEdition: false }).applicability, 'REFERENCE_ONLY');
});

test('an explicitly cited missing standard is reported with its original source and quote', () => {
  const quote = 'הצנרת תעמוד בדרישות תקן ישראלי 1205 מהדורת 2020.';
  const value = graph([root(quote)]);
  assert.ok(value.issues.some((issue) => issue.reason === 'referenced_document_missing'
    && issue.sourceDocumentId === 'contract' && issue.targetLabel.includes('1205') && issue.quote === quote));
});

test('a missing named reference family is reported even when no matching library row exists', () => {
  const value = graph([root('על העבודה יחול חוזה מדף 3210 מהדורת 2019.')]);
  assert.ok(value.issues.some((issue) => issue.reason === 'referenced_document_missing' && issue.targetLabel.includes('3210')));
});

test('the reference report distinguishes a missing standard in a binding chapter from one in an unrelated chapter', () => {
  const ref = { ...blueBook, clauses: [
    clause('הצנרת תעמוד בדרישות תקן ישראלי 1205 מהדורת 2020.', '57', '2023'),
    clause('הצנרת תעמוד בדרישות תקן ישראלי 12050 מהדורת 2020.', '34', '2023'),
  ] };
  const value = graph([root('על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.'), ref]);
  const report = authority.buildDocumentReferenceCheckReport(value);
  assert.deepEqual(report.missingRequiredDocuments.map((issue) => issue.targetLabel), ['תקן ישראלי 1205']);
});

test('a direct specification reference is found without trusting a stale incorporation-table flag', () => {
  const quote = 'מפרט מיוחד זה יש לקראו ולפרשו יחד עם המפרט הכללי על חלקיו השונים.';
  const value = graph([root(quote), blueBook]);
  assert.equal(resolve(value, { sectionCode: null, edition: null, requireEdition: false }).applicability, 'CONFIRMED');
  assert.equal(resolve(value).applicability, 'NEEDS_REVIEW', 'the binding link does not prove a particular edition');
});

test('a project document precedence clause is retained as evidence without inventing a generic winner', () => {
  const quote = 'בכל מקרה של סתירה בין המפרט המיוחד והמפרט הכללי, יקבע המפרט המיוחד והנחיות המפקח.';
  const value = graph([root(`${inclusion} ${quote}`), specification, blueBook]);
  assert.ok(value.precedenceEvidence.some((evidence) => evidence.documentId === 'contract' && evidence.quote === quote));
});
