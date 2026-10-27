import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const {Button}=await import('../../src/components/ui/titanium/Button.tsx');
const {BidiText}=await import('../../src/components/ui/titanium/BidiText.tsx');
const {Field}=await import('../../src/components/ui/titanium/Field.tsx');
const {Feedback}=await import('../../src/components/ui/titanium/Feedback.tsx');
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

test('pending action cannot be submitted twice and tells the user what is happening',()=>{
  const html=render(Button,{pending:true,busyLabel:'שומר...',children:'שמירה'});
  assert.match(html,/<button[^>]*disabled/u);
  assert.match(html,/aria-busy="true"/u);
  assert.match(html,/שומר/u);
});
test('unavailable action keeps its reason visible and associated with its name',()=>{
  const html=render(Button,{disabled:true,disabledReason:'חסרה כמות מאומתת',children:'אישור הסכום'});
  assert.match(html,/<button[^>]*aria-describedby="[^"]+"/u);
  assert.match(html,/חסרה כמות מאומתת/u);
  assert.match(html,/אישור הסכום/u);
});
test('a reusable action inside a form does not submit unless explicitly requested',()=>{
  assert.match(render(Button,{children:'סגירה'}),/type="button"/u);
  assert.match(render(Button,{type:'submit',children:'שמירה'}),/type="submit"/u);
});
test('money remains an intact locale fragment including the minus and currency order',()=>{
  const text=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:2}).format(-2450.75);
  const html=render(BidiText,{value:text,kind:'money'});
  assert.ok(html.includes(text));
  assert.match(html,/<bdi[^>]*dir="rtl"/u);
});
test('mixed codes and filenames have independent directions without changing their characters',()=>{
  const code='C-CE6070 · 01.02.0030';
  const name='עדכון_חוזה_20.10.2026.pdf';
  assert.match(render(BidiText,{value:code,kind:'code'}),/<bdi[^>]*dir="ltr"/u);
  assert.ok(render(BidiText,{value:code,kind:'code'}).includes(code));
  assert.match(render(BidiText,{value:name,kind:'file'}),/<bdi[^>]*dir="auto"/u);
  assert.ok(render(BidiText,{value:name,kind:'file'}).includes(name));
});
test('invalid field exposes a persistent label and the error to assistive technology',()=>{
  const html=render(Field,{id:'quantity',label:'כמות',error:'נדרשת כמות מאומתת',value:'',readOnly:true});
  assert.match(html,/<label[^>]*for="quantity"/u);
  assert.match(html,/aria-invalid="true"/u);
  assert.match(html,/aria-describedby="quantity-error"/u);
  assert.match(html,/id="quantity-error"/u);
});
test('an error is announced as an error while ordinary progress does not interrupt reading',()=>{
  assert.match(render(Feedback,{tone:'danger',children:'השמירה נכשלה'}),/role="alert"/u);
  assert.match(render(Feedback,{tone:'info',children:'טוען מסמכים'}),/role="status"/u);
});
