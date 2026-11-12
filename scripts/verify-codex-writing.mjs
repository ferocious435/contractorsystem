import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LetterDraftSession} from '../src/components/features/smart-letter/letterDraftSession.ts';
import {letterDraftSnapshot,letterDraftProject} from './redesign/fixtures.mjs';
import {queueFixture,savedProfile,projectId} from './codex-runtime/queue-fixtures.mjs';
import {ownerId} from './codex-runtime/fixtures.mjs';
import {createAiWorker} from '../src/server/ai/worker.server.ts';
import {summarizeIndividualPricing} from '../src/utils/individual-pricing.ts';
import {letterDraftRows} from './redesign/fixtures.mjs';
const writing=existsSync(new URL('../src/utils/business-writing-result.ts',import.meta.url))?await import('../src/utils/business-writing-result.ts'):{};
const letters=existsSync(new URL('../src/server/ai/handlers/letter.ts',import.meta.url))?await import('../src/server/ai/handlers/letter.ts'):{};
const consultants=existsSync(new URL('../src/server/ai/handlers/consultant.ts',import.meta.url))?await import('../src/server/ai/handlers/consultant.ts'):{};
const sources=Array.from({length:7},(_,index)=>({sourceId:'S'+(index+1),documentId:'60000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),title:'מקור '+(index+1),pageLabel:'1',quote:'יש לתאם את ביצוע העבודה לפי התכנית המאושרת '+(index+1),basis:'DOCUMENT',status:'VERIFIED',manualNote:null}));
const snapshot=structuredClone(letterDraftSnapshot);snapshot.items[0].sources=sources;
const payload={letterType:'general',recipient:'למנהל הפרויקט',subject:'תיאום עבודה',keyPoints:'נא לתאם את המועד 15.11.2026 לפי התכנית.',tone:'friendly',itemIds:snapshot.items.map(item=>item.ledgerItemId)};
const facts={kind:'letter',projectName:'פרויקט סינתטי',userText:payload.subject+'\n'+payload.keyPoints,sources};
const priorAppData=process.env.LOCALAPPDATA,writingRuntime=await fs.mkdtemp(path.join(os.tmpdir(),'contractorsystem-writing-audit-'));
process.env.LOCALAPPDATA=writingRuntime;
test.after(async()=>{if(priorAppData===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=priorAppData;assert.ok(path.resolve(writingRuntime).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(writingRuntime,{recursive:true,force:true});});
function validate(raw,allowed=facts){assert.equal(typeof writing.validateWritingResult,'function','Business writing result validation is missing');return writing.validateWritingResult(JSON.stringify(raw),allowed,snapshot);}

test('a rejected consultant fact retains its exact untrusted response and supplied source context',async()=>{
 const raw=JSON.stringify({body:'העבודה מתייחסת למגרש 9999.',sourceIds:['S1'],unknowns:[],nextActions:[]});
 const fx=queueFixture({onGenerate:async()=>raw}),handler=consultants.createConsultantHandler({load:async execution=>({project:{id:execution.projectId,name:'פרויקט סינתטי'},sources:[sources[0]],unverified:[],money:{scope:'PROJECT',baseNet:null,variations:summarizeIndividualPricing([])},omittedCount:0}),history:async()=>[]});
 const question='בדוק את המקור בלי להוסיף מספר מגרש.',job=await fx.store.enqueue(ownerId,projectId,'consultant',{question},'rejected-fact-audit',savedProfile,{conversationId:letterDraftProject,clientContextId:letterDraftProject});
 await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>handler,clock:fx.clock,startedAt:0}).run();
 assert.equal(fx.rows.get(job.id).state,'FAILED');assert.equal(fx.rows.get(job.id).error.code,'AI_FACT_UNVERIFIED');assert.equal(fx.rows.get(job.id).result,null);assert.equal(fx.modelTurns,1);
 const directory=path.join(writingRuntime,'ContractorSystem/ai-runtime/jobs',job.id);assert.ok(existsSync(directory),'A rejected answer must keep its source-bound diagnostic');const files=(await fs.readdir(directory)).filter(name=>name.startsWith('consultant-response-')&&name.endsWith('.json'));assert.equal(files.length,1);
 const saved=JSON.parse(await fs.readFile(path.join(directory,files[0]),'utf8'));assert.equal(saved.response,raw);assert.equal(saved.jobId,job.id);assert.equal(saved.ownerId,ownerId);assert.equal(saved.projectId,projectId);assert.equal(saved.acceptedAsEvidence,false);assert.ok(saved.input.text.includes(question));assert.ok(saved.input.text.includes(sources[0].quote));assert.equal(saved.profileRevision,savedProfile.revision);
});

test('a consultant can identify an unread dated version without promoting it to a verified source',async()=>{
 const body='קריאת נספח 15.1.25 והקובץ המסומן (002) לא הושלמה.',handler=consultants.createConsultantHandler({load:async execution=>({project:{id:execution.projectId,name:'פרויקט'},sources:[sources[0]],unverified:[{documentId:'unread',title:'נספח 15.1.25 (002).docx',reason:'נספח 15.1.25 (002).docx — קריאת המקור לא הושלמה'}],money:{scope:'PROJECT',baseNet:null,variations:summarizeIndividualPricing([])},omittedCount:0}),history:async()=>[]});
 const result=await handler.execute({question:'מה חסר להשלמת בדיקת הגרסאות?'},{projectId,ownerId,generate:async()=>JSON.stringify({body,sourceIds:['S1'],unknowns:['נדרש התוכן המלא של נספח 15.1.25 ושל הקובץ (002).'],nextActions:[]})});
 assert.ok(result.result.response.includes(body));assert.deepEqual(result.result.sourceIds,['S1']);assert.deepEqual(result.effects,[]);
});

test('unread file labels cannot validate an invented quantity, payment, quotation or source identifier',()=>{
 const context={kind:'consultant',projectName:'פרויקט',userText:'בדוק את הגרסאות.',sources:[sources[0]],unverifiedSourceLabels:['נספח 15.1 (002).docx','טיוטת אישור לביצוע.docx']};
 for(const value of [
  {body:'יש לבצע עבודה במגרש 9999.',sourceIds:['S1'],code:'AI_FACT_UNVERIFIED'},
  {body:'יש לשלם 15.1 ₪.',sourceIds:['S1'],code:'AI_AMOUNT_UNVERIFIED'},
  {body:'יש לשלם 002 ₪.',sourceIds:['S1'],code:'AI_AMOUNT_UNVERIFIED'},
  {body:'נכתב במקור: "אישור לביצוע".',sourceIds:['S1'],code:'AI_QUOTE_UNVERIFIED'},
  {body:'קריאת הקובץ (002) לא הושלמה.',sourceIds:['unread'],code:'AI_SOURCE_UNVERIFIED'},
 ]){const {code,...result}=value;assert.throws(()=>writing.validateWritingResult(JSON.stringify({...result,unknowns:[],nextActions:[]}),context),error=>error.code===code);}
 assert.throws(()=>writing.validateWritingResult(JSON.stringify({body:'נדרש בירור על הקובץ (002).',sourceIds:[]}),{...context,kind:'letter'}),error=>error.code==='AI_FACT_UNVERIFIED');
});
test('a date explicitly supplied by the user is allowed in natural letter prose',()=>{
  const result=validate({body:'שלום, נבקש לתאם את העבודה ליום 15.11.2026. נשמח לאישורכם.',sourceIds:['S1']});assert.ok(result.body.includes('15.11.2026'));
});

test('equivalent date and range keep the accepted consultant response unchanged',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק את ההתקדמות.',sources:[{...sources[0],quote:'ביום 1.1.25 נדרשה מדידה בחתכים 1450-1499.'}]};
 const body='ביום 01.01.25 נדרשה מדידה בחתכים 1450–1499.';
 const raw={body,sourceIds:['S1'],unknowns:['האם ביום 01.01.25 הועברה המדידה?'],nextActions:['בדיקת חתכים 1450–1499.']};
 assert.deepEqual(writing.validateWritingResult(JSON.stringify(raw),allowed),raw);
});
test('numeric equivalence cannot approve another date, code, range bound or quotation',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק.',sources:[{...sources[0],quote:'ביום 1.1.25 נדרשה מדידה בחתכים 1450-1499; סעיף 2.3.25 וקוד R1500-1599.'}]};
 for(const body of ['ביום 02.01.25 נדרשה מדידה.','סעיף 02.03.25 חל.','קוד R1500–1599.','נדרשה מדידה בחתכים 1450–1500.']){
  assert.throws(()=>writing.validateWritingResult(JSON.stringify({body,sourceIds:['S1'],unknowns:[],nextActions:[]}),allowed),error=>error.code==='AI_FACT_UNVERIFIED');
 }
 assert.throws(()=>writing.validateWritingResult(JSON.stringify({body:'נכתב: "ביום 01.01.25 נדרשה מדידה בחתכים 1450–1499."',sourceIds:['S1'],unknowns:[],nextActions:[]}),allowed),error=>error.code==='AI_QUOTE_UNVERIFIED');
});
test('a currency amount cannot hide as a known date',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'ביום 1.1.25 הועברה הנחיה.',sources:[]};
 for(const body of ['יש לשלם 1.1.25 ₪.','המחיר 1.1.25 USD.','מחיר 1.1.25.']){
  assert.throws(()=>writing.validateWritingResult(JSON.stringify({body,sourceIds:[],unknowns:[],nextActions:[]}),allowed),error=>error.code==='AI_AMOUNT_UNVERIFIED');
 }
});
test('a known negative value cannot validate its unsigned opposite',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'המפלס -5.',sources:[]};
 assert.throws(()=>writing.validateWritingResult(JSON.stringify({body:'המפלס 5.',sourceIds:[],unknowns:[],nextActions:[]}),allowed),error=>error.code==='AI_FACT_UNVERIFIED');
});

