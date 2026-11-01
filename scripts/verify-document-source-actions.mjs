import test from 'node:test';import assert from 'node:assert/strict';
const actions=await import('../src/components/documents/documentAiApi.ts');
const project='cccccccc-cccc-4ccc-8ccc-cccccccccccc',documentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('source reading uses the program worker and reloads the actual saved document',async()=>{
 assert.equal(typeof actions.readDocumentSource,'function');const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),body:options?.body?JSON.parse(options.body):null});return String(url).includes('process')?Response.json({success:true,job:{id,projectId:project,kind:'document_analysis',clientContextId:documentId,operation:'read_source',state:'SUCCEEDED',revision:3,result:{documentId,success:true}}}):Response.json({success:true,documents:[{id:documentId,project_id:project,extracted_text:'מקור מלא',ocr_status:'COMPLETED',parsed_json:{owner_note:'keep'}}]});};
 try{const result=await actions.readDocumentSource(project,documentId);assert.equal(result.extracted_text,'מקור מלא');assert.equal(result.parsed_json.owner_note,'keep');assert.deepEqual(requests.map(x=>x.url),['/api/documents/process','/api/documents?projectId='+project]);assert.equal(requests[0].body.operation,'read_source');assert.equal(requests[0].body.documentId,documentId);}finally{globalThis.fetch=original;}
});
test('denied reading never returns a success or starts an analysis action',async()=>{
 assert.equal(typeof actions.readDocumentSource,'function');const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({error:'not owned'},{status:403});};
 try{await assert.rejects(actions.readDocumentSource(project,documentId));assert.equal(requests,1);}finally{globalThis.fetch=original;}
});
