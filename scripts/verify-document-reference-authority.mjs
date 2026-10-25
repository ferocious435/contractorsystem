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

test('a chapter-specific citation does not prove a different or unidentified clause under the default base', () => {
  const value = graph([root(inclusion), specification, blueBook]);
  assert.equal(resolve(value, { sectionCode: '34.02' }).applicability, 'NEEDS_REVIEW');
  assert.equal(resolve(value, { sectionCode: null }).applicability, 'NEEDS_REVIEW');
});

test('an inclusive chapter list proves its listed chapters but leaves an unlisted clause unverified', () => {
  const value = graph([root('על העבודה יחולו הפרקים: 00 - מוקדמות 57 - קווי מים של המפרט הכללי מהדורת 2023.'), blueBook]);
  assert.equal(resolve(value).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: '34' }).applicability, 'NEEDS_REVIEW');
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

test('different editions of separate chapters preserve the document default and each verified chapter', () => {
  const first = root('על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.');
  const second = { ...root('על העבודה יחול פרק 51 של המפרט הכללי מהדורת 2014.'), id: 'chapter-51-contract' };
  const value = graph([first, second, blueBook]);
  assert.equal(resolve(value, { sectionCode: null, edition: null, requireEdition: false }).applicability, 'CONFIRMED');
  assert.equal(resolve(value).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: '51.01', edition: '2014' }).applicability, 'CONFIRMED');
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

test('a textbook example does not fabricate an incorporation chain for the independently default shelf contract', () => {
  const ref = { ...blueBook, clauses: [clause('דוגמאות: החוזה הממשלתי מדף 3210 הוא נוסח סטנדרטי המחייב את משרדי הממשלה.', '57', '2023')] };
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const value = graph([root('על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.'), ref, shelf]);
  const result = resolve(value, { targetDocumentId: 'shelf', requireEdition: false });
  assert.equal(result.applicability, 'CONFIRMED');
  assert.equal(result.reason, 'system_default_reference');
  assert.deepEqual(result.chain, []);
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

test('both base reference families apply without a direct contract link and without a fabricated chain', () => {
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const value = graph([blueBook, shelf]);
  for (const targetDocumentId of ['blue-book', 'shelf']) {
    const result = resolve(value, { targetDocumentId, sectionCode: null, edition: null, requireEdition: false });
    assert.equal(result.applicability, 'CONFIRMED');
    assert.equal(result.reason, 'system_default_reference');
    assert.deepEqual(result.chain, []);
    assert.equal(value.documents.find(d => d.id === targetDocumentId).role, 'REFERENCE');
  }
});

test('a whole-book exclusion beats an otherwise confirmed incorporation chain', () => {
  const quote = 'המפרט הכללי לא יחול על העבודה.';
  const value = graph([root('על העבודה יחול המפרט הכללי מהדורת 2023.'),
    { ...root(quote), id: 'special-condition' }, blueBook]);
  const result = resolve(value, { requireEdition: false });
  assert.equal(result.applicability, 'REFERENCE_ONLY');
  assert.equal(result.reason, 'project_contract_exclusion');
  assert.deepEqual(result.contractEvidence, [{ documentId: 'special-condition', title: 'הסכם הפרויקט', quote, sectionCode: null }]);
});

test('a whole shelf-contract exclusion overrides its system default', () => {
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const value = graph([root('חוזה מדף 3210 לא יחול על העבודה.'), shelf]);
  assert.equal(resolve(value, { targetDocumentId: 'shelf', requireEdition: false }).reason, 'project_contract_exclusion');
});

test('excluding one blue-book chapter preserves the book and other chapters as the default base', () => {
  const quote = 'פרק 57 של המפרט הכללי לא יחול על העבודה.';
  const value = graph([root(quote), blueBook]);
  assert.equal(resolve(value, { sectionCode: '57.01', requireEdition: false }).applicability, 'REFERENCE_ONLY');
  assert.equal(resolve(value, { sectionCode: '51.04', requireEdition: false }).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: null, edition: null, requireEdition: false }).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: '57.01', requireEdition: false }).contractEvidence[0].quote, quote);
});

test('shelf-contract exclusions match full section boundaries rather than short digit prefixes', () => {
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const value = graph([root('סעיף 48 של חוזה מדף 3210 לא יחול על העבודה.'), shelf]);
  for (const sectionCode of ['48', '48.1']) {
    assert.equal(resolve(value, { targetDocumentId: 'shelf', sectionCode, requireEdition: false }).applicability, 'REFERENCE_ONLY');
  }
  for (const sectionCode of ['47', '480']) {
    assert.equal(resolve(value, { targetDocumentId: 'shelf', sectionCode, requireEdition: false }).applicability, 'CONFIRMED');
  }
});

test('a conditional chapter rule remains uncertain only for that chapter', () => {
  const value = graph([root('פרק 57 של המפרט הכללי יחול רק אם המזמין יאשר זאת בעתיד.'), blueBook]);
  assert.equal(resolve(value, { sectionCode: '57.01', requireEdition: false }).applicability, 'NEEDS_REVIEW');
  assert.equal(resolve(value, { sectionCode: '51', requireEdition: false }).applicability, 'CONFIRMED');
});

