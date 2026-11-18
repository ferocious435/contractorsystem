import './codex-runtime/load-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,sourceDocument,visualRegistry,imageRegistry} from './codex-runtime/visual-reading-fixtures.mjs';
const {loadProjectWritingContext}=await import('../src/utils/project-writing-context-server.ts');
const {createConsultantHandler}=await import('../src/server/ai/handlers/consultant.ts');
const owner='10000000-0000-4000-8000-000000000001',project='30000000-0000-4000-8000-000000000003';
const doc=(id,text,title='פרוטוקול.txt')=>({id,project_id:project,title,extracted_text:text,ocr_status:'COMPLETED',deleted_at:null});
function clientFor(documents){
 return {from(table){let start=0,end=Infinity,single=false;const filters=[];
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},order(){return q;},range(a,b){start=a;end=b;return q;},maybeSingle(){single=true;return q;},
   then(yes,no){const all=(table==='projects'?[{id:project,contractor_id:owner,name:'פרויקט',budget:null}]:table==='documents'?documents:[]).filter(row=>filters.every(([k,v])=>row[k]===v));return Promise.resolve({data:single?all[0]??null:all.slice(start,end+1),count:all.length,error:null}).then(yes,no);}};
  return q;}};
}
test('a relevant saved source beyond the first database page is available to the question',async()=>{
 const documents=Array.from({length:1000},(_,i)=>doc('doc-'+i,'אין שינויים בגינון.'));
 documents.push(doc('doc-mtm','שינוי מת״מ מותנה בנספח חתום ובאישור בכתב.'));
 const context=await loadProjectWritingContext(clientFor(documents),project,owner,'האם אפשר לבצע מת״מ?');
 assert.ok(context.sources.some(source=>source.documentId==='doc-mtm'));
 assert.equal(context.omittedCount,1000);
});
test('Hebrew acronyms retain the exact original quotation and exclude unrelated common words',async()=>{
 const text='מת״מ מאושר עקרונית בלבד. אין להתחיל בביצוע לפני נספח חתום ואישור בכתב.';
 const context=await loadProjectWritingContext(clientFor([doc('irrelevant','יש לבקש אישור ביטוח.'),doc('mtm',text)]),project,owner,'מה נדרש לאישור מת״מ?');
 assert.equal(context.sources[0].documentId,'mtm');
 assert.equal(context.sources[0].quote,text);
});
test('a Hebrew acronym retrieves the same Latin acronym used in saved project documents',async()=>{
 const text='MTM: אין אישור לפעול עד לחתימה על נספח להסכם ואישור בכתב של התאגיד.';
 const context=await loadProjectWritingContext(clientFor([doc('admin','תנאים לאישור בקשת ביטוח.'),doc('method',text)]),project,owner,'מה התנאים לביצוע מת״מ?');
 assert.equal(context.sources[0].documentId,'method');assert.equal(context.sources[0].quote,text);
});
test('different dated sources for the subject are retained instead of six fragments from one long source',async()=>{
 const docs=Array.from({length:9},(_,i)=>doc('mtm-'+i,`מת״מ: יש לבדוק את התנאים במסמך המקורי מיום ${i+1}.01.2025.`));
 const context=await loadProjectWritingContext(clientFor(docs),project,owner,'מה מצב מת״מ?');
 assert.equal(new Set(context.sources.map(source=>source.documentId)).size,9);
 assert.equal(context.omittedCount,0);
});
test('an explicit draft and a PDF with an unread page remain reading gaps rather than verified sources',async()=>{
 const incomplete={...doc('partial','מת״מ: אישור מותנה.','נספח 15.1.25 (002).pdf'),parsed_json:{source_reading:{version:'page-coverage-v1',complete:false,totalPages:2,readPages:[1],unreadablePages:[2]}}};
 const context=await loadProjectWritingContext(clientFor([doc('draft','טיוטה\nמת״מ: אישור.'),incomplete]),project,owner,'מה מצב מת״מ?');
 assert.equal(context.sources.length,0);
 assert.deepEqual(context.unverified.map(row=>row.documentId).sort(),['draft','partial']);
 assert.equal(context.unverified.find(row=>row.documentId==='partial').title,incomplete.title);
});
test('a new consultant subject keeps its detailed condition despite earlier questions on another subject',async()=>{
 const oldQuestion='מה מתועד במסמך החפיפה על חדרי תאורה, תיאום תכנון התאורה, מיקומי התאורה והתוכנית האחרונה?';
 const detail='| תחנות שאיבה | החלפת המשאבות הוסכמה בכפוף למסמך אחריות חתום. | ממתין לחתימה |';
 const text='מסמך חפיפה\nחדרי תאורה: תיאום תכנון התאורה ומיקומי התאורה עדיין בטיפול.\nתחנות שאיבה: שינוי המשאבות בבדיקה.\n'+('נתוני גינון וריצוף מעודכנים.\n'.repeat(160))+detail+'\n'+('המשך רשימת עבודות תחזוקה.\n'.repeat(60));
 let selected;
 const handler=createConsultantHandler({history:async()=>[{role:'user',content:oldQuestion},{role:'assistant',content:'התאורה בבדיקה.'}],
  load:async(execution,question,previousQuestion)=>selected=await loadProjectWritingContext(clientFor([doc('handover',text)]),project,owner,question,previousQuestion)});
 await handler.execute({question:'לפי מסמך החפיפה, מה הוסכם על החלפת המשאבות בתחנות שאיבה ואיזה מסמך אחריות נדרש?'},{projectId:project,ownerId:owner,generate:async()=>JSON.stringify({body:'יש לברר את מצב ההסכמה ולבקש מסמך חתום.',sourceIds:[],unknowns:[],nextActions:[]})});
 assert.ok(selected.sources.some(source=>source.quote.includes('החלפת המשאבות הוסכמה בכפוף למסמך אחריות חתום.')),'latest subject lost its detailed condition');
 for(const source of selected.sources)assert.ok(text.includes(source.quote));
});
test('a consultant follow-up retains the saved source for the previous subject',async()=>{
 const source='משאבות: החלופה ממתינה למסמך אחריות חתום.';
 const context=await loadProjectWritingContext(clientFor([doc('pump',source)]),project,owner,'אפשר להמשיך?','מה מצב המשאבות?');
 assert.equal(context.sources.length,1);assert.equal(context.sources[0].documentId,'pump');assert.equal(context.sources[0].quote,source);
});

