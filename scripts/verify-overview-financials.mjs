import './redesign/load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLetterFinancialSnapshot} from '../src/utils/letter-financials.ts';

const api=await import('../src/utils/overview-financials.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const summary=(rows,budget)=>{assert.equal(typeof api.getOverviewFinancials,'function');return api.getOverviewFinancials(rows,budget);};
function row(id,price=.03,patch={}){
 const value={id,type:'PENDING_VO',quantity:1,unit_price_excl_vat:price,vat_rate:.18,...patch};
 return {...value,evidence_data:{individual_pricing_terms:{version:'individual-pricing-v1',basis:'MANUAL',includes_adjustments:true,quantity:value.quantity,unit_price_excl_vat:value.unit_price_excl_vat,vat_rate:value.vat_rate,note:'כל ההתאמות כלולות במחיר השמור'}}};
}

test('overview adds individual VAT results to the separately rounded base contract',()=>{
 const value=summary([row('a'),row('b'),row('c')],100);
 assert.deepEqual(value,{originalBudget:100,approvedVO:0,pendingVO:.09,projectedNet:100.09,projectedVat:18.03,projectedGross:118.12,financialIssueCount:0});
});
test('a negative amount and a confirmed zero preserve the same money as the letter',()=>{
 for(const [price,net,vat,gross] of [[-5.01,-5.01,-.9,-5.91],[0,0,0,0]]){
  const value=summary([row('a',price)],0);assert.deepEqual([value.projectedNet,value.projectedVat,value.projectedGross],[net,vat,gross]);
 }
});
test('unknown pending money does not erase a known approved amount or become zero',()=>{
 const value=summary([row('ready',10,{type:'APPROVED_VO'}),row('unknown',null)],100);
 assert.equal(value.approvedVO,10);assert.equal(value.pendingVO,null);assert.equal(value.projectedGross,null);assert.equal(value.projectedVat,null);assert.equal(value.financialIssueCount,1);
 const noBase=summary([],null);assert.equal(noBase.originalBudget,null);assert.equal(noBase.projectedGross,null);
});
test('alternatives across statuses are not counted as approved plus pending work',()=>{
 const value=summary([row('a',10,{type:'APPROVED_VO',contradiction_id:'same'}),row('b',20,{contradiction_id:'same'})],100);
 assert.equal(value.approvedVO,null);assert.equal(value.pendingVO,null);assert.equal(value.projectedGross,null);assert.equal(value.financialIssueCount,2);
});
test('sent work and identical duplicates are counted once without reopening letter eligibility',()=>{
 const sent=row('sent',.03,{type:'SENT_VO'}),value=summary([sent,sent],0);
 assert.equal(value.approvedVO,.03);assert.equal(value.projectedGross,.04);assert.equal(value.financialIssueCount,0);
 assert.equal(prepareLetterFinancialSnapshot([sent]).ok,false,'A summary cannot make sent work eligible for a new letter');
});
test('changed selection and already included adjustments are reflected without a second markup',()=>{
 assert.equal(summary([row('a'),row('b')],0).projectedGross,.08);
 assert.equal(summary([row('a'),row('b'),row('c')],0).projectedGross,.12);
 assert.equal(summary([row('priced',75,{markup_percentage:.1})],0).projectedGross,88.5);
});
