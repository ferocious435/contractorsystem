import assert from 'node:assert/strict';
import test from 'node:test';
import { pricingFixture, partialFixture, mismatchFixture } from './fixtures/pricing-scope-fixtures.mjs';
import { validatePricingScope, validatePricingCompatibility } from '../src/utils/pricing-scope-review.ts';

const review = fixture => validatePricingScope(fixture.context, fixture.draft);

test('a separate compatibility verdict must quote the request and the actual offered material', () => {
  const { context } = mismatchFixture();
  const draft = { compatible: 'NO', dimension: 'material', reason: 'החומרים שונים.',
    required_spec_quote: context.sources[0].extracted_text, priced_spec_quote: context.sources[1].extracted_text,
    evidence: context.sources.map(source => ({ documentId: source.id, quote: source.extracted_text })) };
  const result = validatePricingCompatibility(context, 'fill-price', draft);
  assert.equal(result.status, 'MISMATCH'); assert.equal(result.evidence.length, 2);
  draft.evidence[1].quote = 'חול מיוצב עם 8% צמנט';
  assert.equal(validatePricingCompatibility(context, 'fill-price', draft).status, 'UNKNOWN');
});

test('different explicit grades require review even if a model claims MATCH', () => {
  for (const [wanted, offered] of [['S-8', 'C'], ['R45', 'B20']]) {
    const fixture = pricingFixture();
    fixture.context.sources[0].extracted_text = `יש לבצע מילוי של 2 מ"ק חומר מסוג ${wanted}.`;
    fixture.context.sources[1].extracted_text = `מילוי חומר מסוג ${offered}. יחידה מ"ק. מחיר 75 ש"ח ללא מע"מ.`;
    fixture.context.candidates[0].text = fixture.context.sources[1].extracted_text;
    fixture.draft.requirements[0].evidence[0].quote = fixture.context.sources[0].extracted_text;
    fixture.draft.positions[0].evidence = fixture.context.sources.map(source => ({ documentId: source.id, quote: source.extracted_text }));
    assert.equal(review(fixture).status, 'NEEDS_REVIEW');
    assert.equal(validatePricingCompatibility(fixture.context, 'fill-price', { compatible: 'YES', dimension: 'material', reason: 'matches',
      required_spec_quote: fixture.context.sources[0].extracted_text, priced_spec_quote: fixture.context.sources[1].extracted_text,
      evidence: fixture.draft.positions[0].evidence }).status, 'UNKNOWN');
  }
});

test('rejected position retains its real work quote even if no instruction can be extracted from an event', () => {
  const result = review(mismatchFixture('work'));
  assert.ok(result.positions[0].evidence.some(anchor => anchor.documentId === 'work'));
});

test('a suitable sourced item prices two cubic metres at 75 without invented model arithmetic', () => {
  const fixture = pricingFixture(); fixture.draft.lines[0].amountExclVat = 99999;
  const result = review(fixture);
  assert.equal(result.status, 'FULL'); assert.equal(result.requiresReview, false);
  assert.equal(result.totalExclVat, 150); assert.equal(result.lines[0].unitPriceExclVat.value, 75);
  assert.equal(result.positions[0].evidence[0].quote, fixture.context.sources[0].extracted_text);
  assert.equal(result.positions[0].evidence[0].page, null);
});

for (const kind of ['material', 'work']) test(`${kind} mismatch cannot become a price through matching words or a code`, () => {
  const result = review(mismatchFixture(kind));
  assert.equal(result.status, 'REJECTED'); assert.equal(result.totalExclVat, null); assert.equal(result.lines.length, 0);
});

test('missing quantity stays null instead of one even when the model returns a lump sum', () => {
  const fixture = pricingFixture(); fixture.draft.lines[0].quantity = { value: null, basis: 'UNKNOWN', evidence: [] };
  fixture.draft.quantity_basis = 'LUMP_SUM';
  const result = review(fixture);
  assert.equal(result.lines[0].quantity.value, null); assert.equal(result.totalExclVat, null); assert.equal(result.requiresReview, true);
});

test('a numeric value in a price band is not a measured quantity of the requested work', () => {
  const fixture = pricingFixture(); fixture.draft.lines[0].quantity.evidence = [{ documentId: 'price', quote: fixture.context.sources[1].extracted_text }];
  const result = review(fixture);
  assert.equal(result.lines[0].quantity.value, null); assert.equal(result.requiresReview, true);
});

