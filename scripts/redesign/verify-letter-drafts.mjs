import './load-ui.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {letterDraftRows,letterDraftSnapshot,letterDraftHeader,letterDraftLinks,letterDraftProject} from './fixtures.mjs';
const ui=await import('../../src/components/features/smart-letter/LetterWorkspaceView.tsx');
const {assessLetterPrintContext}=await import('../../src/components/features/smart-letter/letterPrintContext.ts');
const {PrintableLetterContent}=await import('../../src/components/pricing/PrintableLetter.tsx');
const noop=()=>{},asyncNoop=async()=>{};
function props(patch={}){return {state:{letterType:'general',recipient:'נמען סינתטי',subject:'טיוטה',keyPoints:'',tone:'professional',generatedLetter:'טקסט ידני',
 isGenerating:false,isCopied:false,isSaving:false,saveSuccess:false,isLoadingLedger:false,ledgerReadFailed:false,isLoadingHistory:false,isLoadingPrintContext:false,
 ledgerItems:letterDraftRows,selectedLedgerItems:letterDraftRows.map(row=>row.id),viewMode:'edit',savedLetters:[],isDeleting:null,showPrintPreview:false,projectName:'Synthetic',
 clientDraftId:letterDraftHeader.client_draft_id,letterId:letterDraftHeader.id,revision:1,status:'DRAFT',snapshot:letterDraftSnapshot,sourceRevisions:Object.fromEntries(letterDraftRows.map(row=>[row.id,'a'.repeat(64)])),isDirty:false,isLegacy:false,...patch},
 setters:{setLetterType:noop,setRecipient:noop,setSubject:noop,setKeyPoints:noop,setTone:noop,setGeneratedLetter:noop,setSelectedLedgerItems:noop,setViewMode:noop},
 actions:{fetchContextDetails:asyncNoop,fetchLedgerItems:asyncNoop,fetchSavedLetters:asyncNoop,generateLetter:asyncNoop,copyLetter:noop,saveLetter:asyncNoop,
 deleteLetter:asyncNoop,openPrintPreview:noop,closePrintPreview:noop,selectSavedLetter:noop,toggleLedgerItem:noop,reviewLetter:asyncNoop,markLetterSent:asyncNoop,newDraft:noop},
 derived:{selectedItems:letterDraftRows,subtotal:.09,vat:.03,totalInclVat:.12,canGenerate:true,canSave:true,canPreview:true,canMarkSent:true,canPrint:true}};}
const render=p=>renderToStaticMarkup(React.createElement(ui.LetterWorkspaceView,p));
const context=patch=>assessLetterPrintContext({projectId:letterDraftProject,letterId:letterDraftHeader.id,letter:letterDraftHeader,links:letterDraftLinks,linkedCount:3,rows:letterDraftRows,...patch});
test('the actual editor distinguishes draft saving from a separate manual sent action',()=>{
 const html=render(props());assert.ok(html.includes('שמירת טיוטה'));assert.ok(html.includes('סימון כנשלח'));assert.ok(html.includes('0.12'));assert.ok(!html.includes('נשמר בארכיון'));
});
test('manual sent confirmation explicitly requires a prior send outside this application',()=>{
 assert.equal(typeof ui.LetterSentConfirmation,'function');
 const html=renderToStaticMarkup(React.createElement(ui.LetterSentConfirmation,{open:true,isSending:false,onClose:noop,onConfirm:asyncNoop}));
 assert.ok(html.includes('כבר נשלח מחוץ למערכת'));assert.ok(html.includes('type="checkbox"'));assert.ok(/<button[^>]*disabled/.test(html));
});
test('sent documents are read-only and historical records have a separate visible label',()=>{
 const sent=render(props({status:'SENT'}));assert.match(sent,/<textarea[^>]*readonly/i);
 const history=render(props({viewMode:'history',savedLetters:[{...letterDraftHeader,calculation_version:null,revision:null,status:'SENT'}]}));assert.ok(history.includes('רשומה היסטורית'));
});
test('saved snapshot reads ignore changed current ledger and preserve number, date and sources',()=>{
 const c=context({rows:letterDraftRows.map(row=>({...row,unit_price_excl_vat:999}))});assert.equal(c.mode,'snapshot');assert.equal(c.matchesStoredTotals,true);
 assert.deepEqual(c.snapshot.totals,{net:.09,vat:.03,gross:.12});assert.equal(c.letterNumber,'VO-FROZEN-001');assert.equal(c.createdAt,letterDraftHeader.created_at);
 const html=renderToStaticMarkup(React.createElement(PrintableLetterContent,{projectName:'Synthetic',recipient:'Test',subject:'Test',legalText:'SAVED TEXT',items:[],snapshot:c.snapshot,letterNumber:c.letterNumber,createdAt:c.createdAt,mode:'snapshot'}));
 assert.ok(html.includes('VO-FROZEN-001'));assert.ok(html.includes('0.12'));assert.ok(html.includes('אושר ידנית לצורך בדיקה בלבד'));assert.ok(!html.includes('999.00'));
});
test('partial or uncounted saved snapshot links cannot produce a checked attachment',()=>{
 for(const patch of [{links:letterDraftLinks.slice(0,2)},{linkedCount:null},{links:letterDraftLinks.map((link,index)=>index?link:{...link,source_snapshot:null})}]){
  const c=context(patch);assert.equal(c.matchesStoredTotals,false);assert.equal(c.snapshot,null);assert.ok(c.blockedReason);
 }
});
test('legacy text retains known amounts and unknown VAT without reconstructing from current prices',()=>{
 const c=context({letter:{...letterDraftHeader,calculation_version:null,vat_amount:null,total_amount_incl_vat:null}});
 assert.equal(c.mode,'legacy');assert.equal(c.snapshot,null);assert.equal(c.storedNet,.09);assert.equal(c.storedVat,null);assert.equal(c.storedGross,null);assert.equal(c.matchesStoredTotals,false);
 const html=renderToStaticMarkup(React.createElement(PrintableLetterContent,{projectName:'Synthetic',recipient:'Test',subject:'Legacy',legalText:'HISTORICAL TEXT',items:[],mode:'legacy',letterNumber:'OLD-001',createdAt:letterDraftHeader.created_at,legacyTotals:{net:.09,vat:null,gross:null}}));
 assert.ok(html.includes('HISTORICAL TEXT'));assert.ok(html.includes('OLD-001'));assert.ok(html.includes('רשומה היסטורית'));assert.ok(html.includes('—'));assert.ok(!html.includes('0.00'));
});