test('analysis_and_writing_use_corrected_source_text_and_its_version',async()=>{
 const text='משאבות: יש להמתין למסמך אחריות חתום.',saved=sourceDocument({project_id:project,title:'הוראות.pdf',deleted_at:null,extracted_text:text,extracted_text_hash:digest(text)});
 saved.parsed_json={source_reading:visualRegistry({currentTextHash:digest(text)}),full_markdown:'Old uncorrected source'};
 const context=await loadProjectWritingContext(clientFor([saved]),project,owner,'מה נדרש למשאבות?');
 assert.equal(context.sources[0].quote,text);assert.equal(context.sources[0].textHash,digest(text));
});
test('a_drawing_is_supplied_as_visual_context_without_becoming_a_literal_quote',async()=>{
 const description='משאבות מחוברות בתרשים למסלול מעבר.',proof=visualRegistry({currentTextHash:digest('')});proof.expectedUnits[0]={...proof.expectedUnits[0],literalHasBody:false,visualHasContent:true};
 const saved=sourceDocument({project_id:project,deleted_at:null,extracted_text:'',extracted_text_hash:digest(''),parsed_json:{source_reading:proof,source_reading_visual_descriptions:[{unitId:'pdf:1',location:{page:1},text:description}]}});
 const context=await loadProjectWritingContext(clientFor([saved]),project,owner,'מה מופיע בתרשים המשאבות?');
 assert.equal(context.sources.length,0);assert.equal(context.visualContext[0].description,description);assert.equal(context.omittedCount,0);
 let prompt;await createConsultantHandler({history:async()=>[],load:async()=>context}).execute({question:'מה בתרשים?'},{projectId:project,ownerId:owner,generate:async input=>{prompt=input.text;return JSON.stringify({body:'התרשים מציג מסלול מעבר.',sourceIds:[],unknowns:[],nextActions:[]});}});
 assert.ok(prompt.includes(description));assert.match(prompt,/never a literal quotation/);
});
test('a saved photo contributes its verified description and actual frame to the selected question context',async()=>{
 const description='משאבות מחוברות בצילום למסלול מעבר.',proof=imageRegistry({text:''}),saved=sourceDocument({title:'צילום משאבות.jpg',project_id:project,deleted_at:null,extracted_text:'',extracted_text_hash:digest(''),parsed_json:{source_reading:proof,source_reading_visual_descriptions:[{unitId:proof.expectedUnits[0].id,location:proof.expectedUnits[0].locations[0],text:description}]}});
 const context=await loadProjectWritingContext(clientFor([saved]),project,owner,'מה מופיע בצילום המשאבות?');assert.deepEqual(context.sources,[]);assert.equal(context.visualContext[0].description,description);assert.equal(context.visualContext[0].location.frame,1);assert.equal(context.visualContext[0].documentId,saved.id);assert.equal(context.omittedCount,0);
});

