import './codex-runtime/load-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {loadProjectWritingContext}=await import('../src/utils/project-writing-context-server.ts');
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
 const incomplete={...doc('partial','מת״מ: אישור מותנה.','פרוטוקול.pdf'),parsed_json:{source_reading:{version:'page-coverage-v1',complete:false,totalPages:2,readPages:[1],unreadablePages:[2]}}};
 const context=await loadProjectWritingContext(clientFor([doc('draft','טיוטה\nמת״מ: אישור.'),incomplete]),project,owner,'מה מצב מת״מ?');
 assert.equal(context.sources.length,0);
 assert.deepEqual(context.unverified.map(row=>row.documentId).sort(),['draft','partial']);
});
