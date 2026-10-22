import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const product = await import('../src/utils/radar-requirement-review.ts').catch(() => ({}));
const { buildDocumentReferenceGraph } = await import('../src/utils/document-reference-authority.ts');
const { savedIssueHistory } = await import('../src/utils/radar-issue-history-server.ts');
const { assessEvidenceRelation } = await import('../src/utils/radar-evidence-assessment.ts');
const { reviewIssueTiming } = await import('../src/utils/radar-issue-timing.ts');
hook.deregister();
const doc = (id, text, category = 'EXECUTION') => ({ id, title: `${id}.docx`, category, extracted_text: text });
const work = text => doc('request', `תאריך: 12.05.2025\nקידוח MTM ברחוב יהלום:\n${text}`);
function review(documents, referenceGraph) {
  assert.equal(typeof product.reviewIssueRequirements, 'function');
  return product.reviewIssueRequirements({ issue: { subject: 'MTM', location: 'יהלום' }, documents, referenceGraph, asOf: '2025-06-24' });
}
const rule = text => doc('special', text, 'SPECS');
const savedMtmPath = 'data/point1-audit/point13-step4-mtm-corpus-before-20261022.json';
const savedMtmOptions = { skip: !fs.existsSync(savedMtmPath) && 'Private project material is not part of a public checkout' };
const response = 'המפקח דורש להעביר תשובה בתוך 3 ימי עבודה ממועד המכתב.';
const responseRule = 'אין לדרוש מהקבלן תשובה בתוך פחות מ-7 ימי עבודה ממועד המכתב.';
function graph(edition = '2023', special = '') {
  return buildDocumentReferenceGraph({ documents: [
    { id: 'special', title: 'מפרט מיוחד', role: 'PROJECT_CONTRACT', clauses: [{ text: `על העבודה יחול פרק 00 של הספר הכחול מהדורת 2023. ${special}` }] },
    { id: 'blue', title: 'הספר הכחול', role: 'REFERENCE', referenceType: 'BLUE_BOOK', clauses: [
      { id: 'blue-00', page: 7, sectionCode: '00', edition, text: responseRule },
    ] },
  ] });
}

