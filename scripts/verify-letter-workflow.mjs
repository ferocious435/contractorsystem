import './redesign/load-ui.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {createSyntheticLetterClient,seedLettersTestData,syntheticIds as id} from './fixtures/letter-rpc-test-adapter.mjs';
import {jsonSql} from './letters-db.mjs';
const {createLetterHttpHandlers}=await import('../src/utils/letter-persistence-server.ts');
const sessionApi=await import('../src/components/features/smart-letter/letterDraftSession.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const clientApi=await import('../src/components/features/smart-letter/api/smartLetterApi.ts');
function session(project=id.projectA){assert.equal(typeof sessionApi.LetterDraftSession,'function','Persistent draft request state is missing');return new sessionApi.LetterDraftSession(project);}
test('the production draft session recovers a lost reply, edits the same document, then marks sent separately',async()=>{
 const draft=session();seedLettersTestData();const client=createSyntheticLetterClient(),h=createLetterHttpHandlers({createClient:async()=>client});
 const previous=globalThis.fetch;let loseNextSave=true,loseNextSent=true,writes=0;
 globalThis.fetch=async(url,options)=>{const method=url.endsWith('/preview')?'preview':url.endsWith('/sent')?'markSent':'save';
  const result=await h[method](new Request('http://localhost'+url,options));
  if(method==='save'){writes++;if(loseNextSave){loseNextSave=false;throw new Error('SYNTHETIC_LOST_REPLY_AFTER_COMMIT');}}
  if(method==='markSent'&&loseNextSent){loseNextSent=false;throw new Error('SYNTHETIC_LOST_SENT_REPLY_AFTER_COMMIT');}
  return result;
 };
 try{
  const items=[id.rowA,id.rowB,id.rowC],p=await clientApi.previewVoLetter({projectId:id.projectA,docType:'general',itemIds:items});
  const input={projectId:id.projectA,docType:'general',itemIds:items,subject:'Synthetic letter',recipientName:'Synthetic recipient',content:'טקסט ידני שלם',sourceRevisions:p.sourceRevisions};
  const attempt=draft.saveAttempt(input);await assert.rejects(clientApi.saveVoLetter(attempt.request),/SYNTHETIC_LOST_REPLY/);
  const retry=draft.saveAttempt({...input,content:'עריכה שנוספה אחרי תשובה שאבדה'});assert.deepEqual(retry.request,attempt.request);
  const saved=await clientApi.saveVoLetter(retry.request);assert.equal(draft.saved(retry,saved),true);assert.equal(saved.status,'DRAFT');assert.equal(writes,2);
  assert.equal(jsonSql('select count(*) from public.vo_letters;'),2);
  assert.equal(jsonSql("select count(*) from public.pricing_ledger where type='SENT_VO';"),0);
  const opened=await clientApi.fetchLetterPrintContext(client,id.projectA,saved.letterId);assert.equal(opened.mode,'snapshot');assert.equal(opened.matchesStoredTotals,true);
  draft.open(id.projectA,opened);const edit=draft.saveAttempt({...input,content:'אותו מכתב עם עריכה חדשה'});
  assert.equal(edit.request.clientDraftId,attempt.request.clientDraftId);assert.equal(edit.request.expectedRevision,1);
  const updated=await clientApi.saveVoLetter(edit.request);assert.equal(draft.saved(edit,updated),true);assert.equal(updated.letterId,saved.letterId);assert.equal(updated.revision,2);
  const mark=draft.sentAttempt();await assert.rejects(clientApi.markVoLetterSent(mark.request),/SYNTHETIC_LOST_SENT_REPLY/);
  assert.throws(()=>draft.saveAttempt(input),/SENT|read|reconcil/);
  const markRetry=draft.sentAttempt();assert.deepEqual(markRetry,mark);
  const sent=await clientApi.markVoLetterSent(markRetry.request);assert.equal(draft.markedSent(markRetry,sent),true);
  assert.equal(draft.state.status,'SENT');assert.deepEqual(sent.snapshot,saved.snapshot);
  assert.equal(jsonSql("select count(*) from public.pricing_ledger where type='SENT_VO';"),3);
  assert.throws(()=>draft.saveAttempt(input),/SENT|read|קריאה/);
 }finally{globalThis.fetch=previous;}
});
test('a definite conflict releases the rejected request for explicit review without accepting its late response',()=>{
 const draft=session(),input={projectId:id.projectA,docType:'general',itemIds:[id.rowA],subject:'Synthetic',recipientName:'Synthetic',content:'full text',sourceRevisions:{[id.rowA]:'a'.repeat(64)}};
 const rejected=draft.saveAttempt(input);draft.rejectedSave(rejected);
 const reviewed=draft.saveAttempt({...input,sourceRevisions:{[id.rowA]:'b'.repeat(64)}});
 assert.notEqual(reviewed.request.operationId,rejected.request.operationId);assert.equal(reviewed.request.clientDraftId,rejected.request.clientDraftId);
 assert.equal(draft.saved(rejected,{letterId:'old',clientDraftId:rejected.request.clientDraftId,status:'DRAFT',revision:1,snapshot:{},sentMarkedAt:null}),false);
 assert.equal(draft.state.letterId,null);
});
test('responses for a replaced project or another opened draft cannot replace current state',()=>{
 const draft=session(),request={projectId:id.projectA,docType:'general',itemIds:[id.rowA],subject:'Synthetic',recipientName:'Synthetic',content:'full text',sourceRevisions:{[id.rowA]:'a'.repeat(64)}};
 const attempt=draft.saveAttempt(request),oldId=draft.state.clientDraftId;
 draft.reset(id.projectB);const next=draft.state.clientDraftId;assert.notEqual(next,oldId);
 assert.equal(draft.saved(attempt,{letterId:'old',clientDraftId:oldId,revision:1,status:'DRAFT',snapshot:{},sentMarkedAt:null}),false);
 assert.equal(draft.state.projectId,id.projectB);assert.equal(draft.state.clientDraftId,next);assert.equal(draft.state.letterId,null);
});
