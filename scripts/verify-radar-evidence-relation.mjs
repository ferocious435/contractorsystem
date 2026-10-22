import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { quality, loadInput, networkAttempts } from './radar-point-1-3-harness.mjs';
import * as evidence from '../src/utils/radar-evidence-assessment.ts';

function compare(workText, baselineText, options = {}) {
  assert.equal(typeof evidence.assessEvidenceRelation, 'function', 'A separate semantic comparison is required');
  const work = { document: { id: 'work', extracted_text: workText }, quote: workText, ...options.work };
  const baseline = baselineText == null ? null
    : { document: { id: 'base', extracted_text: baselineText }, quote: baselineText, ...options.baseline };
  return evidence.assessEvidenceRelation({ work, baseline });
}

for (const [name, work, base, want] of [
  ['different cement content for pipe surround', 'המפקח דורש עטיפת הצינור בחול מצומנט בשיעור 4%.', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', 'INCOMPATIBLE'],
  ['same material content', 'המפקח דורש עטיפת הצינור בחול מצומנט בשיעור 8%.', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', 'COMPATIBLE'],
  ['overlapping minimum and exact requirement', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור של לפחות 4%.', 'COMPATIBLE'],
  ['incompatible upper bound', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור של עד 4%.', 'INCOMPATIBLE'],
  ['years and months normalize to the same duration', 'המפקח דורש אחריות של 2 שנים לאביזרי FOX.', 'אחריות לאביזרי FOX תהיה למשך 24 חודשים.', 'COMPATIBLE'],
  ['different warranty duration', 'המפקח דורש אחריות של 15 שנים לאביזרי FOX.', 'אחריות לאביזרי FOX תהיה למשך 12 חודשים.', 'INCOMPATIBLE'],
  ['centimetres and millimetres normalize to the same diameter', 'קוטר הצינור יהיה 10 ס"מ.', 'קוטר הצינור יהיה 100 מ"מ.', 'COMPATIBLE'],
  ['different numeric properties', 'לוח הזמנים מצביע על עיכוב של 17 חודשים.', 'תקופת הביצוע תהיה 19 חודשים.', 'DIFFERENT_SUBJECT'],
  ['initial schedule and routine updates', 'הקבלן מחויב להגיש לוח זמנים מעודכן בכל חודש.', 'הקבלן יגיש לוח זמנים מפורט בתוך 14 ימים מצו התחלת העבודה.', 'COMPATIBLE'],
  ['inert fill approval in a compatible approval process', 'הקבלן נדרש להעביר חומר אינרטי לאישור בדחיפות.', 'חומר שיאושר למילוי חוזר יישמר באתר. חומר שייפסל יורחק.', 'COMPATIBLE'],
  ['utility survey is not quality assurance', 'הקבלן מחויב לבצע סקר פיזי של התשתיות הקיימות.', 'נקודות בדיקה מחייבות הערכות של מערך הבטחת איכות של המזמין.', 'DIFFERENT_SUBJECT'],
  ['different construction layers', 'חומר המילוי סביב הצינור יהיה חול מצומנט 8%.', 'חומר מילוי תחתון יהיה חומר מילוי אינרטי.', 'DIFFERENT_SUBJECT'],
  ['measurement is not material selection', 'המחיר למילוי חול מצומנט 8% הוא 520 ש"ח למ"ק.', 'יחידת המידה למילוי תעלות בבטון CLSM תהיה מ"ק.', 'DIFFERENT_SUBJECT'],
  ['an event is not a daily-work pricing rule', 'חלה עצירה בעבודות הנחת צינורות מים.', 'עבודות יומיות (רגי) ועבודות חריגות יימדדו לפי שעות.', 'DIFFERENT_SUBJECT'],
  ['different explicit streets', 'ברחוב יהלום עטיפת הצינור תבוצע בחול מצומנט 4%.', 'ברחוב שוהם עטיפת הצינור תבוצע בחול מצומנט 8%.', 'DIFFERENT_SUBJECT'],
  ['general norm applies to the same material on a specific street', 'ברחוב יהלום המפקח דורש עטיפת הצינור בחול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'INCOMPATIBLE'],
  ['different words for the same pipe surround', 'המפקח דורש שהמילוי סביב הצינור יהיה חול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מיוצב בצמנט 8%.', 'INCOMPATIBLE'],
  ['explicit approval waiver versus a new approval obligation', 'על הקבלן להעביר לאישור המתכנן את פרטי המכונה לפני יציקת אבן שפה.', 'אין צורך באישור המתכנן לפרטי המכונה לפני יציקת אבן שפה.', 'INCOMPATIBLE'],
  ['explicitly different material for the same surround', 'עטיפת הצינור תבוצע בבטון CLSM.', 'עטיפת הצינור תבוצע בחול מצומנט.', 'INCOMPATIBLE'],
  ['a material choice allowed by the contract', 'עטיפת הצינור תבוצע בבטון CLSM.', 'עטיפת הצינור תבוצע בחול מצומנט או בבטון CLSM.', 'COMPATIBLE'],
  ['unproved duration versus a claimed advance-agreement deadline', 'לפי הסכם המקדמה חלפו 22 ימים מהמועד להשלמת העבודות.', 'תקופת הביצוע תהיה 19 חודשים מצו התחלת העבודה.', 'INSUFFICIENT_EVIDENCE'],
  ['shared words alone do not prove conflicting obligations', 'הקבלן יגיש את החומר למנהל.', 'החומר יועבר למנהל בהתאם להסכם.', 'INSUFFICIENT_EVIDENCE'],
  ['different products with different warranty periods', 'המפקח דורש אחריות של 15 שנים לאביזרי FOX.', 'אחריות לאביזרי RAPHAEL תהיה 12 חודשים.', 'DIFFERENT_SUBJECT'],
  ['a general warranty rule applies to the specified product', 'המפקח דורש אחריות של 15 שנים לאביזרי FOX ממועד המסירה.', 'תקופת האחריות לכל אביזרי הצנרת היא 12 חודשים ממועד המסירה.', 'INCOMPATIBLE'],
  ['different obligated parties', 'על הקבלן להגיש לוח זמנים מפורט בתוך 10 ימים.', 'על המתכנן להגיש לוח זמנים מפורט בתוך 14 ימים.', 'DIFFERENT_SUBJECT'],
  ['different explicit applicability years', 'בשנת 2025 עטיפת הצינור תהיה חול מצומנט 4%.', 'בשנת 2024 עטיפת הצינור תהיה חול מצומנט 8%.', 'DIFFERENT_SUBJECT'],
  ['a request is not an operative instruction', 'הקבלן מבקש עטיפת הצינור בחול מצומנט 4%.', 'עטיפת הצינור תהיה חול מצומנט 8%.', 'INSUFFICIENT_EVIDENCE'],
  ['a prohibition of another material is compatible', 'אסור לבצע עטיפת הצינור בבטון CLSM.', 'עטיפת הצינור תבוצע בחול מצומנט.', 'COMPATIBLE'],
  ['a prohibition of the required material conflicts', 'אסור לבצע עטיפת הצינור בבטון CLSM.', 'עטיפת הצינור תבוצע בבטון CLSM.', 'INCOMPATIBLE'],
  ['a prohibition of another numeric content is compatible', 'אסור לבצע עטיפת הצינור בחול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'COMPATIBLE'],
  ['a prohibition of the required numeric content conflicts', 'אסור לבצע עטיפת הצינור בחול מצומנט 8%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'INCOMPATIBLE'],
  ['an unproved conditional proposal does not establish an operative conflict', 'עטיפת הצינור תבוצע בחול מצומנט 4% בכפוף לחתימת נספח.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'INSUFFICIENT_EVIDENCE'],
  ['a value inside a required range', 'עטיפת הצינור תבוצע בחול מצומנט 6%.', 'עטיפת הצינור תבוצע בחול מצומנט 4–8%.', 'COMPATIBLE'],
  ['a value outside a required range', 'עטיפת הצינור תבוצע בחול מצומנט 10%.', 'עטיפת הצינור תבוצע בחול מצומנט 4–8%.', 'INCOMPATIBLE'],
  ['different exact initial schedule submission dates', 'הקבלן יגיש לוח זמנים מפורט בחלוף 10 ימים.', 'הקבלן יגיש לוח זמנים מפורט בחלוף 14 ימים.', 'INCOMPATIBLE'],
  ['overlapping initial schedule submission limits', 'הקבלן יגיש לוח זמנים מפורט בתוך 10 ימים.', 'הקבלן יגיש לוח זמנים מפורט בתוך 14 ימים.', 'COMPATIBLE'],
  ['different named recipients of the obligation', 'המפקח דורש מהקבלן להגיש לוח זמנים מפורט בתוך 10 ימים.', 'המתכנן נדרש להגיש לוח זמנים מפורט בתוך 14 ימים.', 'DIFFERENT_SUBJECT'],
  ['different languages still identify the same construction property', 'The pipe bedding must use cemented sand with 4%.', 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', 'INCOMPATIBLE'],
  ['an observation is not a contractual obligation', 'עטיפת הצינור תבוצע בחול מצומנט 4%.', 'בבדיקה נמצא כי עטיפת הצינור מכילה חול מצומנט 8%.', 'INSUFFICIENT_EVIDENCE'],
  ['a negated requirement does not prescribe the mentioned percentage', 'לא נדרש לבצע עטיפת הצינור בחול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'INSUFFICIENT_EVIDENCE'],
  ['a Hebrew if clause is an unproved condition', 'עטיפת הצינור תבוצע בחול מצומנט 4% אם ייחתם הנספח.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'INSUFFICIENT_EVIDENCE'],
  ['an English if clause is an unproved condition', 'The pipe bedding must use cemented sand with 4% if the addendum is signed.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'INSUFFICIENT_EVIDENCE'],
]) {
  test(`[SYNTHETIC semantic] ${name}`, () => {
    const result = compare(work, base);
    assert.equal(result.relation, want, result.reasons.join(', '));
    assert.ok(result.reasons.length > 0);
    for (const anchor of result.sourceAnchors) {
      const source = anchor.documentId === 'work' ? work : base;
      assert.equal(source.slice(anchor.start, anchor.end), anchor.quote);
    }
  });
}

test('a response is kept as a response when it contains no operative decision', () => {
  const result = compare('בתשובה לבקשה נמסר כי נושא עטיפת הצינור ייבדק.', null);
  assert.equal(result.work.role, 'RESPONSE');
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
});

test('the real model extraction can express the same warranty start as a condition without hiding a conflict', () => {
  const work = 'המפקח דורש מהקבלן לתת אחריות של 15 שנים על אביזרי FOX ממועד המסירה.';
  const base = 'תקופת האחריות לכל אביזרי הצנרת היא 12 חודשים ממועד המסירה.';
  const claim = { role: 'INSTRUCTION', subject: 'המפקח דורש מהקבלן לתת אחריות', attribute: 'WARRANTY_DURATION', value: '15 שנים',
    scope: null, location: null, party: 'הקבלן', condition: 'ממועד המסירה', period: null };
  const result = compare(work, base, { work: { extraction: claim }, baseline: { extraction: { ...claim,
    role: 'CONTRACT_RULE', subject: 'תקופת האחריות לכל אביזרי הצנרת', value: '12 חודשים', party: null } } });
  assert.equal(result.relation, 'INCOMPATIBLE', result.reasons.join(', '));
});

test('warranty periods starting at different events cannot be compared as the same applicable period', () => {
  const result = compare('המפקח דורש אחריות של 15 שנים לאביזרי FOX ממועד המסירה.',
    'אחריות לאביזרי FOX תהיה 12 חודשים ממועד צו התחלת העבודה.');
  assert.equal(result.relation, 'DIFFERENT_SUBJECT');
});

test('a mistaken model role cannot conceal different source-proven numeric properties', () => {
  const result = compare('לוח הזמנים מצביע על עיכוב של 17 חודשים.', 'תקופת הביצוע תהיה 19 חודשים.', {
    work: { extraction: { role: 'INSTRUCTION', subject: 'לוח הזמנים', attribute: 'OTHER', value: null,
      scope: null, location: null, party: null, condition: null, period: null } },
  });
  assert.equal(result.relation, 'DIFFERENT_SUBJECT');
});

test('a broad material label cannot conceal two source-proven incompatible cement percentages', () => {
  const result = compare('עטיפת הצינור תבוצע בחול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', {
    work: { extraction: { role: 'INSTRUCTION', subject: 'עטיפת הצינור', attribute: 'MATERIAL', value: 'חול מצומנט 4%',
      scope: null, location: null, party: null, condition: null, period: null } },
  });
  assert.equal(result.relation, 'INCOMPATIBLE');
});

test('an instruction issuer is not the obligated party and cannot conceal a proven material conflict', () => {
  const result = compare('המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.',
    'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', {
      work: { extraction: { role: 'INSTRUCTION', subject: 'עטיפת הצינור', attribute: 'OTHER', value: '4%',
        scope: null, location: null, party: 'המפקח', condition: null, period: null } },
    });
  assert.equal(result.relation, 'INCOMPATIBLE', result.reasons.join(', '));
});

test('an unknown actor role cannot be ignored to certify a conflict', () => {
  const result = compare('בנוכחות המפקח עטיפת הצינור תבוצע בחול מצומנט בשיעור 4%.',
    'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.', {
      work: { extraction: { role: 'INSTRUCTION', subject: 'עטיפת הצינור', attribute: 'OTHER', value: '4%',
        scope: null, location: null, party: 'המפקח', condition: null, period: null } },
    });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('context_dimension_not_established'));
});

for (const [role, quote] of [
  ['PRICE', 'מחיר עטיפת הצינור בחול מצומנט הוא 520 ש"ח.'],
  ['MEASUREMENT', 'מדידה של עטיפת הצינור בחול מצומנט: 20 מ"ק, מחיר 520 ש"ח.'],
  ['PAYMENT_CLAIM', 'דרישת תשלום בגין עטיפת הצינור בחול מצומנט בסך 520 ש"ח.'],
  ['DECISION', 'אושרה עטיפת הצינור בחול מצומנט 8%.'],
]) test(`pricing, measurement, payment and decision retain their distinct source role: ${role}`, () => {
  const result = compare(quote, null);
  assert.equal(result.work.role, role);
  assert.notEqual(result.relation, 'INCOMPATIBLE');
});

test('a source-backed scope which is not understood cannot be ignored to certify a conflict', () => {
  const quote = 'בשלב ב עטיפת הצינור תבוצע בחול מצומנט 4%.';
  const result = compare(quote, 'בשלב א עטיפת הצינור תבוצע בחול מצומנט 8%.', {
    work: { extraction: { role: 'INSTRUCTION', subject: 'עטיפת הצינור', attribute: 'CEMENT_CONTENT', value: '4%',
      scope: 'בשלב ב', location: null, party: null, condition: null, period: null } },
  });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('context_dimension_not_established'));
});

test('a proposed replacement without a baseline remains a known change, without inventing approval', () => {
  const result = compare('הקבלן פנה בבקשה לשנות את שיטת הקידוח מדחיקת צנרת פיברגלס לקידוח MTM.', null);
  assert.equal(result.resultType, 'KNOWN_CHANGE');
  assert.equal(result.work.role, 'REQUEST');
  assert.notEqual(result.relation, 'INCOMPATIBLE');
});

test('a real instruction is compared separately from a considered option in the same quote', () => {
  const result = compare('נשקלה האפשרות לאחריות של 12 חודשים לאביזרי FOX, אך המפקח דורש אחריות של 15 שנים לאביזרי FOX.',
    'אחריות לאביזרי FOX תהיה 12 חודשים.');
  assert.equal(result.relation, 'INCOMPATIBLE');
});

test('invented semantic subject and value fields cannot certify two real quotes', () => {
  const result = compare('עטיפת הצינור תבוצע בחול מצומנט 8%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', {
    work: { extraction: { role: 'INSTRUCTION', subject: 'אחריות למכונה', attribute: 'WARRANTY_DURATION', value: '15 שנים',
      scope: null, location: null, party: null, condition: null, period: null } },
  });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('semantic_field_not_grounded'));
});

test('a source quote which is absent is an evidence error rather than an inferred relation', () => {
  const result = compare('עטיפת הצינור תבוצע בחול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', {
    work: { document: { id: 'work', extracted_text: 'מסמך בנושא אחר.' } },
  });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('source_quote_not_found'));
});

test('a proposed signature or a blank signature line does not itself prove refusal or a binding replacement', () => {
  const quote = 'הקבלן מבקש לשנות את שיטת הקידוח מדחיקת פיברגלס לקידוח MTM. תאריך: ______ חתימת הקבלן: ______';
  const result = compare(quote, null);
  assert.equal(result.work.role, 'REQUEST');
  assert.equal(result.resultType, 'KNOWN_CHANGE');
  assert.equal(result.reasons.some(reason => /refus|signed|draft/.test(reason)), false);
});

test('a quotation cannot hide the condition immediately following it in the same source statement', () => {
  const quote = 'עטיפת הצינור תבוצע בחול מצומנט 4%';
  const result = compare(quote, 'עטיפת הצינור תבוצע בחול מצומנט 8%.', {
    work: { document: { id: 'work', extracted_text: `${quote} בכפוף לחתימת נספח.` } },
  });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('different_or_unproved_conditions'));
});

test('unbounded numeric constraints survive JSON storage without changing meaning', () => {
  const result = compare('עטיפת הצינור תבוצע בחול מצומנט לפחות 8%.', 'עטיפת הצינור תבוצע בחול מצומנט לפחות 4%.');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(result.work.constraint.max, null);
});

test('a value for another product in the same quotation cannot be attached to the proposed subject', () => {
  const quote = 'אחריות לאביזרי FOX תהיה 12 חודשים. אחריות לאביזרי RAPHAEL תהיה 15 שנים.';
  const result = compare(quote, 'אחריות לאביזרי FOX תהיה 12 חודשים.', { work: { extraction: {
    role: 'INSTRUCTION', subject: 'אביזרי FOX', attribute: 'WARRANTY_DURATION', value: '15 שנים',
    scope: null, location: null, party: null, condition: null, period: null,
  } } });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('semantic_field_not_grounded'));
});

test('a repeated baseline quote is interpreted at its supplied occurrence', () => {
  const quote = 'עטיפת הצינור תבוצע בחול מצומנט 8%';
  const source = `${quote}.\n\n${quote} בכפוף לחתימת נספח.`;
  const start = source.lastIndexOf(quote);
  const result = compare('עטיפת הצינור תבוצע בחול מצומנט 4%.', quote, { baseline: {
    document: { id: 'base', extracted_text: source },
    anchor: { documentId: 'base', quote, start, end: start + quote.length, page: null },
  } });
  assert.equal(result.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('different_or_unproved_conditions'));
});

const loaded = loadInput(process.env.RADAR_POINT13_SNAPSHOT);
const expected = { dekel_clsm: 'DIFFERENT_SUBJECT', utilities: 'DIFFERENT_SUBJECT', delay_17: 'DIFFERENT_SUBJECT',
  deadline_warning: 'INSUFFICIENT_EVIDENCE', inert_approval: 'COMPATIBLE', water_stopped: 'DIFFERENT_SUBJECT', schedule_update: 'COMPATIBLE' };
for (const scenario of loaded.registry.cases.filter(row => row.key in expected)) {
  test(`[SAVED semantic] ${scenario.key} explains its comparison instead of certifying matched quotes`, () => {
    const row = loaded.findings.find(row => row.id === scenario.id);
    const work = loaded.documentById.get(row.source_execution_doc_id);
    const baseline = loaded.documentById.get(row.target_contract_doc_id);
    const finding = quality.groundContractScanFinding({ finding: { title: row.title, description: row.description,
      advice: row.strategy_advice, category: row.category, work_quote: row.evidence_data.work_quote, contract_quote: row.evidence_data.contract_quote,
      work_document_id: work.id, contract_document_id: baseline.id }, currentWorkDocument: work, contractDocuments: [baseline] });
    const result = quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [baseline] });
    assert.equal(result.evidenceRelation?.relation, expected[scenario.key]);
    assert.notEqual(result.evidenceStatus, 'VERIFIED');
    if (expected[scenario.key] !== 'INSUFFICIENT_EVIDENCE') assert.equal(result.accepted, false);
    if (scenario.key === 'delay_17') assert.equal(result.presentation.title.includes('הסכמה'), false);
  });
}

after(() => assert.deepEqual(networkAttempts, [], 'No scan, model, database or network call is allowed'));
