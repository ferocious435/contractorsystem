import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

globalThis.fetch = () => { throw new Error('Network is forbidden in offline context/source tests'); };
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/')
    ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const chunks = await import('../src/utils/document-scan-chunks.ts');
const quality = await import('../src/utils/contract-scan-quality.ts');
const anchors = await import('../src/utils/radar-evidence-assessment.ts');
hook.deregister();

const baseFinding = { title: 'חומר מילוי סביב הצינור', category: 'סתירה',
  description: 'חומר המילוי סביב הצינור שונה.', advice: 'לבדוק את הדרישה.',
  work_document_id: 'work', contract_document_id: 'bound',
  work_quote: 'חומר המילוי סביב הצינור יהיה חול מצומנט 4%.',
  contract_quote: 'חומר המילוי סביב הצינור יהיה חול מצומנט 8%.' };
const work = { id: 'work', title: 'הוראה.docx', extracted_text: baseFinding.work_quote };

test('zero_relevance_does_not_supply_contract_basis', () => {
  const source = chunks.buildDocumentScanChunks([{ id: 'unrelated', extracted_text: 'הידרנטים יהיו מתוצרת רפאל.' }]);
  assert.deepEqual(chunks.selectRelevantContractChunks(source, 'לוח זמנים מעודכן לפרויקט'), []);
});

test('numbers_and_generic_words_do_not_supply_contract_basis', () => {
  const source = chunks.buildDocumentScanChunks([{ id: 'generic', extracted_text: 'הקבלן יבצע את העבודות בהתאם לחוזה בתוך 19 ימים.' }]);
  assert.deepEqual(chunks.selectRelevantContractChunks(source, 'הקבלן נדרש לבצע את העבודות בהתאם לחוזה 19'), []);
});

test('contract_context_includes_monthly_update_clause_across_chunk_boundary', () => {
  const text = `4.6 עבודות לילה.\n4.7 הגשת לוח זמנים מפורט בתוך 14 ימים. ${'פירוט משאבים ופעילויות. '.repeat(24)}\n4.8 הקבלן יגיש בכל חודש עד ה-25 לוח זמנים מעודכן.\n4.9 הפרת ההסכם.`;
  const source = chunks.buildDocumentScanChunks([{ id: 'schedule', extracted_text: text }], 500, 10);
  const selected = chunks.selectRelevantContractChunks(source, 'הגשת לוח זמנים מפורט בתוך 14 ימים', 1500, 1);
  const formatted = chunks.formatContractComparisonContext(selected, [], 'לוח זמנים');
  assert.ok(formatted.includes('4.7 הגשת'));
  assert.ok(formatted.includes('4.8 הקבלן יגיש בכל חודש'));
});

test('technical_and_measurement_context_are_kept_as_separate_source_passages', () => {
  const text = `57.02.1 מילוי התעלה: עטיפת הצינור בחול מצומנט 8%; מעליה חומר מקומי מאושר.\n57.03.1 חציית כביש. ${'תיאור חצייה. '.repeat(70)}\n57.15.16 מילוי תעלות בבטון CLSM: יחידת המידה מ"ק והמחיר כולל מילוי מעל עטיפת הצינור.`;
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([{ id: 'fill', extracted_text: text }], 500, 10),
    'מילוי תעלות בחול מצומנט סביב הצינור', 1600, 1);
  const formatted = chunks.formatContractComparisonContext(selected, [], 'מילוי תעלות');
  assert.ok(formatted.includes('57.02.1'));
  assert.ok(formatted.includes('57.15.16'));
});

test('explicit_local_clause_reference_is_available_in_context', () => {
  const text = `4.7 הקבלן יגיש לוח זמנים בהתאם לסעיף 9.2.\n5.1 ביטוח. ${'תנאי ביטוח. '.repeat(70)}\n9.2 עדכון לוח הזמנים נדרש בכל חודש.`;
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([{ id: 'reference', extracted_text: text }], 500, 10),
    'הקבלן יגיש לוח זמנים בהתאם לסעיף 9.2', 1400, 1);
  assert.ok(chunks.formatContractComparisonContext(selected, [], 'לוח זמנים').includes('9.2 עדכון'));
});