test('consultant topic history includes later direct rows before large general background',async()=>{
 const question='מה מצב מדידת סחף קרקע ליד קיר כלונסאות במפעל נגב ואיך התקדמה ההנחיה?';
 const docs=Array.from({length:30},(_,i)=>doc('background-'+i,'חוזה\n'+('מדידת סחף קרקע במפעל נגב ליד קיר כלונסאות, כללי תיאום כלליים. '.repeat(100))));
 const early='נדרשת מדידת סחף קרקע ליד קיר כלונסאות.',late='מדידה ליד קיר כלונסאות טרם הועברה. הקבלן הבטיח למסור בימים הקרובים.';
 const other='\n\nתאורה:\n'+('תאורה וריצוף בבדיקה.\n'.repeat(150));
 docs.push(doc('early','פרוטוקול\nתאריך: 14.05.25\n\nמפעל נגב:\n'+early+'\nהקבלן\t21.05.25'+other),doc('late','פרוטוקול\nתאריך: 30.07.25\n\nמפעל נגב:\n'+late+'\nהקבלן\t13.08.25'+other));
 const context=await loadProjectWritingContext(clientFor(docs),project,owner,question,'',{includeTopicHistory:true});
 assert.ok(context.sources.some(source=>source.documentId==='early'&&source.quote.includes(early)));
 assert.ok(context.sources.some(source=>source.documentId==='late'&&source.quote.includes(late)));
 assert.ok(context.sources.some(source=>source.documentId==='late'&&source.quote.includes('30.07.25')));
 assert.ok(context.sources.length<=32);assert.ok(context.sources.reduce((sum,source)=>sum+source.quote.length,0)<=32000);
 for(const source of context.sources)assert.ok(docs.find(doc=>doc.id===source.documentId).extracted_text.includes(source.quote));
});
test('topic history retains draft and unread-page gaps and does not date an undated source from upload time',async()=>{
 const text='מפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.';
 const partial={...doc('partial',text,'מדידה.pdf'),parsed_json:{source_reading:{version:'page-coverage-v1',complete:false,totalPages:2,readPages:[1],unreadablePages:[2]}}};
 const docs=[doc('draft','טיוטה\n'+text),partial,{...doc('undated',text,'פרוטוקול 01.01.2099.txt'),created_at:'2099-01-01T00:00:00Z'}];
 const context=await loadProjectWritingContext(clientFor(docs),project,owner,'מה מצב מדידת סחף קרקע ליד קיר כלונסאות במפעל נגב?','',{includeTopicHistory:true});
 assert.ok(!context.sources.some(source=>['draft','partial'].includes(source.documentId)));
 assert.ok(['draft','partial'].every(id=>context.unverified.some(source=>source.documentId===id)));
 assert.ok(context.unverified.some(source=>source.documentId==='undated'&&/תאריך|מועד/u.test(source.reason)));
});

