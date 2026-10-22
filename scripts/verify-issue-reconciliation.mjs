import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { loadInput, networkAttempts } from './radar-point-1-3-harness.mjs';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const policy = await import('../src/utils/scan-finding-retention-policy.ts');
hook.deregister();

function fixture(quotes, patch = {}) {
  return { seedId: 'a', findings: quotes.map((quote, index) => ({ id: String.fromCharCode(97 + index),
    project_id: 'project', status: 'OPEN', category: 'שינוי/חריג', scan_signature: `scan-${index}`,
    source_execution_doc_id: `source-${index}`, evidence_data: { work_quote: quote },
    created_at: `2025-01-0${index + 1}T00:00:00Z`, ...patch })),
  documents: quotes.map((quote, index) => ({ id: `source-${index}`, title: `פרוטוקול ${index + 1}.01.2025.docx`,
    extracted_text: `תאריך: 0${index + 1}.01.2025\n${quote}` })), financialLinks: [] };
}
const method = [
  'נדרש לשנות את שיטת הקידוח ברחוב יהלום מדחיקת צנרת פיברגלס לקידוח MTM.',
  'ברחוב יהלום נדרש מעבר לקידוח MTM במקום דחיקת צנרת פיברגלס.',
];
const plan = input => policy.planIssueReconciliation(input);

test('mtm_versions_one_issue: paraphrases share one question and retain both exact sources', () => {
  const input = fixture(method), result = plan(input);
  assert.ok(result.canonicalId);
  assert.equal(result.markDuplicates.length, 1);
  assert.equal(result.attachHistory.length, 2);
  for (const entry of result.attachHistory) {
    const document = input.documents.find(document => document.id === entry.sourceDocumentId);
    assert.equal(document.extracted_text.slice(entry.anchor.start, entry.anchor.end), entry.anchor.quote);
  }
});

test('general rule: equivalent cement requirements on the same sewer surround are repeats', () => {
  const result = plan(fixture([
    'הקבלן נדרש לבצע עטיפת הצינור ברחוב ספיר בחול מצומנט בשיעור 8%.',
    'ברחוב ספיר הקבלן נדרש לבצע עטיפת הצינור בחול מצומנט בשיעור 8%.',
  ]));
  assert.equal(result.markDuplicates.length, 1);
  assert.equal(result.attachHistory.length, 2);
});

test('same_word_different_location_not_merged', () => {
  const result = plan(fixture([method[0], method[1].replace('יהלום', 'ספיר')]));
  assert.equal(result.linkRelatedRecordIds.length, 0);
  assert.equal(result.markDuplicates.length, 0);
});

test('general road works: road 2 repeats while road 3 remains a separate question', () => {
  const a = 'הקבלן נדרש לבצע עטיפת הצינור בכביש 2 בחול מצומנט בשיעור 8%.';
  const b = 'בכביש 2 הקבלן נדרש לבצע עטיפת הצינור בחול מצומנט בשיעור 8%.';
  assert.equal(plan(fixture([a, b])).markDuplicates.length, 1);
  assert.equal(plan(fixture([a, b.replace('בכביש 2', 'בכביש 3')])).linkRelatedRecordIds.length, 0);
});

test('a model title cannot supply a missing location for an otherwise matching quote', () => {
  const input = fixture([method[0], method[1].replace('ברחוב יהלום ', '')]);
  input.findings[1].title = 'קידוח ברחוב יהלום';
  assert.equal(plan(input).markDuplicates.length, 0);
  assert.equal(plan(input).linkRelatedRecordIds.length, 0);
});

test('a valid work passage survives an invalid contractual quotation as a source event', () => {
  const input = fixture([method[0], method[0]]);
  input.findings[1].target_contract_doc_id = 'base';
  input.findings[1].evidence_data.contract_quote = 'invented norm';
  input.documents.push({ id: 'base', title: 'חוזה.docx', extracted_text: 'נורמה אחרת.' });
  const result = plan(input);
  assert.equal(result.attachHistory.length, 2);
  assert.equal(result.flagInvalidEvidence[0].reason, 'BASELINE_QUOTE_NOT_FOUND');
  assert.equal(result.flagInvalidEvidence[0].originalBaselineId, 'base');
  assert.equal(result.markDuplicates.length, 0);
});