test('an exact known short date still works in ordinary letter price-request prose',()=>{
 const allowed={kind:'letter',projectName:'פרויקט',userText:'נא לתאם ליום 15.11.',sources:[]};
 const raw={body:'נא להעביר מחיר עד ליום 15.11.',sourceIds:[]};
 assert.deepEqual(writing.validateWritingResult(JSON.stringify(raw),allowed),raw);
});

test('a selected source marker is a reference rather than an invented project number',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק את המקור.',sources:[{...sources[0],sourceId:'S27',quote:'יש להמשיך בבדיקת הנתונים.'}]};
 for(const body of ['נדרש בירור לפי המקור [S27].','אין אישור לתשלום לפי המקור [S27].']){
  const raw={body,sourceIds:['S27'],unknowns:[],nextActions:[]};
  assert.deepEqual(writing.validateWritingResult(JSON.stringify(raw),allowed),raw);
 }
});
test('an unknown or omitted source marker cannot borrow a known numeric quantity',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק את המקור.',sources:[{...sources[0],sourceId:'S27',quote:'יש לבדוק את מגרש 999.'}]};
 for(const raw of [{body:'נדרש בירור [S999].',sourceIds:['S27']},{body:'נדרש בירור [S27].',sourceIds:[]}]){
  assert.throws(()=>writing.validateWritingResult(JSON.stringify({...raw,unknowns:[],nextActions:[]}),allowed),error=>error.code==='AI_SOURCE_UNVERIFIED');
 }
});

