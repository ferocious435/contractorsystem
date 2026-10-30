import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const quality = await import('../src/utils/contract-scan-quality.ts');

test('technical quote choices put the current subject first without dropping a contractual exception',()=>{
  const unrelated='פרק 40 של המפרט הכללי לא יחול על העבודה.';
  const relevant='צביעת הקיר תבוצע בשתי שכבות.';
  const schema=quality.buildGroundedScanResponseSchema({workText:'יש לבצע צביעת הקיר בשכבה אחת.',contractTexts:[unrelated,relevant]});
  assert.deepEqual(schema.items.properties.contract_quote.enum,[relevant,unrelated,null]);
});

const contract = {
  id: 'contract-boq',
  title: 'כתב כמויות',
  category: 'BOQ',
  extracted_text: '57.90.0018 ברז כיבוי אש הידרנט תוצרת רפאל או שווה ערך',
};

const currentWorkDocument = {
  id: 'protocol-2025-06-04',
  title: 'פרוטוקול 04.06.2025',
  category: 'PROTOCOL',
  extracted_text: 'התאגיד מוכן לשקול עבודה עם שני ספקי הידרנטים לאחר קבלת חלוקה מפורטת לפי אזורים וספקים.',
};

const validAction = {
  title: 'נדרשת חלוקה לפי אזורים וספקים',
  description: 'טרם נמסרה החלוקה הדרושה לבחינת שני ספקים.',
  category: 'פעולה לביצוע',
  advice: 'להעביר חלוקה מפורטת לפי אזורים וספקים.',
  contract_quote: null,
  work_quote: 'התאגיד מוכן לשקול עבודה עם שני ספקי הידרנטים לאחר קבלת חלוקה מפורטת לפי אזורים וספקים.',
  contract_document_id: null,
  work_document_id: currentWorkDocument.id,
  comparison_type: 'project_timeline_action',
};

test('an exact action quote passes source checks before the separate mismatch filter', () => {
  const result = quality.assessContractScanFinding({
    finding: validAction,
    currentWorkDocument,
    contractDocuments: [contract],
  });

  assert.equal(result.accepted, true);
  assert.equal(result.workQuoteMatched, true);
});

test('a conditional willingness to consider suppliers does not contradict an allowed equivalent', () => {
  const result = quality.assessContractScanFinding({
    finding: { ...validAction, title: 'התקשרות הידרנטים', category: 'סתירה',
      contract_document_id: contract.id, contract_quote: contract.extracted_text },
    currentWorkDocument, contractDocuments: [contract],
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('consideration_without_instruction'));
});

test('a decided conflicting requirement is retained even if the sentence also mentions consideration', () => {
  const work = { id: 'decided', extracted_text: 'נשקלה האפשרות להסתפק באחריות של 12 חודשים לאביזרי FOX, אך המפקח דורש אחריות של 15 שנים לאביזרי FOX.' };
  const base = { id: 'warranty', extracted_text: 'אחריות לאביזרי FOX תהיה לתקופה של 12 חודשים.' };
  const finding = quality.groundContractScanFinding({ finding: { title: 'דרישת אחריות לאביזרי FOX', category: 'סתירה',
    contract_quote: base.extracted_text, work_quote: work.extracted_text }, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [base] }).accepted, true);
});

test('an unrelated quote is rejected even when another part of the document contains an action', () => {
  const result = quality.findingHasActionableWorkEvidence({
    finding: {
      ...validAction,
      category: 'אירוע שטח',
      work_quote: 'הישיבה נפתחה בשעה תשע.',
    },
    currentWorkDocument: {
      ...currentWorkDocument,
      extracted_text: 'הישיבה נפתחה בשעה תשע. בהמשך הקבלן נדרש להגיש תכנית.',
    },
  });
  assert.equal(result, false);
});

test('quality gate rejects invented quotes, wrong document IDs, and template text', () => {
  for (const finding of [
    { ...validAction, work_quote: 'ציטוט שלא קיים במסמך' },
    { ...validAction, work_document_id: 'another-document' },
    { ...validAction, title: 'כותרת קצרה בעברית' },
  ]) {
    const result = quality.assessContractScanFinding({
      finding,
      currentWorkDocument,
      contractDocuments: [contract],
    });
    assert.equal(result.accepted, false);
  }
});

test('near-exact model quote is replaced only with the real source sentence', () => {
  const repaired = quality.groundContractScanFinding({
    finding: { ...validAction, work_quote: 'האגיד מוכן לשקול עבודה עם שני ספקי הידרנטים לאחר קבלת חלוקה מפורטת לפי אזורים וספקים' },
    currentWorkDocument,
    contractDocuments: [contract],
  });
  assert.equal(repaired.work_quote, currentWorkDocument.extracted_text);

  const unrelated = quality.groundContractScanFinding({
    finding: { ...validAction, work_quote: 'העבודה הושלמה ואין צורך בשום פעולה נוספת' },
    currentWorkDocument,
    contractDocuments: [contract],
  });
  assert.equal(unrelated.work_quote, 'העבודה הושלמה ואין צורך בשום פעולה נוספת');
});