test('general method change: HDD replacement also consolidates; reversed direction stays separate', () => {
  const original = method[0].replace('MTM', 'HDD').replace('יהלום', 'ספיר');
  const paraphrase = method[1].replace('MTM', 'HDD').replace('יהלום', 'ספיר');
  assert.equal(plan(fixture([original, paraphrase])).markDuplicates.length, 1);
  const reversed = 'ברחוב ספיר נדרש מעבר לדחיקת צנרת פיברגלס במקום קידוח HDD.';
  assert.equal(plan(fixture([original, reversed])).markDuplicates.length, 0);
});

test('numbers bound to different conditions and extra qualifications remain separate', () => {
  const first = 'הקבלן נדרש לבצע עטיפת הצינור ברחוב ספיר בחול מצומנט 8%. המילוי העליון יהיה בחול מצומנט 4%.';
  const second = 'הקבלן נדרש לבצע עטיפת הצינור ברחוב ספיר בחול מצומנט 4%. המילוי העליון יהיה בחול מצומנט 8%.';
  assert.equal(plan(fixture([first, second])).markDuplicates.length, 0);
});

test('different work objects and obligated participants are not merged', () => {
  for (const [a, b] of [
    ['הקבלן נדרש לבצע קידוח קו מים ברחוב ספיר בשיטת HDD.', 'הקבלן נדרש לבצע קידוח קו ביוב ברחוב ספיר בשיטת HDD.'],
    ['הקבלן נדרש להגיש לוח זמנים ברחוב ספיר בתוך 14 ימים.', 'המתכנן נדרש להגיש לוח זמנים ברחוב ספיר בתוך 14 ימים.'],
    ['הקבלן נדרש למלא מעל עטיפת הצינור ברחוב ספיר בחול מצומנט 8%.', 'הקבלן נדרש לבצע עטיפת הצינור ברחוב ספיר בחול מצומנט 8%.'],
  ]) {
    const result = plan(fixture([a, b]));
    assert.equal(result.markDuplicates.length, 0);
    assert.equal(result.linkRelatedRecordIds.length, 0);
  }
});

test('same_quote_different_basis_is_preserved', () => {
  const input = fixture([method[0], method[0]]);
  for (const [index, row] of input.findings.entries()) {
    row.target_contract_doc_id = `contract-${index}`;
    row.evidence_data.contract_quote = `הוראות קידוח ברחוב יהלום: סעיף ${index + 1} מחייב אישור מראש.`;
    input.documents.push({ id: row.target_contract_doc_id, title: 'חוזה.docx', extracted_text: row.evidence_data.contract_quote });
  }
  const result = plan(input);
  assert.equal(result.markDuplicates.length, 0, 'A new basis is not an identical repeat');
  assert.equal(result.attachHistory.length, 2);
  assert.equal(result.attachHistory.filter(entry => entry.baselineAnchor).length, 2);
  assert.ok(result.attachHistory.some(entry => entry.relation === 'ADDITIONAL_BASIS'));
});

test('an unavailable reference page stays a concrete gap rather than a fabricated quote error', () => {
  const input = fixture([method[0], method[0]]);
  input.findings[1].evidence_data.contract_reference_authority = { reference_chunk_id: 'missing-reference-page' };
  input.findings[1].evidence_data.contract_quote = 'A source page not included in the available evidence.';
  const result = plan(input);
  assert.equal(result.flagInvalidEvidence.length, 0);
  assert.ok(result.missingEvidence.some(item => item.reason === 'BASELINE_SOURCE_NOT_AVAILABLE'));
  assert.equal(result.markDuplicates.length, 0);
});