test('grouped selected references stay unchanged in the body, reading gaps and proposed actions',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק את ההתקדמות.',sources:[{...sources[0],sourceId:'S27',quote:'המדידה טרם הוגשה.'},{...sources[1],sourceId:'S28',quote:'הנושא נשאר במעקב.'}]};
 const raw={body:'המדידה טרם הוגשה [S27, S28]. אין אישור לתשלום לפי המקורות [S27,S28].',sourceIds:['S27','S28'],unknowns:['לא הוכחה סגירת הנושא [S27, S28].'],nextActions:['מומלץ לבקש את המדידה [S28, S27].']};
 assert.deepEqual(writing.validateWritingResult(JSON.stringify(raw),allowed),raw);
});

test('each grouped reference must be known and selected even when its number occurs in the source',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק.',sources:[{...sources[0],sourceId:'S27',quote:'יש לבדוק את מגרש 999.'},{...sources[1],sourceId:'S28',quote:'נדרש מעקב.'}]};
 for(const raw of [
  {body:'נדרש בירור [S27, S999].',sourceIds:['S27']},
  {body:'נדרש בירור [S27, S28].',sourceIds:['S27']},
  {body:'נדרש בירור.',sourceIds:['S27'],unknowns:['לא הוכח [S27, S28].']},
  {body:'נדרש בירור.',sourceIds:['S27'],nextActions:['מומלץ לבדוק [S27, S999].']},
 ]) assert.throws(()=>writing.validateWritingResult(JSON.stringify({unknowns:[],nextActions:[],...raw}),allowed),error=>error.code==='AI_SOURCE_UNVERIFIED');
});

