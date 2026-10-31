import './redesign/load-ui.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const ui=await import('../src/components/features/correspondence/ProjectCorrespondence.tsx');
function link(props){assert.equal(typeof ui.CorrespondenceDownload,'function');return ui.CorrespondenceDownload({subject:'בקשת הנחיה',text:'שלום רב,\nנבקש לקבל מסמך חתום.\nתודה.',disabled:false,...props});}
test('a letter download exposes its exact UTF-8 text and BOM through an ordinary file link',async()=>{
 const element=link({});assert.equal(element.type,'a');assert.equal(element.props.download,'בקשת הנחיה.txt');assert.match(element.props.href,/^data:text\/plain;charset=utf-8,/);
 const response=await fetch(element.props.href);assert.equal(response.status,200);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from('\ufeffשלום רב,\nנבקש לקבל מסמך חתום.\nתודה.','utf8'));
});
test('a delayed reader retains the entire long edited letter after the link creation returns',async()=>{
 const text='פתיחת המכתב\n'+('תוכן בעברית עם תווים & % # ?\n'.repeat(2500))+'\nסיום שנוסף ידנית.';
 const element=link({text});const href=element.props.href;await new Promise(resolve=>setImmediate(resolve));
 const response=await fetch(href);assert.equal(await response.text(),text);
 assert.equal(element.props.onClick,undefined,'download must not destroy its resource in a click handler');
});
test('download names cannot contain path, control or directional characters and remain usable on Windows',()=>{
 for(const subject of ['../מכתב: אחריות\u0000\r\n\u202e','CON','מ'.repeat(500),'   ']){
  const name=link({subject}).props.download;assert.ok(name.endsWith('.txt'));assert.ok(name.length<=180);assert.doesNotMatch(name,/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u);assert.doesNotMatch(name,/^(?:con|prn|aux|nul|com\d|lpt\d)\.txt$/iu);
 }
});
test('busy or empty letter downloads are disabled without a live file navigation',()=>{
 for(const props of [{disabled:true},{text:'  '}]){
  const html=renderToStaticMarkup(React.createElement(ui.CorrespondenceDownload,{subject:'טיוטה',text:'שלום',disabled:false,...props}));
  assert.match(html,/disabled/);assert.doesNotMatch(html,/href=/);
 }
});
test('a malformed pasted Unicode character cannot crash the letter editor while preparing a download',async()=>{
 const response=await fetch(link({text:'תוכן \ud800 סוף'}).props.href);assert.equal(await response.text(),'תוכן \ufffd סוף');
});