test('grounding restores a word clipped at the start of an otherwise exact quotation', () => {
  assert.equal(quality.findClosestEvidenceQuote(
    'חומר מילוי תחתון יהיה חומר מילוי אינרטי. תכונות חומר המילוי זהות לחומר מילוי עליון.',
    'תון יהיה חומר מילוי אינרטי. תכונות חומר המילוי זהות לחומר מילוי עליון',
  ), 'תחתון יהיה חומר מילוי אינרטי. תכונות חומר המילוי זהות לחומר מילוי עליון');
});

test('general lower fill is not the same construction scope as pipe surround material', () => {
  const work = { id: 'pipe', extracted_text: 'חומר המילוי סביב הצינור יהיה חול מצומנט 8%.' };
  const base = { id: 'bulk', extracted_text: 'חומר מילוי תחתון יהיה חומר מילוי אינרטי.' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'חומר מילוי', category: 'סתירה', work_quote: work.extracted_text,
      contract_quote: base.extracted_text, contract_document_id: base.id, work_document_id: work.id },
    currentWorkDocument: work, contractDocuments: [base],
  }).accepted, false);
});

test('different material percentages for the same pipe surround still produce a supported comparison', () => {
  const work = { id: 'pipe', extracted_text: 'חומר המילוי סביב הצינור יהיה חול מצומנט 8%.' };
  const base = { id: 'pipe-base', extracted_text: 'חומר המילוי סביב הצינור יהיה חול מצומנט 4%.' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'חומר מילוי סביב הצינור', category: 'סתירה', work_quote: work.extracted_text,
      contract_quote: base.extracted_text, contract_document_id: base.id, work_document_id: work.id },
    currentWorkDocument: work, contractDocuments: [base],
  }).accepted, true);
});

test('compact model output receives verified document IDs and description', () => {
  const grounded = quality.groundContractScanFinding({
    finding: {
      title: 'נדרשת חלוקה',
      category: 'פעולה לביצוע',
      advice: 'להעביר חלוקה.',
      contract_quote: contract.extracted_text,
      work_quote: currentWorkDocument.extracted_text,
    },
    currentWorkDocument,
    contractDocuments: [contract],
  });

  assert.equal(grounded.work_document_id, currentWorkDocument.id);
  assert.equal(grounded.contract_document_id, contract.id);
  assert.equal(grounded.description, currentWorkDocument.extracted_text);
});

test('a contradiction is rejected without two exact document quotes', () => {
  const withoutContractEvidence = quality.assessContractScanFinding({
    finding: { ...validAction, category: 'סתירה' },
    currentWorkDocument,
    contractDocuments: [contract],
  });
  assert.equal(withoutContractEvidence.accepted, false);

  // An allowed equivalent and a conditional supplier discussion do not themselves conflict.
  const warrantyContract = { id: 'warranty-contract', extracted_text: 'אחריות הקבלן על אביזרי FOX היא לתקופה של 12 חודשים.' };
  const warrantyWork = { id: 'warranty-demand', extracted_text: 'המפקח דורש מהקבלן לתת אחריות של 15 שנים על אביזרי FOX כתנאי לאישורם.' };
  const verified = quality.assessContractScanFinding({
    finding: {
      ...validAction,
      title: 'דרישת אחריות לאביזרי FOX',
      category: 'סתירה',
      contract_document_id: warrantyContract.id,
      contract_quote: warrantyContract.extracted_text,
      work_document_id: warrantyWork.id,
      work_quote: warrantyWork.extracted_text,
    },
    currentWorkDocument: warrantyWork,
    contractDocuments: [warrantyContract],
  });
  assert.equal(verified.accepted, true);
  assert.equal(verified.evidenceStatus, 'VERIFIED');
});

for (const [name, workQuote, contractQuote] of [
  ['the same insurance notice period',
    'הביטוחים כוללים תנאי מפורש לפיו אין המבטח רשאי לבטלם אלא אם שלח הודעה במכתב רשום לפחות 60 (שישים) יום מראש.',
    'נודיע למזמינה על כוונתנו שלא לחדש את הביטוחים במכתב רשום לפחות 60 (שישים) יום לפני כניסת הביטול לתוקף.'],
  ['an insurance limit versus a retroactive date',
    'ביטוח אחריות מקצועית בגבול אחריות של 4,000,000 ש"ח.',
    'ביטוח אחריות מקצועית: התאריך הרטרואקטיבי אינו מאוחר ממועד תחילת ביצוע העבודה.'],
  ['a manufacturer warranty versus site safekeeping',
    'פלסים תשתיות בע"מ מעניקה אחריות לטיב המוצר מתוצרתה לתקופה של 15 שנים מיום האספקה.',
    'עד מתן תעודת השלמת העבודות יהא הקבלן אחראי לשמירת האתר ולהשגחה עליו ויתקן כל נזק לרבות אובדן וגניבה.'],
  ['road demolition versus an asphalt connection joint',
    '51.001.0075 פירוק מבנה כבישים ומדרכות הכולל אספלט, מצע ותשתית עד עומק 80 ס"מ.',
    'מישק התחברות לאספלט קיים יימדד במ"ר ויכלול ניקוי האספלט בקווים ניצבים לציר הכביש.'],
  ['a completion percentage without a contractual requirement',
    '884 הידוק שתית קו ביוב 17 d 100% 06/03/2024 28/03/2024',
    '100%'],
]) {
  test(`${name} cannot become a verified contradiction`, () => {
    const work = { id: 'work', extracted_text: workQuote };
    const base = { id: 'contract', extracted_text: contractQuote };
    assert.equal(quality.assessContractScanFinding({
      finding: { ...validAction, title: workQuote, category: 'סתירה', work_quote: workQuote, contract_quote: contractQuote,
        work_document_id: work.id, contract_document_id: base.id },
      currentWorkDocument: work, contractDocuments: [base],
    }).accepted, false);
  });
}