test('an exclusion inside an unresolved condition is not treated as an unconditional cancellation', () => {
  const value = graph([root('אם המזמין יאשר זאת בעתיד, פרק 57 של המפרט הכללי לא יחול על העבודה.'), blueBook]);
  assert.equal(resolve(value, { sectionCode: '57', requireEdition: false }).applicability, 'NEEDS_REVIEW');
});

test('work evidence and library examples cannot cancel the default project base', () => {
  const quote = 'המפרט הכללי לא יחול על העבודה.';
  const value = graph([blueBook, { id: 'letter', title: 'מכתב', role: 'WORK_EVIDENCE', clauses: [clause(quote)] },
    { id: 'guide', title: 'מדריך', role: 'REFERENCE', clauses: [clause(quote)] }]);
  const result = resolve(value, { sectionCode: null, edition: null, requireEdition: false });
  assert.equal(result.applicability, 'CONFIRMED');
  assert.deepEqual(result.contractEvidence || [], []);
});

test('a project textbook example is not an operative exclusion', () => {
  const value = graph([root('לדוגמה: המפרט הכללי לא יחול על העבודה.'), blueBook]);
  assert.equal(resolve(value, { sectionCode: null, edition: null, requireEdition: false }).applicability, 'CONFIRMED');
});

test('not attaching a physical book does not exclude its contractual default', () => {
  const value = graph([root('המפרט הכללי אינו מצורף לחוברת המכרז.'), blueBook]);
  assert.equal(resolve(value, { sectionCode: null, edition: null, requireEdition: false }).applicability, 'CONFIRMED');
});

test('the default base does not prove an unidentified clause or edition', () => {
  const result = resolve(graph([blueBook]), { sectionCode: null, edition: null, requireEdition: true });
  assert.equal(result.applicability, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'reference_clause_not_verified');
});

test('the system default does not extend to unrelated standards or a missing document identity', () => {
  const standard = { id: 'standard', title: 'תקן ישראלי 1205', role: 'REFERENCE', referenceType: 'ISRAELI_STANDARD', clauses: [] };
  const value = graph([standard]);
  assert.equal(resolve(value, { targetDocumentId: 'standard', requireEdition: false }).applicability, 'REFERENCE_ONLY');
  assert.equal(resolve(value, { targetDocumentId: 'absent', requireEdition: false }).applicability, 'REFERENCE_ONLY');
});

test('an explicitly replaced shelf clause requires review rather than using the original provision', () => {
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const value = graph([root('סעיף 48 של חוזה מדף 3210 יוחלף בתנאי החוזה המיוחדים.'), shelf]);
  assert.equal(resolve(value, { targetDocumentId: 'shelf', sectionCode: '48', requireEdition: false }).applicability, 'NEEDS_REVIEW');
  assert.equal(resolve(value, { targetDocumentId: 'shelf', sectionCode: '49', requireEdition: false }).applicability, 'CONFIRMED');
});

test('a narrower exclusion does not cancel the entire parent chapter', () => {
  const value = graph([root('סעיף 57.01 של המפרט הכללי לא יחול על העבודה.'), blueBook]);
  assert.equal(resolve(value, { sectionCode: '57', requireEdition: false }).applicability, 'NEEDS_REVIEW');
  assert.equal(resolve(value, { sectionCode: '57.01.02', requireEdition: false }).applicability, 'REFERENCE_ONLY');
  assert.equal(resolve(value, { sectionCode: '57.02', requireEdition: false }).applicability, 'CONFIRMED');
});

test('an explicitly exclusive chapter list limits the default without requiring a negation', () => {
  const value = graph([root('על העבודה יחולו רק פרקים 51 ו57 של המפרט הכללי.'), blueBook]);
  assert.equal(resolve(value, { sectionCode: '51', requireEdition: false }).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: '57.01', requireEdition: false }).applicability, 'CONFIRMED');
  assert.equal(resolve(value, { sectionCode: '34', requireEdition: false }).applicability, 'REFERENCE_ONLY');
});

test('a mixed-family statement does not assign one family exclusion to both families', () => {
  const shelf = { id: 'shelf', title: 'חוזה מדף 3210', role: 'REFERENCE', referenceType: 'SHELF_CONTRACT_3210', clauses: [] };
  const quote = 'סעיף 48 של חוזה מדף 3210 לא יחול, ואילו פרק 57 של המפרט הכללי יחול.';
  const value = graph([root(quote), blueBook, shelf]);
  assert.equal(resolve(value, { sectionCode: '57', requireEdition: false }).applicability, 'NEEDS_REVIEW');
});

test('a real incorporation chain does not hide a scoped project exclusion in the family report', () => {
  const quote = 'פרק 57 של המפרט הכללי לא יחול על העבודה.';
  const value = graph([root('על העבודה יחול המפרט הכללי.'), { ...root(quote), id: 'special' }, blueBook]);
  const report = authority.buildDocumentReferenceCheckReport(value);
  assert.equal(report.references[0].applicability, 'CONFIRMED');
  assert.deepEqual(report.references[0].contractEvidence, [{ documentId: 'special', title: 'הסכם הפרויקט', quote, sectionCode: '57' }]);
});
