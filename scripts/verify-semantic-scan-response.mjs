import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScanFindings } from '../src/utils/scan-ai-response.ts';
import { groundContractScanFinding, assessContractScanFinding, findingHasActionableWorkEvidence, CONTRACT_SCAN_MEMORY_VERSION } from '../src/utils/contract-scan-quality.ts';
import { buildScanMemorySignature } from '../src/utils/document-scan-memory.ts';
import * as quality from '../src/utils/contract-scan-quality.ts';

// Synthetic model-shaped data exercises the real parser, not an actual model call.
const claim = { role: 'INSTRUCTION', subject: 'עטיפת הצינור', attribute: 'CEMENT_CONTENT', value: '4%',
  scope: null, location: null, party: null, condition: null, period: null };
const finding = { title: 'עטיפת הצינור', category: 'סתירה', work_quote: 'עטיפת הצינור תבוצע בחול מצומנט 4%.',
  contract_quote: 'עטיפת הצינור תבוצע בחול מצומנט 8%.', comparison: { work: claim,
    baseline: { ...claim, role: 'CONTRACT_RULE', value: '8%' } } };
const options = { requireSemantic: true };

test('complete semantic extraction survives the actual parser unchanged', () => {
  assert.deepEqual(parseScanFindings(JSON.stringify([finding]), options), [finding]);
});
test('an explicit empty finding array remains a valid completed response', () => {
  assert.deepEqual(parseScanFindings('[]', options), []);
});
for (const [name, value] of [
  ['legacy object without semantic fields', { title: 'פער', category: 'סתירה', work_quote: 'מקור', contract_quote: null }],
  ['missing work value field', { ...finding, comparison: { ...finding.comparison, work: { ...claim, value: undefined } } }],
  ['unknown statement role', { ...finding, comparison: { ...finding.comparison, work: { ...claim, role: 'APPROVED_BY_MODEL' } } }],
  ['unsupported self-certified conclusion', { ...finding, comparison: { ...finding.comparison, relation: 'INCOMPATIBLE' } }],
  ['an unsupported category', { ...finding, category: 'CERTIFIED' }],
  ['an empty contract quotation instead of null', { ...finding, contract_quote: '' }],
  ['a cut-off work quotation', { ...finding, work_quote: '' }],
]) {
  test(`incomplete semantic response is an error: ${name}`, () => {
    assert.throws(() => parseScanFindings(JSON.stringify([value]), options));
  });
}
for (const [name, text] of [
  ['an empty object', '{}'], ['an invalid empty item', '[{}]'], ['a skipped null item', '[null]'],
  ['a cut-off outer array', JSON.stringify([finding]).slice(0, -1)],
  ['a completed unrelated nested array inside a cut-off response', '[{"title":"פער","comparison":{"work":{"notes":[]'],
  ['unparsed trailing finding data', JSON.stringify([finding]) + ',{"title":'],
]) {
  test(`malformed semantic response cannot become success: ${name}`, () => {
    assert.throws(() => parseScanFindings(text, options));
  });
}

test('parsed source facts reach the real quality gate and its source-based presentation', () => {
  const parsed = parseScanFindings(JSON.stringify([finding]), options)[0];
  const work = { id: 'work', extracted_text: finding.work_quote };
  const base = { id: 'base', extracted_text: finding.contract_quote };
  const grounded = groundContractScanFinding({ finding: parsed, currentWorkDocument: work, contractDocuments: [base] });
  const result = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(result.accepted, true);
  assert.equal(result.evidenceRelation.relation, 'INCOMPATIBLE');
  assert.equal(result.evidenceStatus, 'VERIFIED');
  assert.ok(result.presentation.description.includes('4%'));
  assert.ok(result.presentation.description.includes('8%'));
});

test('a new extraction format preserves the stored scan memory for unchanged inputs', () => {
  // Recorded fingerprint of the pre-step-3 engine for this fixed artificial input.
  assert.equal(buildScanMemorySignature({ engineVersion: CONTRACT_SCAN_MEMORY_VERSION, projectId: 'project-1',
    contractFingerprint: 'contract-1', workFingerprint: 'work-1', relatedWorkFingerprint: 'related-1', aiIdentity: 'manual-selection' }),
  'c288f1ca65ea91f7af6ac5089eadba8d85826f6fac3a73c988d2b279d97c2423');
});