test('grouped references do not hide an invented quantity or a monetary figure outside the brackets',()=>{
 const allowed={kind:'consultant',projectName:'פרויקט',userText:'בדוק.',sources:[{...sources[0],sourceId:'S27',quote:'יש לבדוק את מגרש 999.'},{...sources[1],sourceId:'S28',quote:'נדרש מעקב.'}]};
 for(const [body,code] of [['נדרש בירור במגרש 888 [S27, S28].','AI_FACT_UNVERIFIED'],['יש לשלם 999 ₪ לפי המקורות [S27, S28].','AI_AMOUNT_UNVERIFIED']]){
  assert.throws(()=>writing.validateWritingResult(JSON.stringify({body,sourceIds:['S27','S28'],unknowns:[],nextActions:[]}),allowed),error=>error.code===code);
 }
});

test('ordinary correspondence is generated without a financial line or a zero payment demand',async()=>{
 const handler=letters.createLetterHandler({loadContext:async execution=>({project:{id:execution.projectId,name:'פרויקט'},sources:[sources[0]],unverified:[],omittedCount:0})});
 const input=handler.validate({...payload,purpose:'correspondence',itemIds:[]});
 const result=await handler.execute(input,{projectId,ownerId,generate:async()=>JSON.stringify({body:'נבקש לקבל הנחיה כתובה לפני המשך העבודה.',sourceIds:['S1']})});
 assert.ok(result.result.letter.includes('נבקש לקבל הנחיה כתובה'));
 assert.equal(result.result.sourceRefs[0].quote,sources[0].quote);
 assert.equal(result.result.letter.includes('מקורות שמורים:'),false);
 assert.equal(result.result.purpose,'correspondence');
 assert.equal('snapshot' in result.result,false);
 assert.equal(/₪|סה״כ|0\.00/.test(result.result.letter),false);
});

