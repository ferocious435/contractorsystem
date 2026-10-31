import './redesign/load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const ui=await import('../src/components/features/correspondence/ProjectCorrespondence.tsx');
const client=await import('../src/utils/correspondence-client.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const project='10000000-0000-4000-8000-000000000001';
const letter={id:'20000000-0000-4000-8000-000000000001',project_id:project,client_draft_id:'30000000-0000-4000-8000-000000000001',revision:2,status:'DRAFT',subject:'בקשת הנחיה',recipient:'מנהל הפרויקט',content:'יש להעביר הנחיה כתובה.',source_refs:[],created_at:'2026-10-31T10:00:00.000Z'};
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
function history(props){assert.equal(typeof ui.CorrespondenceHistory,'function');return render(ui.CorrespondenceHistory,{letters:[],loading:false,error:'',busy:false,onOpen:()=>{},onRetry:()=>{},...props});}

test('opening correspondence cannot claim an empty archive before its first read completes',()=>{
 const html=render(ui.ProjectCorrespondence,{projectId:project});
 assert.equal(html.includes('עדיין אין מכתבי עבודה שמורים.'),false);
 assert.ok(html.includes('קורא את המכתבים השמורים'));
 assert.ok(html.includes('בודק את זמינות העוזר'));
 assert.equal(html.includes('העוזר אינו זמין כרגע.'),false);
});
test('a failed refresh keeps known letters, explains the unread state and offers a retry',()=>{
 const html=history({letters:[letter],error:'קריאת המכתבים לא הושלמה'});
 assert.ok(html.includes(letter.subject));assert.ok(html.includes('קריאת המכתבים לא הושלמה'));
 assert.ok(html.includes('ניסיון חוזר'));assert.equal(html.includes('עדיין אין מכתבי עבודה שמורים.'),false);
});
test('only a completed successful empty read may display an empty archive',()=>{
 assert.ok(history({}).includes('עדיין אין מכתבי עבודה שמורים.'));
 assert.equal(history({loading:true}).includes('עדיין אין מכתבי עבודה שמורים.'),false);
 assert.equal(history({error:'קריאה נכשלה'}).includes('עדיין אין מכתבי עבודה שמורים.'),false);
});
test('a real saved letter is returned with its exact text, identity and revision',async()=>{
 assert.equal(typeof client.fetchSavedCorrespondence,'function');
 const result=await client.fetchSavedCorrespondence(project,async()=>Response.json({success:true,letters:[letter]}));
 assert.deepEqual(result,[letter]);
});
test('a timeout yields a Hebrew recovery message instead of leaking a browser exception',async()=>{
 assert.equal(typeof client.fetchSavedCorrespondence,'function');
 await assert.rejects(client.fetchSavedCorrespondence(project,async()=>{throw new DOMException('signal timed out','TimeoutError');}),error=>{
  assert.match(error.message,/[א-ת]/);assert.doesNotMatch(error.message,/signal timed out|aborted/i);return true;
 });
});
test('a partial, malformed or foreign archive is rejected instead of crashing or becoming empty',async()=>{
 assert.equal(typeof client.fetchSavedCorrespondence,'function');
 for(const payload of [{success:true},{success:true,letters:null},{success:true,letters:[{...letter,content:null}]},{success:true,letters:[{...letter,project_id:'foreign'}]}]){
  await assert.rejects(client.fetchSavedCorrespondence(project,async()=>Response.json(payload)));
 }
 await assert.rejects(client.fetchSavedCorrespondence(project,async()=>new Response('broken',{headers:{'Content-Type':'application/json'}})));
});
test('saving requires a complete acknowledgement while preserving the submitted operation identity',async()=>{
 assert.equal(typeof client.writeSavedCorrespondence,'function');
 const payload={projectId:project,operation:'save',operationId:'40000000-0000-4000-8000-000000000001',content:letter.content};let sent;
 const saved=await client.writeSavedCorrespondence(payload,async(_url,options)=>{sent=JSON.parse(options.body);return Response.json({success:true,letter});});
 assert.deepEqual(sent,payload);assert.deepEqual(saved,letter);
 await assert.rejects(client.writeSavedCorrespondence(payload,async()=>Response.json({success:true,letter:{...letter,revision:null}})));
});