test('a price analysis heading does not prove a new request for a quotation', () => {
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: { ...validAction, title: 'הצגת הצעת מחיר לגידור שטח',
      work_quote: 'פרויקט י.ש. גת חוזה 01/2023 ניתוח מחיר לגידור שטח בהתאם להוראות מפקח מיום 08/09/24' },
    currentWorkDocument: { id: 'fence-price-analysis' },
  }), false);
});

test('an unrelated optional contract quote is removed from a real action', () => {
  const unrelated = { id: 'as-built', extracted_text: 'עם סיום העבודה יגיש הקבלן תכניות DWG של המצב שבוצע.' };
  const grounded = quality.groundContractScanFinding({
    finding: { ...validAction, contract_quote: unrelated.extracted_text },
    currentWorkDocument, contractDocuments: [unrelated],
  });
  assert.equal(grounded.contract_quote, null);
  assert.equal(grounded.contract_document_id, null);
  assert.equal(grounded.work_quote, validAction.work_quote);
});

test('source checks recognize Hebrew construct-state wording in a curb request', () => {
  const work = { id: 'curb', extracted_text: 'הקבלן ביקש לבצע יציקת אבן שפה באמצעות מכונה ייעודית ועליו להעביר לאישור את פרטי הביצוע.' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'אישור מכונה ליציקת אבן שפה', work_quote: work.extracted_text, work_document_id: work.id },
    currentWorkDocument: work, contractDocuments: [],
  }).accepted, true);
});

for (const [name, quote] of [
  ['an outstanding material approval', 'הקבלן היה חייב לאשר את החומר אינרטי למילוי חוזר ועדיין חומר למילוי חוזר לא מאושר.'],
  ['a request for designer completion', 'החברה דורשת מההידרולוג להשלים את תכנון הניקוז ולהגיש תכנון מאושר.'],
  ['a curb-machine approval request', 'הקבלן ביקש לבצע יציקת אבן שפה באמצעות מכונה ועליו להעביר לאישור את פרטי הביצוע.'],
  ['a future supplier-area submission', validAction.work_quote],
]) {
  test(`${name} alone does not create an instruction-mismatch card under any non-comparison label`, () => {
    for (const category of ['פעולה לביצוע', 'חוסר נתונים', 'אירוע שטח', 'אין התאמה ישירה']) {
      assert.equal(quality.findingHasActionableWorkEvidence({
        finding: { ...validAction, category, work_quote: quote },
        currentWorkDocument: { id: 'work', extracted_text: quote },
      }), false, category);
    }
  });
}

test('an explicit field nonconformity remains a useful mismatch even without an invented contract quote', () => {
  const quote = 'תגלו תקרות שוחות ניקוז בגובה שאינו תואם, מה שמונע הנחת אספלט בשל מפלס גבוה מדי.';
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: { ...validAction, category: 'אירוע שטח', work_quote: quote },
    currentWorkDocument: { id: 'manhole', extracted_text: quote },
  }), true);
});

test('a general contract heading is not the second conflicting instruction', () => {
  const work = { id: 'fill', extracted_text: 'חומר המילוי סביב הצינור יהיה חול מצומנט 8%.' };
  const base = { id: 'base', extracted_text: 'חומר מילוי בשטחי הכבישים בתחום סוללת הכבישים יותר שימוש בחומרים בהתאם למפורט מטה :' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'חומר מילוי בכבישים', category: 'סתירה', work_quote: work.extracted_text,
      contract_quote: base.extracted_text, contract_document_id: base.id, work_document_id: work.id },
    currentWorkDocument: work, contractDocuments: [base],
  }).accepted, false);
});

