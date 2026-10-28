import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let View;
try{View=(await import('../../src/components/features/consultant/ConsultantView.tsx')).ConsultantView;}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const noop=()=>{};
const props=(extra={})=>({messages:[],input:'',isLoading:false,suggestedQuestions:['מהם הסיכונים בפרויקט?','סכם את הסתירות'],onInput:noop,onSend:async()=>{},onKeyDown:noop,...extra});
function render(input=props()){assert.equal(typeof View,'function','Consultant view is missing');return renderToStaticMarkup(React.createElement(View,input));}
test('empty and in-flight input cannot be submitted',()=>{
  for(const input of [props(),props({input:'  '}),props({input:'שאלה',isLoading:true})])assert.match(render(input),/<button[^>]*aria-label="שליחת שאלה"[^>]*disabled/u);
  assert.ok(!render(props({input:'שאלה'})).match(/<button[^>]*aria-label="שליחת שאלה"[^>]*disabled/u));
});
test('suggestions are available without sending or fabricating an existing conversation',()=>{
  let sends=0,changes=0;const html=render(props({onSend:async()=>{sends++;},onInput:()=>{changes++;}}));assert.ok(html.includes('מהם הסיכונים בפרויקט?'));assert.equal(sends,0);assert.equal(changes,0);assert.ok(!html.includes('Gemini'));
});
test('long mixed-direction messages preserve the complete content and codes',()=>{
  const content='מקור C-CE6070 · 51.03.0110\n'.repeat(400)+'END_CONSULTANT_6070';const html=render(props({messages:[{role:'assistant',content,timestamp:new Date('2026-10-27T12:00Z')}]}));assert.ok(html.includes('END_CONSULTANT_6070'));assert.equal((html.match(/C-CE6070/g)||[]).length,400);assert.ok(html.includes('dir="auto"'));
});
test('a failed response is visibly separate from an assistant answer without discarding the error text',()=>{
  const html=render(props({messages:[{role:'user',content:'שאלה C-CE6070',timestamp:new Date()},{role:'assistant',content:'שגיאת תקשורת. אנא נסה שוב.',timestamp:new Date()}],errorIndexes:[1]}));assert.ok(html.includes('role="alert"'));assert.ok(html.includes('שגיאת תקשורת. אנא נסה שוב.'));
  assert.ok(!render(props({messages:[{role:'assistant',content:'תשובה לבדיקה',timestamp:new Date()}]})).includes('role="alert"'));
});
test('pending response uses an actual waiting state and keeps the keyboard instructions accessible',()=>{
  const html=render(props({isLoading:true,input:'שאלה נוספת'}));assert.ok(html.includes('ממתין לתשובת העוזר'));assert.ok(html.includes('Shift+Enter'));assert.ok(!html.includes('82%'));assert.ok(html.includes('שאלה נוספת'));
});
