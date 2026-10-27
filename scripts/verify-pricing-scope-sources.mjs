import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { pricingDatabase, sourceTables } from './fixtures/pricing-scope-database.mjs';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  try { return nextResolve(specifier, context); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/u.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { loadPricingScopeContext } = await import('../src/utils/pricing-scope-sources-server.ts');
hook.deregister();
const load = database => loadPricingScopeContext({ supabase: database, projectId: 'p', findingId: 'finding' });

test('contract pricing context and the selected book survive without a hard-coded official-book preference', async () => {
  const db = pricingDatabase(sourceTables()); const context = await load(db);
  assert.match(context.sources.find(row => row.id === 'contract').extracted_text, /יחול מחירון דקל/);
  assert.equal(context.candidates.find(row => row.id === 'fill-price').sourceType, 'DEKEL');
  assert.equal(context.candidates.find(row => row.id === 'fill-price').priceBasis, 'EXCL_VAT');
  assert.deepEqual(context.workSourceIds, ['work']); assert.equal(db.writes.length, 0);
});

test('notes are restricted to the same book and exact section boundary', async () => {
  const context = await load(pricingDatabase(sourceTables()));
  assert.deepEqual(context.candidates.find(row => row.id === 'fill-price').noteSourceIds, ['same-book-section-note']);
});

test('global terms remain attributable to their book and edition', async () => {
  const tables = sourceTables(); tables.pricelists[0].terms_text = 'מחירי היחידה אינם כוללים מע"מ.';
  tables.pricelists[0].version_label = '2024';
  tables.pricelist_items.push({ id: 'wrong-edition', pricelist_id: 'dekel', item_type: 'NOTE', item_code: '51.003',
    description: 'אספקה בלבד.', metadata: { version_label: '2025' } });
  const context = await load(pricingDatabase(tables));
  const candidate = context.candidates.find(row => row.id === 'fill-price');
  assert.ok(candidate.noteSourceIds.includes('dekel:terms_text'));
  assert.ok(!candidate.noteSourceIds.includes('wrong-edition'));
  assert.equal(context.sources.find(row => row.id === 'dekel:terms_text').extracted_text, 'מחירי היחידה אינם כוללים מע"מ.');
});

test('a readable uploaded price table is usable as price evidence and never as a work instruction', async () => {
  const tables = sourceTables();
  tables.documents.push({ id: 'excerpt', project_id: 'p', title: 'מצורף', category: 'EXECUTION', doc_type: 'contract',
    extracted_text: 'סעיף\tתאור\tיחידה\tכמות\tמחיר\n57.092.0039\tחול מיוצב עם 8% צמנט, S-8\nמ"ק\t1\t520.00\nמחירון דקל, מחירים ללא מע"מ',
    ocr_status: 'COMPLETED', parsed_json: {} });
  tables.contradictions[0].source_execution_doc_id = 'excerpt';
  tables.contradictions[0].evidence_data.work_quote = 'חול מיוצב עם 8% צמנט, S-8';
  const context = await load(pricingDatabase(tables));
  const candidate = context.candidates.find(row => row.itemCode === '57.092.0039');
  assert.ok(candidate); assert.equal(candidate.rate, 520); assert.equal(candidate.unit, 'מ"ק');
  assert.equal(context.sources.find(row => row.id === 'excerpt').role, 'PRICE');
  assert.ok(!context.workSourceIds.includes('excerpt'));
});

test('unread pages and draft contracts do not become trusted through a name or category', async () => {
  const tables = sourceTables(); tables.documents[0].title = 'הוראה.pdf';
  tables.documents[0].parsed_json = { source_reading: { version: 'page-coverage-v1', complete: false, totalPages: 2, readPages: [1], unreadablePages: [2] } };
  tables.documents[1].extracted_text = 'טיוטה\nלעבודות נוספות יחול מחירון דקל.';
  const context = await load(pricingDatabase(tables));
  assert.equal(context.sources.find(row => row.id === 'work').allowed, false);
  assert.ok(!context.sources.some(row => row.id === 'contract' && row.allowed));
});

test('an unknown reference edition remains unavailable and does not block an unrelated price source', async () => {
  const tables = sourceTables();
  tables.reference_documents = [{ id: 'blue', project_id: 'p', title: 'המפרט הכללי', reference_type: 'BLUE_BOOK', status: 'READY' }];
  tables.reference_document_chunks = [{ id: 'uncertain', reference_document_id: 'blue', chunk_type: 'SECTION', ordinal: 1,
    section_code: '51.003', text: '51.003 אספקה ופיזור חומר מילוי מסוג C.' }];
  const context = await load(pricingDatabase(tables));
  assert.ok(!context.sources.some(row => row.id === 'uncertain' && row.allowed));
  assert.ok(context.sources.find(row => row.id === context.candidates[0].sourceId).allowed);
});

test('full source text is retained even when the prompt will select only relevant ranges', async () => {
  const tables = sourceTables(); const tail = '\n' + 'מידע נוסף למקור. '.repeat(1500);
  tables.documents[0].extracted_text += tail;
  const context = await load(pricingDatabase(tables));
  assert.ok(context.sources.find(row => row.id === 'work').extracted_text.endsWith(tail));
});