test('general operative clauses without MTM reach the requirement comparison', () => {
  const result = review([rule(responseRule), work(response)]);
  const item = result.requirements.find(item => item.kind === 'RESPOND');
  assert.equal(item.assessment, 'CONFLICT');
  assert.ok(item.basis.some(source => source.anchor.documentId === 'special' && source.anchor.quote === responseRule));
  assert.ok(!responseRule.includes('MTM'));
});
test('an incorporated chapter supplies the actual source and complete incorporation proof', () => {
  const result = review([work(response)], graph());
  const item = result.requirements.find(item => item.kind === 'RESPOND');
  assert.equal(item.assessment, 'CONFLICT');
  const source = item.basis.find(source => source.sourceKind === 'INCORPORATED_REFERENCE');
  assert.equal(source.referenceDocumentId, 'blue');
  assert.equal(source.anchor.documentId, 'blue-00');
  assert.equal(source.anchor.page, 7);
  assert.equal(source.chain[0].sourceDocumentId, 'special');
});
test('a different or unproved reference edition cannot prove a contradiction', () => {
  const result = review([work(response)], graph('2026'));
  assert.equal(result.requirements.find(item => item.kind === 'RESPOND').assessment, 'NEEDS_BASIS');
  assert.ok(result.referenceGaps.some(gap => gap.reason === 'referenced_edition_not_proven'));
});
test('an ordinary permitted method instruction has a source and creates no conflict', () => {
  const result = review([rule('המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.'), work('המפקח מורה בכתב לבצע את הקידוח בשיטת MTM.')]);
  const item = result.requirements.find(item => item.kind === 'METHOD_CHANGE');
  assert.equal(item.assessment, 'SUPPORTED');
  assert.equal(result.confirmedConflicts.length, 0);
});
test('permission to change the method does not authorize no-extra-payment or waiver conditions', () => {
  const result = review([rule('המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.'),
    work('המפקח מורה בכתב לבצע בשיטת MTM. לא תשולם כל תוספת מחיר עבור השינוי. הקבלן מוותר על כל טענותיו.')]);
  assert.equal(result.requirements.find(item => item.kind === 'NO_EXTRA_PAYMENT').assessment, 'NEEDS_BASIS');
  assert.equal(result.requirements.find(item => item.kind === 'WAIVE_CLAIMS').assessment, 'NEEDS_BASIS');
});
test('a request violating an explicit written-approval requirement is an actual pairwise conflict', () => {
  const result = review([rule('שינוי שיטת הביצוע טעון אישור מראש ובכתב של המנהל.'),
    work('המפקח מורה לבצע את הקידוח בשיטת MTM ללא אישור המנהל.')]);
  assert.equal(result.requirements.find(item => item.kind === 'METHOD_CHANGE').assessment, 'CONFLICT');
});
test('conditional method selection preserves the condition instead of inventing a duty to sign', () => {
  const result = review([rule('המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.'),
    work('ככל שהקבלן מעוניין בביצוע בשיטת MTM, עליו להעביר אישור מפורש עד לשעה 14:00. אם לא, עליו לבצע לפי המכרז.')]);
  assert.ok(!result.requirements.some(item => item.kind === 'SIGN_ANNEX'));
  assert.ok(result.requirements.every(item => item.assessment !== 'CONFLICT'));
});
test('unsigned proposed price and an employer assertion do not prove signed binding conditions', () => {
  const result = review([rule('כל עבודה נוספת טעונה אישור מראש ובכתב של המנהל.'),
    doc('annex', 'נספח לחוזה\nשנחתם ביום _____\nקידוח MTM ברחוב יהלום.\nלא תשולם כל תוספת מחיר עבור השינוי.\nהמזמין __________ הקבלן __________', 'CHANGE_ORDER'),
    work('נספח השינוי לקידוח MTM מהווה מסמך מחייב לביצוע. עד כה לא התקבלה חתימתך.')]);
  assert.equal(result.requirements.find(item => item.documentId === 'annex' && item.kind === 'NO_EXTRA_PAYMENT').assessment, 'PROPOSED_CHANGE');
  assert.ok(result.requirements.every(item => item.assessment !== 'SUPPORTED'));
});
test('request clock origin, business days and subject cannot be silently changed', () => {
  assert.equal(review([rule(responseRule), work('המפקח דורש להעביר תשובה בתוך 3 ימים ממועד קבלת המכתב.')]).confirmedConflicts.length, 0);
  assert.equal(review([rule('אין לדרוש תשובה על הגשת ערבות למכרז בתוך פחות מ-7 ימי עבודה.'), work(response)]).confirmedConflicts.length, 0);
});
test('a source applying after the available period cannot decide an earlier request', () => {
  assert.equal(review([rule(`תאריך: 01.07.2025\n${responseRule}`), work(response)]).confirmedConflicts.length, 0);
});
test('actual saved MTM material keeps unsigned-price proposals and exact quotes', savedMtmOptions, () => {
  const saved = JSON.parse(fs.readFileSync(savedMtmPath, 'utf8'));
  const documents = saved.documents.map(source => ({ ...source, parsed_json: { source_reading: source.source_reading } }));
  const result = review(documents);
  assert.equal(result.confirmedConflicts.length, 0);
  assert.ok(result.requirements.some(item => item.kind === 'NO_EXTRA_PAYMENT'));
  for (const item of result.requirements) assert.equal(documents.find(source => source.id === item.documentId).extracted_text.slice(item.anchor.start, item.anchor.end), item.anchor.quote);
});

test('an execution annex containing contract words and blank signatures is never a governing root', () => {
  const annex = { ...doc('annex', 'נספח לחוזה התקשרות\nשנחתם ביום ______\nהקבלן מתחייב לחתום על נספח MTM ברחוב יהלום.\nלא תשולם כל תוספת מחיר עבור השינוי.', 'EXECUTION'), title: 'נספח לחוזה התקשרות.docx' };
  const result = review([annex, work('המפקח דורש לחתום על נספח MTM.')]);
  assert.equal(result.sourceCount, 0);
  assert.ok(result.requirements.some(item => item.documentId === 'annex' && item.kind === 'NO_EXTRA_PAYMENT' && item.assessment === 'PROPOSED_CHANGE'));
  assert.ok(result.requirements.every(item => item.assessment !== 'SUPPORTED'));
});
test('neutral method descriptions are not requirements', () => {
  assert.equal(review([work('הדיון עסק בשיטת הקידוח MTM ובמצב העבודה באתר.')]).requirements.length, 0);
});
test('a later norm cannot retroactively decide an earlier request', () => {
  assert.equal(review([rule(`תאריך: 01.06.2025\n${responseRule}`), work(response)]).confirmedConflicts.length, 0);
});
test('an unqualified price adjustment and a blanket no-extra-price demand are incompatible', () => {
  const result = review([rule('כל שינוי בשיטת הביצוע מחייב עדכון התמורה.'), work('המפקח מורה לבצע בשיטת MTM. לא תשולם כל תוספת מחיר עבור השינוי.')]);
  assert.equal(result.requirements.find(item => item.kind === 'NO_EXTRA_PAYMENT').assessment, 'CONFLICT');
});

