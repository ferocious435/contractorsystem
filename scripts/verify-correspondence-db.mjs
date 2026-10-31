import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareLettersDb,runLettersSql,jsonSql} from './letters-db.mjs';
const migration='supabase/migrations/20261031120000_project_correspondence.sql';
await prepareLettersDb();
if(fs.existsSync(migration)){
 runLettersSql('drop table if exists public.project_correspondence cascade; drop function if exists public.write_project_correspondence(jsonb); drop function if exists public.guard_project_correspondence_write();');
 runLettersSql(fs.readFileSync(migration,'utf8'));
}
const owner='10000000-0000-4000-8000-000000000001',project='90000000-0000-4000-8000-000000000001',draft='90000000-0000-4000-8000-000000000002';
const payload={operation:'save',projectId:project,clientDraftId:draft,expectedRevision:0,operationId:'90000000-0000-4000-8000-000000000003',subject:'בקשת הנחיה',recipient:'מנהל הפרויקט',content:'נא לקבל הנחיה כתובה.',sourceRefs:[]};
runLettersSql(`insert into public.projects(id,name,contractor_id) values('${project}','סינתטי בלבד','${owner}') on conflict do nothing;`);
const write=p=>jsonSql(`select public.write_project_correspondence('${JSON.stringify(p).replaceAll("'","''")}'::jsonb);`,{role:'authenticated',userId:owner});
test('ordinary letters save and reopen with no financial record; retry has one identity',()=>{
 runLettersSql(`delete from public.project_correspondence where project_id='${project}';`);
 const first=write(payload),retry=write(payload);
 assert.equal(first.id,retry.id);assert.equal(first.revision,1);assert.equal(first.status,'DRAFT');assert.equal(first.content,payload.content);
 assert.equal(jsonSql(`select count(*)::integer from public.project_correspondence where project_id='${project}';`),1);
 assert.equal(jsonSql(`select count(*)::integer from public.pricing_ledger where project_id='${project}';`),0);
 assert.equal(Object.hasOwn(first,'total_amount_excl_vat'),false);
});
test('editing saves the same ordinary letter and stale or changed retries cannot overwrite it',()=>{
 const change={...payload,expectedRevision:1,operationId:'90000000-0000-4000-8000-000000000004',content:'נא לקבל הנחיה כתובה לפני המשך העבודה.'};
 const result=write(change);assert.equal(result.revision,2);assert.equal(result.client_draft_id,draft);
 assert.throws(()=>write({...payload,operationId:'90000000-0000-4000-8000-000000000005'}),error=>error.code==='PT409');
 assert.throws(()=>write({...change,content:'different retry'}),error=>error.code==='PT409');
 assert.equal(jsonSql(`select to_jsonb(content) from public.project_correspondence where project_id='${project}';`),change.content);
});
test('another owner cannot read or edit the ordinary letter',()=>{
 assert.equal(jsonSql(`select count(*)::integer from public.project_correspondence where project_id='${project}';`,{role:'authenticated',userId:'10000000-0000-4000-8000-000000000002'}),0);
 assert.throws(()=>jsonSql(`select public.write_project_correspondence('${JSON.stringify({...payload,expectedRevision:2})}'::jsonb);`,{role:'authenticated',userId:'10000000-0000-4000-8000-000000000002'}),error=>error.code==='42501');
});
test('ordinary source quotations are verified against the current owned document and failures are atomic',()=>{
 const document='90000000-0000-4000-8000-000000000008',sourceDraft='90000000-0000-4000-8000-000000000009';
 runLettersSql(`insert into public.documents(id,project_id,title,extracted_text,ocr_status) values('${document}','${project}','הנחיה.txt','אין אישור ביצוע לפני הנחיה כתובה.','COMPLETED') on conflict(id) do update set extracted_text=excluded.extracted_text;`);
 const input={...payload,clientDraftId:sourceDraft,operationId:'90000000-0000-4000-8000-000000000010',sourceRefs:[{documentId:document,basis:'DOCUMENT',quote:'אושר תשלום ללא תנאים.'}]};
 assert.throws(()=>write(input),error=>error.code==='PT422');
 assert.equal(jsonSql(`select count(*)::integer from public.project_correspondence where client_draft_id='${sourceDraft}';`),0);
 const valid={...input,sourceRefs:[{documentId:document,basis:'DOCUMENT',quote:'אין אישור ביצוע לפני הנחיה כתובה.'}]};
 assert.equal(write(valid).source_refs[0].quote,valid.sourceRefs[0].quote);
 runLettersSql(`update public.documents set extracted_text='נדרש אישור חדש.' where id='${document}';`);
 assert.throws(()=>write({...valid,expectedRevision:1,operationId:'90000000-0000-4000-8000-000000000011'}),error=>error.code==='PT422');
 assert.equal(jsonSql(`select revision from public.project_correspondence where client_draft_id='${sourceDraft}';`),1);
});
test('marking sent is a separate explicit operation and prevents later edits',()=>{
 const p={operation:'markSent',projectId:project,clientDraftId:draft,expectedRevision:2,operationId:'90000000-0000-4000-8000-000000000006'};
 const result=write(p);assert.equal(result.status,'SENT');assert.equal(result.revision,3);assert.ok(result.sent_marked_at);
 assert.equal(write(p).revision,3);
 assert.throws(()=>write({...payload,expectedRevision:3,operationId:'90000000-0000-4000-8000-000000000007'}),error=>error.code==='PT409');
});
