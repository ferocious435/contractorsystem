import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pricingFixture} from './fixtures/pricing-scope-fixtures.mjs';
const modelUrl='data:text/javascript,'+encodeURIComponent(`
export const calls=[];let profile={operations:[{operation_quote:'אספקה'},{operation_quote:'פיזור'}],unit:'מ"ק'};
let price={work:'MATCH',material:'MATCH',method:'NOT_APPLICABLE',unit:'MATCH',conditions:'NOT_APPLICABLE',coverage:{op1:'INCLUDED',op2:'INCLUDED'},coefficients:[],pricing:'MATCH',pricingEvidence:['Q3']};
export function configure(next={}){calls.length=0;profile=next.profile||{operations:[{operation_quote:'אספקה'},{operation_quote:'פיזור'}],unit:'מ"ק'};price=next.price||{work:'MATCH',material:'MATCH',method:'NOT_APPLICABLE',unit:'MATCH',conditions:'NOT_APPLICABLE',coverage:{op1:'INCLUDED',op2:'INCLUDED'},coefficients:[],pricing:'MATCH',pricingEvidence:['Q3']};}
export function getComparisonAiIdentity(){return {kind:'ollama',provider:'Local AI',model:'test-io'}}
export async function generateComparisonText(prompt){calls.push(prompt);return JSON.stringify(prompt.startsWith('PRICING_SCOPE_WORK_PROFILE')?profile:prompt.startsWith('PRICING_SCOPE_MATERIAL')?{verdict:price.material}:prompt.startsWith('PRICING_SCOPE_PERMISSION')?{verdict:price.pricing,evidence:price.pricingEvidence}:price);}
`);
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='@/lib/comparison-ai')return{url:modelUrl,shortCircuit:true};if(specifier.startsWith('@/'))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);try{return next(specifier,context)}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[cm]?[jt]sx?$/u.test(specifier))return next(`${specifier}.ts`,context);throw error}}});
const {validatePricingScope}=await import('../src/utils/pricing-scope-review.ts');
const {reviewPricingScope}=await import('../src/utils/pricing-scope-review-server.ts');
const model=await import(modelUrl);hook.deregister();

test('a rate that is absent from the cited price and structured source row cannot become a verified total',()=>{
 const fixture=pricingFixture();fixture.context.candidates[0].rate=91;
 const result=validatePricingScope(fixture.context,fixture.draft);
 assert.equal(result.lines[0].unitPriceExclVat.value,null);assert.equal(result.totalExclVat,null);
});

test('an unrelated delivery number cannot replace the measured quantity in the work source',()=>{
 const fixture=pricingFixture();const source=fixture.context.sources[0];source.extracted_text+=' מסמך משלוח מספר 8.';
 fixture.draft.requirements[0].evidence[0].quote=source.extracted_text;fixture.draft.positions[0].evidence[0].quote=source.extracted_text;
 fixture.draft.lines[0].quantity={value:8,basis:'SOURCE',evidence:[{documentId:'work',quote:source.extracted_text}]};
 const result=validatePricingScope(fixture.context,fixture.draft);assert.equal(result.lines[0].quantity.value,null);assert.equal(result.totalExclVat,null);
});

test('a form number is not a documented price multiplier',()=>{
 const fixture=pricingFixture();fixture.context.sources.push({id:'note',title:'Note',role:'PRICE',allowed:true,extracted_text:'ראו טופס מספר 1.2 לצורך תיעוד.'});
 fixture.context.candidates[0].noteSourceIds=['note'];fixture.draft.lines[0].coefficients=[{value:1.2,basis:'SOURCE',evidence:[{documentId:'note',quote:'ראו טופס מספר 1.2 לצורך תיעוד.'}]}];
 const result=validatePricingScope(fixture.context,fixture.draft);assert.equal(result.lines[0].coefficients[0].value,null);assert.equal(result.totalExclVat,null);
});

test('an invented model action does not become a requirement merely by attaching the whole work quote',async()=>{
 model.configure({profile:{operations:[{operation_quote:'התקנת גדר שלא נדרשה'}],unit:'מ"ק'},price:{work:'MATCH',material:'MATCH',method:'NOT_APPLICABLE',unit:'MATCH',conditions:'NOT_APPLICABLE',coverage:{op1:'INCLUDED'},coefficients:[]}});
 const result=await reviewPricingScope(pricingFixture().context);assert.equal(result.requirements.some(r=>r.description.includes('גדר')),false);assert.equal(result.totalExclVat,null);
});

test('matching physical descriptions without an applicable contract pricing basis stay unapproved',async()=>{
 model.configure();const result=await reviewPricingScope(pricingFixture().context);assert.equal(result.requiresReview,true);assert.equal(result.totalExclVat,null);
});

test('a source-confirmed pricing policy allows a genuinely matching positive case',async()=>{
 model.configure();const fixture=pricingFixture();fixture.context.sources.push({id:'contract',title:'תנאי בדיקה',role:'CONTRACT',allowed:true,
 extracted_text:'לצורך בדיקה זו הוסכם לתמחר לפי מחירון בדיקה. המחירים לפי יחידת הסעיף לפני מע"מ, ללא הנחות או מקדמים נוספים.'});
 const result=await reviewPricingScope(fixture.context);assert.equal(result.status,'FULL');assert.equal(result.requiresReview,false);assert.equal(result.totalExclVat,150);
});

test('a model profile cannot forward an invented measurement into the price comparison',async()=>{
 model.configure({profile:{operations:[{operation_quote:'אספקה'},{operation_quote:'פיזור'}],unit:'INVENTED_WORK_MEASUREMENT',quantity:999}});
 await reviewPricingScope(pricingFixture().context);
 assert.equal(model.calls.some(prompt=>prompt.startsWith('PRICING_SCOPE_PRICE_COVERAGE')&&prompt.includes('INVENTED_WORK_MEASUREMENT')),false);
});

test('an action elsewhere in a long source cannot become a requirement for the selected work quote',async()=>{
 model.configure({profile:{operations:[{operation_quote:'התקנת גדר'}],unit:'מ"ק'}});
 const fixture=pricingFixture();fixture.context.workQuote=fixture.context.sources[0].extracted_text;
 fixture.context.sources[0].extracted_text+='\nבנושא נפרד נדרשת התקנת גדר.';
 const result=await reviewPricingScope(fixture.context);assert.equal(result.requirements.some(r=>r.description==='התקנת גדר'),false);assert.equal(result.totalExclVat,null);
});