test('Hebrew query variants cannot crowd the concrete instruction history out of the source cap',async()=>{
 const question='מה מתועד בנושא ניקוז מפעל נגב ומדידת אזורי סחף הקרקע ליד קיר הכלונסאות? הסבר איך ההנחיות התקדמו עם הזמן ומה עדיין לא הוכח כבוצע. הבדל בין טענת צד לבין הנחיה ותן הפניות למקורות. האם יש בסיס לראות את הנושא כסגור?';
 const docs=Array.from({length:20},(_,i)=>doc('spec-'+i,'תאריך: 1.1.20\n\nכלונסאות:\nהפניות ופניות לסעיפי מפרט ניקוז וקירות כלונסאות, בהתאם לסוג הקרקע.'));
 for(const [i,date] of ['1.5.25','14.5.25','21.5.25','28.5.25','24.6.25','1.7.25','30.7.25'].entries())docs.push(doc('history-'+i,'פרוטוקול\nתאריך: '+date+'\n\nמפעל נגב:\nהקבלן טרם הגיש את מדידת אזורי סחף הקרקע כנדרש. הנושא מעוכב ועל הקבלן להמציא את הנתונים לפיקוח.'));
 const context=await loadProjectWritingContext(clientFor(docs),project,owner,question,'',{includeTopicHistory:true});
 for(let i=0;i<7;i++)assert.ok(context.sources.some(source=>source.documentId==='history-'+i&&source.quote.includes('מדידת אזורי סחף הקרקע')),'missing actual topic history '+i);
 assert.ok(context.sources.length<=32);
});

test('a precise current acronym is not displaced by a large previous topic',async()=>{
 const docs=Array.from({length:30},(_,i)=>doc('lighting-'+i,'תאריך: '+(i+1)+'.1.25\n\nתאורה:\nתכנון התאורה ומיקומי המנורות עדיין בטיפול.'));
 docs.push(doc('method','MTM: יש להמתין למסמך אחריות חתום ואישור בכתב.'));
 const context=await loadProjectWritingContext(clientFor(docs),project,owner,'מה מצב מת״מ?','מה מצב תכנון התאורה ומיקומי המנורות? מוצגת ההיסטוריה.',{includeTopicHistory:true});
 assert.equal(context.sources[0].documentId,'method');
});

test('consultant saves source-backed supply and laying rows with the accepted answer',async()=>{
 const body='כתב כמויות לביצוע\nסעיף תיאור יחידה כמות מחיר סה"כ\nהמחירים ללא מע"מ\nדחיקת צינורות פיברגלס בשיטת Micro Tunneling בקוטר 450 מ"מ 57.91.0016\nאספקת הצינורות נמדדת בנפרד\n496,551.00 3,310.34 150.00 מטר\nאספקה בלבד של צינורות GRP בקוטר 450 מ"מ 57.91.0022\n402,085.50 2,680.57 150.00 מטר';
 const boq=doc('boq',body,'כתב כמויות לביצוע.txt');boq.category='CONTRACT';
 const instruction='מכתב: ברחוב יהלום יש לבצע דחיקת צינורות GRP בקוטר 450 מ"מ.';
 const documents=[boq,doc('instruction',instruction,'מכתב.txt')];
 const handler=createConsultantHandler({history:async()=>[],load:async(e,q)=>loadProjectWritingContext(clientFor(documents),project,owner,q,'',{includeTopicHistory:true})});
 const result=await handler.execute({question:'מה הבסיס לביצוע ברחוב יהלום?'},{projectId:project,ownerId:owner,generate:async()=>JSON.stringify({body:'המכתב מורה לבצע את העבודה. [S1]',sourceIds:['S1'],unknowns:[],nextActions:[]})});
 assert.equal(result.result.boqRows?.length,2,'saved answer must carry both original BOQ rows');
 assert.deepEqual(result.result.boqRows.map(row=>row.unitPrice),[3310.34,2680.57]);
 assert.ok(result.result.details.includes('3310.34'));assert.ok(result.result.details.includes('2680.57'));
 assert.ok(Number.isFinite(Date.parse(result.result.answeredAt)));assert.deepEqual(result.effects,[]);
 const ordinary=await loadProjectWritingContext(clientFor(documents),project,owner,'מה הבסיס לביצוע ברחוב יהלום?');assert.equal(ordinary.boqRows,undefined);
 await assert.rejects(()=>handler.execute({question:'מה הבסיס לביצוע ברחוב יהלום?'},{projectId:project,ownerId:owner,generate:async()=>JSON.stringify({body:'יש לשלם 999999 ₪.',sourceIds:[],unknowns:[],nextActions:[]})}));
});

