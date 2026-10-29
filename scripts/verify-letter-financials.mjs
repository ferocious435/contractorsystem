import './redesign/load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/letter-financial-cases.json',import.meta.url),'utf8'));
const api=await import('../src/utils/letter-financials.ts').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const prepare=rows=>{
  assert.equal(typeof api.prepareLetterFinancialSnapshot,'function','Shared letter snapshot is not implemented');
  return api.prepareLetterFinancialSnapshot(rows);
};
function row(id='one',patch={}) {
  const item={id,type:'PENDING_VO',quantity:1,unit_price_excl_vat:.03,vat_rate:.18,...patch};
  if(!Object.hasOwn(patch,'evidence_data'))item.evidence_data={individual_pricing_terms:{
    version:'individual-pricing-v1',basis:'MANUAL',includes_adjustments:true,
    quantity:item.quantity,unit_price_excl_vat:item.unit_price_excl_vat,vat_rate:item.vat_rate,
    note:'כל התנאים כלולים במחיר השמור',
  }};
  return item;
}

// Catches applying VAT to the aggregated net instead of summing rounded individual prices.
test('three ready .03 rows preserve the .12 total in their frozen snapshot',()=>{
  const result=prepare([row('a'),row('b'),row('c')]);
  assert.equal(result.ok,true);
  assert.equal(result.snapshot.calculationVersion,'letter-individual-v1');
  assert.deepEqual(result.snapshot.totals,{net:.09,vat:.03,gross:.12});
  assert.deepEqual(result.snapshot.items.map(item=>item.ledgerItemId),['a','b','c']);
  assert.deepEqual(result.snapshot.items[0],{ledgerItemId:'a',quantity:1,unitPriceExclVat:.03,
    net:.03,vatRate:.18,vat:.01,gross:.04,conditionBasis:'manual',conditionNote:'כל התנאים כלולים במחיר השמור'});
});
for(const item of fixture.cases)test('shared monetary boundary: '+item.id,()=>{
  const result=prepare([row(item.id,{quantity:item.quantity,unit_price_excl_vat:item.unitPrice,vat_rate:item.vatRate})]);
  assert.equal(result.ok,true);
  assert.deepEqual(result.snapshot.totals,item.expected);
  for(const key of ['net','vat','gross'])assert.equal(Object.is(result.snapshot.totals[key],-0),false);
});
test('confirmed free work is distinct from an unknown price',()=>{
  assert.equal(prepare([row('zero',{unit_price_excl_vat:0,evidence_data:{zero_value_reason:'אין תוספת לפי אישור'}})]).snapshot.totals.gross,0);
  for(const patch of [{unit_price_excl_vat:null},{unit_price_excl_vat:''},{quantity:null},{vat_rate:null},
    {vat_rate:18},{evidence_data:null},{total_price_excl_vat:1},{unit_price_excl_vat:Infinity}]) {
    const result=prepare([row('bad',patch)]);
    assert.equal(result.ok,false,JSON.stringify(patch));
    assert.ok(result.issues.some(issue=>issue.itemId==='bad'&&issue.reason));
    assert.equal(result.snapshot,undefined);
  }
});
test('a source requiring review stays blocked after a manual terms confirmation',()=>{
  const item=row('unverified');
  item.evidence_data.pricing_evaluation={requires_user_answer_before_approval:true};
  const result=prepare([item]);
  assert.equal(result.ok,false);
  assert.ok(result.issues.some(issue=>issue.reason==='source-needs-review'));
});
test('same ID is counted once in first-selection order without mutating its input',()=>{
  const rows=[row('second'),row('first',{type:'APPROVED_VO'}),row('second')];
  const before=JSON.stringify(rows), result=prepare(rows);
  assert.equal(result.ok,true);
  assert.deepEqual(result.snapshot.items.map(item=>item.ledgerItemId),['second','first']);
  assert.deepEqual(result.snapshot.totals,{net:.06,vat:.02,gross:.08});
  assert.equal(JSON.stringify(rows),before);
});
test('conflicting copies of an ID fail instead of arbitrarily choosing an amount or source',()=>{
  for(const changed of [row('a',{unit_price_excl_vat:.04}),{...row('a'),evidence_data:{...row('a').evidence_data,document_id:'changed-source'}}]) {
    const result=prepare([row('a'),changed]);
    assert.equal(result.ok,false);
    assert.ok(result.issues.some(issue=>issue.itemId==='a'&&issue.reason==='duplicate-conflict'));
  }
});
test('two alternatives for one contradiction cannot be added together',()=>{
  const result=prepare([row('a',{contradiction_id:'finding'}),row('b',{contradiction_id:'finding'})]);
  assert.equal(result.ok,false);
  assert.deepEqual(result.issues.map(issue=>issue.itemId),['a','b']);
});
test('base, already sent, missing ID and empty selection are not new letter work',()=>{
  for(const rows of [[],[row('a',{type:'BASE_CONTRACT'})],[row('a',{type:'SENT_VO'})],[row(undefined,{id:undefined})]]) {
    assert.equal(prepare(rows).ok,false);
  }
});
test('unsafe cents in a row or in the combined total give an explicit refusal',()=>{
  for(const rows of [[row('unsafe',{unit_price_excl_vat:1e14})],
    [row('a',{unit_price_excl_vat:5e13}),row('b',{unit_price_excl_vat:5e13})],
    [row('overflow',{quantity:1e200,unit_price_excl_vat:1e200})]]) {
    const result=prepare(rows);assert.equal(result.ok,false);assert.ok(result.issues.length>0);
  }
});
test('moving individual calculations preserves the existing UI API identity and behavior',async()=>{
  const shared=await import('../src/utils/individual-pricing.ts');
  const old=await import('../src/components/features/pricing-ledger/utils/individualPricing.ts');
  assert.equal(shared.getIndividualPricing,old.getIndividualPricing);
  assert.equal(shared.summarizeIndividualPricing,old.summarizeIndividualPricing);
  assert.equal(old.summarizeIndividualPricing([row('a'),row('b'),row('c')]).totalInclVat,.12);
});
