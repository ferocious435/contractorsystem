import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const projectHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('@/')
      ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
  },
});

const retention = await import('../src/utils/scan-finding-retention-policy.ts');
const cleanup = await import('../src/utils/scan-finding-retention.ts');
const quality = await import('../src/utils/contract-scan-quality.ts');
projectHook.deregister();

function memoryDatabase(tables) {
  const state = structuredClone(tables);
  return { state, from(table) {
    const predicates = [];
    let mode = 'select';
    let patch;
    const query = {
      select() { return query; },
      eq(key, value) { predicates.push((row) => row[key] === value); return query; },
      neq(key, value) { predicates.push((row) => row[key] !== value); return query; },
      not(key, operator, value) { assert.equal(operator, 'is'); predicates.push((row) => row[key] != value); return query; },
      in(key, values) { predicates.push((row) => values.includes(row[key])); return query; },
      or(filter) { const project = filter.match(/project_id\.eq\.([^,]+)/)?.[1]; predicates.push((row) => row.project_id == null || row.project_id === project); return query; },
      order() { return query; },
      range() { return query; },
      delete() { mode = 'delete'; return query; },
      update(value) { mode = 'update'; patch = value; return query; },
      then(resolve, reject) {
        try {
          assert.ok(Object.hasOwn(state, table), `unexpected table ${table}`);
          const matches = state[table].filter((row) => predicates.every((predicate) => predicate(row)));
          if (mode === 'delete') state[table] = state[table].filter((row) => !matches.includes(row));
          if (mode === 'update') matches.forEach((row) => Object.assign(row, structuredClone(patch)));
          return Promise.resolve({ data: structuredClone(matches), count: matches.length, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  } };
}

const openWork = { id: 'work', project_id: 'project', title: 'פרוטוקול 01.01.2025', category: 'EXECUTION', extracted_text: 'תכנית הניקוז שנמסרה אינה תואמת את הוראות המתכנן.' };
const openCard = {
  id: 'issue', project_id: 'project', title: 'תכנית ניקוז אינה תואמת להוראות המתכנן', description: openWork.extracted_text,
  category: 'אירוע שטח', strategy_advice: 'לבדוק את אי ההתאמה.', source_execution_doc_id: openWork.id,
  target_contract_doc_id: null, status: 'OPEN', scan_signature: 'scan', evidence_data: { work_quote: openWork.extracted_text },
};

test('cleanup archives a real resolved question with its resolution source instead of deleting it', async () => {
  const reply = { id: 'reply', project_id: 'project', title: 'פרוטוקול 02.01.2025', category: 'EXECUTION', extracted_text: 'תכנית הניקוז תוקנה בהתאם להוראות המתכנן והנושא נסגר.' };
  const db = memoryDatabase({ contradictions: [openCard], documents: [openWork, reply], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  assert.equal(db.state.contradictions.length, 1);
  assert.equal(db.state.contradictions[0].status, 'ARCHIVED');
  assert.equal(db.state.contradictions[0].evidence_data.archive_meta.resolution_document_id, reply.id);
  assert.equal(db.state.contradictions[0].evidence_data.archive_meta.resolution_quote, reply.extracted_text);
});

test('replacement preserves the primary linked question instead of creating a technical archive closure', async () => {
  const linked = { ...openCard, evidence_data: { ...openCard.evidence_data, issue_reconciliation: { canonicalId: openCard.id } } };
  const db = memoryDatabase({ contradictions: [linked], document_scan_state: [] });
  const result = await cleanup.replacePreviousScanFindings({ supabase: db, rows: [linked], currentScanSignature: 'new-scan' });
  assert.equal(result.archived, 0);
  assert.deepEqual(db.state.contradictions, [linked]);
});

test('protecting linked history does not prevent a later documented resolution from closing the question', async () => {
  const linked = { ...openCard, evidence_data: { ...openCard.evidence_data, issue_reconciliation: { canonicalId: openCard.id } } };
  const reply = { id: 'reply', project_id: 'project', title: 'פרוטוקול 02.01.2025', category: 'EXECUTION', extracted_text: 'תכנית הניקוז תוקנה בהתאם להוראות המתכנן והנושא נסגר.' };
  const db = memoryDatabase({ contradictions: [linked], documents: [openWork, reply], document_scan_state: [] });
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.equal(db.state.contradictions[0].status, 'ARCHIVED');
  assert.equal(db.state.contradictions[0].evidence_data.archive_meta.resolution_document_id, reply.id);
  assert.deepEqual(db.state.contradictions[0].evidence_data.issue_reconciliation, linked.evidence_data.issue_reconciliation);
});

test('a broken source on a linked primary question is flagged without deleting its collected history', async () => {
  const linked = { ...openCard, evidence_data: { work_quote: 'A no-longer-available quote', issue_reconciliation: { canonicalId: openCard.id } } };
  const db = memoryDatabase({ contradictions: [linked], documents: [openWork], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  assert.equal(db.state.contradictions.length, 1);
  assert.equal(db.state.contradictions[0].evidence_data.evidence_status, 'REQUIRES_VERIFICATION');
  assert.deepEqual(db.state.contradictions[0].evidence_data.issue_reconciliation, linked.evidence_data.issue_reconciliation);
});

test('revalidation keeps an unresolved question and flags its existing unrelated source without silently replacing it', async () => {
  const contract = { id: 'base', project_id: 'project', title: 'חוזה', category: 'CONTRACT', extracted_text: 'הקבלן יגיש תכניות DWG למסירת העבודה.' };
  const card = { ...openCard, target_contract_doc_id: contract.id, evidence_data: { ...openCard.evidence_data,
    contract_quote: contract.extracted_text, contract_title: contract.title, evidence_status: 'VERIFIED',
    document_pair: { contract_doc_id: contract.id, contract_title: contract.title, work_doc_id: openWork.id },
    source_verification: { contract_quote_matched: true, work_quote_matched: true, quality_gate_passed: true },
    support_analysis: { status: 'COMPLETE', impact_summary: 'old analysis using the unrelated contract' },
  } };
  const reply = { id: 'reply', project_id: 'project', title: 'פרוטוקול 02.01.2025', category: 'EXECUTION', extracted_text: 'תכנית הניקוז טרם תוקנה לפי הוראות המתכנן, המפקח ישיב עד סוף החודש.' };
  const db = memoryDatabase({ contradictions: [card], documents: [openWork, contract, reply], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  assert.equal(db.state.contradictions[0].status, 'OPEN');
  assert.equal(db.state.contradictions[0].target_contract_doc_id, contract.id);
  assert.equal(db.state.contradictions[0].evidence_data.contract_quote, contract.extracted_text);
  assert.equal(db.state.contradictions[0].evidence_data.contract_title, contract.title);
  assert.equal(db.state.contradictions[0].evidence_data.document_pair.contract_doc_id, contract.id);
  assert.equal(db.state.contradictions[0].evidence_data.source_verification.contract_quote_matched, true);
  assert.ok(db.state.contradictions[0].evidence_data.source_verification.verification_reasons.includes('unrelated_optional_contract_source'));
  assert.equal(db.state.contradictions[0].evidence_data.evidence_status, 'REQUIRES_VERIFICATION');
  assert.equal(Boolean(db.state.contradictions[0].evidence_data.support_analysis), false);
  assert.deepEqual(db.state.documents, [openWork, contract, reply]);
  const afterFirstPass = structuredClone(db.state);
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.deepEqual(db.state, afterFirstPass, 'Revalidation must remain idempotent');
});

test('revalidation retains context limits and original source anchors without modifying documents', async () => {
  const quote = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 4%.';
  const clause = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.';
  const work = { ...openWork, title: 'הוראה.docx', extracted_text: `\u200fהוראת המפקח:\n${quote}` };
  const base = { id: 'base', project_id: 'project', title: 'מפרט.docx', category: 'CONTRACT', extracted_text: `57.02 ${clause}\n57.03 תנאי אספקה.` };
  const context = { version: 'source-context-v1', complete: false, limitations: ['clause_truncated:57.03'],
    sources: [{ documentId: base.id, selection: { reason: 'matched_subject_with_local_context', matched_terms: ['הצינור'],
      complete: false, limitations: ['clause_truncated:57.03'], source_anchors: [{ documentId: base.id, quote: clause,
        start: 6, end: 6 + clause.length, page: null }] } }] };
  const card = { ...openCard, title: 'עטיפת הצינור בחול מצומנט', description: quote, category: 'סתירה', target_contract_doc_id: base.id,
    evidence_data: { work_quote: quote, contract_quote: clause, context_selection: context, supplied_contract_document_ids: [base.id] } };
  const db = memoryDatabase({ contradictions: [card], documents: [work, base], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  const evidence = db.state.contradictions[0].evidence_data;
  assert.equal(evidence.evidence_status, 'REQUIRES_VERIFICATION');
  assert.deepEqual(evidence.context_selection, context);
  assert.ok(evidence.source_verification.verification_reasons.includes('comparison_context_incomplete'));
  for (const [source, anchor] of [[work, evidence.work_source_anchor], [base, evidence.contract_source_anchor]]) {
    assert.equal(source.extracted_text.slice(anchor.start, anchor.end), anchor.quote);
    assert.equal(anchor.page, null);
  }
  assert.deepEqual(db.state.documents, [work, base]);
});

test('revalidation in memory persists semantic proof and a source-based title even after a wrong initial category', async () => {
  const quote = 'המפקח דורש עטיפת הצינור בחול מצומנט בשיעור 4%.';
  const clause = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.';
  const work = { ...openWork, title: 'הוראה.docx', extracted_text: quote };
  const base = { id: 'base', project_id: 'project', title: 'מפרט.docx', category: 'CONTRACT', extracted_text: clause };
  const card = { ...openCard, title: 'הוסכם על 4%', description: 'untrusted automatic description', category: 'פעולה לביצוע',
    target_contract_doc_id: base.id, evidence_data: { work_quote: quote, contract_quote: clause } };
  const db = memoryDatabase({ contradictions: [card], documents: [work, base], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  const saved = db.state.contradictions[0];
  assert.equal(saved.category, 'סתירה');
  assert.equal(saved.evidence_data.evidence_status, 'VERIFIED');
  assert.equal(saved.evidence_data.semantic_assessment.relation, 'INCOMPATIBLE');
  assert.equal(saved.evidence_data.source_verification.semantic_relation, 'INCOMPATIBLE');
  assert.equal(saved.evidence_data.semantic_assessment.work.constraint.min, 4);
  assert.equal(saved.evidence_data.semantic_assessment.baseline.constraint.min, 8);
  assert.equal(saved.title.includes('הוסכם'), false);
  assert.ok(saved.description.includes(quote));
  assert.ok(saved.description.includes(clause));
  for (const anchor of saved.evidence_data.semantic_assessment.sourceAnchors) {
    const source = anchor.documentId === work.id ? work : base;
    assert.equal(source.extracted_text.slice(anchor.start, anchor.end), anchor.quote);
  }
  assert.deepEqual(db.state.documents, [work, base]);
  const afterFirstPass = structuredClone(db.state);
  const recheck = quality.groundContractScanFinding({ finding: { ...saved, advice: saved.strategy_advice,
    work_quote: saved.evidence_data.work_quote, contract_quote: saved.evidence_data.contract_quote,
    work_document_id: work.id, contract_document_id: base.id }, currentWorkDocument: work, contractDocuments: [base] });
  const assessment = quality.assessContractScanFinding({ finding: recheck, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, true, JSON.stringify(assessment.reasons));
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.deepEqual(db.state, afterFirstPass);
});

test('an explicit saved-evidence review excludes an invalid comparison without deleting or archiving its sources and records', async () => {
  const work = { ...openWork, title: 'הוראה.docx', extracted_text: 'הקבלן יגיש לוח זמנים מעודכן בכל חודש.' };
  const base = { id: 'base', project_id: 'project', title: 'חוזה.docx', category: 'CONTRACT',
    extracted_text: 'הקבלן יגיש לוח זמנים מפורט בתוך 14 ימים מצו התחלת העבודה.' };
  const card = { ...openCard, category: 'סתירה', title: 'הגשת לוח זמנים', target_contract_doc_id: base.id,
    evidence_data: { work_quote: work.extracted_text, contract_quote: base.extracted_text } };
  const priced = { ...card, id: 'priced', pricing_status: 'PRICED' };
  const db = memoryDatabase({ contradictions: [card, priced], documents: [work, base],
    document_scan_state: [{ project_id: 'project', scan_signature: 'scan', findings_count: 2 }] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project', { reviewOnly: true }), 1);
  assert.equal(db.state.contradictions.length, 2);
  assert.equal(db.state.contradictions[0].status, 'OPEN');
  assert.equal(db.state.contradictions[0].evidence_data.review_disposition.type, 'INVALID_AUTOMATIC_FINDING');
  assert.equal(db.state.contradictions[0].evidence_data.semantic_assessment.relation, 'COMPATIBLE');
  assert.deepEqual(db.state.contradictions[1], priced);
  assert.equal(db.state.document_scan_state[0].findings_count, 1);
  assert.deepEqual(db.state.documents, [work, base]);
  const firstPass = structuredClone(db.state);
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project', { reviewOnly: true });
  assert.deepEqual(db.state, firstPass);
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.equal(db.state.contradictions.length, 2, 'Ordinary cleanup must retain the technical review record');
});

test('a saved warning receives the actual agreement search result rather than an unassigned generic check', async () => {
  const quote = 'במסגרת הסכם המקדמה התחייבתם להשלים את ביצוע הפרויקט לא יאוחר מיום 01.06.2025. נכון ליום 24.06.2025 העבודות לא הושלמו.';
  const work = { ...openWork, title: 'התראה.docx', extracted_text: quote };
  const base = { id: 'base', project_id: 'project', title: 'חוזה.docx', category: 'CONTRACT', extracted_text: 'תקופת הביצוע תהיה 19 חודשים.' };
  const card = { ...openCard, title: 'מועד השלמת העבודות', description: quote, category: 'סתירה', target_contract_doc_id: base.id,
    evidence_data: { work_quote: quote, contract_quote: base.extracted_text } };
  const db = memoryDatabase({ contradictions: [card], documents: [work, base], document_scan_state: [] });
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project', { reviewOnly: true });
  const saved = db.state.contradictions[0];
  assert.ok(saved.evidence_data.completion_deadline_review, JSON.stringify(saved.evidence_data.review_disposition));
  assert.equal(saved.evidence_data.completion_deadline_review.status, 'BASIS_NOT_FOUND_IN_READABLE_SOURCES');
  assert.deepEqual(saved.evidence_data.completion_deadline_review.referenceDates, ['2025-06-01']);
  assert.ok(saved.description.includes('הסכם המקדמה עצמו לא אותר'));
  assert.equal(saved.evidence_data.evidence_status, 'REQUIRES_VERIFICATION');
  const afterFirstPass = structuredClone(db.state);
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project', { reviewOnly: true });
  assert.deepEqual(db.state, afterFirstPass, 'A reclassified unresolved warning must survive repeat review unchanged');
});

test('a repaired review restores a real unresolved warning and its cached count without scanning', async () => {
  const work = { ...openWork, title: 'התראה.docx', extracted_text: 'במסגרת הסכם המקדמה התחייבתם להשלים את ביצוע הפרויקט לא יאוחר מיום 01.06.2025. נכון ליום 24.06.2025 העבודות לא הושלמו.' };
  const base = { id: 'base', project_id: 'project', title: 'חוזה.docx', category: 'CONTRACT', extracted_text: 'תקופת הביצוע תהיה 19 חודשים.' };
  const card = { ...openCard, category: 'חוסר נתונים', target_contract_doc_id: base.id,
    title: 'לוח הזמנים — בסיס מועד השלמת העבודות — נדרש ביסוס להשוואה',
    evidence_data: { work_quote: work.extracted_text, contract_quote: base.extracted_text,
      review_disposition: { type: 'INVALID_AUTOMATIC_FINDING', reasons: ['completion_deadline_basis_not_established'] } } };
  const db = memoryDatabase({ contradictions: [card], documents: [work, base],
    document_scan_state: [{ project_id: 'project', scan_signature: 'scan', findings_count: 0 }] });
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project', { reviewOnly: true });
  assert.equal(db.state.contradictions[0].evidence_data.review_disposition, undefined);
  assert.equal(db.state.contradictions[0].category, 'חוסר נתונים');
  assert.equal(db.state.document_scan_state[0].findings_count, 1);
  const first = structuredClone(db.state);
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project', { reviewOnly: true });
  assert.deepEqual(db.state, first);
});

test('cleanup removes a proven invalid reviewed card, preserves financial work and refreshes cached counts', async () => {
  const invalid = { ...openCard, evidence_data: { work_quote: 'Invented quote.', manual_review: { verdict: 'CONFIRMED' } } };
  const priced = { ...invalid, id: 'priced-issue', pricing_status: 'PRICED' };
  const db = memoryDatabase({ contradictions: [invalid, priced], documents: [openWork],
    document_scan_state: [{ project_id: 'project', scan_signature: 'scan', findings_count: 2 }] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 1);
  assert.deepEqual(db.state.contradictions.map((row) => row.id), ['priced-issue']);
  assert.equal(db.state.document_scan_state[0].findings_count, 1);
});

test('archive cleanup deletes a proven invalid reviewed card while retaining genuine closed evidence', async () => {
  const closed = { ...openCard, status: 'ARCHIVED', evidence_data: { ...openCard.evidence_data,
    archive_meta: { archive_reason: 'Resolved by later documented project evidence.', resolution_document_id: 'reply' } } };
  const invalid = { ...closed, id: 'invalid', evidence_data: { work_quote: 'Invented quote.', manual_review: { verdict: 'CONFIRMED' } } };
  const db = memoryDatabase({ contradictions: [closed, invalid], documents: [openWork], document_scan_state: [] });
  assert.equal(await cleanup.deleteObsoleteAutomaticArchiveRows(db, 'project'), 1);
  assert.deepEqual(db.state.contradictions.map((row) => row.id), ['issue']);
  assert.equal(db.state.contradictions[0].evidence_data.archive_meta.resolution_document_id, 'reply');
});

test('a real historical closed approval is preserved even though new standalone requests do not belong in the radar', async () => {
  const work = { ...openWork, extracted_text: 'הקבלן ביקש אישור לתכנית הניקוז.' };
  const card = { ...openCard, title: 'אישור תכנית הניקוז', description: work.extracted_text, category: 'פעולה לביצוע', status: 'ARCHIVED',
    evidence_data: { work_quote: work.extracted_text, archive_meta: { archive_reason: 'Closed by project participants.' } } };
  const db = memoryDatabase({ contradictions: [card], documents: [work], document_scan_state: [] });
  assert.equal(await cleanup.deleteObsoleteAutomaticArchiveRows(db, 'project'), 0);
  assert.equal(db.state.contradictions.length, 1);
});

test('revalidation stores a proven response breach as a comparison with its dates and sources', async () => {
  const quote = 'הבקשה התקבלה אצל המזמין ביום 01.01.2025. נכון ליום 25.01.2025 לא נמסרה תשובה לבקשה.';
  const clause = 'המזמין ימסור תשובה לבקשה בתוך 14 ימים קלנדריים מיום קבלת הבקשה.';
  const work = { ...openWork, extracted_text: quote };
  const base = { id: 'base', project_id: 'project', title: 'חוזה', category: 'CONTRACT', extracted_text: clause };
  const card = { ...openCard, title: 'אי מתן תשובה במועד', description: quote, category: 'פעולה לביצוע', target_contract_doc_id: base.id,
    evidence_data: { work_quote: quote, contract_quote: clause } };
  const db = memoryDatabase({ contradictions: [card], documents: [work, base], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  const saved = db.state.contradictions[0];
  assert.equal(saved.category, 'סתירה');
  assert.equal(saved.evidence_data.comparison_type, 'contractual_response_deadline');
  assert.equal(saved.evidence_data.contractual_reply_deadline.dueDate, '2025-01-15');
  assert.equal(saved.evidence_data.contractual_reply_deadline.statusDate, '2025-01-25');
});

test('obsolete automatic scan finding does not need archive history', () => {
  assert.equal(retention.findingNeedsHistory({
    id: 'old-auto',
    scan_signature: 'old-scan',
    status: 'OPEN',
    evidence_data: { analysis_model: 'qwen3:4b' },
  }), false);
});

test('manual review and pricing work are preserved', () => {
  assert.equal(retention.findingNeedsHistory({
    id: 'reviewed',
    scan_signature: 'old-scan',
    evidence_data: { manual_review: { verdict: 'CONFIRMED' } },
  }), true);
  assert.equal(retention.findingNeedsHistory({
    id: 'priced',
    scan_signature: 'old-scan',
    pricing_status: 'PRICED',
  }), true);
});

test('a manual review does not protect a proven invalid automatic card from removal', () => {
  assert.equal(retention.canRemoveUnsupportedAutomaticFinding({
    id: 'wrong-reviewed-card', scan_signature: 'scan', evidence_data: { manual_review: { verdict: 'CONFIRMED' } },
  }), true);
  assert.equal(retention.canRemoveUnsupportedAutomaticFinding({ id: 'manual-conclusion-without-model-origin' }), false);
  assert.equal(retention.canRemoveUnsupportedAutomaticFinding({ id: 'priced', scan_signature: 'scan', pricing_status: 'PRICED' }), false);
  assert.equal(retention.canRemoveUnsupportedAutomaticFinding({ id: 'pricing-queue', scan_signature: 'scan', status: 'MOVED_TO_PRICING' }), false);
});

test('exact repeated protocol item becomes one latest finding with full document history', () => {
  const workQuote = 'הקבלן נדרש להשלים את אבני השפה ולתאם את המשך העבודה עם מנהל הפרויקט.';
  const plan = retention.planRepeatedFindingConsolidation({
    findings: [
      {
        id: 'finding-oldest',
        scan_signature: 'scan-1',
        source_execution_doc_id: 'protocol-1',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        evidence_data: { work_quote: workQuote },
        created_at: '2025-01-10T10:00:00.000Z',
      },
      {
        id: 'finding-latest',
        scan_signature: 'scan-3',
        source_execution_doc_id: 'protocol-3',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        evidence_data: { work_quote: workQuote },
        created_at: '2025-02-15T10:00:00.000Z',
      },
      {
        id: 'finding-middle',
        scan_signature: 'scan-2',
        source_execution_doc_id: 'protocol-2',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        evidence_data: { work_quote: `  ${workQuote}\u200f  ` },
        created_at: '2025-01-20T10:00:00.000Z',
      },
    ],
    documents: [
      { id: 'protocol-1', title: 'פרוטוקול ישיבה 16.12.24' },
      { id: 'protocol-2', title: 'פרוטוקול ישיבה 01.01.25' },
      { id: 'protocol-3', title: 'פרוטוקול ישיבה 12.02.25' },
    ],
  });

  assert.deepEqual(plan, [{
    keepId: 'finding-latest',
    deleteIds: ['finding-oldest', 'finding-middle'],
    repeatedHistory: [
      {
        finding_id: 'finding-oldest',
        source_document_id: 'protocol-1',
        source_document_title: 'פרוטוקול ישיבה 16.12.24',
        document_date: '2024-12-16',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        work_quote: workQuote,
      },
      {
        finding_id: 'finding-middle',
        source_document_id: 'protocol-2',
        source_document_title: 'פרוטוקול ישיבה 01.01.25',
        document_date: '2025-01-01',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        work_quote: workQuote,
      },
      {
        finding_id: 'finding-latest',
        source_document_id: 'protocol-3',
        source_document_title: 'פרוטוקול ישיבה 12.02.25',
        document_date: '2025-02-12',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        work_quote: workQuote,
      },
    ],
  }]);
});

test('similar wording and reviewed findings are not merged automatically', () => {
  const base = 'הקבלן נדרש להשלים את אבני השפה ולתאם את המשך העבודה עם מנהל הפרויקט.';
  const plan = retention.planRepeatedFindingConsolidation({
    findings: [
      {
        id: 'automatic-a',
        scan_signature: 'scan-a',
        source_execution_doc_id: 'protocol-a',
        evidence_data: { work_quote: base },
      },
      {
        id: 'automatic-similar',
        scan_signature: 'scan-b',
        source_execution_doc_id: 'protocol-b',
        evidence_data: { work_quote: `${base} נדרש אישור נוסף.` },
      },
      {
        id: 'reviewed-copy',
        scan_signature: 'scan-c',
        source_execution_doc_id: 'protocol-c',
        evidence_data: {
          work_quote: base,
          manual_review: { verdict: 'CONFIRMED' },
        },
      },
    ],
    documents: [
      { id: 'protocol-a', title: 'פרוטוקול 01.01.25' },
      { id: 'protocol-b', title: 'פרוטוקול 02.01.25' },
      { id: 'protocol-c', title: 'פרוטוקול 03.01.25' },
    ],
  });

  assert.deepEqual(plan, []);
});

test('repeat history is added without losing the kept finding evidence', () => {
  const history = [{
    finding_id: 'finding-1',
    source_document_id: 'protocol-1',
    source_document_title: 'פרוטוקול 01.01.25',
    document_date: '2025-01-01',
    title: 'נושא חוזר',
    category: 'הנחיה חדשה',
    work_quote: 'זהו משפט ארוך מספיק שמתאר דרישה חוזרת באותו נושא מתוך פרוטוקול העבודה.',
  }];

  assert.deepEqual(
    retention.attachRepeatedFindingHistory({
      work_quote: 'original quote',
      source_verification: { quality_gate_passed: true },
    }, history),
    {
      work_quote: 'original quote',
      source_verification: { quality_gate_passed: true },
      repeated_history: history,
      repeated_in_documents: 1,
    },
  );
});

test('a later protocol keeps history already collected by an earlier scan', () => {
  const quote = 'הקבלן נדרש להשלים את אבני השפה ולתאם את המשך העבודה עם מנהל הפרויקט.';
  const oldHistory = {
    finding_id: 'old-first',
    source_document_id: 'protocol-1',
    source_document_title: 'פרוטוקול 01.01.25',
    document_date: '2025-01-01',
    title: 'השלמת אבני שפה',
    category: 'הנחיה חדשה',
    work_quote: quote,
  };
  const plan = retention.planRepeatedFindingConsolidation({
    findings: [
      {
        id: 'old-kept',
        scan_signature: 'scan-old',
        source_execution_doc_id: 'protocol-2',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        evidence_data: { work_quote: quote, repeated_history: [oldHistory] },
      },
      {
        id: 'new-latest',
        scan_signature: 'scan-new',
        source_execution_doc_id: 'protocol-3',
        title: 'השלמת אבני שפה',
        category: 'הנחיה חדשה',
        evidence_data: { work_quote: quote },
      },
    ],
    documents: [
      { id: 'protocol-2', title: 'פרוטוקול 02.01.25' },
      { id: 'protocol-3', title: 'פרוטוקול 03.01.25' },
    ],
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].keepId, 'new-latest');
  assert.deepEqual(
    plan[0].repeatedHistory.map((entry) => entry.source_document_id),
    ['protocol-1', 'protocol-2', 'protocol-3'],
  );
});

test('an identical work quote with different contractual bases is not collapsed', () => {
  const quote = 'הקבלן נדרש להשלים את אבני השפה ולתאם את המשך העבודה עם מנהל הפרויקט.';
  for (const bases of [
    [{ id: 'contract-a', quote: 'A first contractual requirement.' }, { id: 'contract-b', quote: 'A second contractual requirement.' }],
    [{ id: 'contract-a', quote: 'A first contractual requirement.' }, { id: 'contract-a', quote: 'A different clause in the same contract.' }],
  ]) {
    const plan = retention.planRepeatedFindingConsolidation({
      findings: bases.map((base, i) => ({ id: `finding-${i}`, scan_signature: `scan-${i}`, source_execution_doc_id: `work-${i}`,
        target_contract_doc_id: base.id, evidence_data: { work_quote: quote, contract_quote: base.quote } })),
      documents: [{ id: 'work-0', title: 'Protocol 01.01.2025' }, { id: 'work-1', title: 'Protocol 02.01.2025' }],
    });
    assert.deepEqual(plan, []);
  }
});

test('the same quotes from different incorporated source pages are not consolidated', () => {
  const quote = 'הקבלן נדרש להשלים את אבני השפה ולתאם את המשך העבודה עם מנהל הפרויקט.';
  const plan = retention.planRepeatedFindingConsolidation({
    findings: [0, 1].map((i) => ({ id: `ref-${i}`, scan_signature: `scan-${i}`, source_execution_doc_id: `work-${i}`,
      target_contract_doc_id: null, evidence_data: { work_quote: quote, contract_quote: 'The same source sentence.',
        contract_reference_authority: { reference_chunk_id: `different-source-${i}` } } })),
    documents: [{ id: 'work-0', title: 'Protocol 01.01.2025' }, { id: 'work-1', title: 'Protocol 02.01.2025' }],
  });
  assert.deepEqual(plan, []);
});

test('saved incorporated-reference findings retain the real library source during revalidation', async () => {
  const workQuote = 'המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.';
  const contractQuote = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.';
  const work = { ...openWork, id: 'ref-work', extracted_text: workQuote };
  const base = { id: 'root', project_id: 'project', title: 'מפרט מיוחד', category: 'CONTRACT',
    extracted_text: 'על עבודות הניקוז יחול פרק 57 של המפרט הכללי מהדורת 2023.' };
  const card = { ...openCard, title: 'עטיפת צינור בחול מצומנט', category: 'סתירה', source_execution_doc_id: work.id,
    evidence_data: { work_quote: workQuote, contract_quote: contractQuote, contract_reference_authority: { reference_chunk_id: 'ref-page' } } };
  const db = memoryDatabase({ contradictions: [card], documents: [work, base], document_scan_state: [],
    reference_documents: [{ id: 'ref-book', project_id: 'project', title: 'המפרט הכללי', reference_type: 'BLUE_BOOK', status: 'READY' }],
    reference_document_incorporations: [], reference_document_chunks: [{ id: 'ref-page', reference_document_id: 'ref-book',
      chunk_type: 'PAGE', page_from: 57, text: `פרק 57\nמהדורת 2023\n${contractQuote}` }],
  });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  assert.equal(db.state.contradictions[0].target_contract_doc_id, null);
  assert.equal(db.state.contradictions[0].evidence_data.document_pair.contract_doc_id, 'ref-book');
  assert.equal(db.state.contradictions[0].evidence_data.contract_quote, contractQuote);
  const changedIncorporation = base.extracted_text.replace('עבודות הניקוז', 'עבודות המים והניקוז');
  db.state.documents.find((document) => document.id === base.id).extracted_text = changedIncorporation;
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.equal(db.state.contradictions[0].evidence_data.contract_reference_authority.chain[0].quote, changedIncorporation);
  db.state.reference_documents = [];
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.equal(db.state.contradictions.length, 1, 'loss of a reference source does not prove the historical finding was junk');
  assert.equal(db.state.contradictions[0].evidence_data.evidence_status, 'REQUIRES_VERIFICATION');
});

test('the same work quote and contractual clause still consolidate despite layout differences', () => {
  const quote = 'הקבלן נדרש להשלים את אבני השפה ולתאם את המשך העבודה עם מנהל הפרויקט.';
  const plan = retention.planRepeatedFindingConsolidation({
    findings: [0, 1].map((i) => ({ id: `finding-${i}`, scan_signature: `scan-${i}`, source_execution_doc_id: `work-${i}`,
      target_contract_doc_id: 'contract', evidence_data: { work_quote: quote, contract_quote: i ? 'The   same\nclause.' : 'The same clause.' } })),
    documents: [{ id: 'work-0', title: 'Protocol 01.01.2025' }, { id: 'work-1', title: 'Protocol 02.01.2025' }],
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].keepId, 'finding-1');
});

test('a genuine closed project issue is not disposable technical archive junk', () => {
  assert.equal(retention.isObsoleteAutomaticArchiveRow({
    id: 'closed-issue', scan_signature: 'scan', status: 'ARCHIVED',
    evidence_data: { archive_meta: { archive_reason: 'Resolved by protocol 20.10.2026', resolution_document_id: 'resolution' } },
  }), false);
  assert.equal(retention.isObsoleteAutomaticArchiveRow({
    id: 'replaced-auto', scan_signature: 'scan', status: 'ARCHIVED',
    evidence_data: { archive_meta: { archive_reason: 'A complete replacement scan finished successfully for this work document.', current_scan_signature: 'replacement' } },
  }), true);
});

test('an exact quote from an incompletely read PDF keeps the finding unconfirmed until reading is verified', async () => {
  const base = { id: 'warranty-base', project_id: 'project', title: 'warranty.pdf', category: 'CONTRACT',
    ocr_status: 'COMPLETED', extracted_text: 'אחריות לאביזרי FOX תהיה לתקופה של 12 חודשים.' };
  const work = { id: 'warranty-work', project_id: 'project', title: 'Protocol 01.01.2025', category: 'EXECUTION',
    extracted_text: 'המפקח דורש אחריות של 15 שנים לאביזרי FOX.' };
  const row = { ...openCard, id: 'warranty-card', title: 'דרישת אחריות לאביזרי FOX', category: 'סתירה',
    description: work.extracted_text, source_execution_doc_id: work.id, target_contract_doc_id: base.id,
    evidence_data: { work_quote: work.extracted_text, contract_quote: base.extracted_text, evidence_status: 'VERIFIED' } };
  const db = memoryDatabase({ documents: [base, work], contradictions: [row], document_scan_state: [] });
  assert.equal(await cleanup.deleteUnsupportedAutomaticFindings(db, 'project'), 0);
  assert.equal(db.state.contradictions[0].evidence_data.evidence_status, 'REQUIRES_VERIFICATION');
  assert.equal(db.state.contradictions[0].evidence_data.source_verification.source_reading_complete, false);
  db.state.documents[0].parsed_json = { source_reading: { version: 'page-coverage-v1', complete: true,
    totalPages: 1, readPages: [1], unreadablePages: [] } };
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.equal(db.state.contradictions[0].evidence_data.evidence_status, 'VERIFIED');
});

test('an unread later PDF cannot close a real earlier mismatch', async () => {
  const reply = { id: 'reply', project_id: 'project', title: 'Protocol 02.01.2025.pdf', category: 'EXECUTION',
    ocr_status: 'REQUIRES_REVIEW', extracted_text: 'תכנית הניקוז תוקנה בהתאם להוראות המתכנן והנושא נסגר.' };
  const db = memoryDatabase({ documents: [openWork, reply], contradictions: [openCard], document_scan_state: [] });
  await cleanup.deleteUnsupportedAutomaticFindings(db, 'project');
  assert.equal(db.state.contradictions[0].status, 'OPEN');
});