test('a documented replacement retains both methods without an unrelated general contract clause', () => {
  const quote = 'קבלן פנה לתאגיד בבקשה לשנות את שיטת הקידוח מדחיקת צנרת פיברגלס בקוטר חיצוני 450 מ"מ לשיטת ביצוע קו הביוב באמצעות מכונת MTM בקוטר פנימי 354 מ"מ.';
  const work = { id: 'method-change', extracted_text: quote };
  const base = { id: 'general-changes', extracted_text: 'המזמין רשאי בכל עת לשנות את מקומן וגובהן של דרישות הביצוע ולהקטין את מספר הנקודות על אותו מעגל.' };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'בקשה לשינוי שיטת קידוח', category: 'שינוי/חריג', work_quote: quote, contract_quote: base.extracted_text },
    currentWorkDocument: work, contractDocuments: [base],
  });
  assert.equal(finding.contract_quote, null);
  assert.equal(finding.contract_document_id, null);
  assert.equal(finding.work_quote, quote);
  const result = quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(result.accepted, true);
  assert.equal(result.evidenceStatus, 'REQUIRES_VERIFICATION');
});

test('an ordinary change request without the previous and new instruction cannot invent the missing comparison', () => {
  const quote = 'הקבלן ביקש לשנות את שיטת הקידוח ויש להעביר פרטים לאישור.';
  const work = { id: 'unspecified-change', extracted_text: quote };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'בקשה לשינוי שיטת קידוח', category: 'שינוי/חריג', work_quote: quote, contract_quote: null },
    currentWorkDocument: work, contractDocuments: [],
  });
  assert.equal(quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [] }).accepted, false);
});

const responseClause = 'המזמין ימסור תשובה לבקשה בתוך 14 ימים קלנדריים מיום קבלת הבקשה.';
const responseRecord = 'הבקשה התקבלה אצל המזמין ביום 01.01.2025. נכון ליום 25.01.2025 לא נמסרה תשובה לבקשה.';

test('a contractual response deadline requires a proven receipt date and an explicitly documented unanswered state', () => {
  const result = quality.assessContractualReplyDeadline({ contractQuote: responseClause, workQuote: responseRecord });
  assert.equal(result.applicable, true);
  assert.equal(result.proven, true);
  assert.equal(result.receivedDate, '2025-01-01');
  assert.equal(result.dueDate, '2025-01-15');
  assert.equal(result.statusDate, '2025-01-25');
});

for (const [name, clause, record] of [
  ['the reply is not yet due', responseClause, responseRecord.replace('25.01.2025', '08.01.2025')],
  ['the due date has not ended', responseClause, responseRecord.replace('25.01.2025', '15.01.2025')],
  ['sending does not prove receipt', responseClause, responseRecord.replace('התקבלה אצל המזמין', 'נשלחה אל המזמין')],
  ['the receiving party differs from the contractual respondent', responseClause, responseRecord.replace('אצל המזמין', 'אצל הקבלן')],
  ['a reply was not promised within a defined period', 'המזמין ימסור תשובה לבקשה בהקדם האפשרי.', responseRecord],
  ['business days need their contractual calendar', responseClause.replace('ימים קלנדריים', 'ימי עבודה'), responseRecord],
  ['lack of approval does not prove lack of a response', responseClause, responseRecord.replace('לא נמסרה תשובה לבקשה', 'הבקשה טרם אושרה')],
  ['an optional reply is not a contractual duty', responseClause.replace('המזמין ימסור', 'המזמין רשאי לבחור אם ימסור'), responseRecord],
  ['a complete-submission condition has not been proved', `${responseClause} בכפוף לקבלת מלוא המסמכים והאישורים הנדרשים.`, responseRecord],
  ['a conditional receipt trigger has not been proved', responseClause.replace('קבלת הבקשה', 'קבלת הבקשה המלאה והתקינה'), responseRecord],
  ['an unreadable numeric period cannot be used as a date', responseClause.replace('14', '999999999999999999999999'), responseRecord],
]) {
  test(`${name} cannot prove a contractual response-delay violation`, () => {
    assert.equal(quality.assessContractualReplyDeadline({ contractQuote: clause, workQuote: record }).proven, false);
  });
}

test('the response duty can come from a binding special specification rather than the main agreement', () => {
  const work = { id: 'unanswered-spec-request', extracted_text: responseRecord };
  const agreement = { id: 'main-agreement', title: 'הסכם', category: 'CONTRACT',
    extracted_text: 'המפרט המיוחד המצורף מהווה חלק בלתי נפרד ממסמכי החוזה.' };
  const specification = { id: 'binding-specification', title: 'מפרט מיוחד', category: 'SPECS', extracted_text: responseClause };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'אי מתן תשובה במועד', category: 'פעולה לביצוע', work_quote: responseRecord, contract_quote: responseClause },
    currentWorkDocument: work, contractDocuments: [agreement, specification],
  });
  assert.equal(finding.contract_document_id, specification.id);
  assert.equal(finding.category, 'סתירה');
  assert.equal(quality.assessContractScanFinding({
    finding, currentWorkDocument: work, contractDocuments: [agreement, specification],
  }).accepted, true);
});

test('a documented response-delay breach is retained even when the model labels it as a pending action', () => {
  const work = { id: 'unanswered-request', extracted_text: responseRecord };
  const base = { id: 'response-term', extracted_text: responseClause };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'אי מתן תשובה במועד', category: 'פעולה לביצוע', work_quote: responseRecord, contract_quote: responseClause },
    currentWorkDocument: work, contractDocuments: [base],
  });
  assert.equal(finding.category, 'סתירה');
  assert.equal(quality.findingHasActionableWorkEvidence({ finding, currentWorkDocument: work }), true);
  assert.equal(quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [base] }).accepted, true);
});