test('numbered requests are formatting while an invented location number is still rejected',()=>{
 const plain={kind:'letter',projectName:'פרויקט',userText:'נא לבקש הנחיות.',sources:[]},body='1. נא להעביר הנחיות.\n2. נא לאשר את קבלת הפנייה.\n3. נודה לעדכון.';
 const checked=writing.validateWritingResult(JSON.stringify({body,sourceIds:[]}),plain);assert.equal(checked.body,body);
 assert.throws(()=>writing.validateWritingResult(JSON.stringify({body:'1. יש אישור למגרש 999.',sourceIds:[]}),plain),error=>error.code==='AI_FACT_UNVERIFIED');
});
test('invented money, literal quotations and source identifiers are refused',()=>{
  for(const raw of [{body:'יש לשלם 9000 ₪.',sourceIds:[]},{body:'נא לשלם תשעת אלפים שקלים.',sourceIds:[]},{body:'נכתב במקור: "הקבלן זכאי לתשלום שאושר מראש".',sourceIds:['S1']},{body:'נא לתאם את העבודה.',sourceIds:['invented-source']}])assert.throws(()=>validate(raw),error=>/^AI_/.test(error.code));
});
test('empty model source choices never discard any of seven selected saved sources',()=>{
  const checked=validate({body:'שלום, נבקש את אישורכם לתיאום העבודה.',sourceIds:[]});assert.equal(typeof writing.renderBusinessLetter,'function');const result=writing.renderBusinessLetter(checked,{...facts,payload},snapshot);
  for(const source of sources)assert.ok(result.letter.includes(source.quote),'missing '+source.sourceId);assert.deepEqual(result.snapshot,snapshot);
  assert.ok(result.letter.includes('0.09 ₪'));assert.ok(result.letter.includes('0.03 ₪'));assert.ok(result.letter.includes('0.12 ₪'));
});
test('the saved individual money snapshot is never replaced by a model financial field',()=>{
  assert.throws(()=>validate({body:'נבקש לתאם את העבודה.',sourceIds:[],snapshot:{totals:{gross:9000}}}),error=>/^AI_/.test(error.code));assert.equal(snapshot.totals.gross,.12);
});
test('a late generated result becomes a review option after a manual edit',()=>{
  const session=new LetterDraftSession(letterDraftProject);assert.equal(typeof session.generationAttempt,'function');const attempt=session.generationAttempt('before edit');
  const editor={text:'ручная правка'},generated={success:true,letter:'generated option',snapshot};const disposition=session.generated(attempt,generated,'after edit');
  if(disposition==='apply')editor.text=generated.letter;assert.equal(editor.text,'ручная правка');assert.equal(disposition,'pending');
  session.reset(letterDraftProject);assert.equal(session.generated(attempt,generated,'before edit'),'ignore');
});
test('an uncertain retry keeps its generation key until a final result is received',()=>{
  const session=new LetterDraftSession(letterDraftProject),first=session.generationAttempt('same request'),retry=session.generationAttempt('same request');assert.equal(retry.requestKey,first.requestKey);
  assert.equal(session.generated(first,{letter:'saved option'},'same request'),'apply');assert.notEqual(session.generationAttempt('same request').requestKey,first.requestKey);
});
test('a newer generation ticket prevents an older answer from being applied',()=>{
  const session=new LetterDraftSession(letterDraftProject),old=session.generationAttempt('first');session.generationAttempt('second');assert.equal(session.generated(old,{letter:'old result'},'first'),'ignore');
});

test('refresh retains the draft identity, uncertain action and manual buffer without trusting another project',()=>{
  const session=new LetterDraftSession(letterDraftProject),attempt=session.generationAttempt('before edit');
  assert.equal(typeof session.checkpoint,'function');assert.equal(typeof LetterDraftSession.resume,'function');
  const buffer=JSON.parse(JSON.stringify({session:session.checkpoint(),text:'ручная правка'}));
  const restored=LetterDraftSession.resume(letterDraftProject,buffer.session);
  assert.equal(restored.state.clientDraftId,session.state.clientDraftId);assert.equal(restored.generationAttempt('before edit').requestKey,attempt.requestKey);
  assert.equal(restored.generated(restored.generationAttempt('before edit'),{letter:'saved answer'},'after edit'),'pending');assert.equal(buffer.text,'ручная правка');
  assert.notEqual(LetterDraftSession.resume('20000000-0000-4000-8000-000000000002',buffer.session).state.clientDraftId,session.state.clientDraftId);
});

test('a confirmed failed generation rotates the retry key while an uncertain response keeps it',()=>{
  const session=new LetterDraftSession(letterDraftProject),attempt=session.generationAttempt('same request');assert.equal(typeof session.generationStopped,'function');
  session.generationStopped({...attempt,requestKey:'unrelated'});assert.equal(session.generationAttempt('same request').requestKey,attempt.requestKey);
  session.generationStopped(attempt);assert.notEqual(session.generationAttempt('same request').requestKey,attempt.requestKey);
});