test('an initial model category cannot hide a source-proven conflict from the saving gate', () => {
  const work = { id: 'work', extracted_text: finding.work_quote };
  const base = { id: 'base', extracted_text: finding.contract_quote };
  const grounded = groundContractScanFinding({ finding: { ...finding, category: 'פעולה לביצוע' },
    currentWorkDocument: work, contractDocuments: [base] });
  const assessment = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.evidenceRelation.resultType, 'CONTRADICTION');
  assert.equal(findingHasActionableWorkEvidence({ finding: grounded, currentWorkDocument: work, assessment }), true);
});

test('an independent calendar proof does not validate fabricated extraction fields', () => {
  const quote = 'הבקשה התקבלה אצל המזמין ביום 01.01.2025. נכון ליום 25.01.2025 לא נמסרה תשובה לבקשה.';
  const clause = 'המזמין ימסור תשובה לבקשה בתוך 14 ימים קלנדריים מיום קבלת הבקשה.';
  const work = { id: 'work', extracted_text: quote };
  const base = { id: 'base', extracted_text: clause };
  const parsed = parseScanFindings(JSON.stringify([{ ...finding, title: 'אי מתן תשובה לבקשה',
    work_quote: quote, contract_quote: clause, comparison: {
      work: { ...claim, role: 'UNKNOWN', subject: 'הבקשה', attribute: 'OTHER', value: '999 ימים' },
      baseline: { ...claim, role: 'CONTRACT_RULE', subject: 'תשובה לבקשה', attribute: 'OTHER', value: '14 ימים' },
    } }]), options)[0];
  const grounded = groundContractScanFinding({ finding: parsed, currentWorkDocument: work, contractDocuments: [base] });
  const assessment = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, false);
  assert.ok(assessment.reasons.includes('semantic_field_not_grounded'));
  assert.notEqual(assessment.evidenceStatus, 'VERIFIED');
});

test('an unfamiliar source formulation remains an explicit unresolved comparison, not a fabricated-quote error', () => {
  const quote = 'מתבקשים לדאוג לכך שהמילוי סביב הצינור יכלול חול מצומנט 4%.';
  const work = { id: 'work', extracted_text: quote };
  const base = { id: 'base', extracted_text: finding.contract_quote };
  const parsed = parseScanFindings(JSON.stringify([{ ...finding, title: 'המילוי סביב הצינור', work_quote: quote,
    comparison: { ...finding.comparison, work: { ...claim, subject: 'המילוי סביב הצינור' } } }]), options)[0];
  const grounded = groundContractScanFinding({ finding: parsed, currentWorkDocument: work, contractDocuments: [base] });
  const assessment = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, true, assessment.reasons.join(', '));
  assert.equal(assessment.evidenceRelation.relation, 'INSUFFICIENT_EVIDENCE');
  assert.ok(assessment.verificationReasons.includes('semantic_fields_not_established'));
  assert.notEqual(assessment.evidenceStatus, 'VERIFIED');
});

test('a proven receipt and overdue response control the result despite the model calling non-response a response', () => {
  const quote = 'הבקשה התקבלה אצל המזמין ביום 01.01.2025. נכון ליום 25.01.2025 לא נמסרה תשובה לבקשה.';
  const clause = 'המזמין ימסור תשובה לבקשה בתוך 14 ימים קלנדריים מיום קבלת הבקשה.';
  const work = { id: 'work', extracted_text: quote };
  const base = { id: 'base', extracted_text: clause };
  const parsed = parseScanFindings(JSON.stringify([{ ...finding, title: 'לא נמסרה תשובה לבקשה', category: 'חוסר נתונים',
    work_quote: quote, contract_quote: clause, comparison: {
      work: { ...claim, role: 'RESPONSE', subject: 'הבקשה התקבלה אצל המזמין ביום 01.01.2025', attribute: 'OTHER', value: '01.01.2025' },
      baseline: { ...claim, role: 'INSTRUCTION', subject: 'המזמין ימסור תשובה לבקשה', attribute: 'OTHER', value: '14 ימים קלנדריים מיום קבלת הבקשה' },
    } }]), options)[0];
  const grounded = groundContractScanFinding({ finding: parsed, currentWorkDocument: work, contractDocuments: [base] });
  const assessment = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.category, 'סתירה');
  assert.equal(assessment.evidenceStatus, 'VERIFIED');
  assert.equal(assessment.replyDeadline.dueDate, '2025-01-15');
});

