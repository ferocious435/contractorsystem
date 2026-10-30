import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { pricingDatabase, sourceTables } from './fixtures/pricing-scope-database.mjs';

const modelUrl = 'data:text/javascript,' + encodeURIComponent(`
  export let calls=0, externalCalls=0;
  let options={};
  export function reset(next={}) { options=next; calls=0; externalCalls=0; }
  export function getComparisonAiIdentity() { if(options.external)throw Object.assign(Error('Unverified execution'),{status:503});return {kind:'codex',provider:'Codex',model:'fixture'}; }
  export const ENGINEERING_STRATEGY_PROMPT='Only source-backed advice';
  export async function generateComparisonText(prompt) {
    calls++; if(options.unavailable)throw new Error('Local offline');
    if(prompt.startsWith('PRICING_SCOPE_MATERIAL'))return JSON.stringify({verdict:options.reject?'MISMATCH':'MATCH'});
    if(prompt.startsWith('PRICING_SCOPE_PERMISSION'))return JSON.stringify({verdict:'MATCH',evidence:[prompt.match(/\\[CONTRACT SOURCE[^\\n]*\\]\\n\\[(Q\\d+)\\]/)?.[1]].filter(Boolean)});
    if(prompt.startsWith('Explain only'))return JSON.stringify({technical_foundation:'לפי מקורות העבודה והמחיר',professional_argument:'לבדוק את ההפרש המתועד',site_diary_instruction:'לתעד כמות בפועל',...(options.expertExtra?{suggested_unit_price_excl_vat:999999}:{})});
    if(prompt.startsWith('PRICING_SCOPE_WORK_PROFILE'))return JSON.stringify({operations:(options.partial?['אספקה','התקנה']:['אספקה ופיזור']).map(operation_quote=>({operation_quote})),quantity:options.noQuantity?null:2,unit:'מ"ק'});
    if(prompt.startsWith('PRICING_SCOPE_PRICE_COVERAGE'))return JSON.stringify({required_material_quote:'חומר מילוי מסוג C',priced_material_quote:'חומר מילוי מסוג C',
      reason:options.reject?'החומר שונה':'לפי תיאור המחיר',material:options.reject?'MISMATCH':'MATCH',work:'MATCH',method:'MATCH',unit:'MATCH',conditions:'MATCH',
      coverage:options.unknownCandidate?{op1:'UNKNOWN'}:options.partial?{op1:'INCLUDED',op2:'EXCLUDED'}:{op1:'INCLUDED'},coefficients:[]});
    const match=prompt.match(/^PRICING_CONTEXT (\\{.*\\})$/m);
    if(!match)return JSON.stringify({impact_summary:'נדרשת בדיקת התאמה',recommended_action:'לבדוק את מקורות העבודה',reference_ids:[],price_item_ids:['P1']});
    const input=JSON.parse(match[1]);
    const work=input.sources.find(s=>input.workSourceIds.includes(s.id));
    const w=work?.quotes[0];
    if(input.stage==='work_profile')return JSON.stringify({operations:(options.partial?['אספקה','התקנה']:['אספקה ופיזור']).map(operation_quote=>({operation_quote})),quantity:options.noQuantity?null:2,unit:'מ"ק'});
    if(input.stage==='price_coverage')return JSON.stringify({required_material_quote:w?.text||'',priced_material_quote:input.sources.find(s=>s.id===input.priceSourceId)?.quotes[0]?.text||'',
      reason:options.reject?'החומר שונה':'לפי תיאור המחיר',material:options.reject?'MISMATCH':'MATCH',work:'MATCH',method:'MATCH',unit:'MATCH',conditions:'MATCH',
      coverage:Object.fromEntries(input.requestedOperations.map((op,i)=>[op.id,options.unknownCandidate?'UNKNOWN':options.partial&&i===1?'EXCLUDED':'INCLUDED'])),coefficients:[]});
    if(input.priceSourceId) {
      const p=input.sources.find(s=>s.id===input.priceSourceId)?.quotes[0];
      return JSON.stringify({required_spec_quote:w?.text||'',priced_spec_quote:p?.text||'',compatible:options.reject?'NO':'YES',
        dimension:'material',reason:options.reject?'החומר שונה':'החומר תואם',evidence:[w?.citationId,p?.citationId]});
    }
    const candidate=input.candidates[0];
    const p=input.sources.find(s=>s.id===candidate?.sourceId)?.quotes[0];
    const requirementIds=options.partial?['supply','installation']:['fill'];
    const covered=options.partial?['supply']:['fill'];
    const candidateId=options.unknownCandidate?'not-a-fetched-item':candidate.id;
    return JSON.stringify({requirements:requirementIds.map(id=>({id,description:id==='installation'?'התקנה':'אספקה ופיזור',role:'INSTRUCTION',evidence:[w.citationId]})),
      positions:[{candidateId,status:options.partial?'PARTIAL':'FULL',requirementIds:covered,reason:'לפי תיאור הסעיף והעבודה',
        dimensions:{work:'MATCH',material:'MATCH',method:'MATCH',unit:'MATCH',conditions:'MATCH'},evidence:[w.citationId,p.citationId]}],
      lines:[{candidateId,requirementIds:covered,quantity:{value:options.noQuantity?null:2,basis:options.noQuantity?'UNKNOWN':'SOURCE',evidence:options.noQuantity?[]:[w.citationId]},coefficients:[]}]});
  }
`);
const model = await import(modelUrl);
const hook = registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith(new URL('../src/', import.meta.url).href) && url.endsWith('.ts')) return {
    format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: url,
    }).outputText,
  };
  return nextLoad(url, context);
}, resolve(specifier, context, nextResolve) {
  if (specifier === '@/server/ai/comparison.server') return { url: modelUrl, shortCircuit: true };
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}${specifier.endsWith('.json')?'':'.ts'}`, import.meta.url).href, context);
  try { return nextResolve(specifier, context); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/u.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { AiEstimatorService } = await import('../src/app/api/pricing/evaluate-ai/ai-estimator-service.ts');
const { enrichProjectFindingsWithSupportSources } = await import('../src/utils/support-source-enrichment-server.ts');
const { normalizePricingEvaluation, DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS } = await import('../src/app/api/pricing/evaluate-ai/evaluation-normalizers.ts');
hook.deregister();
const execution={projectId:'30000000-0000-4000-8000-000000000003',signal:new AbortController().signal,checkActive:async()=>{}};
const evaluate = db => new AiEstimatorService(db).evaluate({execution,  contradictionId: 'finding', projectId: 'p', contractorId: 'owner' });

for (const reject of [true, false]) test(`both consumers ${reject ? 'reject the wrong material' : 'accept a supported matching item'} through the common checker`, async () => {
  model.reset({ reject });
  const db = pricingDatabase(sourceTables(), { allowWrites: true });
  const result = await evaluate(db);
  assert.equal(result.scope_review.status, reject ? 'REJECTED' : 'FULL');
  assert.equal(result.suggested_unit_price_excl_vat, reject ? null : 75);
  assert.equal(result.suggested_quantity, reject ? null : 2);
  assert.equal(result.total_excl_vat, reject ? null : 150);
  assert.equal(result.requires_user_answer_before_approval, reject);
  assert.ok(result.scope_review.positions[0].evidence.some(anchor => anchor.documentId === 'contract'
    && anchor.quote.includes('מחירון דקל')), 'The contract mechanism shown to the local reviewer must remain visible as source evidence');
  assert.equal(db.writes.filter(write => write.table !== 'contradictions').length, 0);
  const enriched = pricingDatabase(sourceTables(), { allowWrites: true });
  await enrichProjectFindingsWithSupportSources({execution,  supabase: enriched, projectId: 'p' });
  const support = enriched.tables.contradictions[0].evidence_data.support_analysis;
  assert.equal(support.scope_review.status, reject ? 'REJECTED' : 'FULL');
  assert.equal(support.price_evidence.length, reject ? 0 : 1);
  if (!reject) assert.equal(support.price_evidence[0].pricelist_id, 'dekel');
  assert.equal(model.externalCalls, 0);
});

test('partial coverage remains visible and cannot be presented as a complete automatic sum', async () => {
  model.reset({ partial: true });
  const tables=sourceTables();
  tables.documents[0].extracted_text='יש לבצע אספקה והתקנה של 2 מ"ק חומר מילוי מסוג C.';
  tables.contradictions[0].evidence_data.work_quote=tables.documents[0].extracted_text;
  const result = await evaluate(pricingDatabase(tables, { allowWrites: true }));
  assert.equal(result.scope_review.status, 'PARTIAL');
  assert.deepEqual(result.scope_review.uncoveredRequirementIds, ['op2']);
  assert.equal(result.scope_review.requirements.find(row => row.id === 'op2').description, 'התקנה');
  assert.equal(result.total_excl_vat, null); assert.equal(result.requires_user_answer_before_approval, true);
});

test('unverified coverage cannot use an unrelated available price as confirmation', async () => {
  model.reset({ unknownCandidate: true });
  const result = await evaluate(pricingDatabase(sourceTables(), { allowWrites: true }));
  assert.equal(result.match_found, false); assert.equal(result.suggested_unit_price_excl_vat, null);
  assert.equal(result.total_excl_vat, null); assert.equal(result.requires_user_answer_before_approval, true);
});

test('a technical exclusion is rejected before model use or financial writes', async () => {
  model.reset(); const tables = sourceTables(); tables.contradictions[0].evidence_data.review_disposition = { type: 'INVALID_AUTOMATIC_FINDING' };
  const db = pricingDatabase(tables, { allowWrites: true });
  await assert.rejects(evaluate(db), error => error.status === 409);
  await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
  assert.equal(model.calls, 0); assert.equal(model.externalCalls, 0); assert.equal(db.writes.length, 0);
});

test('an unchanged complete support cache does not trigger the new model logic', async () => {
  model.reset(); const db = pricingDatabase(sourceTables(), { allowWrites: true });
  await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
  model.reset(); db.writes.length = 0;
  const result = await enrichProjectFindingsWithSupportSources({execution,  supabase: db, projectId: 'p' });
  assert.equal(result.skipped, 1); assert.equal(model.calls, 0); assert.equal(db.writes.length, 0);
});

test('an unchanged checked estimate is returned without a model call or another write', async () => {
  model.reset(); const db = pricingDatabase(sourceTables(), { allowWrites: true });
  const first = await evaluate(db);
  assert.equal(first.total_excl_vat, 150);
  model.reset(); db.writes.length = 0;
  const cached = await evaluate(db);
  assert.equal(cached.total_excl_vat, 150);
  assert.equal(model.calls, 0); assert.equal(db.writes.length, 0);
});

test('the calculator reuses the radar scope without repeating local inference', async () => {
  model.reset(); const db=pricingDatabase(sourceTables(),{allowWrites:true});
  await enrichProjectFindingsWithSupportSources({execution, supabase:db,projectId:'p'});
  const scope=db.tables.contradictions[0].evidence_data.support_analysis.scope_review;
  model.reset(); db.writes.length=0;
  const result=await evaluate(db);
  assert.deepEqual(result.scope_review,scope); assert.equal(result.total_excl_vat,150); assert.equal(model.calls,0);
});

test('the radar reuses an unchanged calculator scope', async () => {
  model.reset(); const db=pricingDatabase(sourceTables(),{allowWrites:true});
  const estimate=await evaluate(db);
  model.reset();
  await enrichProjectFindingsWithSupportSources({execution, supabase:db,projectId:'p'});
  const support=db.tables.contradictions[0].evidence_data.support_analysis;
  assert.deepEqual(support.scope_review,estimate.scope_review);
  assert.equal(model.calls,0,'No second price selection or free-form explanation is needed for an already checked price');
});

test('an error preserves the last complete support result in one limitation write', async () => {
  model.reset(); const db=pricingDatabase(sourceTables(),{allowWrites:true});
  await enrichProjectFindingsWithSupportSources({execution, supabase:db,projectId:'p'});
  const last=structuredClone(db.tables.contradictions[0].evidence_data.support_analysis);
  db.tables.pricelists[0].content_hash='updated-book'; db.tables.pricelist_items[0].rate=90; db.writes.length=0;
  model.reset({unavailable:true});
  await enrichProjectFindingsWithSupportSources({execution, supabase:db,projectId:'p'});
  const support=db.tables.contradictions[0].evidence_data.support_analysis;
  assert.deepEqual(support.last_complete,last); assert.deepEqual(support.price_evidence,[]);
  assert.equal(db.writes.length,1);
});

test('an optional local explanation reuses the checked scope and cannot replace its money', async () => {
  model.reset(); const db = pricingDatabase(sourceTables(), { allowWrites: true });
  await evaluate(db); model.reset();
  const result = await new AiEstimatorService(db).evaluate({execution,  projectId: 'p', contradictionId: 'finding', contractorId: 'owner', expertMode: true });
  assert.equal(result.suggested_unit_price_excl_vat, 75); assert.equal(result.total_excl_vat, 150);
  assert.ok(result.expert_strategy.technical_foundation); assert.ok(result.expert_strategy.site_diary_instruction);
  assert.equal(model.calls, 1); assert.equal(model.externalCalls, 0);
});

test('an explanation that adds a financial field is rejected while the checked price remains intact',async()=>{
  model.reset();const db=pricingDatabase(sourceTables(),{allowWrites:true});await evaluate(db);
  const before=structuredClone(db.tables.contradictions[0].evidence_data);model.reset({expertExtra:true});
  await assert.rejects(new AiEstimatorService(db).evaluate({execution,projectId:'p',contradictionId:'finding',contractorId:'owner',expertMode:true}),error=>error.status===503);
  assert.deepEqual(db.tables.contradictions[0].evidence_data,before);assert.equal(before.pricing_evaluation.suggested_unit_price_excl_vat,75);assert.equal(before.pricing_evaluation.total_excl_vat,150);assert.equal(model.calls,1);
});

for (const failure of ['external', 'unavailable']) test(`${failure} local inference never falls back or saves a ready result`, async () => {
  model.reset({ [failure]: true });
  const db = pricingDatabase(sourceTables(), { allowWrites: true });
  await assert.rejects(evaluate(db), error => error.status === 503);
  if(failure==='external')await assert.rejects(enrichProjectFindingsWithSupportSources({execution,supabase:db,projectId:'p'}),error=>error.status===503);
  else await enrichProjectFindingsWithSupportSources({execution,supabase:db,projectId:'p'});
  assert.notEqual(db.tables.contradictions[0].evidence_data.support_analysis?.status, 'COMPLETE');
  assert.equal(model.externalCalls, 0); assert.equal(db.writes.filter(write => write.table !== 'contradictions').length, 0);
});

test('normalization cannot manufacture price or quantity when no verified scope result exists', () => {
  const result = normalizePricingEvaluation({ suggested_unit_price_excl_vat: 123.45, suggested_quantity: null, suggested_unit: 'ls' },
    { hasSourceMatches: false, textFallbacks: DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS });
  assert.equal(result.suggested_unit_price_excl_vat, null); assert.equal(result.suggested_quantity, null);
  assert.equal(result.requires_user_answer_before_approval, true);
});

test('legacy row formatting cannot insert a quantity of one or infer a missing price row', async () => {
  const { normalizePositiveQuantity, normalizePricingBreakdown } = await import('../src/app/api/pricing/evaluate-ai/evaluation-normalizers.ts');
  assert.equal(normalizePositiveQuantity(undefined), null);
  assert.deepEqual(normalizePricingBreakdown([], { suggested_unit_price_excl_vat: 123.45 }), []);
  const rows = normalizePricingBreakdown([{ description: 'known source price', unit_price_excl_vat: 75, quantity: null }], {});
  assert.equal(rows[0].quantity, null); assert.equal(rows[0].amount_excl_vat, null);
});
