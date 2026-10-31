import test from 'node:test';import assert from 'node:assert/strict';
const actions=await import('../src/components/documents/documentAiApi.ts');
test('source reading is independent of model readiness and reloads the actual saved document',async()=>{
 assert.equal(typeof actions.readDocumentSource,'function');const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),body:options?.body?JSON.parse(options.body):null});return String(url).includes('extract-text')?Response.json({success:true,requiresReview:false}):Response.json({success:true,documents:[{id:'doc',project_id:'project',extracted_text:'מקור מלא',ocr_status:'COMPLETED',parsed_json:{owner_note:'keep'}}]});};
 try{const result=await actions.readDocumentSource('project','doc');assert.equal(result.extracted_text,'מקור מלא');assert.equal(result.parsed_json.owner_note,'keep');assert.deepEqual(requests.map(x=>x.url),['/api/documents/extract-text','/api/documents?projectId=project']);assert.deepEqual(requests[0].body,{projectId:'project',documentId:'doc'});}finally{globalThis.fetch=original;}
});
test('denied reading never returns a success or starts an analysis action',async()=>{
 assert.equal(typeof actions.readDocumentSource,'function');const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({error:'not owned'},{status:403});};
 try{await assert.rejects(actions.readDocumentSource('project','foreign'));assert.equal(requests,1);}finally{globalThis.fetch=original;}
});
