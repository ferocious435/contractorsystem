import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import './radar-point-1-3-harness.mjs';
const hook = registerHooks({ resolve(specifier,context,nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href : specifier,context);
} });
const { planSavedFindingReview } = await import('../src/utils/radar-saved-finding-review.ts');
const { isProjectContractBaseDocument, isReferenceDocument } = await import('../src/utils/contract-document-hierarchy.ts');
const { getRadarFindingKind } = await import('../src/components/features/contradiction-radar/utils/findingClassification.ts');
const { getEvidenceDisplayStatus } = await import('../src/utils/radar-evidence-status.ts');
hook.deregister();
if(!process.argv[2] || !process.argv[3]) throw new Error('Usage: node --experimental-strip-types scripts/audit-radar-saved-review.mjs <scoped-snapshot.json> <private-report.json>');
const root=fileURLToPath(new URL('../',import.meta.url)), auditRoot=path.join(root,'data','point1-audit');
const output=path.resolve(process.argv[3]), relative=path.relative(auditRoot,output);
if(!relative || relative.startsWith('..') || path.isAbsolute(relative))throw new Error('Save reports only inside data/point1-audit');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
const documents=input.documents.map(d=>({...d,extracted_text:d.extracted_text??'',
  parsed_json:{...d.parsed_json,...(d.source_reading?{source_reading:d.source_reading}:{})}}));
const contractDocuments=input.contractDocuments || documents.filter(d=>isProjectContractBaseDocument(d)&&!isReferenceDocument(d));
const plans=input.findings.map(finding=>planSavedFindingReview({finding,documents,contractDocuments}));
const cases=plans.map((plan,i)=>{const before=input.findings[i],after={...before,...plan.patch};return {
  ...plan,before:{category:before.category,status:before.status,display:getEvidenceDisplayStatus(before.evidence_data),kind:getRadarFindingKind(before)},
  after:{category:after.category,status:after.status,display:getEvidenceDisplayStatus(after.evidence_data),kind:getRadarFindingKind(after)},
  changedFields:Object.keys(plan.patch).filter(k=>!isDeepStrictEqual(before[k],plan.patch[k])),
  financialLinks:(input.financialLinks||[]).filter(link=>link.findingId===before.id||link.findingId===plan.canonicalId),
};});
const result={checkedAt:new Date().toISOString(),scope:'Explicit saved records; actual product functions; no model, OCR, database mutation or general archive review.',
  sourceHashes:documents.map(d=>({id:d.id,sha256:crypto.createHash('sha256').update(d.extracted_text).digest('hex')})),cases,
  financialLinks:input.financialLinks||[],modelCalls:0};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({report:output,checked:cases.length,confirmed:cases.filter(c=>c.outcome==='CONFIRMED').length,
  requiresReview:cases.filter(c=>c.outcome==='REQUIRES_REVIEW').length,technical:cases.filter(c=>c.outcome==='TECHNICAL_EXCLUSION').length,
  changedRecords:cases.filter(c=>c.changedFields.length).length,modelCalls:0},null,2));