test('context_limits_and_actual_source_boundaries_are_reported_without_modifying_source', () => {
  const text = `4.7 לוח זמנים מפורט. ${'פעילות תכנון משאבים ממושכת. '.repeat(100)}\n4.8 עדכון לוח הזמנים החודשי נדרש.`;
  const document = { id: 'budget', extracted_text: text };
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([document], 500, 20), 'לוח זמנים מפורט', 350, 1);
  assert.equal(document.extracted_text, text);
  assert.ok(selected.reduce((sum, item) => sum + item.text.length, 0) <= 350);
  assert.equal(selected[0].context_selection?.complete, false);
  assert.ok(selected[0].context_selection?.limitations.length > 0);
  for (const anchor of selected[0].context_selection.source_anchors) {
    assert.equal(text.slice(anchor.start, anchor.end), anchor.quote);
  }
});

test('bound_source_does_not_change_silently_when_the_bound_document_is_missing', () => {
  const other = { id: 'other', extracted_text: baseFinding.contract_quote };
  const grounded = quality.groundContractScanFinding({ finding: baseFinding, currentWorkDocument: work, contractDocuments: [other] });
  assert.equal(grounded.contract_document_id, 'bound');
  assert.equal(quality.assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [other] }).accepted, false);
});

test('bound_source_does_not_change_silently_when_another_document_matches', () => {
  const wrong = { id: 'bound', extracted_text: 'הידרנטים יהיו מתוצרת רפאל.' };
  const other = { id: 'other', extracted_text: baseFinding.contract_quote };
  const grounded = quality.groundContractScanFinding({ finding: baseFinding, currentWorkDocument: work, contractDocuments: [wrong, other] });
  assert.equal(grounded.contract_document_id, 'bound');
  assert.equal(quality.assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [wrong, other] }).contractQuoteMatched, false);
});

test('an_explicit_work_source_is_not_silently_rebound_to_the_current_document', () => {
  const grounded = quality.groundContractScanFinding({ finding: { ...baseFinding, work_document_id: 'another-work' },
    currentWorkDocument: work, contractDocuments: [{ id: 'bound', extracted_text: baseFinding.contract_quote }] });
  assert.equal(grounded.work_document_id, 'another-work');
});

for (const [name, actual, proposed] of [
  ['negation', 'קידוח MTM ברחוב יהלום לא אושר לביצוע.', 'קידוח MTM ברחוב יהלום אושר לביצוע.'],
  ['number', 'חומר המילוי סביב הצינור יהיה חול מצומנט 8%.', 'חומר המילוי סביב הצינור יהיה חול מצומנט 4%.'],
  ['condition', 'קידוח MTM ברחוב יהלום אושר בכפוף לחתימת הנספח.', 'קידוח MTM ברחוב יהלום אושר לחתימת הנספח.'],
  ['prefixed_negation', 'קידוח MTM ברחוב יהלום בוצע ולא אושר לביצוע.', 'קידוח MTM ברחוב יהלום בוצע ואושר לביצוע.'],
  ['future_approval', 'קידוח MTM ברחוב יהלום יאושר לביצוע.', 'קידוח MTM ברחוב יהלום אושר לביצוע.'],
  ['condition_word', 'קידוח MTM ברחוב יהלום אושר לביצוע ובלבד שהנספח ייחתם.', 'קידוח MTM ברחוב יהלום אושר לביצוע שהנספח ייחתם.'],
]) {
  test(`fuzzy_repair_does_not_change_${name}`, () => {
    assert.equal(quality.findClosestEvidenceQuote(actual, proposed), null);
  });
}

test('incomplete_source_stays_unverified_even_with_an_exact_pair_of_quotes', () => {
  const incomplete = { ...work, title: 'הוראה.pdf', ocr_status: 'COMPLETED' };
  const result = quality.assessContractScanFinding({ finding: baseFinding, currentWorkDocument: incomplete,
    contractDocuments: [{ id: 'bound', extracted_text: baseFinding.contract_quote }] });
  assert.equal(result.workQuoteMatched, true);
  assert.equal(result.evidenceStatus, 'REQUIRES_VERIFICATION');
});