test('conditional contractor reply is saved distinctly and remains immutable on catalogue reload',async()=>{
 const {selectConsultantBoqRows}=await import('../src/utils/consultant-boq.ts');
 const {createConsultantBoqRevisionReader}=await import('../src/server/ai/consultant-boq-revisions.server.ts');
 const {savedConsultantBoqRows,consultantBoqRowKey}=await import('../src/utils/consultant-result.ts');
 const text='כתב כמויות לביצוע\nמספר כתב כמויות: A; מהדורה: one\nסעיף תיאור יחידה כמות מחיר סה"כ\nהמחירים ללא מע"מ\nדחיקת צינורות GRP בקוטר 450 מ"מ 57.91.0016\n496,551.00 3,310.34 150.00 מטר\nאספקה בלבד של צינורות GRP בקוטר 450 מ"מ 57.91.0022\n402,085.50 2,680.57 150.00 מטר';
 const a=doc('boq-a',text,'כתב כמויות.txt');a.content_hash='a';a.extracted_text_hash=digest(text);
 const proposal='הקבלן מציע דחיקת צינורות GRP בקוטר 450 מ"מ. התשובה: מאושר עקרונית בכפוף לנספח חתום, ללא אישור לתוספת תשלום.';
 const documents=[a,doc('proposal',proposal,'מכתב.txt')];let prompt;
 const handler=createConsultantHandler({history:async()=>[],load:async(e,q)=>loadProjectWritingContext(clientFor(documents),project,owner,q,'',{includeTopicHistory:true})});
 const prepared=await handler.execute({question:'מה הוסכם על הצעת הקבלן לדחיקת צינורות GRP בקוטר 450 מ"מ?'},{projectId:project,ownerId:owner,generate:async input=>{prompt=input.text;return JSON.stringify({body:'הקבלן הציע את השינוי. התשובה היא הסכמה עקרונית בכפוף לנספח חתום, ללא אישור לתוספת תשלום.',sourceIds:[],unknowns:[],nextActions:[]});}});
 assert.ok(prompt.includes('מאושר עקרונית בכפוף לנספח חתום')); assert.match(prompt,/A direct instruction/);assert.match(prompt,/Preserve every source identifier/);
 assert.match(prepared.result.response,/בכפוף לנספח חתום/);assert.equal(prepared.result.boqRows.length,2);
 const saved=structuredClone(prepared.result),conversation='40000000-0000-4000-8000-000000000004';
 const good={id:'50000000-0000-4000-8000-000000000005',projectId:project,kind:'consultant',conversationId:conversation,clientContextId:conversation,state:'SUCCEEDED',result:prepared.result};
 const legacy={...good,id:'legacy',result:{response:'old exact answer'}};
 const jobs=[good,legacy,{...good,id:'failed',state:'FAILED'},{...good,id:'other',projectId:'other'},{...good,id:'other-conversation',conversationId:'other'},{...good,id:'wrong-kind',kind:'pricing'}];
 const newText=text.replace('מהדורה: one','מהדורה: two').replace('3,310.34','4,000.00').replace('496,551.00','600,000.00')+'\nכתב כמויות A מהדורה two מחליף את כתב כמויות A מהדורה one.';documents.push({...doc('new',newText,'מהדורה חדשה.txt'),content_hash:'new',extracted_text_hash:digest(newText)});
 const reader=createConsultantBoqRevisionReader({authenticate:async()=>owner,client:()=>clientFor(documents),store:()=>({listOwned:async(o,p,k,c)=>{assert.deepEqual([o,p,k,c],[owner,project,'consultant',conversation]);return jobs;}})});
 const request=()=>new Request(`http://localhost/api/chat/boq-revisions?projectId=${project}&conversationId=${conversation}`);
 const response=await reader(request());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const opened=await response.json();
 assert.deepEqual(opened.jobs.map(job=>job.jobId),[good.id,'legacy']);assert.equal(opened.availability,'AVAILABLE');assert.deepEqual(opened.jobs[1].rows,[]);
 assert.equal(opened.jobs[0].rows[0].rowKey,consultantBoqRowKey(saved.boqRows[0]));assert.equal(opened.jobs[0].rows[0].comparison.status,'REPLACED');assert.equal(opened.jobs[0].rows[0].comparison.currentRow.unitPrice,4000);assert.equal(opened.jobs[0].rows[0].comparison.editionHistory.length,1);
 assert.deepEqual(prepared.result,saved);assert.deepEqual(legacy.result,{response:'old exact answer'});
 const corrupt={boqRows:[null,{}, {...saved.boqRows[0],unitPrice:999},saved.boqRows[1]]};assert.equal(savedConsultantBoqRows(corrupt).length,1);
 const failingClient=()=>({from(table){if(table==='documents')throw new Error('offline');return clientFor(documents).from(table);}});
 const fallback=await createConsultantBoqRevisionReader({authenticate:async()=>owner,client:failingClient,store:()=>({listOwned:async()=>[good]})})(request());
 const unavailable=await fallback.json();assert.equal(unavailable.availability,'UNAVAILABLE');assert.deepEqual(unavailable.jobs[0].rows[0].originalRow,saved.boqRows[0]);assert.equal(unavailable.jobs[0].rows[0].comparison,null);
 const empty=await createConsultantBoqRevisionReader({authenticate:async()=>owner,client:()=>clientFor([]),store:()=>({listOwned:async()=>[]})})(request());assert.deepEqual((await empty.json()).jobs,[]);
 const denied=await createConsultantBoqRevisionReader({authenticate:async()=> 'another-owner',client:()=>clientFor(documents),store:()=>{throw new Error('must not list');}})(request());assert.equal(denied.status,403);
 assert.equal((await reader(new Request(`http://localhost/?projectId=${project}&conversationId=invalid`))).status,400);
 const unsigned=await createConsultantBoqRevisionReader({authenticate:async()=>{const {BusinessAiError}=await import('../src/server/ai/contracts.ts');throw new BusinessAiError('AI_UNAUTHORIZED','login',401);}})(request());assert.equal(unsigned.status,401);
});

