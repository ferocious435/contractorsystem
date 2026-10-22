import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

// Diagnostic code only. No database client, model adapter, route or OCR import.
export const networkAttempts = [];
function denyNetwork(...args) {
  networkAttempts.push(String(args[0]));
  throw new Error('Network is forbidden in the point 1.3 offline reproduction');
}
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = tls.connect = denyNetwork;
syncBuiltinESMExports();

export const root = fileURLToPath(new URL('../', import.meta.url));
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/')
    ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
export const quality = await import('../src/utils/contract-scan-quality.ts');
export const retention = await import('../src/utils/scan-finding-retention-policy.ts');
export const readiness = await import('../src/utils/document-source-readiness.ts');
export const classification = await import('../src/components/features/contradiction-radar/utils/findingClassification.ts');
export const display = await import('../src/components/features/contradiction-radar/utils/evidenceVerification.ts');
hook.deregister();

export const productionFiles = [
  'src/utils/contract-scan-quality.ts', 'src/utils/document-scan-chunks.ts',
    'src/utils/contract-context-selection.ts', 'src/utils/radar-evidence-assessment.ts', 'src/utils/radar-evidence-meaning.ts',
  'src/utils/scan-finding-retention-policy.ts', 'src/utils/scan-finding-retention.ts',
  'src/utils/document-source-readiness.ts', 'src/utils/scan-ai-response.ts',
  'src/app/api/scan/route.ts',
  'src/components/features/contradiction-radar/utils/evidenceVerification.ts',
  'src/components/features/contradiction-radar/utils/findingClassification.ts',
];
export function productionHashes() {
  return Object.fromEntries(productionFiles.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}

export function normalize(value) {
  return String(value || '').normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
}

export function loadInput(snapshotPath) {
  const registry = JSON.parse(fs.readFileSync(new URL('./fixtures/radar-point-1-3.json', import.meta.url), 'utf8'));
  const input = snapshotPath ? JSON.parse(fs.readFileSync(path.resolve(snapshotPath), 'utf8')) : registry;
  const documents = input.documents.map(document => ({
    ...document,
    extracted_text: document.extracted_text ?? document.passages.map(passage => passage.text).join('\n\n[diagnostic excerpt gap]\n\n'),
    // Restore exactly the separately saved reading metadata, not invented coverage.
    parsed_json: { ...document.parsed_json, source_reading: document.source_reading ?? null },
  }));
  return { registry, input, documents, findings: input.findings,
    documentById: new Map(documents.map(document => [document.id, document])),
    sourceMode: snapshotPath ? 'FULL_SAVED_TEXT_SNAPSHOT' : 'MINIMAL_DIAGNOSTIC_EXCERPTS',
  };
}

export function inspectCard(row, documentById) {
  const evidence = row.evidence_data || {};
  const work = documentById.get(row.source_execution_doc_id);
  const baseline = documentById.get(row.target_contract_doc_id);
  if (!work) throw new Error(`Missing work document for ${row.id}`);
  if (row.target_contract_doc_id && !baseline) throw new Error(`Missing baseline for ${row.id}`);
  const original = {
    title: row.title, description: row.description, category: row.category,
    advice: row.strategy_advice, work_quote: evidence.work_quote,
    contract_quote: evidence.contract_quote,
    work_document_id: row.source_execution_doc_id,
    contract_document_id: row.target_contract_doc_id,
    comparison: evidence.comparison, context_selection: evidence.context_selection,
    supplied_contract_document_ids: evidence.supplied_contract_document_ids,
  };
  const grounded = quality.groundContractScanFinding({
    finding: original, currentWorkDocument: work, contractDocuments: baseline ? [baseline] : [],
  });
  const assessment = quality.assessContractScanFinding({
    finding: grounded, currentWorkDocument: work, contractDocuments: baseline ? [baseline] : [],
  });
  return {
    id: row.id, title: row.title, category: row.category,
    quality: { accepted: assessment.accepted, reasons: assessment.reasons,
      category: assessment.category,
      evidenceStatus: assessment.evidenceStatus, workQuoteMatched: assessment.workQuoteMatched,
      contractQuoteMatched: assessment.contractQuoteMatched },
    semanticAssessment: assessment.evidenceRelation, presentation: assessment.presentation,
    actionable: quality.findingHasActionableWorkEvidence({ finding: grounded, currentWorkDocument: work, assessment }),
    sourceReadiness: readiness.assessDocumentSourceReadiness(work),
    savedEvidenceStatus: evidence.evidence_status,
    displayStatus: display.getEvidenceDisplayStatus(evidence),
    displayKind: classification.getRadarFindingKind(row),
    grounded, work, baseline,
  };
}

export function inspectInput(loaded) {
  const cases = loaded.registry.cases.map(scenario => {
    const row = loaded.findings.find(finding => finding.id === scenario.id);
    if (!row) throw new Error(`Missing saved finding ${scenario.id}`);
    return { ...scenario, ...inspectCard(row, loaded.documentById) };
  });
  const old = loaded.findings.find(row => row.id === '86cef2b9-12bf-4223-b6c4-7f29e2e5198b');
  const oldAssessment = inspectCard(old, loaded.documentById);
  const currentMtm = loaded.findings.find(row => row.id === '2f7e6a92-f88c-4641-8a3d-12855208ea47');
  const earliest = loaded.findings.find(row => row.id === 'a3f5cff9-cedc-4681-9019-aa1a7ed10d6e');
  const earlierDocument = loaded.documentById.get(earliest.source_execution_doc_id);
  const related = loaded.registry.history_document_ids
    .filter(id => id !== earlierDocument.id)
    .map(id => loaded.documentById.get(id));
  if (related.some(document => !document)) throw new Error('Incomplete MTM timeline fixture');
  const datedReadingEligible = related.filter(document => readiness.assessDocumentSourceReadiness(document).canCompare);
  const resolution = quality.findSupersedingWorkEvidence({
    finding: { ...earliest, work_quote: earliest.evidence_data.work_quote },
    currentWorkDocument: earlierDocument, relatedWorkDocuments: datedReadingEligible,
  });
  const consolidationPlan = retention.planRepeatedFindingConsolidation({
    // These are the same eligibility predicates as the current server caller.
    findings: loaded.findings.filter(row => row.status !== 'ARCHIVED' && row.scan_signature),
    documents: loaded.documents,
  });
  return { cases, history: {
    sourceDocumentIds: [earlierDocument.id, ...related.map(document => document.id)],
    sourceReadingEligibleIds: datedReadingEligible.map(document => document.id),
    omittedUnverifiedPdfIds: related.filter(document => !readiness.assessDocumentSourceReadiness(document).canCompare).map(document => document.id),
    actualResolution: resolution,
    existingDecemberRepeatHistory: currentMtm.evidence_data.repeated_history || [],
    exactConsolidationPlan: consolidationPlan,
    // Protection prevents loss of financial work; it is not proof that its source is correct.
    oldPricedMtm: { id: old.id, protected: retention.findingNeedsHistory(old),
      canRemoveAutomatically: retention.canRemoveUnsupportedAutomaticFinding(old),
      quoteFound: oldAssessment.quality.workQuoteMatched,
      assessment: oldAssessment.quality, status: old.status, pricingStatus: old.pricing_status },
    ownerNotes: loaded.registry.owner_notes,
    referenceExpectations: loaded.registry.history_expectations,
    limitation: 'The current API returns a superseding closure only; it does not return separate method/signature/price states or an as-of timeline. Owner notes are not document evidence.',
  } };
}

export function serializableReport(loaded, inspected) {
  return {
    checked_at: new Date().toISOString(), sourceMode: loaded.sourceMode,
    scope: 'Real current pure functions on saved findings and source text. No model, OCR, scan route, network or database client. This is not a replay of the original model response or the entire live API.',
    cases: inspected.cases.map(({ grounded, work, baseline, ...result }) => ({ ...result,
      workDocument: { id: work.id, title: work.title },
      baselineDocument: baseline ? { id: baseline.id, title: baseline.title } : null,
      evidence: { workQuote: grounded.work_quote, baselineQuote: grounded.contract_quote ?? null },
      expectedResultReached: (result.expected.accepted === null || result.quality.accepted === result.expected.accepted)
        && (result.expected.evidenceStatus === null || result.quality.evidenceStatus === result.expected.evidenceStatus),
    })),
    history: inspected.history,
    production_sha256: productionHashes(), networkAttempts: [...networkAttempts],
    limitations: ['Source excerpts alone do not prove full reading coverage.',
      'No historical refusal/signature date is inferred from blank fields.',
      'Synthetic variants in the test suite are not findings about this project.'],
  };
}