test('saved history includes general bases and invalidates only when a relevant source changes', () => {
  const row = { id: 'mtm', title: 'MTM', evidence_data: { work_quote: 'קידוח MTM ברחוב יהלום' } };
  const first = savedIssueHistory(row, [rule(responseRule), work(response)]);
  assert.equal(first.requirementReview.requirements.find(item => item.kind === 'RESPOND').assessment, 'CONFLICT');
  const unchanged = savedIssueHistory({ ...row, evidence_data: { ...row.evidence_data, issue_history: first } }, [rule(responseRule), work(response)]);
  assert.deepEqual(unchanged, first);
  const changed = savedIssueHistory({ ...row, evidence_data: { ...row.evidence_data, issue_history: first } },
    [rule('אין לדרוש מהקבלן תשובה בתוך פחות מ-2 ימי עבודה ממועד המכתב.'), work(response)]);
  assert.notEqual(changed.sourceSignature, first.sourceSignature);
  assert.equal(changed.requirementReview.confirmedConflicts.length, 0);
});

test('normal source comparison uses the same requirement rule as saved history', () => {
  const base = rule('שינוי שיטת הביצוע טעון אישור מראש ובכתב של המנהל.');
  const current = work('המפקח מורה לבצע את הקידוח בשיטת MTM ללא אישור המנהל.');
  const result = assessEvidenceRelation({ work: { document: current, quote: current.extracted_text },
    baseline: { document: base, quote: base.extracted_text } });
  assert.equal(result.relation, 'INCOMPATIBLE');
  assert.equal(result.reasons[0], 'method_instruction_waives_required_approval');
});

test('response deadlines on another protocol topic are not attached to MTM', () => {
  const result = review([doc('protocol', 'תאריך: 26.03.2025\nקידוח MTM ברחוב יהלום נדון בישיבה.\nהקבלן יעביר תשובה לגבי צילומי כביש 1 בתוך יומיים.')]);
  assert.equal(result.requirements.length, 0);
});
test('an explicit waiver of approval is not read as an approval requirement', () => {
  const result = review([rule('שינוי שיטת הביצוע אינו טעון אישור המנהל. המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.'),
    work('המפקח מורה בכתב לבצע את הקידוח בשיטת MTM ללא אישור המנהל.')]);
  assert.equal(result.confirmedConflicts.length, 0);
});
test('a compound request does not become fully compatible from method authority alone', () => {
  const base = rule('המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.');
  const current = work('המפקח מורה בכתב לבצע בשיטת MTM. לא תשולם כל תוספת מחיר עבור השינוי.');
  assert.notEqual(assessEvidenceRelation({ work: { document: current, quote: current.extracted_text }, baseline: { document: base, quote: base.extracted_text } }).relation, 'COMPATIBLE');
});

test('a general applicable dated signing duty can prove a missed deadline without an MTM literal in its source', () => {
  const documents = [rule('תאריך: 01.01.2025\nהקבלן מתחייב לחתום על כל נספח שינוי בפרויקט עד ליום 01.06.2025.'),
    work('טרם חתמתם על נספח קידוח MTM ברחוב יהלום.')];
  documents[1].extracted_text = documents[1].extracted_text.replace('12.05.2025', '24.06.2025');
  const requirementReview = review(documents);
  const timing = reviewIssueTiming({ issue: { subject: 'MTM', location: 'יהלום' }, documents, requirementReview, asOf: '2025-06-24' });
  assert.equal(timing.confirmedConflicts.length, 1);
  assert.equal(timing.confirmedConflicts[0].duty.authority, 'APPLICABLE_DOCUMENT');
  assert.equal(timing.confirmedConflicts[0].dueDate, '2025-06-01');
});

test('an approval prerequisite phrased as subject-to remains enforceable against an explicit bypass', () => {
  assert.equal(review([rule('שינוי שיטת הביצוע יתאפשר רק בכפוף לאישור המנהל מראש ובכתב.'),
    work('המפקח מורה לבצע קידוח MTM ללא אישור המנהל.')]).confirmedConflicts.length, 1);
});
test('a method rule explicitly limited to asphalt cannot prove a drilling conflict', () => {
  assert.equal(review([rule('בעבודות אספלט שינוי שיטת הביצוע טעון אישור מראש ובכתב של המנהל.'),
    work('המפקח מורה לבצע קידוח MTM ללא אישור המנהל.')]).confirmedConflicts.length, 0);
});
test('mentioning an annex and a foreign blank form does not invalidate a complete project specification', () => {
  const specification = rule(`המפרט המיוחד: מסמך זה כולל הפניה לנספח.\n\n${responseRule}\n\nטופס לדוגמה: שם המציע ______`);
  assert.equal(review([specification, work(response)]).confirmedConflicts.length, 1);
});