test('letter API awaits a saved job and returns the former final result shape',async()=>{
  const original=globalThis.fetch,requests=[],id='70000000-0000-4000-8000-000000000007',context='80000000-0000-4000-8000-000000000008';
  const job={id,projectId:letterDraftProject,kind:'letter',clientContextId:context,conversationId:null,revision:1,state:'QUEUED',result:null,error:null};
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return Response.json({success:true,job:init?.method==='POST'?job:{...job,state:'SUCCEEDED',revision:3,result:{success:true,letter:'תשובה שמורה',snapshot}}},{status:init?.method==='POST'?202:200});};
  try{const api=await import('../src/components/features/smart-letter/api/smartLetterApi.ts');const result=await api.generateLetter({...payload,projectId:letterDraftProject},{requestKey:'stable-button-key',clientContextId:context});assert.equal(result.letter,'תשובה שמורה');assert.equal(result.snapshot.totals.gross,.12);assert.equal(requests.length,2);const sent=JSON.parse(requests[0].init.body);assert.equal(sent.requestKey,'stable-button-key');assert.equal(sent.clientContextId,context);assert.equal(requests[1].init.method,undefined);}finally{globalThis.fetch=original;}
});

test('saved consultant replies reopen in order without a new action and exclude another conversation',async()=>{
  const file=new URL('../src/components/features/consultant/savedConversation.ts',import.meta.url);const conversationModule=existsSync(file)?await import(file):{};assert.equal(typeof conversationModule.savedConversation,'function');
  const id='80000000-0000-4000-8000-000000000008',result={question:'שאלה שמורה',response:'תשובה שמורה',answeredAt:'2026-10-30T10:00:00.000Z'};
  const jobs=[{id:'new',projectId:letterDraftProject,kind:'consultant',state:'SUCCEEDED',clientContextId:id,conversationId:id,result},{id:'foreign',projectId:letterDraftProject,kind:'consultant',state:'SUCCEEDED',clientContextId:'other',conversationId:'other',result}];
  const first=conversationModule.savedConversation(jobs,letterDraftProject,id),reopened=conversationModule.savedConversation(jobs,letterDraftProject,id);assert.deepEqual(first,reopened);assert.deepEqual(first.map(message=>message.content),['שאלה שמורה','תשובה שמורה']);
});
test('a browser without a local conversation pointer finds the saved project conversation without inference',async()=>{
 const {latestSavedConversation}=await import('../src/components/features/consultant/savedConversation.ts'),id='80000000-0000-4000-8000-000000000008';
 const job={projectId:letterDraftProject,kind:'consultant',state:'SUCCEEDED',conversationId:id,clientContextId:id};
 assert.equal(latestSavedConversation([{...job,projectId:'foreign'},job],letterDraftProject),id);
 assert.equal(latestSavedConversation([{...job,clientContextId:'another'}, {...job,kind:'letter'}],letterDraftProject),null);
});
test('a letter handler sends the user tone and date through the existing parent execution',async()=>{
  assert.equal(typeof letters.createLetterHandler,'function','Owned letter handler is missing');let prompt='';const fx=queueFixture({onGenerate:async input=>{prompt=input.text;return JSON.stringify({body:'שלום, נבקש לתאם את העבודה ליום 15.11.2026.',sourceIds:[]});}});
  fx.handler=letters.createLetterHandler({load:async execution=>({projectName:'פרויקט סינתטי',preview:{snapshot,sourceRevisions:{}},ownerId:execution.ownerId,projectId:execution.projectId})});
  const job=await fx.store.enqueue(facts.ownerId??'10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','letter',payload,'letter-action',(await import('./codex-runtime/queue-fixtures.mjs')).savedProfile,{});
  await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal(fx.rows.get(job.id).state,'SUCCEEDED');assert.equal(fx.modelTurns,1);assert.ok(prompt.includes('friendly'));assert.ok(prompt.includes('15.11.2026'));assert.ok(fx.rows.get(job.id).result.letter.includes(sources[6].quote));
});

