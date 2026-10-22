import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  loadInput, inspectInput, quality, retention, classification,
  networkAttempts, productionHashes, normalize,
} from './radar-point-1-3-harness.mjs';

// Desired behavior tests. Failures are intentionally retained in diagnostic step 1.
// Do not weaken expectations to turn the current product's output green.
const beforeHashes = productionHashes();
const loaded = loadInput(process.env.RADAR_POINT13_SNAPSHOT);
const actual = inspectInput(loaded);

for (const scenario of actual.cases) {
  test(`[SAVED ${scenario.key}] ${scenario.label}`, () => {
    if (scenario.expected.accepted !== null) {
      assert.equal(scenario.quality.accepted, scenario.expected.accepted,
        `${scenario.id}: current reasons = ${JSON.stringify(scenario.quality.reasons)}`);
    }
    if (scenario.expected.evidenceStatus !== null) {
      assert.equal(scenario.quality.evidenceStatus, scenario.expected.evidenceStatus,
        `${scenario.id}: source matching must not establish the disputed deadline`);
    }
  });
}

test('[SAVED sources] all eight actual quotations remain anchored to their assigned sources', () => {
  for (const row of actual.cases) {
    assert.equal(row.quality.workQuoteMatched, true, row.id);
    if (row.baseline) assert.equal(row.quality.contractQuoteMatched, true, row.id);
  }
});

test('[SAVED MTM provenance] history expectations cite actual passages rather than inferred signature events', () => {
  for (const event of loaded.registry.history_expectations) {
    const document = loaded.documentById.get(event.documentId);
    assert.ok(document, event.documentId);
    assert.ok(normalize(document.extracted_text).includes(event.anchor), event.documentId);
  }
});

test('[SAVED MTM] the old priced card is rejected for the incorrect electricity-pole source', () => {
  assert.equal(actual.history.oldPricedMtm.quoteFound, false);
  assert.equal(actual.history.oldPricedMtm.assessment.accepted, false);
  assert.ok(actual.history.oldPricedMtm.assessment.reasons.includes('work_quote_not_found'));
});

test('[SAVED MTM] invalid evidence does not make the protected priced record automatically disposable', () => {
  assert.equal(actual.history.oldPricedMtm.protected, true);
  assert.equal(actual.history.oldPricedMtm.canRemoveAutomatically, false);
});

test('[SAVED MTM] the December copies already contribute two source entries to the current record', () => {
  const ids = actual.history.existingDecemberRepeatHistory.map(row => row.source_document_id).sort();
  assert.deepEqual(ids, ['be390766-cc93-4744-ae70-653baea03b05', 'ea4c4bf0-a19b-4651-8e05-53f417682e0c']);
});

test('[SAVED MTM] available reading-eligible later correspondence does not establish closure', () => {
  assert.ok(actual.history.sourceReadingEligibleIds.includes('df02edce-a1b1-4bab-a0d8-8fc6e99a2ed3'));
  assert.equal(actual.history.actualResolution, null);
});

test('[SAVED MTM] the direct August statement is still unsigned, without treating the owner note as a document', () => {
  const august = loaded.documentById.get('cbfaca0d-e9be-45bb-9aec-3ae5c740554d');
  assert.ok(normalize(august.extracted_text).includes('הקבלן טרם חתם על נספח ההסכם'));
  assert.ok(actual.history.omittedUnverifiedPdfIds.includes(august.id));
  assert.equal(actual.history.actualResolution, null);
  // This is source integrity, not a claim that an as-of state engine already exists.
});

// Synthetic variants below are labelled separately. They exercise general rules,
// and must never be described as events that actually happened in this project.
function compareSynthetic(workText, baselineText) {
  const work = { id: 'synthetic-work', title: 'הוראה 02.01.2025', extracted_text: workText };
  const base = { id: 'synthetic-base', title: 'תנאי חוזה', extracted_text: baselineText };
  const finding = quality.groundContractScanFinding({
    finding: { title: 'דרישת חומר לעטיפת הצינור', category: 'סתירה',
      work_quote: workText, contract_quote: baselineText },
    currentWorkDocument: work, contractDocuments: [base],
  });
  return quality.assessContractScanFinding({ finding, currentWorkDocument: work, contractDocuments: [base] });
}