test('new_model_output_can_still_bind_a_unique_exact_source', () => {
  const finding = { ...baseFinding };
  delete finding.contract_document_id;
  delete finding.work_document_id;
  const grounded = quality.groundContractScanFinding({ finding, currentWorkDocument: work,
    contractDocuments: [{ id: 'bound', extracted_text: baseFinding.contract_quote }] });
  assert.equal(grounded.contract_document_id, 'bound');
  assert.equal(grounded.work_document_id, 'work');
});

test('comparison_context_records_only_the_passages_actually_formatted', () => {
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([
    { id: 'bound', extracted_text: `57.02 חומר המילוי סביב הצינור יהיה חול מצומנט 8%.\n57.03 המדידה לפי אורך הצינור.` },
  ]), baseFinding.work_quote, 1500, 1);
  const result = chunks.prepareContractComparisonContext(selected, [], baseFinding.work_quote);
  assert.equal(result.selection.complete, true);
  assert.deepEqual(result.selection.sources.map(source => source.documentId), ['bound']);
  for (const source of result.selection.sources) for (const anchor of source.selection.source_anchors) {
    assert.ok(result.text.includes(anchor.quote));
  }
  assert.equal(JSON.stringify(result.selection).includes('sourceText'), false);
});

test('a_quote_cannot_bind_to_a_document_that_was_not_supplied', () => {
  const finding = { ...baseFinding, supplied_contract_document_ids: ['supplied'] };
  const contracts = [{ id: 'bound', extracted_text: baseFinding.contract_quote }];
  const grounded = quality.groundContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: contracts });
  const assessed = quality.assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: contracts });
  assert.equal(grounded.contract_document_id, 'bound');
  assert.equal(assessed.accepted, false);
  assert.ok(assessed.reasons.includes('contract_source_not_supplied'));
});

test('a_real_quote_outside_the_supplied_passages_is_not_validated_as_seen_context', () => {
  const document = { id: 'bound', extracted_text: `57.02 ${baseFinding.contract_quote}\n57.03 מילוי התעלה נמדד לפי אורך הצינור.` };
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([document]), 'מילוי התעלה נמדד', 35, 1);
  const prepared = chunks.prepareContractComparisonContext(selected, [], 'מילוי התעלה נמדד');
  const finding = { ...baseFinding, supplied_contract_document_ids: ['bound'], context_selection: prepared.selection };
  const grounded = quality.groundContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [document] });
  const assessed = quality.assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [document] });
  assert.equal(assessed.contractQuoteMatched, true, 'The saved document really contains the quote');
  assert.ok(assessed.reasons.includes('contract_quote_not_in_supplied_context'));
  assert.equal(assessed.accepted, false);
});

test('truncated_context_stays_unverified_even_when_both_quotes_match', () => {
  const finding = { ...baseFinding, context_selection: { complete: false, limitations: ['clause_truncated:57.02'] } };
  const assessed = quality.assessContractScanFinding({ finding, currentWorkDocument: work,
    contractDocuments: [{ id: 'bound', extracted_text: baseFinding.contract_quote }] });
  assert.equal(assessed.accepted, true);
  assert.equal(assessed.evidenceStatus, 'REQUIRES_VERIFICATION');
  assert.ok(assessed.verificationReasons.includes('comparison_context_incomplete'));
});

test('ambiguous_unbound_quote_requires_a_source_instead_of_picking_the_first_document', () => {
  const finding = { ...baseFinding, contract_document_id: null };
  const contracts = ['one', 'two'].map(id => ({ id, extracted_text: baseFinding.contract_quote }));
  const grounded = quality.groundContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: contracts });
  assert.equal(grounded.contract_document_id, null);
  assert.ok(quality.assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: contracts })
    .reasons.includes('ambiguous_contract_source'));
});