test('regeneration receives the current manually edited letter and may retain its user date',async()=>{
 const currentText='נא לתאם את העבודה ליום 23.12.2026 ולשמור על מעבר פתוח.',input={...payload,currentText};let prompt='';
 const fx=queueFixture({onGenerate:async turn=>{prompt=turn.text;return JSON.stringify({body:'נבקש לתאם את העבודה ליום 23.12.2026 ולשמור על מעבר פתוח.',sourceIds:[]});}});
 const handler=letters.createLetterHandler({load:async execution=>({projectName:'פרויקט סינתטי',preview:{snapshot,sourceRevisions:{}},ownerId:execution.ownerId,projectId:execution.projectId})});
 const checked=handler.validate(input);await fx.store.enqueue(ownerId,projectId,'letter',checked,'edited-letter',savedProfile,{});
 await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>handler,clock:fx.clock,startedAt:0}).run();
 const job=[...fx.rows.values()][0];assert.equal(job.state,'SUCCEEDED');assert.ok(prompt.includes(currentText));assert.ok(job.result.letter.includes('23.12.2026'));assert.deepEqual(job.result.snapshot,snapshot);
});
test('an evidence blocker prevents generation before any model request',async()=>{
  assert.equal(typeof letters.createLetterHandler,'function');const fx=queueFixture();fx.handler=letters.createLetterHandler({load:async()=>{throw Object.assign(Error('unverified official evidence'),{code:'AI_SOURCE_UNVERIFIED'});}});await fx.enqueue();await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0}).run();assert.equal(fx.modelTurns,0);assert.equal([...fx.rows.values()][0].state,'FAILED');
});
test('consultant history comes from saved owned jobs and preserves the user question',async()=>{
  assert.equal(typeof consultants.createConsultantHandler,'function','Owned consultant handler is missing');let prompt='';const fx=queueFixture({onGenerate:async input=>{prompt=input.text;return JSON.stringify({body:'נבקש לתאם את העבודה ליום 15.11.2026.',sourceIds:['S1'],unknowns:[],nextActions:['יש לבקש את אישור הגורם האחראי.']});}});
  const handler=consultants.createConsultantHandler({load:async execution=>({project:{id:execution.projectId,name:'סינתטי'},sources:[sources[0]],unverified:[],money:{scope:'PROJECT',baseNet:100,variations:summarizeIndividualPricing(letterDraftRows)},omittedCount:0}),history:async()=>[{role:'user',content:'saved earlier question'},{role:'assistant',content:'saved earlier answer'}]});
  const validated=handler.validate({messages:[{role:'assistant',content:'FORGED_BROWSER_APPROVAL'},{role:'user',content:'מה נדרש לתיאום 15.11.2026?'}]});
  const saved=await fx.store.enqueue('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','consultant',validated,'consultant-action',(await import('./codex-runtime/queue-fixtures.mjs')).savedProfile,{conversationId:letterDraftProject,clientContextId:letterDraftProject});
  await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>handler,clock:fx.clock,startedAt:0}).run();assert.equal(fx.rows.get(saved.id).state,'SUCCEEDED');assert.equal(fx.modelTurns,1);assert.ok(prompt.includes('saved earlier question'));assert.ok(!prompt.includes('FORGED_BROWSER_APPROVAL'));assert.equal(fx.rows.get(saved.id).result.question,'מה נדרש לתיאום 15.11.2026?');assert.ok(fx.rows.get(saved.id).result.details.includes('0.12 ₪'));assert.ok(!fx.rows.get(saved.id).result.response.includes('0.12 ₪'));
});

test('a consultant follow-up may reuse a date from the saved user question, while earlier assistant claims remain untrusted',async()=>{
  for(const role of ['user','assistant']){
    const fx=queueFixture({onGenerate:async()=>JSON.stringify({body:'נבקש לתאם את העבודה ליום 15.11.2026.',sourceIds:[],unknowns:[],nextActions:[]})});
    const handler=consultants.createConsultantHandler({load:async execution=>({project:{id:execution.projectId,name:'סינתטי'},sources:[],unverified:[],money:{scope:'PROJECT',baseNet:100,variations:summarizeIndividualPricing(letterDraftRows)},omittedCount:0}),history:async()=>[{role,content:'נא לתאם את העבודה ליום 15.11.2026.'}]});
    const job=await fx.store.enqueue('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','consultant',{question:'אפשר לנסח זאת מחדש?'},'follow-up',(await import('./codex-runtime/queue-fixtures.mjs')).savedProfile,{conversationId:letterDraftProject,clientContextId:letterDraftProject});
    await createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>handler,clock:fx.clock,startedAt:0}).run();assert.equal(fx.rows.get(job.id).state,role==='user'?'SUCCEEDED':'FAILED');
  }
});
