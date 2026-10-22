import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';

import {
  buildSupportAnalysisPrompt,
  selectRelevantSupportIds,
  SUPPORT_ANALYSIS_RESPONSE_SCHEMA,
  supportAnalysisTextIsGrounded,
} from '../src/utils/support-source-enrichment.ts';

dotenv.config({ path: '.env.local' });

const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const model = process.env.OLLAMA_MODEL || 'qwen3:4b';
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
const response = await fetch(`${baseUrl}/api/generate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model,
    prompt,
    stream: false,
    format: SUPPORT_ANALYSIS_RESPONSE_SCHEMA,
    think: false,
    keep_alive: '10m',
    options: { temperature: 0, num_ctx: 8192, num_predict: 384, seed: 42 },
  }),
  signal: AbortSignal.timeout(180_000),
});
if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
const payload = await response.json();
const result = JSON.parse(String(payload.response || '{}'));
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
  impactSummary,
  recommendedAction,
}, null, 2));
