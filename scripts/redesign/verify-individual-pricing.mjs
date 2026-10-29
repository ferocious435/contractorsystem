import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {default:PricingLedgerTable,LedgerForm}=await import('../../src/components/pricing/PricingLedgerTable.tsx');
const {LedgerSourceDetails}=await import('../../src/components/features/pricing-ledger/components/LedgerSourceDetails.tsx');
const {default:TotalsSummary}=await import('../../src/components/features/pricing-ledger/components/TotalsSummary.tsx');
const {LedgerWorkspace}=await import('../../src/components/features/pricing-ledger/components/LedgerWorkspace.tsx');
const {default:PricingStatusBar}=await import('../../src/components/pricing/PricingStatusBar.tsx');

const api=await import('../../src/components/features/pricing-ledger/utils/individualPricing.ts').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const get=item=>{assert.equal(typeof api.getIndividualPricing,'function','Individual final pricing is not implemented');return api.getIndividualPricing(item);};
const summary=rows=>{assert.equal(typeof api.summarizeIndividualPricing,'function','Individual total summary is not implemented');return api.summarizeIndividualPricing(rows);};
function row(id='one',overrides={}) {
  const item={id,type:'PENDING_VO',source:'CUSTOM_ANALYSIS',quantity:1,unit_price_excl_vat:900,total_price_excl_vat:900,vat_rate:.18,markup_percentage:0,...overrides};
  if(!Object.hasOwn(overrides,'evidence_data'))item.evidence_data={individual_pricing_terms:{version:'individual-pricing-v1',basis:'MANUAL',includes_adjustments:true,quantity:item.quantity,unit_price_excl_vat:item.unit_price_excl_vat,vat_rate:item.vat_rate,note:'המחיר לאחר הנחה שסוכמה ונכללת במחיר היחידה'}};
  return item;
}

