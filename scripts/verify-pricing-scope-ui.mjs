import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pricingFixture, mismatchFixture, partialFixture } from './fixtures/pricing-scope-fixtures.mjs';
import { pricingDatabase, sourceTables } from './fixtures/pricing-scope-database.mjs';
import { validatePricingScope } from '../src/utils/pricing-scope-review.ts';
import { getLedgerRowAmount } from '../src/utils/project-financials.ts';
import { assessPricingScopeApproval } from '../src/utils/pricing-scope-approval.ts';

registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith(new URL('../src/', import.meta.url).href) && /\.tsx?$/u.test(url)) return {
    format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: url,
    }).outputText,
  };
  return nextLoad(url, context);
}, resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  try { return nextResolve(specifier, context); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/u.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { saveLedgerItem } = await import('../src/app/api/pricing/save-ledger/save-ledger-service.ts');
const { toPricingScopeForm, applyPricingScopeFormEdit, getPricingFormAmounts, getReviewedPricingFormAmounts, getPricingFormApproval } = await import('../src/components/pricing/ai-estimator/pricingScopeForm.ts');
const { default: Summary } = await import('../src/components/pricing/ai-estimator/components/EstimatorFinancialSummary.tsx');
const { default: EvidenceTrace } = await import('../src/components/pricing/ai-estimator/components/EstimatorEvidenceTrace.tsx');
const { default: PricingForm } = await import('../src/components/pricing/ai-estimator/components/EstimatorPricingForm.tsx');
const { loadPricingScopeContext } = await import('../src/utils/pricing-scope-sources-server.ts');
const { buildPricingScopeEvaluation } = await import('../src/utils/pricing-scope-evaluation.ts');

function scope({ missingQuantity = false, reject = false } = {}) {
  const fixture = reject ? mismatchFixture() : pricingFixture();
  if (missingQuantity) fixture.draft.lines[0].quantity = { value: null, basis: 'UNKNOWN', evidence: [] };
  return validatePricingScope(fixture.context, fixture.draft);
}

test('missing form numbers remain empty and cannot produce a zero or one-unit total', () => {
  const form = toPricingScopeForm({ suggested_quantity: null, suggested_unit_price_excl_vat: 75, scope_review: scope({ missingQuantity: true }) });
  assert.equal(form.quantity, null); assert.deepEqual(form.manualPricingInputs, {});
  assert.equal(getPricingFormAmounts(form).totalExclVat, null);
});

test('a failed or unfinished recalculation cannot approve an earlier visible estimate', () => {
  const evaluation = { scope_review: scope(), suggested_quantity: 2, suggested_unit_price_excl_vat: 75, suggested_unit: 'מ"ק' };
  const form = toPricingScopeForm(evaluation);
  assert.equal(getPricingFormApproval(evaluation, form).allowed, true);
  assert.equal(getPricingFormApproval(evaluation, form, { error: 'Local unavailable' }).allowed, false);
  assert.equal(getPricingFormApproval(evaluation, form, { isLoading: true }).allowed, false);
});

test('an explicit manual quantity resolves only the quantity gap', () => {
  const review = scope({ missingQuantity: true });
  assert.equal(assessPricingScopeApproval(review, {}).allowed, false);
  const result = assessPricingScopeApproval(review, { quantity: 2 });
  assert.equal(result.allowed, true); assert.equal(result.totalExclVat, 150);
  assert.equal(assessPricingScopeApproval(scope({ reject: true }), { quantity: 2 }).allowed, false);
});

test('manual edits preserve their origin and markup is applied exactly once', () => {
  let form = toPricingScopeForm({ suggested_quantity: 2, suggested_unit_price_excl_vat: 75 });
  form = applyPricingScopeFormEdit(form, 'markup', '20');
  assert.deepEqual(form.manualPricingInputs, { markupPercent: 20 });
  assert.equal(getPricingFormAmounts(form).totalExclVat, 180);
  assert.equal(assessPricingScopeApproval(scope(), form.manualPricingInputs).totalExclVat, 180);
  form = applyPricingScopeFormEdit(form, 'quantity', '');
  assert.equal(form.quantity, null); assert.equal(getPricingFormAmounts(form).totalExclVat, null);
});

test('a fractional coefficient has the same cents in scope, form and saved approval', () => {
  const fixture = pricingFixture();
  const coefficientQuote = 'מקדם מחיר 1.175.';
  fixture.context.sources[1].extracted_text += ` ${coefficientQuote}`;
  fixture.draft.lines[0].coefficients = [{ value: 1.175, basis: 'SOURCE', evidence: [{ documentId: 'price', quote: coefficientQuote }] }];
  const review = validatePricingScope(fixture.context, fixture.draft);
  const evaluation = buildPricingScopeEvaluation(fixture.context, review);
  const form = toPricingScopeForm(evaluation);
  assert.equal(review.totalExclVat, 176.26);
  assert.equal(getPricingFormAmounts(form).totalExclVat, review.totalExclVat);
  assert.equal(assessPricingScopeApproval(review, {}).totalExclVat, review.totalExclVat);
});

test('fractional quantities cannot silently change a two-line sum when combined into one ledger row', () => {
  const fixture = partialFixture();
  const work = 'יש לבצע אספקה והתקנה של 0.333 מטר צינור.';
  fixture.context.sources[0].extracted_text = work;
  fixture.draft.requirements.forEach(row => { row.evidence = [{ documentId: 'work', quote: work }]; });
  fixture.context.candidates.forEach((row, i) => {
    const source = fixture.context.sources[i + 1];
    source.extracted_text = `מחיר ${i ? 'התקנת' : 'אספקת'} צינור. יחידה מטר. מחיר 1 ללא מע"מ.`;
    row.unit = 'מטר'; row.rate = 1; row.text = source.extracted_text;
    fixture.draft.positions[i].evidence = [{ documentId: 'work', quote: work }, { documentId: source.id, quote: source.extracted_text }];
    fixture.draft.lines[i].quantity = { value: 0.333, basis: 'SOURCE', evidence: [{ documentId: 'work', quote: work }] };
  });
  const review = validatePricingScope(fixture.context, fixture.draft);
  assert.equal(review.requiresReview, true); assert.equal(review.totalExclVat, null);
  assert.equal(assessPricingScopeApproval(review, {}).allowed, false);
});

test('the real amount summary shows a dash for unknown and the sourced total with VAT separately', () => {
  const props = { themeColor: 'emerald', themeHex: '#10b981', isExpertMode: false, isSaving: false, isLoading: false,
    transactionDisplayId: 'test', canSubmit: false, onSubmit() {} };
  const empty = renderToStaticMarkup(React.createElement(Summary, { ...props, ...getPricingFormAmounts(toPricingScopeForm({})) }));
  assert.ok(empty.includes('—')); assert.ok(!empty.includes('NaN'));
  const amounts = getPricingFormAmounts(toPricingScopeForm({ suggested_quantity: 2, suggested_unit_price_excl_vat: 75 }));
  assert.deepEqual([amounts.totalExclVat, amounts.vatAmount, amounts.totalInclVat], [150, 27, 177]);
  const html = renderToStaticMarkup(React.createElement(Summary, { ...props, ...amounts }));
  for (const value of ['150', '27', '177']) assert.ok(html.includes(value));
});

test('the scope panel names the price source, item, available page and original quotes', () => {
  const fixture = pricingFixture(); fixture.context.candidates[0].page = 7;
  const review = validatePricingScope(fixture.context, fixture.draft);
  const html = renderToStaticMarkup(React.createElement(EvidenceTrace, {
    contradiction: { id: 'finding', evidence_data: {}, source_execution_doc_id: 'work' },
    estimateData: { scope_review: review }, onViewSource() {},
  }));
  assert.ok(html.includes('מחירון בדיקה')); assert.ok(html.includes('51.003.0110'));
  assert.ok(html.includes('עמוד 7')); assert.ok(html.includes('התאמה מלאה'));
  assert.ok(html.includes('חומר מילוי נברר מסוג C'));
  assert.ok(!html.includes('אין מקור ישיר מאומת לפריט זה'), 'Do not contradict the verified scope source with a legacy missing-source warning');
});

test('a known rate with unknown quantity does not ask the user to enter the already known rate', () => {
  const formState = toPricingScopeForm({ suggested_unit_price_excl_vat: 75, suggested_quantity: null });
  const html = renderToStaticMarkup(React.createElement(PricingForm, { formState, hasPricingDraft: false, onFormChange() {}, onMarkupPreset() {} }));
  assert.ok(!html.includes('יש להזין מחיר יחידה'));
});

test('the final form total stays unknown for partial coverage or a failed refresh', () => {
  const fixture = partialFixture(); fixture.context.candidates.splice(1); fixture.draft.positions.splice(1); fixture.draft.lines.splice(1);
  const partial = buildPricingScopeEvaluation(fixture.context, validatePricingScope(fixture.context, fixture.draft));
  assert.equal(getReviewedPricingFormAmounts(partial, toPricingScopeForm(partial)).totalExclVat, null);
  const complete = { scope_review: scope(), suggested_quantity: 2, suggested_unit_price_excl_vat: 75, suggested_unit: 'מ"ק' };
  assert.equal(getReviewedPricingFormAmounts(complete, toPricingScopeForm(complete)).totalExclVat, 150);
  assert.equal(getReviewedPricingFormAmounts(complete, toPricingScopeForm(complete), { error: 'Local unavailable' }).totalExclVat, null);
});

async function ledgerDatabase(review) {
  const tables = sourceTables();
  tables.contradictions[0].evidence_data.pricing_evaluation = { scope_review: review, suggested_unit: 'מ"ק', source: 'DEKEL' };
  const db = pricingDatabase(tables, { allowWrites: true });
  const { pricingScopeSignature } = await import('../src/utils/pricing-scope-signature.ts');
  const context = await loadPricingScopeContext({ supabase: db, projectId: 'p', findingId: 'finding' });
  db.tables.contradictions[0].evidence_data.pricing_evaluation.scope_source_signature = pricingScopeSignature(context);
  return db;
}
const payload = { project_id: 'p', contradiction_id: 'finding', description: 'עבודת מילוי לפי המקור',
  quantity: 2, unit_price_excl_vat: 75, unit: 'מ"ק', source: 'DEKEL', type: 'PENDING_VO' };

for (const forged of [false, true]) test(`server uses the stored review when client ${forged ? 'forges' : 'omits'} the review`, async () => {
  const db = await ledgerDatabase(scope({ missingQuantity: true }));
  const result = await saveLedgerItem(db, 'owner', { ...payload,
    evidence_data: forged ? { pricing_evaluation: { scope_review: scope(), requires_user_answer_before_approval: false } } : {} });
  assert.equal(result.status, 409); assert.equal(db.writes.length, 0);
});

test('a sourced calculation with explicitly entered missing quantity can be saved', async () => {
  const db = await ledgerDatabase(scope({ missingQuantity: true }));
  const result = await saveLedgerItem(db, 'owner', { ...payload, manual_pricing_inputs: { quantity: 2 } });
  assert.equal(result.status, 200); assert.equal(db.tables.pricing_ledger[0].quantity, 2);
  assert.equal(getLedgerRowAmount(db.tables.pricing_ledger[0]), 150);
  assert.equal(db.tables.pricing_ledger[0].evidence_data.pricing_approval.total_excl_vat, 150);
  assert.equal(db.tables.pricing_ledger[0].evidence_data.manual_pricing_inputs.quantity, 2);
});

test('changing two fields while preserving the same total cannot forge a source price', async () => {
  const db = await ledgerDatabase(scope());
  const result = await saveLedgerItem(db, 'owner', { ...payload, quantity: 1, unit_price_excl_vat: 150 });
  assert.equal(result.status, 409); assert.equal(db.writes.length, 0);
});

test('a manually entered rate is stored as manual rather than as the official rate', async () => {
  const db = await ledgerDatabase(scope());
  const result = await saveLedgerItem(db, 'owner', { ...payload, unit_price_excl_vat: 100, manual_pricing_inputs: { unitPriceExclVat: 100 } });
  assert.equal(result.status, 200); assert.equal(db.tables.pricing_ledger[0].source, 'CUSTOM_ANALYSIS');
  assert.equal(getLedgerRowAmount(db.tables.pricing_ledger[0]), 200);
});

test('a changed price source cannot approve the previous automatic review', async () => {
  const db = await ledgerDatabase(scope());
  const originalContext = await loadPricingScopeContext({ supabase: db, projectId: 'p', findingId: 'finding' });
  const { pricingScopeSignature } = await import('../src/utils/pricing-scope-signature.ts');
  db.tables.contradictions[0].evidence_data.pricing_evaluation.scope_source_signature = pricingScopeSignature(originalContext);
  db.tables.pricelist_items[0].rate = 100;
  const result = await saveLedgerItem(db, 'owner', payload);
  assert.equal(result.status, 409); assert.equal(db.writes.length, 0);
});

test('an old unverified suggestion cannot be approved by omitting its client evidence', async () => {
  const db = await ledgerDatabase(null);
  db.tables.contradictions[0].evidence_data.pricing_evaluation = { suggested_unit_price_excl_vat: 75, confidence: 0.99 };
  const result = await saveLedgerItem(db, 'owner', payload);
  assert.equal(result.status, 409); assert.equal(db.writes.length, 0);
});

test('an automatic scope without a source signature remains unverified', async () => {
  const db = await ledgerDatabase(scope());
  delete db.tables.contradictions[0].evidence_data.pricing_evaluation.scope_source_signature;
  const result = await saveLedgerItem(db, 'owner', payload);
  assert.equal(result.status, 409); assert.equal(db.writes.length, 0);
});