test('alternative_source_is_only_a_repair_suggestion', () => {
  const contracts = [{ id: 'bound', extracted_text: 'הידרנטים מתוצרת רפאל.' }, { id: 'other', extracted_text: baseFinding.contract_quote }];
  const grounded = quality.groundContractScanFinding({ finding: baseFinding, currentWorkDocument: work, contractDocuments: contracts });
  assert.equal(grounded.contract_document_id, 'bound');
  assert.equal(grounded.contract_quote, baseFinding.contract_quote);
  assert.equal(grounded.source_repair_suggestions[0].documentId, 'other');
  assert.equal(grounded.source_repair_suggestions[0].quote, baseFinding.contract_quote);
});

test('anchors_use_original_offsets_and_a_page_only_with_confirmed_coverage', () => {
  const extracted_text = '\u200fכותרת\n  ח\tו\tל   מצומנט 8%.\n-- 1 of 2 --\nתוכן שני.\n-- 2 of 2 --';
  const document = { id: 'raw', title: 'מקור.pdf', extracted_text, ocr_status: 'COMPLETED',
    parsed_json: { source_reading: { version: 'page-coverage-v1', complete: true,
      totalPages: 2, readPages: [1, 2], unreadablePages: [] } } };
  const anchor = anchors.findEvidenceAnchor(document, 'חול מצומנט 8%.');
  assert.equal(anchor.page, 1);
  assert.equal(extracted_text.slice(anchor.start, anchor.end), anchor.quote);
  assert.equal(anchor.quote, 'ח\tו\tל   מצומנט 8%.');
  assert.equal(anchors.findEvidenceAnchor({ ...document, parsed_json: {} }, 'חול מצומנט 8%.').page, null);
  const malformed = structuredClone(document);
  malformed.parsed_json.source_reading.readPages = [1, 9];
  assert.equal(anchors.findEvidenceAnchor(malformed, 'חול מצומנט 8%.').page, null);
  assert.equal(document.extracted_text, extracted_text);
});

test('context_retrieval_accepts_raw_pdf_letter_spacing_without_rewriting_the_source', () => {
  const extracted_text = '57.02 ח\tו\tל מ\tצ\tו\tמ\tנ\tט 8% סביב הצינור.\n57.03 תנאי הספקה.';
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([{ id: 'raw', extracted_text }]), 'חול מצומנט סביב הצינור', 1000, 1);
  assert.ok(selected[0].context_selection.matched_terms.includes('מצומנט'));
  for (const anchor of selected[0].context_selection.source_anchors) {
    assert.equal(extracted_text.slice(anchor.start, anchor.end), anchor.quote);
  }
});

test('an_external_general_specification_reference_is_not_replaced_by_a_same_numbered_local_clause', () => {
  const text = '57.02 חול מצומנט יבוצע בהתאם לסעיף 9.2 שבמפרט הכללי.\n9.2 צביעת גדר.';
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks([{ id: 'project', extracted_text: text }]), 'חול מצומנט', 1500, 1);
  assert.ok(selected[0].context_selection.limitations.includes('external_reference_requires_authority:9.2'));
  assert.equal(selected[0].context_selection.complete, false);
  assert.equal(selected[0].text.includes('צביעת גדר'), false);
});

test('a_repeated_quote_uses_the_original_offsets_of_the_supplied_occurrence', () => {
  const extracted_text = `${baseFinding.contract_quote}\n-- 1 of 2 --\n${baseFinding.contract_quote}\n-- 2 of 2 --`;
  const document = { id: 'bound', extracted_text, ocr_status: 'COMPLETED', parsed_json: { source_reading: {
    version: 'page-coverage-v1', complete: true, totalPages: 2, readPages: [1, 2], unreadablePages: [],
  } } };
  const start = extracted_text.lastIndexOf(baseFinding.contract_quote);
  const finding = { ...baseFinding, context_selection: { version: 'source-context-v1', complete: true, limitations: [],
    sources: [{ documentId: 'bound', selection: { source_anchors: [anchors.anchorSourceRange(document, start, start + baseFinding.contract_quote.length)] } }] } };
  const result = quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [document] });
  assert.equal(result.accepted, true);
  assert.equal(result.contractSourceAnchor.start, start);
  assert.equal(result.contractSourceAnchor.page, 2);
});
