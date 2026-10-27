import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';

import {
  buildSupportAnalysisPrompt,
  selectRelevantSupportIds,
  SUPPORT_ANALYSIS_RESPONSE_SCHEMA,
  supportAnalysisTextIsGrounded,
  checkedSupportSummary,
} from '../src/utils/support-source-enrichment.ts';

dotenv.config({ path: '.env.local' });

const adapterHook=registerHooks({resolve(specifier,context,next){return next(specifier.startsWith('@/')?new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href:specifier,context);}});
const {generateComparisonText,getComparisonAiIdentity}=await import('../src/lib/comparison-ai.ts');
adapterHook.deregister();
const identity=getComparisonAiIdentity();
assert.equal(identity.kind,'ollama','Acceptance must use the existing configured local product adapter');
const model=identity.model;
const referenceCandidates = [{
  id: 'reference-3210',
  title: 'חוזה מדף 3210',
  sourceType: 'SHELF_CONTRACT_3210',
  text: 'תקופת הבדק לעבודות ולאביזרים היא 12 חודשים ממועד מסירת העבודה.',
  applicability: 'CONFIRMED',
}];
const priceCandidates = [{
  id: 'dekel-unrelated',
  title: 'מחירון דקל',
  itemCode: '01.02.03',
  text: 'אספקת חול מצומנט למילוי תעלות',
  unit: 'מ״ק',
  rate: 250,
}];
const prompt = buildSupportAnalysisPrompt({
  title: 'דרישה לאחריות של 15 שנים',
  category: 'סתירה',
  contractQuote: 'תקופת הבדק היא 12 חודשים ממועד המסירה.',
  workQuote: 'המפקח דורש אחריות של 15 שנים על אביזרי FOX.',
  referenceCandidates,
  priceCandidates,
});
const startedAt = performance.now();
const response = await generateComparisonText(prompt,process.env,{responseFormat:SUPPORT_ANALYSIS_RESPONSE_SCHEMA,
  temperature:0,numCtx:8192,numPredict:384,seed:42,timeoutMs:180_000});
const result = JSON.parse(response);
const issueQuery = 'דרישה לאחריות של 15 שנים\nתקופת הבדק היא 12 חודשים ממועד המסירה.\nהמפקח דורש אחריות של 15 שנים על אביזרי FOX.';
const selectedReferences = selectRelevantSupportIds({
  value: result.reference_ids,
  prefix: 'R',
  candidates: referenceCandidates,
  query: issueQuery,
});
const selectedPrices = selectRelevantSupportIds({
  value: result.price_item_ids,
  prefix: 'P',
  candidates: priceCandidates,
  query: issueQuery,
});
const impactSummary = String(result.impact_summary || '');
const recommendedAction = String(result.recommended_action || '');
const grounded = supportAnalysisTextIsGrounded({
  impactSummary,
  recommendedAction,
  suppliedSourceText: `${prompt}\n250`,
  selectedReferences: selectedReferences.map((id) => referenceCandidates[Number(id.slice(1)) - 1]),
});

assert.equal(selectedReferences.includes('R1'), true, 'the directly relevant confirmed 3210 excerpt must be selected');
assert.equal(selectedPrices.length, 0, 'the unrelated price item must not be selected');
assert.equal(grounded, true, 'the explanation must not invent numbers or binding sources');

console.log(JSON.stringify({
  passed: true,
  model,
  durationSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(1)),
  selectedReferences,
  selectedPrices,
  modelDraft: {impactSummary,recommendedAction},
  published: checkedSupportSummary(null,selectedReferences.length),
}, null, 2));
