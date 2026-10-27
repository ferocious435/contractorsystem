import assert from 'node:assert/strict';
import test from 'node:test';
import { pricingFixture, partialFixture } from './fixtures/pricing-scope-fixtures.mjs';
import { explicitPricingQuantity } from '../src/utils/pricing-scope-measurements.ts';

test('an explicit physical measurement is extracted from the actual work, without asking the model to guess', () => {
  assert.equal(explicitPricingQuantity(pricingFixture().context, 'מ"ק').value, 2);
  assert.equal(explicitPricingQuantity(partialFixture().context, 'יחידה').value, 2);
});
for (const source of ['יש לבצע מילוי עד 20 מ"ק.', 'יש לבצע מילוי, הכמות תימדד בהמשך. 2026.', 'יש לבצע מילוי עם 8% צמנט.']) {
  test(`a limit, year or material percentage is not a work quantity: ${source}`, () => {
    const { context } = pricingFixture(); context.sources[0].extracted_text = source;
    assert.equal(explicitPricingQuantity(context, 'מ"ק').value, null);
  });
}
test('a quantity from another part of the document is not borrowed for the selected quote', () => {
  const { context } = pricingFixture(); context.sources[0].extracted_text += '\nיש לבצע מילוי של 9 מ"ק במקום אחר.';
  context.workQuote = 'יש לבצע מילוי של 9 מ"ק במקום אחר.';
  assert.equal(explicitPricingQuantity(context, 'מ"ק').value, 9);
});

test('a delivery identifier is not a piece count just because the work uses piece units', () => {
  const {context}=partialFixture();
  context.sources[0].extracted_text='יש לבצע אספקה והתקנה של שסתומים. יחידת מדידה: יחידה. מסמך משלוח מספר 8';
  assert.equal(explicitPricingQuantity(context,'יחידה').value,null);
});