test('new_conflicting_condition_is_not_hidden', () => {
  const result = plan(fixture([
    'הקבלן נדרש לבצע עטיפת הצינור ברחוב ספיר בחול מצומנט בשיעור 8%.',
    'הקבלן נדרש לבצע עטיפת הצינור ברחוב ספיר בחול מצומנט בשיעור 4%.',
  ]));
  assert.equal(result.markDuplicates.length, 0);
  assert.equal(result.attachHistory.length, 2);
  assert.ok(result.attachHistory.some(entry => entry.relation === 'CHANGED_CONDITION'));
});

test('new condition, negation, permission, price or period is never swallowed as a repeat', () => {
  const base = 'הקבלן נדרש לבצע קידוח ברחוב ספיר בשיטת HDD.';
  for (const changed of [
    `${base} בכפוף לחתימת הסכם.`, `${base} בתנאי שהמחיר אינו עולה על 100 ש"ח.`,
    'נאסר על הקבלן לבצע קידוח ברחוב ספיר בשיטת HDD.',
    `${base} מועד ההשלמה הוא 04.05.2025.`, `${base} המחיר המוסכם הוא 200 ש"ח.`,
    `${base} נדרש אישור נוסף.`,
  ]) {
    const result = plan(fixture([base, changed]));
    assert.equal(result.markDuplicates.length, 0, changed);
    assert.equal(result.attachHistory.length, 2, changed);
  }
});

test('missing location or unreadable source cannot establish paraphrased identity', () => {
  const input = fixture(method.map(quote => quote.replace('ברחוב יהלום ', '')));
  assert.equal(plan(input).markDuplicates.length, 0);
  const unreadable = fixture(method);
  unreadable.documents[1].storage_path = 'source.pdf';
  unreadable.documents[1].ocr_status = 'COMPLETED';
  assert.equal(plan(unreadable).markDuplicates.length, 0);
  assert.ok(plan(unreadable).missingEvidence.some(entry => entry.reason === 'SOURCE_NOT_READY'));
});

test('a stale retained history cannot introduce an unchecked contractual anchor', () => {
  const input = fixture(method), first = plan(input);
  const primary = input.findings.find(row => row.id === first.canonicalId);
  primary.evidence_data.issue_reconciliation = structuredClone(first);
  primary.evidence_data.issue_reconciliation.attachHistory[1].baselineAnchor = {
    documentId: 'nonexistent-contract', start: 0, end: 8, quote: 'invented', page: null,
  };
  assert.ok(plan(input).attachHistory.every(entry => entry.baselineAnchor === null));
});

test('a prior semantic exclusion cannot become the primary question just because its quote matches', () => {
  const input = fixture(method);
  input.findings[0].evidence_data.review_disposition = { type: 'INVALID_AUTOMATIC_FINDING', reasons: ['DIFFERENT_SUBJECT'] };
  assert.equal(plan(input).canonicalId, 'b');
});

test('priced_wrong_source_is_flagged_not_deleted; a good open record supplies the primary evidence', () => {
  const input = fixture(method);
  input.findings[1] = { ...input.findings[1], status: 'ARCHIVED', pricing_status: 'PRICED',
    evidence_data: { ...input.findings[1].evidence_data, manual_review: { keep: true } } };
  input.documents[1].extracted_text = 'תאריך: 02.01.2025\nהנחיות להגנת עמוד החשמל.';
  input.financialLinks = [{ findingId: 'b', ledgerId: 'ledger', letterIds: ['letter'] }];
  const before = structuredClone(input), result = plan(input);
  assert.equal(result.canonicalId, 'a');
  assert.deepEqual(result.flagInvalidEvidence.map(item => item.findingId), ['b']);
  assert.deepEqual(result.linkRelatedRecordIds, ['b']);
  assert.deepEqual(result.financialLinks, input.financialLinks);
  assert.deepEqual(input, before);
  assert.equal(result.deleteIds, undefined);
});

