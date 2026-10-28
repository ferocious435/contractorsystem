import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {radarFindings} from './fixtures.mjs';
const {LedgerSourceDetails}=await import('../../src/components/features/pricing-ledger/components/LedgerSourceDetails.tsx');
const {default:ContradictionRadarFeedItem}=await import('../../src/components/features/ContradictionRadarFeedItem.tsx');
const {RichText}=await import('../../src/components/ui/RichText.tsx');
test('an evidence marker never presents an invalid page as a verified source location',()=>{
 for(const page of [-1,0,1.5,'2.5','abc','3abc']){
  const html=renderToStaticMarkup(React.createElement(RichText,{text:'מקור [1]',evidence:{contract_quote:'הוראה שמורה',contract_page:page,document_pair:{contract_doc_id:'stored-source'}},onOpen:()=>{}}));
  assert.ok(html.includes('עמוד לא אומת'),String(page));
 }
 const html=renderToStaticMarkup(React.createElement(RichText,{text:'מקור [1]',evidence:{contract_quote:'הוראה שמורה',contract_page:'12',document_pair:{contract_doc_id:'stored-source'}},onOpen:()=>{}}));
 assert.ok(html.includes('עמוד 12'));
 assert.ok(!html.includes('עמוד לא אומת'));
});
test('an unlinked contract source cannot offer an enabled action',()=>{
 const c={...radarFindings[0],target_doc:null,evidence_data:{}};
 const html=renderToStaticMarkup(React.createElement(ContradictionRadarFeedItem,{item:c,idx:0,isExpanded:true,isItemRescanning:false,isScanning:false,aiAvailable:false,shouldAnimate:false,onToggleExpand:()=>{},onRescanItem:()=>{},onUpdateStatus:async()=>true,onDelete:async()=>true,onRadarOpenDocument:()=>{}}));
 const button=(html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu)||[]).find(value=>value.includes('לא נמצא מסמך חוזי'));
 assert.ok(button?.includes('disabled'));
});
test('source links keep separate roles and reject invalid page numbers',()=>{
 const html=renderToStaticMarkup(React.createElement(LedgerSourceDetails,{item:{id:'same-source',description:'מקור בדיקה',source_execution_doc_id:'same-document',evidence_data:{document_pair:{contract_doc_id:'same-document'},work_page:-1,contract_page:2.5}},onOpenSource:()=>{}}));
 assert.equal((html.match(/עמוד לא אומת/g)||[]).length,2);assert.ok(!html.includes('עמוד -1'));assert.ok(!html.includes('עמוד 2.5'));
});
test('a retained contract filename explains why its missing source link is disabled',()=>{
 const item={...radarFindings[0],target_doc:null,evidence_data:{contract_title:'שם מוכר ללא קישור.pdf'}};
 const html=renderToStaticMarkup(React.createElement(ContradictionRadarFeedItem,{item,idx:0,isExpanded:true,isItemRescanning:false,isScanning:false,aiAvailable:false,shouldAnimate:false,onToggleExpand:()=>{},onRescanItem:()=>{},onUpdateStatus:async()=>true,onDelete:async()=>true,onRadarOpenDocument:()=>{}}));
 const button=(html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu)||[]).find(value=>value.includes('שם מוכר ללא קישור.pdf'));
 assert.ok(button?.includes('disabled'));assert.ok(button.includes('אין קישור למסמך המקור השמור.'));
});