test('a late reply does not erase an already documented response-deadline breach', () => {
  const work = { id: 'request-record', title: 'פרוטוקול 25.01.2025', extracted_text: responseRecord };
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { title: 'אי מתן תשובה במועד', category: 'סתירה', work_quote: responseRecord, contract_quote: responseClause },
    currentWorkDocument: work,
    relatedWorkDocuments: [{ id: 'late-reply', title: 'פרוטוקול 30.01.2025',
      extracted_text: 'הבקשה התקבלה אצל המזמין ביום 01.01.2025. תשובה לבקשה נמסרה ביום 30.01.2025 והבקשה אושרה.' }],
  }), false);
});

test('two real response quotes cannot create a violation before the contract deadline', () => {
  const work = { id: 'recent-request', extracted_text: responseRecord.replace('25.01.2025', '08.01.2025') };
  const base = { id: 'response-term', extracted_text: responseClause };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'אי מתן תשובה במועד', category: 'סתירה', work_quote: work.extracted_text, contract_quote: responseClause },
    currentWorkDocument: work, contractDocuments: [base],
  });
  const result = quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('response_deadline_not_proven'));
});

for (const workQuote of [
  'אבן שפה: הקבלן ביקש לבצע יציקה באמצעות מכונה ועליו להעביר לאישור את פרטי הביצוע.',
  'פרטי הביצוע למכונת יציקת אבן שפה טרם אושרו על ידי המתכנן.',
]) {
  test('an ordinary approval step does not become a contradiction simply by changing its label', () => {
    const work = { id: 'curb-protocol', extracted_text: workQuote };
    const clause = 'הקבלן יגיש לאישור המתכנן את פרטי המכונה לפני יציקת אבן שפה.';
    const base = { id: 'curb-clause', extracted_text: clause };
    for (const category of ['סתירה', 'שינוי/חריג']) {
      assert.equal(quality.assessContractScanFinding({
        finding: { ...validAction, title: 'פרטי מכונה ליציקת אבן שפה', category,
          work_quote: workQuote, work_document_id: work.id, contract_quote: clause, contract_document_id: base.id },
        currentWorkDocument: work, contractDocuments: [base],
      }).accepted, false, category);
    }
  });
}

test('a new approval requirement remains a comparison when the contract explicitly waives that approval', () => {
  const work = { id: 'new-approval', extracted_text: 'על הקבלן להעביר לאישור המתכנן את פרטי המכונה לפני יציקת אבן שפה.' };
  const base = { id: 'approval-waiver', extracted_text: 'אין צורך באישור המתכנן לפרטי המכונה לפני יציקת אבן שפה.' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'אישור פרטי מכונה ליציקת אבן שפה', category: 'שינוי/חריג',
      work_quote: work.extracted_text, work_document_id: work.id, contract_quote: base.extracted_text, contract_document_id: base.id },
    currentWorkDocument: work, contractDocuments: [base],
  }).accepted, true);
});

test('a real warranty mismatch is retained even when approval is also pending', () => {
  const work = { id: 'warranty-pending', extracted_text: 'המפקח דרש אחריות של 15 שנים על אביזרי FOX והאביזרים טרם אושרו.' };
  const base = { id: 'warranty-term', extracted_text: 'הקבלן יגיש לאישור המתכנן את אביזרי FOX עם אחריות של 12 חודשים.' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'דרישת אחריות לאביזרי FOX', category: 'סתירה',
      work_quote: work.extracted_text, work_document_id: work.id, contract_quote: base.extracted_text, contract_document_id: base.id },
    currentWorkDocument: work, contractDocuments: [base],
  }).accepted, true);
});

test('exact but unrelated contract and work quotes cannot create a contradiction', () => {
  const trafficDocument = {
    id: 'traffic-protocol',
    title: 'פרוטוקול 17.06.2025',
    category: 'PROTOCOL',
    extracted_text: 'הקבלן התריע על עיכובים רבים בלוח הזמנים לביצוע הסדרי התנועה הסופיים.',
  };
  const asBuiltContract = {
    id: 'as-built-contract',
    title: 'מפרט מסירה',
    category: 'CONTRACT',
    extracted_text: 'עם סיום העבודה יגיש הקבלן מפת עדות ותכניות DWG של המצב שבוצע.',
  };
  const result = quality.assessContractScanFinding({
    finding: {
      title: 'הצגת סדרי תנועה סופיים',
      description: trafficDocument.extracted_text,
      category: 'סתירה',
      advice: 'בדוק את הפער.',
      contract_quote: asBuiltContract.extracted_text,
      work_quote: trafficDocument.extracted_text,
      contract_document_id: asBuiltContract.id,
      work_document_id: trafficDocument.id,
    },
    currentWorkDocument: trafficDocument,
    contractDocuments: [asBuiltContract],
  });

  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('contract_evidence_unrelated'));
});

