import assert from 'node:assert/strict';
import test from 'node:test';

const support = await import('../src/utils/support-source-enrichment.ts');

test('search terms are compact and remove generic words', () => {
  const terms = support.extractSupportSearchTerms('הקבלן נדרש לבצע מילוי חול מצומנט לפי המסמך');
  assert.ok(terms.includes('מצומנט'));
  assert.ok(terms.includes('מילוי'));
  assert.ok(!terms.includes('הקבלן'));
});

test('database text filter keeps only safe search terms', () => {
  const filter = support.buildSafeIlikeOrFilter('description', ['הידרנט', 'bad,value', 'x']);
  assert.equal(filter, 'description.ilike.%הידרנט%,description.ilike.%bad value%');
  assert.ok(!filter.includes(',value'));
});

test('reference candidates are ranked by the finding topic', () => {
  const ranked = support.rankSupportCandidates('מילוי חול מצומנט', [
    { id: 'a', title: 'חוזה 3210', text: 'לוחות זמנים לעבודות' },
    { id: 'b', title: 'ספר כחול', text: 'מילוי חול מצומנט סביב צנרת' },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['b']);
});

test('model candidate IDs are accepted only inside the supplied list', () => {
  assert.deepEqual(support.selectVerifiedSupportIds(['R2', 'R9', 'P1', 'R2'], 'R', 2), ['R2']);
});

test('model-selected support IDs still need direct topic overlap', () => {
  const candidates = [
    { id: 'warranty', text: 'תקופת הבדק היא 12 חודשים' },
    { id: 'sand', text: 'אספקת חול מצומנט למילוי תעלות' },
  ];
  assert.deepEqual(support.selectRelevantSupportIds({
    value: ['P1', 'P2'],
    prefix: 'P',
    candidates,
    query: 'דרישה לאחריות מול תקופת הבדק',
  }), ['P1']);
});

test('generic supply and installation words cannot attach a generator price to a FOX product issue', () => {
  assert.deepEqual(support.rankSupportCandidates('נדרש אישור לאביזרי FOX בכפוף להתקנה ואספקה לפי הוראות היצרן', [{
    id: 'generator', itemCode: '08.003.0429', text: 'אספקה, הובלה, התקנה והפעלה של דיזל גנרטור בהספק עד 50 KVA כולל כל הנדרש לפי סעיף 08.3.426',
  }]), []);
});

test('the word drawings cannot attach a retaining-wall price to a drawings transmittal', () => {
  assert.deepEqual(support.rankSupportCandidates('על הקבלן להעביר תכניות מעודכנות ורשימת תכניות לצורך ביצוע העבודה', [{
    id: 'wall', text: 'קיר כובד בטון עם חזית אבן, כולל חפירה ומילוי וכל הנדרש לביצוע הקיר לפי התכניות והמפרט',
  }]), []);
});

test('generic request-in-writing wording does not link FOX fittings to a fire-alarm reference', () => {
  assert.deepEqual(support.rankSupportCandidates('הקבלן פנה בבקשה לקבל הסבר בכתב מדוע לא מאושר מוצר FOX', [{
    id: 'fire-alarm', text: 'הקבלן יכול לקבל מסמכים בכתב אודות בדיקת מערכות גילוי וכיבוי אש.',
  }]), []);
});

test('Hebrew prefixes do not turn generic document words back into search subjects', () => {
  const terms = support.extractSupportSearchTerms('באביזרים ובהתקנה בתכניות FOX');
  assert.ok(terms.includes('fox'));
  assert.equal(terms.includes('באביזרים'), false);
  assert.equal(terms.includes('בתכניות'), false);
});

test('a price-list year shared with a protocol date is not a subject match', () => {
  assert.deepEqual(support.rankSupportCandidates('פרוטוקול 2025 אישור הידרנטים', [{
    id: 'wall', title: 'מחירון 2025', text: 'קיר בטון עם חזית אבן',
  }]), []);
});

test('a three-letter product identifier remains available for source search', () => {
  assert.ok(support.extractSupportSearchTerms('אישור אביזרי FOX').includes('fox'));
});

test('repeated filler does not pass as a useful support recommendation', () => {
  assert.equal(support.supportAnalysisTextIsGrounded({
    impactSummary: 'יש להשלים את ההתחלה', recommendedAction: 'הצגת התחלה למתכנן לתקן את התחלה של התחלה',
    suppliedSourceText: 'נדרש היתר חפירה ותיאום עם מתכנן הגז', selectedReferences: [],
  }), false);
});

test('prompt separates issue detection from support analysis', () => {
  const prompt = support.buildSupportAnalysisPrompt({
    title: 'מילוי חול מצומנט',
    category: 'שינוי/חריג',
    contractQuote: 'ציטוט חוזי',
    workQuote: 'ציטוט ביצוע',
    referenceCandidates: [{
      id: 'r1',
      title: 'הספר הכחול',
      text: 'קטע מקור',
      applicability: 'REFERENCE_ONLY',
    }],
    priceCandidates: [{ id: 'p1', title: 'מחירון דקל', itemCode: '01.02', text: 'תיאור מחיר' }],
  });
  assert.match(prompt, /REFERENCE_ONLY source is context/);
  assert.match(prompt, /project BOQ first/);
  assert.match(prompt, /R1/);
  assert.match(prompt, /P1/);
});

test('support analysis rejects invented numbers', () => {
  assert.equal(support.supportAnalysisTextIsGrounded({
    impactSummary: 'נגרם עיכוב של 30 ימים',
    recommendedAction: 'לשלוח הודעה',
    suppliedSourceText: 'העבודה נעצרה ללא משך מתועד',
    selectedReferences: [],
  }), false);
});

test('unconfirmed reference cannot be described as binding', () => {
  assert.equal(support.supportAnalysisTextIsGrounded({
    impactSummary: 'הספר מחייב את המזמין',
    recommendedAction: 'לשלוח הודעה',
    suppliedSourceText: 'קטע כללי',
    selectedReferences: [{ id: 'r1', text: 'קטע כללי', applicability: 'REFERENCE_ONLY' }],
  }), false);
});
