import './load-ui.mjs';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {letterItems,letterPaperProps,longLetterPaperProps} from './fixtures.mjs';
const {LETTER_TYPES,TONE_OPTIONS}=await import('../../src/components/features/smart-letter/constants.ts');
const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/letter-paper-before.json',import.meta.url),'utf8'));
const OriginalDate=Date;
globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[golden.fixedDate]));}static now(){return new OriginalDate(golden.fixedDate).getTime();}};
const {PrintableLetter,PrintableLetterContent}=await import('../../src/components/pricing/PrintableLetter.tsx');
const letterApi=await import('../../src/components/features/smart-letter/api/smartLetterApi.ts');
let assessPrint;
try{assessPrint=(await import('../../src/components/features/smart-letter/letterPrintContext.ts')).assessLetterPrintContext;}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
let view;
let printableItemsForView;
try{const letterUiModule=await import('../../src/components/features/smart-letter/LetterWorkspaceView.tsx');view=letterUiModule.LetterWorkspaceView;printableItemsForView=letterUiModule.getLetterPrintableItems;}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const noop=()=>{};
function props(extra={}){const state={letterType:'claim',recipient:'נמען בדיקה',subject:'בדיקת C-CE6070',keyPoints:'עיקרי הפנייה',tone:'professional',generatedLetter:'טקסט ידני C-CE6070\nEND_MANUAL_LETTER',isGenerating:false,isCopied:false,isSaving:false,saveSuccess:false,ledgerItems:letterItems,selectedLedgerItems:['letter-pending','letter-approved','letter-negative'],viewMode:'edit',savedLetters:[],isDeleting:null,showPrintPreview:false,projectName:'פרויקט בדיקה',...extra};return{state,setters:{setLetterType:noop,setRecipient:noop,setSubject:noop,setKeyPoints:noop,setTone:noop,setGeneratedLetter:noop,setSelectedLedgerItems:noop,setViewMode:noop},actions:{fetchContextDetails:async()=>{},fetchLedgerItems:async()=>{},fetchSavedLetters:async()=>{},generateLetter:async()=>{},copyLetter:noop,saveLetter:async()=>{},deleteLetter:async()=>{},openPrintPreview:noop,closePrintPreview:noop,selectSavedLetter:noop,toggleLedgerItem:noop},derived:{selectedItems:letterItems.slice(0,3),subtotal:168.44,vat:30.32,totalInclVat:198.76,canGenerate:true,canSave:true}};}
function render(input=props()){assert.equal(typeof view,'function','The actual letter workspace view is missing');return renderToStaticMarkup(React.createElement(view,input));}
const button=(html,label)=>html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`,'u'))?.[0]||'';

test('five letter types and six tones remain available with their original values',()=>{
  const html=render();for(const option of LETTER_TYPES)assert.ok(html.includes(option.label));for(const option of TONE_OPTIONS)assert.ok(html.includes(`value="${option.value}"`));assert.equal(LETTER_TYPES.length,5);assert.equal(TONE_OPTIONS.length,6);
});
test('generation and saving retain the existing independent eligibility guards',()=>{
  const input=props();input.derived.canGenerate=false;input.derived.canSave=false;const html=render(input);assert.ok(button(html,'יצירת טיוטה').includes('disabled'));assert.ok(button(html,'שמירת מכתב').includes('disabled'));assert.ok(html.includes('בחירת שורות'));
});
test('a failed ledger refresh cannot enable generation or save with stale selected amounts',()=>{
  const html=render(props({operationError:{kind:'ledger',message:'קריאת השורות נכשלה'}}));
  assert.ok(button(html,'יצירת טיוטה').includes('disabled'));
  assert.ok(button(html,'שמירת מכתב').includes('disabled'));
  assert.ok(!html.includes('168.44'));
});
test('another feedback message cannot clear an unresolved ledger read failure',()=>{
  const html=render(props({ledgerReadFailed:true,operationError:{kind:'copy',message:'ההעתקה נכשלה'}}));
  assert.ok(button(html,'יצירת טיוטה').includes('disabled'));
  assert.ok(button(html,'שמירת מכתב').includes('disabled'));
  assert.ok(!html.includes('168.44'));
});
test('IDs left after a ledger refresh cannot save a letter without selectable rows',()=>{
  const input=props({ledgerItems:[]});input.derived.selectedItems=[];
  assert.ok(button(render(input),'שמירת מכתב').includes('disabled'));
});
test('eligible financial IDs remain selected and a base-contract row cannot be offered for the letter',()=>{
  const html=render();for(const id of ['letter-pending','letter-approved','letter-negative'])assert.ok(new RegExp(`<input[^>]*checked[^>]*value="${id}"|<input[^>]*value="${id}"[^>]*checked`,'u').test(html));assert.ok(!html.includes('EXCLUDED_BASE_CONTRACT'));
});
test('manual letter text stays complete in the editor without calling generation',()=>{
  const input=props({generatedLetter:'טקסט מלא C-CE6070\n'.repeat(200)+'END_MANUAL_LETTER'});let generated=0;input.actions.generateLetter=async()=>{generated++;};const html=render(input);assert.ok(html.includes('END_MANUAL_LETTER'));assert.ok(html.includes('name="letterText"'));assert.equal(generated,0);
});
test('a save rejection remains visible and suppresses stale success feedback',()=>{
  const html=render(props({saveSuccess:true,operationError:{kind:'save',message:'שמירת המכתב לא הושלמה. הטקסט נשאר לבדיקה.'}}));assert.ok(html.includes('role="alert"'));assert.ok(html.includes('שמירת המכתב לא הושלמה'));assert.ok(!html.includes('נשמר בארכיון'));
});
test('history is a view of saved letters and does not generate or save during opening',()=>{
  const input=props({viewMode:'history',savedLetters:[{id:'history-one',project_id:'demo-letters-redesign',letter_number:'VO-TEST-007',subject:'מכתב שמור',recipient_name:'נמען',content:'טקסט שמור במלואו',created_at:'2026-10-27',total_amount_incl_vat:null}]});let writes=0;input.actions.generateLetter=input.actions.saveLetter=async()=>{writes++;};const html=render(input);assert.ok(html.includes('VO-TEST-007'));assert.ok(html.includes('מכתב שמור'));assert.ok(html.includes('פתיחת הטקסט לעריכה'));assert.equal(writes,0);assert.ok(!html.includes('₪ 0'));
});
test('pending work uses real status without a fabricated completion percentage',()=>{
  const html=render(props({isGenerating:true}));assert.ok(html.includes('מכין טיוטה'));assert.ok(button(html,'יצירת טיוטה').includes('disabled'));assert.ok(!html.includes('82%'));
});
test('the current financial values remain separate from VAT in the workspace',()=>{
  const html=render();for(const amount of ['168.44','30.32','198.76'])assert.ok(html.includes(amount));assert.ok(html.includes('18%'));
});
test('the complete printed structure, calculations and evidence appendix match the captured source',()=>{
  for(const [name,input] of Object.entries({short:letterPaperProps,long:longLetterPaperProps})){const html=renderToStaticMarkup(React.createElement(PrintableLetterContent||PrintableLetter,input)),start=html.indexOf('<div class="max-w-[210mm]');assert.ok(start>=0);const paper=PrintableLetterContent?html:html.slice(start,html.lastIndexOf('</div>'));assert.equal(createHash('sha256').update(paper).digest('hex'),golden.cases[name].sha256,name);assert.ok(paper.includes('נספח הוכחות'));if(name==='short'){for(const amount of ['168.44','30.32','198.76'])assert.ok(paper.includes(amount));assert.ok(!paper.includes('EXCLUDED_BASE_CONTRACT'));}else{for(let index=1;index<=45;index++)assert.ok(paper.includes('UI-LETTER-'+String(index).padStart(3,'0')));assert.ok(paper.includes('END_LONG_LETTER_TEXT'));}}
});
test('the printable body can be rendered independently of modal web controls',()=>{
  assert.equal(typeof PrintableLetterContent,'function');
  const paper=renderToStaticMarkup(React.createElement(PrintableLetterContent,letterPaperProps));
  assert.ok(!paper.includes('<button'));assert.ok(!paper.includes('<dialog'));
});

function linkedSource(extra={}){return{projectId:'demo-letters-redesign',letterId:'saved-letter',letter:{id:'saved-letter',project_id:'demo-letters-redesign',total_amount_excl_vat:168.44,total_amount_incl_vat:198.76},links:letterItems.slice(0,3).map((row,index)=>({ledger_item_id:row.id,sort_order:index})),rows:letterItems.slice(0,3).map(row=>({...row,type:'SENT_VO'})),...extra};}
test('sent rows can reconstruct a saved print context when both stored totals match',()=>{
  assert.equal(typeof assessPrint,'function');const context=assessPrint(linkedSource());assert.equal(context.matchesStoredTotals,true);assert.equal(context.blockedReason,null);assert.deepEqual(context.items.map(row=>row.id),['letter-pending','letter-approved','letter-negative']);
});
test('changed historical amounts block preview without replacing the stored totals',()=>{
  assert.equal(typeof assessPrint,'function');const source=linkedSource();source.rows[0].total_price_excl_vat=151;const context=assessPrint(source);assert.equal(context.matchesStoredTotals,false);assert.ok(context.blockedReason);assert.equal(source.letter.total_amount_excl_vat,168.44);assert.equal(source.letter.total_amount_incl_vat,198.76);
});
test('missing links unknown numbers and cross-project rows cannot turn into a zero-value print',()=>{
  assert.equal(typeof assessPrint,'function');for(const change of [{links:[]},{rows:[]},{letter:{id:'saved-letter',project_id:'demo-letters-redesign',total_amount_excl_vat:null,total_amount_incl_vat:null}},{rows:linkedSource().rows.map((row,index)=>index===0?{...row,project_id:'another-project'}:row)},{rows:linkedSource().rows.map((row,index)=>index===0?{...row,unit_price_excl_vat:null}:row)}]){const context=assessPrint(linkedSource(change));assert.equal(context.matchesStoredTotals,false);assert.ok(context.blockedReason);}
});
test('linked print reads are bounded to the selected letter and project and retain only linked IDs',async()=>{
  assert.equal(typeof letterApi.fetchLetterPrintContext,'function');const source=linkedSource(),calls=[];
  const client={from(table){const call={table,filters:[],ids:null};calls.push(call);const query={select(columns){call.columns=columns;return this;},eq(key,value){call.filters.push([key,value]);return this;},in(key,ids){assert.equal(key,'id');call.ids=ids;return this;},order(){return this;},single(){return this;},then(yes,no){const data=table==='vo_letters'?source.letter:table==='vo_letter_items'?source.links:source.rows.filter(row=>call.ids.includes(row.id));return Promise.resolve({data,error:null,count:table==='vo_letter_items'?source.links.length:null}).then(yes,no);}};return query;}};
  const context=await letterApi.fetchLetterPrintContext(client,source.projectId,source.letterId);assert.equal(context.matchesStoredTotals,true);assert.deepEqual(calls.map(call=>call.table),['vo_letters','vo_letter_items','pricing_ledger']);assert.equal(calls[0].columns,'*');assert.deepEqual(calls[0].filters,[['id','saved-letter'],['project_id','demo-letters-redesign']]);assert.deepEqual(calls[1].filters,[['letter_id','saved-letter']]);assert.deepEqual(calls[2].filters,[['project_id','demo-letters-redesign']]);assert.deepEqual(calls[2].ids,['letter-pending','letter-approved','letter-negative']);
});
test('a truncated or uncounted links response cannot be declared a complete print context',async()=>{
  const source=linkedSource();
  for(const count of [4,null]){
    let countOption=null;
    const client={from(table){const query={select(columns,options){if(table==='vo_letter_items')countOption=options?.count;return this;},eq(){return this;},in(){return this;},order(){return this;},single(){return this;},then(yes,no){return Promise.resolve({data:table==='vo_letters'?source.letter:table==='vo_letter_items'?source.links:source.rows,error:null,count:table==='vo_letter_items'?count:null}).then(yes,no);}};return query;}};
    const context=await letterApi.fetchLetterPrintContext(client,source.projectId,source.letterId);
    assert.equal(context.matchesStoredTotals,false);assert.ok(context.blockedReason);assert.equal(countOption,'exact');
  }
});

test('the print view uses linked sent rows after the selectable ledger becomes empty',()=>{
  assert.equal(typeof printableItemsForView,'function');const context=assessPrint(linkedSource());const items=printableItemsForView({printContext:context},{selectedItems:[]});assert.deepEqual(items.map(row=>row.id),['letter-pending','letter-approved','letter-negative']);assert.equal(items[0].total_price_excl_vat,150);assert.equal(items[2].total_price_excl_vat,-5.01);
  const blocked=printableItemsForView({printContext:{...context,matchesStoredTotals:false,blockedReason:'changed'}},{selectedItems:letterItems.slice(0,3)});assert.equal(blocked.length,0);
});

test('an existing letter without a stored gross amount retains its known net and blocks reconstruction',async()=>{
  const source=linkedSource();delete source.letter.total_amount_incl_vat;
  const client={from(table){let columns='';const query={select(value){columns=value;return this;},eq(){return this;},in(){return this;},order(){return this;},single(){return this;},then(yes,no){if(table==='vo_letters'&&columns!=='*')return Promise.resolve({data:null,error:{code:'42703',message:'column total_amount_incl_vat does not exist'}}).then(yes,no);return Promise.resolve({data:table==='vo_letters'?source.letter:table==='vo_letter_items'?source.links:source.rows,error:null,count:table==='vo_letter_items'?3:null}).then(yes,no);}};return query;}};
  const context=await letterApi.fetchLetterPrintContext(client,source.projectId,source.letterId);assert.equal(context.matchesStoredTotals,false);assert.equal(context.storedNet,168.44);assert.equal(context.storedGross,undefined);assert.ok(context.blockedReason);
});
