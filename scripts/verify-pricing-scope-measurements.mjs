import assert from 'node:assert/strict';
import test from 'node:test';
import { pricingFixture, partialFixture } from './fixtures/pricing-scope-fixtures.mjs';
import * as measurements from '../src/utils/pricing-scope-measurements.ts';
const { explicitPricingQuantity } = measurements;

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

const caption = 'קו מידה למקטע המזרחי: 12.00';
function drawing(text, workQuote = caption, descriptions = []) {
  return {
    workSourceIds: ['plan'], workQuote, candidates: [],
    sources: [
      { id: 'plan', title: 'Drawing', role: 'WORK', allowed: true, extracted_text: text },
      ...descriptions.map((extracted_text, i) => ({ id: `note-${i}`, title: 'Description', role: 'REFERENCE', allowed: true, extracted_text })),
    ],
  };
}

test('the whole sheet supplies units for the selected dimension without changing its literal caption', () => {
  const context = drawing(`תכנית פיתוח\n${caption}\nמקרא\nכל המידות במטרים, אלא אם מצוין אחרת`);
  const result = measurements.resolveDrawingDimension(context);
  assert.equal(result.label, '12.00');
  assert.equal(result.unit, 'm');
  assert.equal(result.basis, 'SHEET');
  assert.deepEqual(result.evidence.map(item => item.quote), [caption, 'כל המידות במטרים, אלא אם מצוין אחרת']);
});

test('a unit in the dimension and an applicable detail note each take priority over sheet units', () => {
  const detail = 'Detail A — Dimension: 1200';
  const sheet = 'All dimensions are in meters.';
  const detailNote = 'Detail A: dimensions in millimeters.';
  const context = drawing(`Site development plan\n${sheet}\n${detail}\n${detailNote}`, detail);
  assert.equal(measurements.resolveDrawingDimension(context).basis, 'DETAIL');
  assert.equal(explicitPricingQuantity(context, 'מטר').value, 1.2);
  context.workQuote += ' cm';
  context.sources[0].extracted_text = context.sources[0].extracted_text.replace(detail, context.workQuote);
  assert.equal(measurements.resolveDrawingDimension(context).basis, 'DIMENSION');
  assert.equal(explicitPricingQuantity(context, 'מטר').value, 12);
});

test('an applicable separately sourced description gives its own evidence and an old revision cannot override it', () => {
  const context = drawing(`Sheet BZ-06 Rev B\n${caption}`, caption, [
    'Description for sheet BZ-06 Rev A\nAll dimensions in centimeters.',
    'Description for sheet BZ-06 Rev B\nAll dimensions in meters.',
  ]);
  const result = measurements.resolveDrawingDimension(context);
  assert.equal(result.basis, 'DESCRIPTION');
  assert.equal(result.unit, 'm');
  assert.equal(result.evidence[1].documentId, 'note-1');
  assert.equal(explicitPricingQuantity(context, 'm').value, 12);
});

test('conflicting sheet units, repeated dimension captions and height marks stay out of the calculation', () => {
  const conflict = drawing(`Site development plan\n${caption}\nAll dimensions in meters.\nAll dimensions in centimeters.`);
  assert.equal(measurements.resolveDrawingDimension(conflict).reason, 'conflicting_units');
  assert.equal(explicitPricingQuantity(conflict, 'm').value, null);
  const duplicate = drawing(`Site development plan\n${caption}\n${caption}\nAll dimensions in meters.`);
  assert.equal(measurements.resolveDrawingDimension(duplicate).reason, 'ambiguous_dimension');
  assert.equal(explicitPricingQuantity(duplicate, 'm').value, null);
  const elevation = 'Elevation: +12.00';
  assert.equal(measurements.resolveDrawingDimension(drawing(`Site development plan\n${elevation}\nAll dimensions in meters.`, elevation)), null);
});

test('drawing conventions suggest a unit without certifying a billable quantity', () => {
  for (const [title, expected] of [
    ['תכנית פיתוח', 'm'], ['Concrete detail', 'cm'], ['Steel detail', 'mm'], ['Wood detail', 'mm'],
  ]) {
    const context = drawing(`${title}\n${caption}`);
    const result = measurements.resolveDrawingDimension(context);
    assert.equal(result.basis, 'CONVENTION');
    assert.equal(result.unit, expected);
    assert.equal(explicitPricingQuantity(context, 'm').value, null);
  }
});

test('scale, elevation and tolerance cannot fall through to the old quantity parser', () => {
  for (const line of ['Elevation: +12.00 m', 'Scale: 12.00 m', 'Dimension tolerance: 12.00 m']) {
    assert.equal(explicitPricingQuantity(drawing(`Site development plan\n${line}`, line), 'm').value, null);
  }
});

test('unit notes with restricted scope or a different exact revision cannot supply units', () => {
  const context = drawing(`Sheet BZ-06 Rev 3.1\n${caption}\nDimensions in meters, for supports only.`, caption, [
    'Sheet BZ-06 Rev 3\nAll dimensions in centimeters.',
    'This revision no longer uses Sheet BZ-06 Rev 3.1\nAll dimensions in meters.',
    'Description for sheet BZ-06 Rev 3.1\nSuperseded by later revisions. Do not use this description for execution.\nAll dimensions in meters.',
  ]);
  assert.equal(measurements.resolveDrawingDimension(context).basis, 'UNKNOWN');
  assert.equal(explicitPricingQuantity(context, 'm').value, null);
});

test('an earlier detail does not carry its units into the following plan view', () => {
  const context = drawing(`All dimensions in meters.\nDetail A\nDimensions in millimeters.\nSite development plan\n${caption}`);
  assert.equal(measurements.resolveDrawingDimension(context).basis, 'SHEET');
  assert.equal(explicitPricingQuantity(context, 'm').value, 12);
});

test('detail-specific declarations can name their scope before or after the unit', () => {
  const size = 'Detail A: Dimension: 1200';
  for (const note of ['Dimensions in millimeters for detail A.', 'Detail A: Dimensions in millimeters (unless indicated otherwise).']) {
    const context = drawing(`All dimensions in meters.\n${note}\n${size}`, size);
    assert.equal(measurements.resolveDrawingDimension(context).basis, 'DETAIL');
    assert.equal(explicitPricingQuantity(context, 'm').value, 1.2);
  }
});

test('unlocated text from a multipage drawing cannot be treated as one sheet', () => {
  const context = drawing(`Sheet BZ-06 Rev B\n${caption}\nAll dimensions in meters.`);
  context.sources[0].title = 'Drawing.pdf';
  context.sources[0].ocr_status = 'COMPLETED';
  context.sources[0].parsed_json = { source_reading: { version: 'page-coverage-v1', complete: true,
      totalPages: 2, readPages: [1, 2], unreadablePages: [] } };
  assert.equal(measurements.resolveDrawingDimension(context), null);
  assert.equal(explicitPricingQuantity(context, 'm').value, null);
});
