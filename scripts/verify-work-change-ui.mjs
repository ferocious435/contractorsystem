import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { finding, sourceDocuments, registerWorkChangeModules } from './fixtures/work-change-fixtures.mjs';
const resolveHook=registerWorkChangeModules();
const jsxHook=registerHooks({load(url,context,next){if(url.endsWith('.tsx'))return{format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:url}).outputText};return next(url,context);}});
const {WorkChangeReviewContent}=await import('../src/components/pricing/WorkChangeReviewPanel.tsx');
const {buildWorkChangePacket}=await import('../src/utils/work-change-sources.ts');
const {validateWorkChangeReview}=await import('../src/utils/work-change-review.ts');
jsxHook.deregister();resolveHook.deregister();
function review(){const packet=buildWorkChangePacket(finding(),sourceDocuments());return validateWorkChangeReview(packet,{facts:[
 {sourceId:'proposal',kind:'PROPOSED_WORK',quote:packet.sources.find(s=>s.id==='proposal').extracted_text,quantity:80,unit:'מטר',amountExclVat:null},
],comparisons:[]});}
test('a real unknown monetary result renders a dash and a concrete explanation',()=>{
 const html=renderToStaticMarkup(React.createElement(WorkChangeReviewContent,{review:review(),projectId:'project'}));
 const visible=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 assert.match(visible,/סכום מאומת לפני מע״מ\s*—/);
 assert.match(visible,/לא אושרה דרישת תשלום/);
});
test('the real panel keeps design fees in their own section and links to the actual source',()=>{
 const result=review();result.facts.push({id:'F2',sourceId:'proposal',kind:'DESIGN_FEE',evidence:result.facts[0].evidence,quantity:null,unit:null,amountExclVat:null,observedAmount:12000,confirmed:false,issues:['source_reading_unverified']});
 const html=renderToStaticMarkup(React.createElement(WorkChangeReviewContent,{review:result,projectId:'project'}));
 assert.match(html,/תכנון ושכר טרחה/);assert.match(html,/documentId=proposal/);assert.match(html,/קריאת המקור לא אומתה במלואה/);
});
test('the real empty state provides source access and does not say the work was fully checked',()=>{
 const result=review();result.facts=[];
 const html=renderToStaticMarkup(React.createElement(WorkChangeReviewContent,{review:result,projectId:'project'}));
 assert.match(html,/לא נמצאו עדיין פרטים עם ציטוט מאומת/);assert.match(html,/פתיחת קובץ המקור/);
});

test('table quantities and unit prices are displayed separately from totals and payment approval',()=>{
 const result=review();result.tableRows=[{id:'T1',sourceId:'proposal',itemCode:'71.02.0008',quantity:80,unit:'m',unitPrice:3000,total:240000,evidence:result.facts[0].evidence,arithmeticVerified:true,requiresReview:false,vatBasis:'EXCL'}];
 const html=renderToStaticMarkup(React.createElement(WorkChangeReviewContent,{review:result,projectId:'project'}));
 assert.match(html,/נתונים מעמודות הטבלאות/);assert.match(html,/מחיר יחידה במקור/);assert.match(html,/71\.02\.0008/);
 assert.match(html,/תוצאת כמות כפול מחיר יחידה נבדקה/);assert.match(html,/לא אושרה דרישת תשלום/);
});