test('a saved price after discount receives VAT once, without discounting it again',()=>{
  const result=get(row());
  assert.equal(result.status,'complete');
  assert.deepEqual([result.totalExclVat,result.vatAmount,result.totalInclVat],[900,162,1062]);
  assert.match(result.conditionNote,/הנחה/u);
});
test('confirming manual terms preserves evidence and never changes a price',()=>{
  const item=row('manual',{evidence_data:{work_quote:'ציטוט מקורי'}}),before=JSON.stringify(item);
  assert.equal(typeof api.confirmIndividualPricingTerms,'function');
  const evidence=api.confirmIndividualPricingTerms(item,'הנחה כבר כלולה במחיר');
  assert.equal(evidence.work_quote,'ציטוט מקורי');
  assert.equal(JSON.stringify(item),before);
  assert.equal(get({...item,evidence_data:evidence}).totalInclVat,1062);
});
test('an evidence array survives explicit manual confirmation',()=>{
  const item=row('array',{evidence_data:[{quote:'מקור קודם',page:2}]});
  assert.equal(typeof api.confirmIndividualPricingTerms,'function');
  const evidence=api.confirmIndividualPricingTerms(item,'מחיר מלא לאחר תנאים');
  assert.deepEqual(evidence.original_evidence_data,[{quote:'מקור קודם',page:2}]);
});
test('a manual confirmation becomes stale when quantity, net price or VAT rate changes',()=>{
  for(const patch of [{quantity:2,total_price_excl_vat:1800},{unit_price_excl_vat:1000,total_price_excl_vat:1000},{vat_rate:.17}]) {
    const result=get({...row(),...patch});
    assert.equal(result.status,'needs-review');
    assert.equal(result.totalInclVat,null);
    assert.ok(result.reasons.includes('conditions-unconfirmed'));
  }
});
test('changing a sub-cent unit rate still invalidates a confirmation when the quantity amplifies it',()=>{
  const item=row('precision-change',{quantity:1000,unit_price_excl_vat:1.001,total_price_excl_vat:1001});
  const changed={...item,unit_price_excl_vat:1.002,total_price_excl_vat:1002};
  assert.equal(get(changed).status,'needs-review');
});
test('manual preview and saved record use the same server unit-price rounding',async()=>{
  assert.equal(typeof api.getIndividualPricingDraft,'function');
  const {normalizeSaveLedgerInput}=await import('../../src/app/api/pricing/save-ledger/ledger-input.ts');
  const input={...row('round-save',{quantity:1000,unit_price_excl_vat:900.001,total_price_excl_vat:undefined,evidence_data:null}),project_id:'synthetic',description:'תמחור סינתטי',unit:'יח'};
  const draft=api.getIndividualPricingDraft(input);
  const evidence=api.confirmIndividualPricingTerms(draft,'כל ההתאמות כלולות');
  const normalized=normalizeSaveLedgerInput({...input,evidence_data:evidence});
  assert.equal(normalized.ok,true);
  assert.equal(get({...draft,evidence_data:evidence}).totalInclVat,1062000);
  assert.equal(get(normalized.value.ledgerMutationPayload).totalInclVat,1062000);
});
test('unconfirmed discounts or terms do not become a ready final price',()=>{
  const result=get(row('terms',{evidence_data:null}));
  assert.equal(result.status,'needs-review');assert.equal(result.totalInclVat,null);
  assert.ok(result.reasons.includes('conditions-unconfirmed'));
});
test('missing quantity, price, or VAT never defaults to one, zero, or the project rate',()=>{
  for(const patch of [{quantity:null},{unit_price_excl_vat:null},{vat_rate:null},{quantity:''},{vat_rate:undefined}]) {
    const result=get(row('unknown',patch));
    assert.equal(result.status,'needs-review');assert.equal(result.totalInclVat,null);
  }
});
test('a confirmed zero surcharge remains zero without reopening its source assessment',()=>{
  const item=row('zero',{unit_price_excl_vat:0,total_price_excl_vat:0,evidence_data:{zero_value_reason:'אין תוספת תשלום לפי המקור השמור'}});
  const result=get(item);
  assert.equal(result.status,'complete');assert.deepEqual([result.totalExclVat,result.vatAmount,result.totalInclVat],[0,0,0]);
});
test('an unexplained zero does not masquerade as a confirmed free job',()=>{
  const result=get(row('zero-unknown',{unit_price_excl_vat:0,total_price_excl_vat:0,evidence_data:null}));
  assert.equal(result.status,'needs-review');assert.equal(result.totalInclVat,null);
});
test('negative credits remain negative and retain the cents',()=>{
  const result=get(row('credit',{unit_price_excl_vat:-5.01,total_price_excl_vat:-5.01}));
  assert.equal(result.status,'complete');assert.deepEqual([result.totalExclVat,result.vatAmount,result.totalInclVat],[-5.01,-.9,-5.91]);
});
test('a percent stored as 18 rather than .18 is not silently treated as a valid tax rate',()=>{
  const result=get(row('bad-vat',{vat_rate:18}));
  assert.equal(result.status,'needs-review');assert.ok(result.reasons.includes('vat-invalid'));
});
test('an explicitly recorded zero tax rate is not replaced by eighteen percent',()=>{
  const result=get(row('zero-vat',{vat_rate:0}));
  assert.equal(result.status,'complete');assert.equal(result.totalInclVat,900);
});
test('a conflicting stored total requires review instead of choosing an unexplained price',()=>{
  const result=get(row('conflict',{total_price_excl_vat:850}));
  assert.equal(result.status,'needs-review');assert.ok(result.reasons.includes('amount-mismatch'));
});
test('a complete saved source approval can provide terms without a new manual confirmation',()=>{
  const item=row('source',{evidence_data:{pricing_approval:{total_excl_vat:900,quantity:1,effective_unit_price_excl_vat:900},pricing_evaluation:{scope_review:{version:'price-scope-v1',status:'FULL',requiresReview:false,issues:[],uncoveredRequirementIds:[],lines:[{coefficients:[]}]},requires_user_answer_before_approval:false}}});
  assert.equal(get(item).totalInclVat,1062);
});
test('a stale saved source approval cannot certify changed financial fields',()=>{
  const item=row('source-stale',{evidence_data:{pricing_approval:{total_excl_vat:700,quantity:1,effective_unit_price_excl_vat:700},pricing_evaluation:{scope_review:{version:'price-scope-v1',status:'FULL',requiresReview:false,issues:[],uncoveredRequirementIds:[],lines:[{coefficients:[]}]}}}});
  assert.equal(get(item).status,'needs-review');
});
test('a source still requiring answers is not certified by a manual price-terms checkbox',()=>{
  const item=row();item.evidence_data.pricing_evaluation={requires_user_answer_before_approval:true};
  assert.equal(get(item).status,'needs-review');
});
test('unresolved source issues and uncovered work are not cleared by a price-terms confirmation',()=>{
  for(const patch of [{issues:['source_unverified'],uncoveredRequirementIds:[]},{issues:[],uncoveredRequirementIds:['work-not-covered']}]) {
    const item=row();item.evidence_data.pricing_evaluation={scope_review:{version:'price-scope-v1',status:'FULL',requiresReview:false,lines:[{coefficients:[]}],...patch}};
    assert.equal(get(item).status,'needs-review');
  }
});
test('overflow from individually finite inputs never becomes a ready monetary total',()=>{
  const result=get(row('overflow',{quantity:1e200,unit_price_excl_vat:1e200,total_price_excl_vat:undefined}));
  assert.equal(result.status,'needs-review');assert.equal(result.totalInclVat,null);
});
test('conflicting representations of the same ID are excluded instead of accepting the first price',()=>{
  const result=summary([row('same-id'),row('same-id',{unit_price_excl_vat:1000,total_price_excl_vat:1000})]);
  assert.equal(result.readyCount,0);assert.equal(result.totalInclVat,null);assert.equal(result.alternativeCount,1);
});
test('statistics sum each rounded gross amount, rather than charging VAT on the combined net',()=>{
  const result=summary(['a','b','c'].map(id=>row(id,{unit_price_excl_vat:.03,total_price_excl_vat:.03})));
  assert.equal(result.readyCount,3);assert.equal(result.totalInclVat,.12);
});
test('pending, approved, and sent totals stay distinct and do not include the contract base',()=>{
  const result=summary([row('p'),row('a',{type:'APPROVED_VO'}),row('s',{type:'SENT_VO'}),row('base',{type:'BASE_CONTRACT',unit_price_excl_vat:999999,total_price_excl_vat:999999})]);
  assert.equal(result.totalInclVat,3186);assert.equal(result.readyCount,3);assert.equal(result.excludedBaseCount,1);
  assert.equal(result.byStatus.pending.totalInclVat,1062);assert.equal(result.byStatus.approved.totalInclVat,1062);assert.equal(result.byStatus.sent.totalInclVat,1062);
});
test('the same saved record repeated twice contributes only once',()=>{
  const item=row();const result=summary([item,{...item}]);
  assert.equal(result.readyCount,1);assert.equal(result.totalInclVat,1062);assert.equal(result.duplicateCount,1);
});
test('two alternatives for the same finding are excluded rather than counted as independent work',()=>{
  const result=summary([row('v1',{contradiction_id:'same'}),row('v2',{contradiction_id:'same'}),row('independent')]);
  assert.equal(result.readyCount,1);assert.equal(result.totalInclVat,1062);assert.equal(result.alternativeCount,2);
});
test('incomplete records are counted as incomplete, not as zero-cost prepared prices',()=>{
  const result=summary([row('known'),row('missing',{quantity:null,total_price_excl_vat:null})]);
  assert.equal(result.readyCount,1);assert.equal(result.incompleteCount,1);assert.equal(result.totalInclVat,1062);
  assert.equal(summary([row('missing',{quantity:null,total_price_excl_vat:null})]).totalInclVat,null);
});
test('formatting retains two decimals and complete large monetary values',()=>{
  assert.equal(typeof api.formatIndividualMoney,'function');
  const formatted=api.formatIndividualMoney(148620450.75).replace(/[\u200e\u200f\u061c\u00a0]/g,'');
  assert.match(formatted,/148,620,450\.75/u);assert.equal(api.formatIndividualMoney(null),'—');
});