if(process.env.CONSULTANT_BOQ_FIXTURES){
 test('saved real catalogue selects all four original BOQ rows within the shared evidence budget',async()=>{
  const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');
  const documents=JSON.parse(await readFile(join(process.env.CONSULTANT_BOQ_FIXTURES,'project-documents.json'),'utf8'));
  const request=JSON.parse(await readFile(join(process.env.CONSULTANT_BOQ_FIXTURES,'request.json'),'utf8'));
  const mapped=documents.map(document=>({...document,project_id:project,deleted_at:null}));
  const context=await loadProjectWritingContext(clientFor(mapped),project,owner,request.question,'',{includeTopicHistory:true});
  assert.equal(context.boqRows.length,4);const {savedConsultantBoqRows}=await import('../src/utils/consultant-result.ts');assert.equal(savedConsultantBoqRows({boqRows:context.boqRows}).length,4);assert.ok(context.sources.length<=32);assert.ok(context.sources.reduce((sum,source)=>sum+source.quote.length,0)<=32000);
  for(const row of context.boqRows)assert.ok(context.sources.some(source=>source.documentId===row.documentId&&source.quote.includes(row.quote)));
  if(process.env.CONSULTANT_BOQ_PAYMENT_DOCUMENT){
   const appendix=mapped.find(document=>document.id===process.env.CONSULTANT_BOQ_PAYMENT_DOCUMENT);assert.ok(appendix);
   for(const pattern of [/לא\s+תשולם[^\n]*תוספת/u,/(?:קבלן|הקבלן)[^\n]*בקשה/u,/המזמינה[^\n]*בכפוף/u])assert.ok(context.sources.some(source=>source.documentId===appendix.id&&pattern.test(source.quote)),'the current question must retain the payment condition, initiative and conditional reply without establishing signature');
  }
 });
}
