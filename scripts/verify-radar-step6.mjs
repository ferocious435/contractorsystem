import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { getEvidenceDisplayStatus } from '../src/components/features/contradiction-radar/utils/evidenceVerification.ts';
import { getRadarFindingKind, filterRadarFindings, buildRadarStatusFilterOptions } from '../src/components/features/contradiction-radar/utils/findingClassification.ts';
import * as dispositions from '../src/utils/radar-review-disposition.ts';
import { isVerifiedEvidence } from '../src/utils/letter-evidence.ts';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
let review;
try { review = await import('../src/utils/radar-saved-finding-review.ts'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
hook.deregister();

const quotes = { evidence_status: 'VERIFIED', contract_quote: 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.',
  work_quote: 'המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.',
  source_verification: { contract_quote_matched: true, work_quote_matched: true, quality_gate_passed: true } };
const work = { id: 'work', title: 'הוראה', extracted_text: quotes.work_quote };
const base = { id: 'base', title: 'חוזה', category: 'CONTRACT', extracted_text: quotes.contract_quote };
const row = { id: 'finding', title: 'דרישת חומר לעטיפת הצינור', description: 'הנחיית מילוי', strategy_advice: 'בדוק את דרישות המילוי',
  category: 'סתירה', severity: 'HIGH', scan_signature: 'signature', status: 'OPEN', pricing_status: 'PENDING',
  source_execution_doc_id: work.id, target_contract_doc_id: base.id, evidence_data: quotes };
const plan = (finding = row, documents = [work, base]) => {
  assert.ok(review, 'saved review must use a shared product planner');
  return review.planSavedFindingReview({ finding, documents, contractDocuments: documents.filter(d => d.category === 'CONTRACT') });
};

test('high_severity_is_not_contradiction', () => {
  assert.equal(getRadarFindingKind({ category: 'אירוע שטח', severity: 'HIGH' }), 'SITE_EVENT');
  assert.equal(getRadarFindingKind({ category: 'שינוי/חריג', severity: 'HIGH' }), 'VARIATION');
});
test('matched_quotes_without_relation_are_not_confirmed', () => {
  assert.equal(getEvidenceDisplayStatus(quotes), 'MATCHED_QUOTES_REQUIRE_ASSESSMENT');
});
test('legacy_verification_is_not_semantic_proof', () => {
  assert.equal(getRadarFindingKind(row), 'MISSING_INFO');
  assert.equal(getEvidenceDisplayStatus({ ...quotes, source_verification: { ...quotes.source_verification,
    quality_gate_version: 'old-version' } }), 'MATCHED_QUOTES_REQUIRE_ASSESSMENT');
});
test('a genuine incompatibility receives the same confirmed type in a saved record', () => {
  const result = plan();
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(result.patch.evidence_data.semantic_assessment.relation, 'INCOMPATIBLE');
  assert.equal(getEvidenceDisplayStatus(result.patch.evidence_data), 'SOURCE_VERIFIED');
  assert.equal(getRadarFindingKind({ ...row, ...result.patch }), 'CONTRADICTION');
});
test('a compatible comparison is excluded without changing its project status or source quotes', () => {
  const sameWork = { ...work, extracted_text: base.extracted_text };
  const original = { ...row, evidence_data: { ...quotes, work_quote: base.extracted_text } };
  const result = plan(original, [sameWork, base]);
  assert.equal(result.outcome, 'TECHNICAL_EXCLUSION');
  assert.equal(result.patch.status, undefined);
  assert.equal(result.patch.evidence_data.work_quote, original.evidence_data.work_quote);
  assert.equal(result.patch.evidence_data.contract_quote, original.evidence_data.contract_quote);
});
test('unknown wording or missing reading coverage requires review, never proves an automatic error', () => {
  const unknown = { ...work, extracted_text: 'נדרש לתאם את פרטי העבודות מול המפקח.' };
  const result = plan({ ...row, evidence_data: { ...quotes, work_quote: unknown.extracted_text } }, [unknown, base]);
  assert.equal(result.outcome, 'REQUIRES_REVIEW');
  assert.equal(result.patch.evidence_data.review_disposition, undefined);
  assert.equal(result.patch.category, 'חוסר נתונים');
  const unread = { ...work, storage_path: 'work.pdf', ocr_status: 'COMPLETED', parsed_json: {} };
  assert.equal(plan(row, [unread, base]).outcome, 'REQUIRES_REVIEW');
});
test('technical_exclusions_not_in_work_archive', () => {
  const excluded = { ...row, status: 'ARCHIVED', evidence_data: { review_disposition: { type: 'INVALID_AUTOMATIC_FINDING' } } };
  assert.deepEqual(filterRadarFindings([excluded], 'ALL', 'ARCHIVED'), []);
  assert.equal(buildRadarStatusFilterOptions([excluded])[2].count, 0);
  assert.equal(excluded.status, 'ARCHIVED');
});
test('linked_financial_record_remains_accessible and manual history is never rewritten', () => {
  const priced = { ...row, pricing_status: 'PRICED', status: 'MOVED_TO_PRICING', evidence_data: { ...quotes,
    work_quote: 'הנחיה שאינה נמצאת במקור', issue_link: { canonicalId: 'primary', relation: 'INVALID_EVIDENCE' },
    expert_strategy: { letter: 'saved text' }, manual_review: { verdict: 'REQUIRES_REVIEW' } } };
  const before = structuredClone(priced);
  const result = plan(priced);
  assert.equal(result.canonicalId, 'primary');
  assert.equal(result.patch.pricing_status, undefined);
  assert.equal(result.patch.title, undefined);
  assert.deepEqual(result.patch.evidence_data.manual_review, before.evidence_data.manual_review);
  assert.deepEqual(result.patch.evidence_data.issue_link, before.evidence_data.issue_link);
  assert.deepEqual(result.patch.evidence_data.expert_strategy, before.evidence_data.expert_strategy);
  assert.deepEqual(priced, before);
});
test('unchanged_sources_are_not_reanalyzed and repeated assessment is stable', () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No model or network is allowed during saved review'); };
  try {
    const first = plan();
    const second = plan({ ...row, ...first.patch });
    assert.deepEqual(second.patch, first.patch);
  } finally { globalThis.fetch = oldFetch; }
});
test('technical exclusions cannot enter a new automatic calculation; unassessed records are not labelled erroneous', () => {
  assert.equal(typeof dispositions.canAutomaticallyPriceFinding, 'function');
  const eligible = dispositions.canAutomaticallyPriceFinding;
  assert.equal(eligible(row), true);
  assert.equal(eligible({ ...row, evidence_data: { review_disposition: { type: 'INVALID_AUTOMATIC_FINDING' } } }), false);
  assert.equal(eligible({ ...row, evidence_data: { review_disposition: { type: 'DUPLICATE' } } }), false);
  assert.equal(eligible({ ...row, status: 'ARCHIVED' }), false);
  assert.equal(eligible({ ...row, status: 'AUTO_RESOLVED' }), false);
  assert.equal(eligible({ ...row, status: 'IGNORED' }), false);
});
test('pricing and new letter evidence do not promote two unassessed quotations to a confirmed conclusion', () => {
  assert.equal(isVerifiedEvidence(quotes), false);
  assert.equal(isVerifiedEvidence(plan().patch.evidence_data), true);
});
test('an incomplete source cannot prove compatibility, and repeat review does not revive or rewrite an earlier exclusion', () => {
  const unread={...work,storage_path:'work.pdf',ocr_status:'COMPLETED',parsed_json:{},extracted_text:base.extracted_text};
  const original={...row,evidence_data:{...quotes,work_quote:base.extracted_text,
    review_disposition:{type:'INVALID_AUTOMATIC_FINDING',reasons:['same_approval_workflow']}}};
  const first=plan(original,[unread,base]);
  assert.equal(first.outcome,'REQUIRES_REVIEW');
  assert.equal(getEvidenceDisplayStatus(first.patch.evidence_data),'REQUIRES_REVIEW');
  const repeat=plan({...original,...first.patch},[unread,base]);
  assert.deepEqual(repeat.patch,first.patch);
  assert.equal(repeat.patch.evidence_data.review_disposition.type,'INVALID_AUTOMATIC_FINDING');
});
test('a stale verified flag cannot confirm a record whose quote is missing', () => {
  const verified=plan().patch.evidence_data;
  assert.notEqual(getEvidenceDisplayStatus({...verified,work_quote:null}),'SOURCE_VERIFIED');
});
test('a damaged primary source keeps the collected question and its historical financial links visible', () => {
  const primary={...row,evidence_data:{...quotes,work_quote:'ציטוט שכבר אינו קיים במקור',
    issue_reconciliation:{canonicalId:row.id,financialLinks:[{findingId:'old',ledgerId:'ledger'}]},issue_history:{events:[{id:'saved-event'}]}}};
  const result=plan(primary);
  assert.equal(result.outcome,'REQUIRES_REVIEW');
  assert.equal(result.patch.evidence_data.review_disposition,undefined);
  assert.deepEqual(result.patch.evidence_data.issue_reconciliation,primary.evidence_data.issue_reconciliation);
  assert.deepEqual(filterRadarFindings([{...primary,...result.patch}],'ALL','OPEN').map(r=>r.id),['finding']);
});
test('actual closed and ignored project statuses are counted and displayed with the work archive', () => {
  for(const status of ['AUTO_RESOLVED','IGNORED']) {
    const closed={...row,status};
    assert.equal(buildRadarStatusFilterOptions([closed])[0].count,0);
    assert.equal(buildRadarStatusFilterOptions([closed])[2].count,1);
    assert.deepEqual(filterRadarFindings([closed],'ALL','ARCHIVED').map(r=>r.id),['finding']);
  }
});