for (const change of ['quote', 'source', 'price', 'unit', 'coefficient', 'manual', 'note']) test(`unverified ${change} cannot make an automatic total`, () => {
  const fixture = pricingFixture();
  if (change === 'quote') fixture.draft.positions[0].evidence[1].quote = 'Не существующая в источнике цитата';
  if (change === 'source') fixture.draft.positions[0].candidateId = 'invented';
  if (change === 'price') fixture.draft.lines[0].unitPriceExclVat = { value: 999, basis: 'SOURCE', evidence: [] };
  if (change === 'unit') fixture.draft.positions[0].dimensions.unit = 'MISMATCH';
  if (change === 'coefficient') fixture.draft.lines[0].coefficients = [{ value: 1.2, basis: 'SOURCE', evidence: [] }];
  if (change === 'manual') fixture.draft.lines[0].quantity.basis = 'MANUAL';
  if (change === 'note') {
    fixture.context.sources.push({ id: 'other-note', title: 'Чужая книга', role: 'PRICE', allowed: true, extracted_text: 'Цена включает монтаж.' });
    fixture.draft.positions[0].evidence.push({ documentId: 'other-note', quote: 'Цена включает монтаж.' });
  }
  const result = review(fixture);
  assert.equal(result.requiresReview, true); assert.equal(result.totalExclVat, null);
});

test('two separately sourced partial positions cover supply and installation together', () => {
  const fixture = partialFixture();
  const result = review(fixture);
  assert.equal(result.status, 'FULL'); assert.equal(result.requiresReview, false); assert.equal(result.totalExclVat, 150);
  assert.deepEqual(result.uncoveredRequirementIds, []);
  fixture.draft.lines.pop(); fixture.draft.positions.pop();
  const partial = review(fixture);
  assert.equal(partial.status, 'PARTIAL'); assert.deepEqual(partial.uncoveredRequirementIds, ['installation']);
  assert.equal(partial.requiresReview, true); assert.equal(partial.totalExclVat, null);
});

test('an operation already included in another item cannot be paid twice', () => {
  const fixture = partialFixture(); fixture.draft.positions[0].requirementIds.push('installation');
  fixture.draft.lines[0].requirementIds.push('installation');
  const result = review(fixture);
  assert.equal(result.requiresReview, true); assert.equal(result.totalExclVat, null);
});

test('the same candidate cannot be charged on two lines by renaming the operation', () => {
  const fixture = pricingFixture(); fixture.draft.lines.push(structuredClone(fixture.draft.lines[0]));
  const result = review(fixture);
  assert.equal(result.requiresReview, true); assert.equal(result.totalExclVat, null);
});

test('a price excerpt alone and a reported stoppage do not create an instruction to perform priced work', () => {
  const fixture = pricingFixture(); fixture.context.workSourceIds = ['price'];
  fixture.draft.requirements[0].evidence = [{ documentId: 'price', quote: fixture.context.sources[1].extracted_text }];
  assert.equal(review(fixture).requirements.length, 0);
  const event = mismatchFixture('work'); event.draft.positions[0].dimensions.work = 'MATCH'; event.draft.positions[0].status = 'FULL';
  assert.equal(review(event).requirements.length, 0);
});

test('an unread PDF or unconfirmed reference cannot support a verified price', () => {
  const fixture = pricingFixture(); fixture.context.sources[0].title = 'work.pdf';
  assert.equal(review(fixture).requiresReview, true);
  const reference = pricingFixture(); reference.context.sources[1].allowed = false;
  assert.equal(review(reference).totalExclVat, null);
});

test('unknown material is reviewable rather than interchangeable and an irrelevant condition does not block a valid item', () => {
  const fixture = pricingFixture(); fixture.draft.positions[0].dimensions.material = 'UNKNOWN';
  assert.equal(review(fixture).status, 'NEEDS_REVIEW');
  assert.equal(review(pricingFixture()).status, 'FULL');
});

test('a supported zero and a missing price remain distinct', () => {
  const fixture = pricingFixture(); fixture.context.candidates[0].rate = 0;
  fixture.context.sources[1].extracted_text = fixture.context.sources[1].extracted_text.replace('75', '0');
  fixture.context.candidates[0].text = fixture.context.sources[1].extracted_text;
  fixture.draft.positions[0].evidence[1].quote = fixture.context.sources[1].extracted_text;
  assert.equal(review(fixture).totalExclVat, 0);
  fixture.context.candidates[0].rate = null;
  assert.equal(review(fixture).totalExclVat, null);
});