test('a date and addressee header cannot prove a change or extra work', () => {
  const letterHeader = '17.06.2025 לכבוד: תאגיד המים – מי גת';
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: {
      title: 'בדיקת קידוח MTM',
      description: letterHeader,
      category: 'שינוי/חריג',
      advice: 'תעד את הדרישה.',
      contract_quote: contract.extracted_text,
      work_quote: letterHeader,
      contract_document_id: contract.id,
      work_document_id: 'letter',
    },
    currentWorkDocument: {
      id: 'letter',
      title: 'מכתב 17.06.2025',
      category: 'LETTER',
      extracted_text: `${letterHeader}\nהנדון: בדיקת קידוח MTM`,
    },
  }), false);
});

test('a conclusion based only on a file name cannot create a radar finding', () => {
  const fileNameInference = 'הקבלן הגיש לו"ז מעודכן בקובץ בשם "קרית_גת_31_10_2024_האצה". לפי שם הקובץ הקבלן עובד בהאצה.';
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: {
      title: 'האצה בלוח זמנים',
      description: fileNameInference,
      category: 'שינוי/חריג',
      advice: 'בדוק את ההשלכות.',
      contract_quote: contract.extracted_text,
      work_quote: fileNameInference,
      contract_document_id: contract.id,
      work_document_id: 'schedule-file',
    },
    currentWorkDocument: {
      id: 'schedule-file',
      title: 'לוח זמנים מעודכן',
      category: 'SCHEDULE',
      extracted_text: fileNameInference,
    },
  }), false);
});

test('a title about a different subject cannot turn an exact quote into a finding', () => {
  const drainageDocument = {
    id: 'drainage-progress',
    title: 'פרוטוקול התקדמות',
    category: 'PROTOCOL',
    extracted_text: 'יש לבצע את הנחת הניקוז בכביש 2 עד כביש 15.',
  };
  const result = quality.assessContractScanFinding({
    finding: {
      title: 'הצגת תכנית בטיחות',
      description: drainageDocument.extracted_text,
      category: 'פעולה לביצוע',
      advice: 'בצע ותעד.',
      contract_quote: null,
      work_quote: drainageDocument.extracted_text,
      contract_document_id: null,
      work_document_id: drainageDocument.id,
    },
    currentWorkDocument: drainageDocument,
    contractDocuments: [contract],
  });

  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('title_evidence_unrelated'));
});

test('one shared word cannot justify invented facts in the rest of the title', () => {
  const work = { id: 'delay', extracted_text: 'הקבלן התריע על עיכובים רבים בלוח הזמנים לביצוע הסדרי התנועה הסופיים.' };
  assert.equal(quality.assessContractScanFinding({
    finding: { ...validAction, title: 'הצטברות של עיכובים בדוח התחלה', work_document_id: work.id, work_quote: work.extracted_text },
    currentWorkDocument: work, contractDocuments: [],
  }).accepted, false);
});

test('a comparison title may describe the verified baseline when the work uses another formulation', () => {
  const baseline = { id: 'defects-period', extracted_text: 'תקופת הבדק לכל אביזרי הצנרת היא 12 חודשים ממועד המסירה.' };
  const work = { id: 'extended-warranty', extracted_text: 'המפקח דורש מהקבלן לתת אחריות של 15 שנים על אביזרי FOX כתנאי לאישורם.' };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'התקופת הבדק של אביזרי הצנרת', category: 'סתירה',
      contract_quote: baseline.extracted_text, work_quote: work.extracted_text },
    currentWorkDocument: work, contractDocuments: [baseline],
  });
  assert.equal(quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [baseline] }).accepted, true);
  assert.equal(quality.assessContractScanFinding({ finding: { ...finding, title: 'הצגת תכנית בטיחות' },
    currentWorkDocument: work, contractDocuments: [baseline] }).accepted, false);
});

test('an unverified baseline or a standalone action cannot lend words to an unrelated title', () => {
  const work = { id: 'drainage', extracted_text: 'יש לבצע את הנחת הניקוז בכביש 2 עד כביש 15.' };
  const baseline = { id: 'safety', extracted_text: 'יש להציג תכנית בטיחות לפני תחילת העבודה.' };
  const candidate = { ...validAction, title: 'הצגת תכנית בטיחות', work_document_id: work.id, work_quote: work.extracted_text,
    contract_document_id: baseline.id, contract_quote: baseline.extracted_text };
  for (const [finding, documents] of [[candidate, [baseline]], [{ ...candidate, category: 'סתירה' }, []]]) {
    const result = quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: documents });
    assert.ok(result.reasons.includes('title_evidence_unrelated'));
  }
});

test('an action recommendation follows the response without assigning another addressee work to the contractor', () => {
  const work = { id: 'designer', extracted_text: 'החברה דורשת מההידרולוג להשלים את תכנון הניקוז ולמסור תשובה עד סוף החודש.' };
  const grounded = quality.groundContractScanFinding({
    finding: { title: 'השלמת תכנון הניקוז', category: 'פעולה לביצוע', work_quote: work.extracted_text },
    currentWorkDocument: work, contractDocuments: [],
  });
  assert.equal(grounded.advice.startsWith('בצע'), false);
  assert.ok(grounded.advice.length > 10);
});

