import './load-ui.mjs';import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {getLedgerRowAmount,getMoneySum,getPreferredProjectAmount,isVisibleLedgerRow,getAmountInclVat,getAmountVat} from '../../src/utils/project-financials.ts';
import {summarizeOpenContradictions} from '../../src/components/features/projectOverviewStats.ts';
const {OverviewView}=await import('../../src/components/features/overview/OverviewView.tsx');
const render=stats=>renderToStaticMarkup(React.createElement(OverviewView,{stats,loading:false,error:null,onNavigate:()=>{}}));
const stats={originalBudget:100000,approvedVO:0,pendingVO:0,criticalCount:0,totalDiscrepancies:0,documentCount:0,evidenceCoverage:0,clientName:'לקוח בדיקה'};

test('the overview preserves the same individually rounded VAT as the letter and export',()=>{
 const html=render({...stats,originalBudget:0,approvedVO:0,pendingVO:.09,projectedNet:.09,projectedVat:.03,projectedGross:.12});
 assert.ok(html.includes('0.12'),'Three individually rounded .03 items must remain .12 in the overview');
 assert.ok(!html.includes('0.11'),'VAT may not be charged again on their combined net');
});
test('existing financial aggregation retains approved, sent, pending and trusted base definitions',()=>{
 const rows=[{type:'BASE_CONTRACT',source:'BOQ',quantity:2,unit_price_excl_vat:50000,evidence_data:{source:'pricelist_items',pricelist_item_id:'synthetic-base'}},{type:'BASE_CONTRACT',total_price_excl_vat:999999},{type:'APPROVED_VO',total_price_excl_vat:100},{type:'SENT_VO',total_price_excl_vat:200},{type:'PENDING_VO',total_price_excl_vat:300,ai_rationale:'הסבר לבדיקה'}];
 const visible=rows.filter(isVisibleLedgerRow),sum=type=>visible.filter(row=>type.includes(row.type)).reduce((total,row)=>getMoneySum([total,getLedgerRowAmount(row)]),0);
 const actual={...stats,originalBudget:getPreferredProjectAmount(90000,rows),approvedVO:sum(['APPROVED_VO','SENT_VO']),pendingVO:sum(['PENDING_VO']),evidenceCoverage:25};
 assert.equal(actual.originalBudget,100000);assert.equal(actual.approvedVO,300);assert.equal(actual.pendingVO,300);
 const html=render(actual);assert.ok(html.includes('חריגים בהמתנה'));assert.ok(html.includes('מאושרים / נשלחו'));assert.ok(html.includes('פריטי תמחור עם הסבר'));assert.ok(!html.includes('כיסוי הוכחות'));
 assert.equal(getAmountVat(100600,.18),18108);assert.equal(getAmountInclVat(100600,.18),118708);
});
test('open risk counts still come from the existing contradiction summary',()=>{
 const summary=summarizeOpenContradictions([{status:'OPEN',severity:'HIGH'},{status:'OPEN',severity:'LOW'},{status:'RESOLVED',severity:'HIGH'},{status:'DISMISSED',severity:'HIGH'}]);assert.deepEqual(summary,{openCount:2,highRiskOpenCount:1});
 const html=render({...stats,totalDiscrepancies:summary.openCount,criticalCount:summary.highRiskOpenCount});assert.ok(html.includes('ממצאים פתוחים'));assert.ok(html.includes('בסיכון גבוה'));
});
test('unknown values and failed reads never become known zero, and no time series is invented',()=>{
 const unknown=Object.fromEntries(Object.keys(stats).map(key=>[key,null]));const html=render(unknown);assert.ok(html.includes('—'));assert.ok(!html.includes('₪'));assert.ok(!html.includes('data-time-series'));
 const failed=renderToStaticMarkup(React.createElement(OverviewView,{stats,loading:false,error:'הקריאה נכשלה',onNavigate:()=>{}}));assert.ok(failed.includes('הקריאה נכשלה'));assert.ok(!failed.includes('₪'));
});
test('known zero, negative and large amounts keep their agorot and remain isolated',()=>{
 for(const [value,printed] of [[0,'0.00'],[-1234.5,'-1,234.50'],[148620450.75,'148,620,450.75']]){const html=render({...stats,originalBudget:value});assert.ok(html.includes('dir="rtl"'));assert.ok(html.includes(printed));}
});
test('all four established quick destinations remain keyboard buttons',()=>{const html=render(stats);for(const label of ['פתיחת מכ״ם הסתירות','פתיחת מסמכי חוזה','פתיחת התמחור','פתיחת היועץ'])assert.ok(html.includes(label));assert.equal((html.match(/data-overview-navigation=/g)||[]).length,4);});
test('an unavailable provider identity cannot be presented as the active consultant',()=>{const unavailable=renderToStaticMarkup(React.createElement(OverviewView,{stats,loading:false,error:null,aiStatus:{available:false,provider:'Legacy unavailable provider',reason:'STATUS_UNAVAILABLE'},onNavigate:()=>{}}));assert.ok(unavailable.includes('אינו זמין כרגע'));assert.ok(!unavailable.includes('Legacy unavailable provider'));});