const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const tableProps={isLoading:false,isAddingNew:false,isEditing:null,newItemForm:{},setNewItemForm:()=>{},editForm:{},setEditForm:()=>{},selectedLedgerIds:[],toggleSelectItem:()=>{},toggleSelectAll:()=>{},handleAddNew:()=>{},setIsAddingNew:()=>{},handleSaveEdit:()=>{},handleCancelEdit:()=>{},approveVO:()=>{},handleEditClick:()=>{},handleDelete:()=>{},formatCurrency:value=>String(value)};
test('the list shows the full gross amount rather than labeling a net amount as final',()=>{
  const html=render(PricingLedgerTable,{...tableProps,ledgerItems:[row()]});
  assert.ok(html.includes('סה״כ כולל מע״מ'));
  assert.ok(html.includes('1,062.00'));
});
test('opening saved source details presents the same final amount and its net and VAT breakdown',()=>{
  let writes=0;
  const html=render(LedgerSourceDetails,{item:{...row(),item_code:'PRICE-1',description:'תמחור שמור',unit:'קומפ'},onOpenSource:()=>writes++});
  for(const literal of ['1,062.00','900.00','162.00','המחיר לאחר הנחה'])assert.ok(html.includes(literal),literal);
  assert.equal(writes,0);
});
test('unconfirmed terms are explained visibly in the list instead of displaying a false final',()=>{
  const html=render(PricingLedgerTable,{...tableProps,ledgerItems:[row('incomplete',{evidence_data:null})]});
  assert.ok(!html.includes('1,062.00'));
  assert.ok(html.includes('נדרשת השלמה'));
});
test('manual entry explains adjustments already included in price and exposes an explicit confirmation',()=>{
  let changes=0;
  const html=render(LedgerForm,{form:row('manual-form',{evidence_data:null}),setForm:()=>changes++,onSave:()=>changes++,onCancel:()=>{},formatCurrency:value=>String(value),pending:false});
  assert.ok(html.includes('לאחר הנחות ותוספות'));
  assert.ok(html.includes('המחיר כולל את כל ההנחות והתוספות החלות'));
  assert.equal(changes,0);
});
test('the separate summary exposes prepared gross totals and keeps sent distinct from approved',()=>{
  const data=summary([row('p'),row('a',{type:'APPROVED_VO',unit_price_excl_vat:100,total_price_excl_vat:100}),row('s',{type:'SENT_VO',unit_price_excl_vat:50,total_price_excl_vat:50})]);
  const html=render(TotalsSummary,{summary:data});
  for(const literal of ['1,239.00','1,062.00','118.00','59.00','נשלחו'])assert.ok(html.includes(literal),literal);
});
test('the workspace keeps shared financial amounts out of the list until the summary is opened',()=>{
  const items=[{...row(),item_code:'PRICE-1',description:'תמחור שמור',unit:'קומפ'}];
  const props={state:{activeTab:'ledger',pendingQueue:[],selectedLedgerIds:[],selectedQueueIds:[],scanningItems:[],isAddingNew:false,isEditing:null,newItemForm:{},editForm:{},loading:false,isSyncing:false,error:null},totals:{totalBaseExclVat:999999,totalVOExclVat:900,grandTotalExclVat:1000899,grandTotalVat:180161.82,grandTotalInclVat:1181060.82},derived:{visibleLedgerRows:items,selectedVOIds:[],queueConfidencePercentById:new Map(),queueConfidenceStats:{averageScore:null,totalWithConfidence:0,highConfidenceCount:0},selectedHighConfidenceQueueIds:[]},setters:{setActiveTab:()=>{},setSelectedLedgerIds:()=>{},setIsAddingNew:()=>{},setNewItemForm:()=>{},setEditForm:()=>{},setIsGeneratingLetter:()=>{}},actions:{}};
  const html=render(LedgerWorkspace,props);
  assert.ok(html.includes('סיכום התמחורים'));
  assert.ok(!html.includes('999,999'));
  assert.ok(!html.includes('1,181,060'));
});
test('the shared status footer no longer claims that all visible prices exclude VAT',()=>{
  const html=render(PricingStatusBar,{projectId:'synthetic-pricing'});
  assert.ok(html.includes('חיבור העוזר'));
  assert.ok(!html.includes('סכומי הטבלה ללא'));
});