test('a reference code and date alone cannot prove a contradiction', () => {
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: {
      title: 'אחריות לפלסי תשתיות',
      description: 'QA.19.01.05C 28.11.23',
      category: 'סתירה',
      advice: 'בדוק את הפער.',
      contract_quote: contract.extracted_text,
      work_quote: 'QA.19.01.05C 28.11.23',
      contract_document_id: contract.id,
      work_document_id: 'reference-code',
    },
    currentWorkDocument: {
      id: 'reference-code',
      title: 'מסמך איכות',
      category: 'PROTOCOL',
      extracted_text: 'QA.19.01.05C 28.11.23',
    },
  }), false);
});

test('hydrant evaluation accepts no mismatch and rejects both an old contradiction and a standalone task', () => {
  assert.deepEqual(quality.evaluateHydrantTimelineResult([]), {
    passed: true,
    forbiddenContradiction: false,
    currentActionFound: false,
  });
  assert.equal(quality.evaluateHydrantTimelineResult([validAction]).passed, false);
  assert.equal(quality.evaluateHydrantTimelineResult([
    { ...validAction, category: 'סתירה' },
  ]).passed, false);
});

test('later approval suppresses an older finding about the same topic', () => {
  const oldDocument = {
    id: 'protocol-2024-12-16',
    title: 'פרוטוקול 16.12.2024',
    category: 'PROTOCOL',
    extracted_text: 'הקבלן העביר לאישור הידרנטים של רפאל.',
  };
  const laterApproval = {
    id: 'protocol-2025-01-22',
    title: 'פרוטוקול 22.01.2025',
    category: 'PROTOCOL',
    extracted_text: 'החומרים שהגיש הקבלן להידרנטים אושרו על ידי המתכנן.',
  };

  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { ...validAction, work_quote: oldDocument.extracted_text },
    currentWorkDocument: oldDocument,
    relatedWorkDocuments: [laterApproval],
  }), true);
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: validAction,
    currentWorkDocument,
    relatedWorkDocuments: [oldDocument],
  }), false);
});

const drainageIssue = {
  id: 'drainage-2024',
  title: 'Protocol 16.12.2024',
  extracted_text: 'The drainage plan has not been approved.',
};

for (const [name, laterText, expected] of [
  ['a promised response date', 'The contractor will provide a response about the drainage plan by 01.12.2026.', false],
  ['future conditional approval', 'The drainage plan will be approved after the contractor submits the calculations.', false],
  ['explicit refusal', 'The drainage plan has not been approved; the contractor will respond by 01.12.2026.', false],
  ['a question about approval', 'Has the drainage plan been approved?', false],
  ['an unrelated closed issue in the next sentence', 'The drainage plan is still pending. The lighting installation was completed.', false],
  ['an unrelated approval in the same sentence', 'The lighting plan was approved, while the drainage plan is still pending.', false],
  ['a documented approval after two years', 'The drainage plan was approved for construction and all drainage comments were resolved.', true],
]) {
  test(`${name} ${expected ? 'closes' : 'does not close'} an open construction question`, () => {
    assert.equal(quality.findingIsSupersededByLaterEvidence({
      finding: { title: 'Drainage approval pending', work_quote: drainageIssue.extracted_text },
      currentWorkDocument: drainageIssue,
      relatedWorkDocuments: [{ id: 'reply', title: 'Protocol 20.10.2026', extracted_text: laterText }],
    }), expected);
  });
}

test('Hebrew negation and a conditional future approval leave the traffic issue open', () => {
  const source = { id: 'traffic', title: 'פרוטוקול 26.03.2025', extracted_text: 'טרם אושרו הסדרי התנועה הקבועים.' };
  for (const reply of [
    'לא ניתן להוציא הסדרי תנועה זמניים כל עוד לא אושרו הסדרי התנועה הקבועים.',
    'הסדרי התנועה הקבועים יאושרו לאחר מסירת התכניות.',
    'הסדרי התנועה הקבועים יהיו מאושרים בכפוף לקבלת אישור המשטרה.',
    'האם הסדרי התנועה הקבועים אושרו?',
    'הסדרי התנועה הקבועים צפויים להיות מאושרים בחודש הבא.',
  ]) {
    assert.equal(quality.findingIsSupersededByLaterEvidence({
      finding: { title: 'אישור הסדרי התנועה הקבועים', work_quote: source.extracted_text },
      currentWorkDocument: source,
      relatedWorkDocuments: [{ id: 'reply', title: 'פרוטוקול 09.04.2025', extracted_text: reply }],
    }), false, reply);
  }
});

test('approval of a permanent traffic plan does not close the temporary traffic plan issue', () => {
  const work = { id: 'temporary', title: 'Protocol 01.01.2025', extracted_text: 'The temporary traffic plan has not been approved.' };
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { work_quote: work.extracted_text }, currentWorkDocument: work,
    relatedWorkDocuments: [{ id: 'permanent', title: 'Protocol 02.01.2025', extracted_text: 'The permanent traffic plan was approved.' }],
  }), false);
});