test('a linked question and its related records cannot be discarded by automatic replacement', () => {
  for (const evidence_data of [
    { issue_reconciliation: { canonicalId: 'linked' } }, { issue_link: { canonicalId: 'primary' } },
  ]) {
    const row = { id: 'linked', scan_signature: 'scan', evidence_data };
    assert.equal(policy.findingNeedsHistory(row), true);
    assert.equal(policy.canRemoveUnsupportedAutomaticFinding(row), false);
  }
});

test('known question already in pricing is reused when evidence remains good', () => {
  const input = fixture(method);
  input.findings[0].status = 'MOVED_TO_PRICING';
  input.findings[0].pricing_status = 'PRICED';
  input.financialLinks = [{ findingId: 'a', ledgerId: 'ledger', letterIds: [] }];
  assert.equal(plan(input).canonicalId, 'a', 'An open copy must not erase the existing priced question');
  assert.equal(plan(input).markDuplicates.length, 1);
});

test('an archive status or a calculation does not establish closure or hide an open unresolved question', () => {
  const input = fixture(method);
  input.findings[0].status = 'ARCHIVED';
  input.findings[0].pricing_status = 'PRICED';
  input.findings[0].evidence_data.archive_meta = { archive_reason: 'A complete replacement scan finished successfully for this work document.' };
  input.financialLinks = [{ findingId: 'a', ledgerId: 'ledger', letterIds: ['letter'] }];
  const result = plan(input);
  assert.equal(result.canonicalId, 'b');
  assert.deepEqual(result.financialLinks, input.financialLinks);
  assert.equal(result.markDuplicates.includes('b'), false);
});

test('reconciliation_is_idempotent and retains owner notes and prior source events', () => {
  const input = fixture(method);
  const first = plan(input);
  const primary = input.findings.find(row => row.id === first.canonicalId);
  primary.evidence_data.issue_reconciliation = first;
  primary.evidence_data.issue_owner_notes = [{ id: 'note', origin: 'OWNER_NOTE', text: 'keep' }];
  for (const id of first.markDuplicates) input.findings.find(row => row.id === id).evidence_data.review_disposition = {
    type: 'DUPLICATE', canonical_id: first.canonicalId,
  };
  const second = plan(input);
  assert.deepEqual(second, first);
  assert.equal(primary.evidence_data.issue_owner_notes[0].text, 'keep');
});

test('SAVED MTM: old priced electricity-pole quote is linked but never repaired by inventing a new quote', () => {
  const saved = loadInput(), input = { seedId: '2f7e6a92-f88c-4641-8a3d-12855208ea47',
    findings: saved.findings, documents: saved.documents,
    financialLinks: [{ findingId: '86cef2b9-12bf-4223-b6c4-7f29e2e5198b', ledgerId: 'saved-ledger', letterIds: ['saved-letter'] }] };
  const before = structuredClone(input.findings), result = plan(input);
  assert.equal(result.canonicalId, input.seedId);
  assert.ok(result.flagInvalidEvidence.some(item => item.findingId === input.financialLinks[0].findingId && item.reason === 'WORK_QUOTE_NOT_FOUND'));
  assert.ok(result.linkRelatedRecordIds.includes(input.financialLinks[0].findingId));
  assert.deepEqual(input.findings, before);
  assert.deepEqual(networkAttempts, []);
});

test('SAVED December sources: replaying the retained two original source entries produces one question', () => {
  const saved = loadInput();
  const current = saved.findings.find(row => row.id === '2f7e6a92-f88c-4641-8a3d-12855208ea47');
  const entries = current.evidence_data.repeated_history;
  assert.equal(entries.length, 2);
  const findings = entries.map(entry => ({ id: entry.finding_id, scan_signature: 'saved-source-replay', status: 'OPEN',
    source_execution_doc_id: entry.source_document_id, evidence_data: { work_quote: entry.work_quote } }));
  const result = plan({ seedId: findings[0].id, findings, documents: saved.documents });
  assert.equal(result.markDuplicates.length, 1);
  assert.equal(result.attachHistory.length, 2);
});
