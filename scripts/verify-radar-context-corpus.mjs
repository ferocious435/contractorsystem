import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { loadInput, networkAttempts } from './radar-point-1-3-harness.mjs';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/')
    ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const chunks = await import('../src/utils/document-scan-chunks.ts');
const hierarchy = await import('../src/utils/contract-document-hierarchy.ts');
const { normalizeEvidenceSource } = await import('../src/utils/radar-evidence-assessment.ts');
hook.deregister();
const savedTest = process.env.RADAR_POINT13_SNAPSHOT ? test : test.skip;
const loaded = loadInput(process.env.RADAR_POINT13_SNAPSHOT);
const before = structuredClone(loaded.documents);
// Match the route's explicit upload-role boundary. An execution appendix whose
// title mentions an agreement remains work evidence, rather than its own baseline.
const workRoles = new Set(['EXECUTION', 'SITE_REPORT', 'PROTOCOL', 'INVOICE', 'CHANGE_ORDER', 'PHOTO', 'VIDEO', 'LETTER']);
const contractDocuments = hierarchy.sortContractDocumentsByPrecedence(loaded.documents.filter(document =>
  !workRoles.has(String(document.category || '').toUpperCase()) && hierarchy.isProjectContractBaseDocument(document)
  && !hierarchy.isReferenceDocument(document) && chunks.hasUsefulDocumentScanText(document)));

function select(key, requireMatch = true) {
  const scenario = loaded.registry.cases.find(row => row.key === key);
  const row = loaded.findings.find(row => row.id === scenario.id);
  const work = loaded.documentById.get(row.source_execution_doc_id);
  const workChunk = chunks.buildDocumentScanChunks([work], 7000, 400).find(chunk =>
    normalizeEvidenceSource(chunk.text).includes(normalizeEvidenceSource(row.evidence_data.work_quote)));
  assert.ok(workChunk, 'The actual saved quote must occur in a normal product work chunk');
  const selected = chunks.selectRelevantContractChunks(chunks.buildDocumentScanChunks(contractDocuments, 2500, 400),
    workChunk.text, 2500, 1);
  if (requireMatch) assert.ok(selected.length > 0);
  const normalized = chunks.normalizeDocumentTextForScan(selected.map(chunk => chunk.text).join('\n'));
  return { selected, normalized };
}

savedTest('FULL SAVED CORPUS: schedule context contains the initial schedule and monthly update clauses', () => {
  const { normalized } = select('schedule_update');
  assert.match(normalized, /4\.7\s/);
  assert.match(normalized, /4\.8\s/);
  assert.ok(normalized.includes('לוח זמנים מעודכן'));
});

savedTest('FULL SAVED CORPUS: fill context distinguishes the material from CLSM measurement/payment', () => {
  const { normalized } = select('dekel_clsm');
  assert.match(normalized, /חול|מצע|עטיפ/);
  assert.ok(normalized.includes('CLSM'));
  assert.match(normalized, /יחידת המידה|אופני מדידה|התשלום/);
});

savedTest('FULL SAVED CORPUS: inert fill approval retrieves that material rather than general equipment approval', () => {
  assert.ok(select('inert_approval').normalized.includes('אינרטי'));
});

savedTest('FULL SAVED CORPUS: source coordinates and context limits remain truthful for all eight cards', () => {
  for (const scenario of loaded.registry.cases) {
    const { selected } = select(scenario.key, false);
    assert.ok(selected.reduce((sum, chunk) => sum + chunk.text.length, 0) <= 2500);
    for (const chunk of selected) for (const anchor of chunk.context_selection.source_anchors) {
      assert.equal(loaded.documentById.get(anchor.documentId).extracted_text.slice(anchor.start, anchor.end), anchor.quote);
    }
  }
});

after(() => {
  assert.deepEqual(loaded.documents, before, 'Full saved source texts must remain unchanged');
  assert.deepEqual(networkAttempts, [], 'No model, network or database call is permitted');
});