test('generic hydrant approval does not close a later requirement for supplier-area distribution', () => {
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: validAction, currentWorkDocument,
    relatedWorkDocuments: [{ id: 'generic-approval', title: 'פרוטוקול 01.07.2025', extracted_text: 'הידרנטים אושרו על ידי המתכנן.' }],
  }), false);
});

test('a later reopening takes precedence over an earlier approval regardless of array order', () => {
  const approval = { id: 'approval', title: 'Protocol 01.01.2025', extracted_text: 'The drainage plan was approved.' };
  const reopening = { id: 'reopened', title: 'Protocol 20.10.2026', extracted_text: 'The drainage plan approval was cancelled; revised drainage calculations are required.' };
  for (const documents of [[approval, reopening], [reopening, approval]]) {
    assert.equal(quality.findingIsSupersededByLaterEvidence({
      finding: { title: 'Drainage approval pending', work_quote: drainageIssue.extracted_text },
      currentWorkDocument: drainageIssue,
      relatedWorkDocuments: documents,
    }), false);
  }
});

test('an impossible document date cannot close an open issue', () => {
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { title: 'Drainage approval pending', work_quote: drainageIssue.extracted_text },
    currentWorkDocument: drainageIssue,
    relatedWorkDocuments: [{ id: 'invalid-date', title: 'Protocol 31.02.2025', extracted_text: 'The drainage plan was approved.' }],
  }), false);
});

test('a superseding result identifies the document and actual resolution quote', () => {
  const reply = { id: 'resolution', title: 'Protocol 20.10.2026', extracted_text: 'The drainage plan was approved for construction.' };
  assert.deepEqual(quality.findSupersedingWorkEvidence({
    finding: { work_quote: drainageIssue.extracted_text }, currentWorkDocument: drainageIssue, relatedWorkDocuments: [reply],
  }), { documentId: reply.id, documentTitle: reply.title, quote: reply.extracted_text });
});

test('neutral work note cannot create a radar card', () => {
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: {
      ...validAction,
      category: 'אין התאמה ישירה',
      work_quote: 'בישיבה נסקר מצב הניקיון באתר. לא ניתנו הוראות חדשות ולא נרשמו שינויים.',
    },
    currentWorkDocument: {
      id: 'neutral',
      title: 'פרוטוקול שבועי',
      category: 'PROTOCOL',
      extracted_text: 'בישיבה נסקר מצב הניקיון באתר. לא ניתנו הוראות חדשות ולא נרשמו שינויים.',
    },
  }), false);
  assert.equal(quality.findingHasActionableWorkEvidence({
    finding: validAction,
    currentWorkDocument,
  }), false);
});

test('prompt tells the model to use the full timeline and exact current evidence', () => {
  const prompt = quality.buildContractScanPrompt({
    contractHierarchyGuide: 'Contract controls.',
    contractContext: contract.extracted_text,
    relatedWorkContext: '01.01.2025 החומרים אושרו על ידי המתכנן.',
    workDoc: currentWorkDocument,
    workChunk: { index: 0, total: 1, start: 0, end: currentWorkDocument.extracted_text.length, text: currentWorkDocument.extracted_text },
    contractChunksIndexed: 1,
    contractSourceChars: contract.extracted_text.length,
    projectWorkChunksIndexed: 3,
  });

  assert.ok(prompt.includes('Report only the latest documented situation'));
  assert.ok(prompt.includes('work_quote appears verbatim in the CURRENT document'));
  assert.ok(prompt.includes('contract_quote and work_quote must concern the same technical subject'));
  assert.ok(prompt.includes('A date, addressee, subject line, file header, or transmittal header is not evidence'));
  assert.ok(prompt.includes('The title must describe the same fact as work_quote'));
  assert.ok(prompt.includes('פעולה לביצוע'));
  assert.equal(prompt.includes('כותרת קצרה בעברית'), false);
});

test('scan job preserves valid memory, removes placeholders and applies the existing quality gate', () => {
  const route = fs.readFileSync('src/app/api/scan/route.ts', 'utf8').replace(/\r\n/g, '\n');
  const service=fs.readFileSync('src/server/ai/radar-service.server.ts','utf8');
  assert.ok(route.includes("createOwnedAiJob(req,'scan',body)"));
  assert.equal(service.includes('initializeExistingScanMemory'), false);
  assert.equal(service.includes('resetPrematureScanBaseline'), false);
  assert.equal(service.includes('.update({ scan_signature: null })'), false);
  assert.ok(service.includes('deleteTemplatePlaceholderFindings'));
  assert.ok(/\.from\("contradictions"\)\s*\.delete\(\)/.test(service));
  assert.ok(service.includes('assessContractScanFinding'));
  assert.ok(service.includes('buildRadarEvidenceAssessment(p, assessment)'));
  assert.ok(service.includes("status:'SKIPPED'"));
});