test('[SYNTHETIC positive] a real 8% versus 4% pipe-surround requirement must still be found', () => {
  const result = compareSynthetic('המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.',
    'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.');
  assert.equal(result.accepted, true);
});

test('[SYNTHETIC compatible] identical material requirements are not a contradiction', () => {
  const result = compareSynthetic('המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 8%.',
    'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.');
  assert.equal(result.accepted, false);
});

test('[SYNTHETIC UI] high importance does not change an MTM variation into a contradiction', () => {
  const mtm = loaded.findings.find(row => row.id === '2f7e6a92-f88c-4641-8a3d-12855208ea47');
  assert.equal(classification.getRadarFindingKind({ ...mtm, severity: 'HIGH' }), 'VARIATION');
});

test('[SYNTHETIC MTM aspect] approval of the method alone does not close the price issue', () => {
  const work = { id: 'synthetic-price', title: 'פרוטוקול 01.01.2025',
    extracted_text: 'קידוח MTM ברחוב יהלום: ניתוח המחיר טרם אושר.' };
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { work_quote: work.extracted_text }, currentWorkDocument: work,
    relatedWorkDocuments: [{ id: 'synthetic-method', title: 'פרוטוקול 02.01.2025',
      extracted_text: 'קידוח MTM ברחוב יהלום אושר לביצוע.' }],
  }), false);
});

test('[SYNTHETIC MTM conditional] a future conditional approval does not close the issue', () => {
  const work = { id: 'synthetic-open', title: 'פרוטוקול 01.01.2025',
    extracted_text: 'קידוח MTM ברחוב יהלום טרם אושר.' };
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { work_quote: work.extracted_text }, currentWorkDocument: work,
    relatedWorkDocuments: [{ id: 'synthetic-conditional', title: 'פרוטוקול 02.01.2025',
      extracted_text: 'קידוח MTM ברחוב יהלום יאושר לאחר חתימת הנספח.' }],
  }), false);
});

test('[SYNTHETIC MTM resolution] a definite decision on the same issue still closes it', () => {
  const work = { id: 'synthetic-open', title: 'פרוטוקול 01.01.2025',
    extracted_text: 'קידוח MTM ברחוב יהלום טרם אושר.' };
  assert.equal(quality.findingIsSupersededByLaterEvidence({
    finding: { work_quote: work.extracted_text }, currentWorkDocument: work,
    relatedWorkDocuments: [{ id: 'synthetic-resolution', title: 'פרוטוקול 02.01.2025',
      extracted_text: 'קידוח MTM ברחוב יהלום אושר לביצוע.' }],
  }), true);
});

test('[SYNTHETIC repeat] paraphrased MTM copies remain one issue when all conditions agree', () => {
  const quotes = [
    'נדרש לשנות את שיטת הקידוח ברחוב יהלום מדחיקת צנרת פיברגלס לקידוח MTM.',
    'ברחוב יהלום נדרש מעבר לקידוח MTM במקום דחיקת צנרת פיברגלס.',
  ];
  const rows = quotes.map((quote, index) => ({ id: `synthetic-copy-${index}`, status: 'OPEN',
    scan_signature: `synthetic-signature-${index}`, category: 'שינוי/חריג',
    source_execution_doc_id: `synthetic-source-${index}`, target_contract_doc_id: null,
    evidence_data: { work_quote: quote },
  }));
  const docs = rows.map((row, index) => ({ id: row.source_execution_doc_id,
    title: `פרוטוקול רחוב יהלום 0${index + 1}.01.2025`, extracted_text: quotes[index] }));
  const groups = retention.planRepeatedFindingConsolidation({ findings: rows, documents: docs });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].repeatedHistory.length, 2);
});

after(() => {
  assert.deepEqual(networkAttempts, [], 'No network, database or model attempt is permitted');
  assert.deepEqual(productionHashes(), beforeHashes, 'Diagnostic tests must not modify product code');
});