test('an inserted colon in a Hebrew subject is repaired only inside the already verified quotation', () => {
  const workQuote = 'המפקח דורש שהמילוי סביב הצינור יהיה חול מצומנט 4%';
  const baseQuote = 'עטיפת הצינור תבוצע בחול מיוצב בצמנט 8%';
  const work = { id: 'work', extracted_text: `${workQuote}.` };
  const base = { id: 'base', extracted_text: `${baseQuote}.` };
  const proposal = { ...finding, work_quote: workQuote, contract_quote: baseQuote, comparison: {
    work: { ...claim, subject: 'המילוי סביב הצינ:ור' },
    baseline: { ...claim, role: 'CONTRACT_RULE', subject: 'עטיפת הצינור', value: '8%' },
  } };
  const grounded = groundContractScanFinding({ finding: proposal, currentWorkDocument: work, contractDocuments: [base] });
  const assessment = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, true, assessment.reasons.join(', '));
  assert.equal(assessment.evidenceRelation.relation, 'INCOMPATIBLE');
  assert.equal(grounded.comparison.work.subject, 'המילוי סביב הצינור');
  assert.equal(grounded.comparison_span_repairs[0].original, 'המילוי סביב הצינ:ור');
  assert.equal(proposal.comparison.work.subject, 'המילוי סביב הצינ:ור');
});

test('a complete response with an absent citation is a retryable analysis error, not a completed empty finding', () => {
  assert.equal(typeof quality.assertGeneratedScanSources, 'function');
  const work = { id: 'work', extracted_text: finding.work_quote };
  const base = { id: 'base', extracted_text: finding.contract_quote };
  assert.throws(() => quality.assertGeneratedScanSources({ findings: [{ ...finding, work_quote: 'הקבלן נדרש להחליף מכונה.' }],
    currentWorkDocument: work, contractDocuments: [base] }), /work_quote_not_found/);
  assert.doesNotThrow(() => quality.assertGeneratedScanSources({ findings: [], currentWorkDocument: work, contractDocuments: [base] }));
});

test('a source-proven conflict is presented from its sources even when the model title is unrelated', () => {
  const work = { id: 'work', extracted_text: finding.work_quote };
  const base = { id: 'base', extracted_text: finding.contract_quote };
  const grounded = groundContractScanFinding({ finding: { ...finding, title: 'אחריות לאביזרי FOX' }, currentWorkDocument: work, contractDocuments: [base] });
  const assessment = assessContractScanFinding({ finding: grounded, currentWorkDocument: work, contractDocuments: [base] });
  assert.equal(assessment.accepted, true, assessment.reasons.join(', '));
  assert.equal(assessment.evidenceRelation.relation, 'INCOMPATIBLE');
  assert.equal(assessment.presentation.title.includes('FOX'), false);
});

test('the runtime schema constrains citations and subjects to source text without rewriting dates or numbers', () => {
  assert.equal(typeof quality.buildGroundedScanResponseSchema, 'function');
  const work = 'עטיפת הצינור תבוצע בחול מצומנט 4%.';
  const base = 'עטיפת הצינור תבוצע בחול מיוצב בצמנט 8%.';
  const schema = quality.buildGroundedScanResponseSchema({ workText: work, contractTexts: [base] });
  assert.deepEqual(schema.items.properties.work_quote.enum, [work]);
  assert.deepEqual(schema.items.properties.contract_quote.enum, [base, null]);
  for (const subject of schema.items.properties.comparison.properties.work.properties.subject.enum) assert.ok(work.includes(subject));
  assert.equal(schema.items.properties.work_quote.enum.includes(work.replace('4%', '8%')), false);
});