test('opposite governing rules remain unresolved until a project priority rule is proved', () => {
  const special = rule('שינוי שיטת הביצוע אינו טעון אישור המנהל. המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.');
  const g = graph();
  g.documents[1].clauses[0].text = 'שינוי שיטת הביצוע טעון אישור מראש ובכתב של המנהל.';
  const result = review([special, work('המפקח מורה בכתב לבצע קידוח MTM ללא אישור המנהל.')], g);
  assert.equal(result.requirements.find(item => item.kind === 'METHOD_CHANGE').assessment, 'NEEDS_BASIS');
  assert.ok(result.requirements[0].reasons.includes('governing_precedence_not_established'));
});
test('an explicit project priority rule resolves the special/general conflict with its source', () => {
  const special = rule('שינוי שיטת הביצוע אינו טעון אישור המנהל. המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.');
  const g = buildDocumentReferenceGraph({ documents: [
    { id: 'special', title: 'מפרט מיוחד', role: 'PROJECT_CONTRACT', clauses: [{ text: 'על העבודה יחול פרק 00 של הספר הכחול מהדורת 2023. במקרה של סתירה המפרט המיוחד יגבר על המפרט הכללי.' }] },
    { id: 'blue', title: 'הספר הכחול', role: 'REFERENCE', referenceType: 'BLUE_BOOK', clauses: [{ id: 'blue-00', sectionCode: '00', edition: '2023', page: 7, text: 'שינוי שיטת הביצוע טעון אישור מראש ובכתב של המנהל.' }] },
  ] });
  const result = review([special, work('המפקח מורה בכתב לבצע קידוח MTM ללא אישור המנהל.')], g);
  assert.equal(result.requirements.find(item => item.kind === 'METHOD_CHANGE').assessment, 'SUPPORTED');
  assert.ok(result.precedenceEvidence.some(source => source.documentId === 'special'));
});

test('the actual May signing request is linked through its named drilling annex', savedMtmOptions, () => {
  const saved = JSON.parse(fs.readFileSync(savedMtmPath, 'utf8'));
  const source = saved.documents.find(source => source.id.startsWith('ef74c34f'));
  const result = review([{ ...source, parsed_json: { source_reading: source.source_reading } }]);
  assert.ok(result.requirements.some(item => item.kind === 'SIGN_ANNEX' && item.anchor.quote.includes('לחתום על נספח הקידוחים')));
  const price = result.requirements.find(item => item.kind === 'SUBMIT_PRICE' && item.anchor.quote.includes('ניתוח מחיר מפורט'));
  assert.equal(price.requestedObject, 'UNSPECIFIED');
  assert.ok(price.reasons.includes('price_analysis_item_not_established'));
});
test('contractor alternative, submitted papers and price negotiation are compatible stages', () => {
  const documents = [rule('הקבלן יגיש ניתוח מחיר לשינוי מוצע. השינוי טעון אישור מראש ובכתב של המנהל.'),
    work('הקבלן הציע לבצע את קו הביוב בשיטת MTM במקום השיטה המקורית. הוא הגיש את המסמכים הטכניים. נדרש להגיש ניתוח מחיר לעבודות קידוח MTM.'),
    doc('later-price', 'תאריך: 20.05.2025\nניתוח המחיר לקידוח MTM הוגש. הצדדים מנהלים משא ומתן על המחיר. המחיר טרם אושר.')];
  const result = review(documents);
  assert.equal(result.confirmedConflicts.length, 0);
  assert.ok(result.requirements.some(item => item.kind === 'SUBMIT_PRICE' && item.requestedObject === 'DRILLING'));
  const history = savedIssueHistory({ id: 'mtm', title: 'MTM', evidence_data: {} }, documents);
  assert.notEqual(history.aspects.PRICE.state, 'AGREED');
});

test('the February fallback to the tender method is a conditional choice, not an MTM execution duty', savedMtmOptions, () => {
  const saved = JSON.parse(fs.readFileSync(savedMtmPath, 'utf8'));
  const source = saved.documents.find(source => source.id === '70d0f7d6-1244-426f-95fd-f77016b3901e');
  const documents = [{ ...source, parsed_json: { source_reading: source.source_reading } }];
  const requirements = review(documents);
  assert.ok(requirements.requirements.filter(item => item.kind === 'METHOD_CHANGE').every(item => item.assessment === 'PROPOSED_CHANGE'));
  const timing = reviewIssueTiming({ issue: { subject: 'MTM', location: 'יהלום' }, documents, requirementReview: requirements, asOf: '2025-06-24' });
  assert.ok(timing.requirements.some(item => item.action === 'EXECUTE' && item.authority === 'CONDITIONAL_CHOICE'));
  assert.equal(timing.confirmedConflicts.length, 0);
});

test('equipment incident response is not a basis for answering an MTM letter', () => {
  const maintenance = 'אחריות ותקופת הבדק: מוקד במשרדי הקבלן, זמן תגובה לבדיקת ותיקון תקלות בתוך 3 ימים.';
  const result = review([rule(maintenance), work(response)]);
  assert.ok(result.requirements.every(item => item.basis.every(basis => basis.anchor.quote !== maintenance)));
});

test('a reported supply-delay dispute is not an instruction to change the method', () => {
  const result = review([work('קידוח מיקרוטאנלינג: טענת הקבלן לעיכוב עקב מחסור בסחורות בארץ אינה מהווה הצדקה לאי-ביצוע העבודות. הקבלן אחראי לאספקת כל הציוד והחומרים הנדרשים לביצוע.')]);
  assert.equal(result.requirements.length, 0);
});

test('safety and insurance signatures cannot support signing a change annex', () => {
  for (const text of ['הקבלן מתחייב לפעול בהתאם לנספח הבטיחות ולחתום על אישור הבטיחות.',
    'עם חתימת ההסכם הקבלן ימציא אישור על קיום ביטוחים (נספח 5 א) חתום כדין.',
    'הקבלן יגיש תוכניות עדות המסמנות שינויים, בנספח אשר ייחתם על ידיו.',
    'הקבלן מתחייב לחתום על נספח לחוזה המכרז המקורי.']) {
    const result = review([rule(text), work('הקבלן נדרש לחתום על נספח קידוח MTM.')]);
    const item = result.requirements.find(item => item.kind === 'SIGN_ANNEX');
    assert.equal(item.assessment, 'NEEDS_BASIS');
    assert.ok(item.basis.every(source => source.anchor.quote !== text));
  }
});

test('controller scan and reaction times are not correspondence deadlines', () => {
  const text = 'בקרים PLC או DDC: דרישות לזמני סריקה ותגובה, אם נדרשות, מיקום התקנה. יש להגדיר זמן פעולה.';
  const result = review([rule(text), work(response)]);
  assert.ok(result.requirements.every(item => item.basis.every(source => source.anchor.quote !== text)));
  const technical = 'הכנות ליציקה: על הקבלן למסור תשובה ולענות על דרישות מנהל הפרויקט לפני תחילת העבודה. הפיקוח יקבע מועד לבדיקות.';
  assert.ok(review([rule(technical), work(response)]).requirements.every(item => item.basis.every(source => source.anchor.quote !== technical)));
});

test('an insurer subrogation waiver is not a contractor waiver of change claims', () => {
  const text = 'נספח ביטוח: המבטח מוותר על זכות תחלוף כלפי הקבלן. הקבלן ימציא את נספח הביטוח.';
  const result = review([rule(text), work('בקידוח MTM הקבלן מוותר על כל טענותיו.')]);
  assert.ok(result.requirements.every(item => item.basis.every(source => source.anchor.quote !== text)));
});

test('a reference published after the available project period is not a historical requirement basis', () => {
  for (const edition of ['2026', null]) {
    const g = buildDocumentReferenceGraph({ documents: [
      { id: 'special', title: 'מפרט מיוחד', role: 'PROJECT_CONTRACT', clauses: [{ text: 'על העבודה יחול פרק 00 של הספר הכחול מהדורת 2026.' }] },
      { id: 'blue', title: 'הספר הכחול', role: 'REFERENCE', referenceType: 'BLUE_BOOK', clauses: [{ id: 'blue-future', sectionCode: '00', edition, page: 7,
        text: `הוועדה הבין משרדית\nהמפרט הכללי לעבודות בנייה פרק 00 – מוקדמות, פברואר 2026\n${responseRule}` }] },
    ] });
    const result = review([work(response)], g);
    assert.equal(result.confirmedConflicts.length, 0);
    assert.ok(result.requirements.every(item => item.basis.every(basis => basis.anchor.documentId !== 'blue-future')));
    assert.ok(result.referenceGaps.some(gap => gap.reason === 'reference_publication_after_available_period'));
  }
});
