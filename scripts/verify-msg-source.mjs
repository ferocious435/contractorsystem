import assert from 'node:assert/strict';import test from 'node:test';import {createHash} from 'node:crypto';import fs from 'node:fs';
import {msgFixture,nativeMsgFixture,uncompressedRtf,cyclicMsgFixture,compressedRtfFixture} from './fixtures/msg-fixtures.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const api=()=>import('../src/server/documents/msg-source.server.ts');
const container=()=>import('../src/server/documents/msg-container.server.ts');
async function extract(file,body='אושר',options){const {createMsgSourceExtractor}=await api(),{readMsgContainer}=await container();return createMsgSourceExtractor({container:readMsgContainer,native:async()=>nativeMsgFixture({body})})(file,options);}

test('short_and_long_bodies_are_preserved',async()=>{
 for(const body of ['אושר','א'.repeat(130001)+'\r\nסוף']){const file=msgFixture({body}),before=digest(file),result=await extract(file,body),root=result.parts.find(p=>p.id===result.rootPartId);
  assert.equal(root.body.text,body);assert.equal(root.body.textHash,digest(body));assert.equal(root.body.complete,true);assert.equal(result.sourceHash,before);assert.deepEqual(result.issues,[]);assert.equal(digest(file),before);}
});
test('headers_without_confirmed_body_are_partial',async()=>{
 const result=await extract(msgFixture({omitBody:true}),'Only a header');const root=result.parts.find(p=>p.id===result.rootPartId);assert.equal(root.body.complete,false);assert.equal(root.body.text,'');assert.ok(result.issues.length>0);
 const rtf=await extract(msgFixture({rtf:Buffer.from('not compressed RTF')}));assert.ok(rtf.issues.some(s=>s.includes('RTF')));
});
test('duplicate_names_have_distinct_parts',async()=>{
 const file=msgFixture({attachments:[{name:'same.pdf',data:Buffer.from('first')},{name:'same.pdf',data:Buffer.from('second')}]}),result=await extract(file),parts=result.parts.filter(p=>p.id!==result.rootPartId);
 assert.equal(parts.length,2);assert.equal(parts[0].name,'same.pdf');assert.equal(parts[1].name,'same.pdf');assert.notEqual(parts[0].id,parts[1].id);assert.notEqual(parts[0].payloadHash,parts[1].payloadHash);
 assert.equal(result.payloads.get(parts[0].id).toString(),'first');assert.equal(result.payloads.get(parts[1].id).toString(),'second');
});
test('a_missing_attachment_tree_cannot_be_reported_as_an_empty_message',async()=>{
 const result=await extract(msgFixture({attachmentCountOverride:1}));assert.ok(result.issues.some(s=>s.includes('INVENTORY')));
});
test('inline_reference_is_not_an_attachment_inventory',async()=>{
 const literal=await extract(msgFixture({body:'See <image001.png> and https://example.invalid/document.pdf'}));assert.equal(literal.parts.length,1);assert.deepEqual(literal.issues,[]);
 const missing=await extract(msgFixture({html:'<p>אושר</p><img src="cid:missing">'}));assert.ok(missing.issues.some(s=>s.includes('CID')||s.includes('HTML')));
 const attached=await extract(msgFixture({attachments:[{name:'logo.png',mimeType:'image/png',contentId:'logo',data:Buffer.from('PNG')}]}));assert.equal(attached.parts.find(p=>p.name==='logo.png').kind,'INLINE');
});
test('embedded_messages_without_file_bytes_remain_explicit',async()=>{
 const result=await extract(msgFixture({attachments:[{name:'nested.msg',embedded:{body:'Nested body'}}]}));const nested=result.parts.find(p=>p.name==='nested.msg');assert.equal(nested.kind,'MESSAGE');assert.equal(nested.payloadHash,null);assert.ok(nested.issues.length>0);assert.equal(nested.body.text,'Nested body');
});
test('binary_nested_messages_keep_own_body_and_origin',async()=>{
 const file=msgFixture({attachments:[{name:'nested.msg',mimeType:'application/vnd.ms-outlook',data:msgFixture({body:'Nested body'})}]}),result=await extract(file),nested=result.parts.find(p=>p.name==='nested.msg');
 assert.equal(nested.kind,'MESSAGE');assert.equal(nested.parentId,result.rootPartId);assert.equal(nested.body.text,'Nested body');assert.ok(result.payloads.get(nested.id));
});
test('container_limits_and_cancellation_are_bounded',async()=>{
 const {readMsgContainer}=await container(),small=await readMsgContainer(msgFixture(),{limits:{maxSourceBytes:100}});assert.ok(small.issues.some(s=>s.includes('LIMIT')));
 const truncated=await readMsgContainer(msgFixture().subarray(0,600));assert.ok(truncated.issues.length>0);
 const cycle=await readMsgContainer(cyclicMsgFixture(),{limits:{timeoutMs:2000}});assert.ok(cycle.issues.length>0);
 const limited=await readMsgContainer(msgFixture({attachments:[{name:'a',data:Buffer.from('A')},{name:'b',data:Buffer.from('B')}]}),{limits:{maxParts:2}});assert.ok(limited.issues.some(s=>s.includes('LIMIT')));
 const deep=await readMsgContainer(msgFixture({attachments:[{name:'nested.msg',embedded:{body:'nested'}}]}),{limits:{maxDepth:0}});assert.ok(deep.issues.some(s=>s.includes('DEPTH')));
 await assert.rejects(()=>readMsgContainer(msgFixture(),{signal:AbortSignal.abort()}),{name:'AbortError'});
});
test('unconfirmed_rtf_objects_remain_a_gap',async()=>{
 const result=await extract(msgFixture({rtf:uncompressedRtf('{\\rtf1\\ansi text {\\object data}}')}));assert.ok(result.issues.some(s=>s.includes('RTF')));
});
test('valid_compressed_and_uncompressed_rtf_alternatives_are_checked',async()=>{
 for(const rtf of [compressedRtfFixture(),uncompressedRtf('{\\rtf1 Hello}')]){const result=await extract(msgFixture({body:'Hello',rtf}),'Hello');assert.deepEqual(result.issues,[]);}
 const bad=compressedRtfFixture();bad[12]^=1;const result=await extract(msgFixture({body:'Hello',rtf:bad}),'Hello');assert.ok(result.issues.some(s=>s.includes('RTF')));
});
test('native_extractor_reads_real_synthetic_msg_without_an_AI_client',async t=>{
 if(!process.env.LOCAL_OCR_MCP_PATH||!fs.existsSync(process.env.LOCAL_OCR_MCP_PATH)){t.skip('Pinned local Kreuzberg executable is not available on this platform');return;}
 const {extractMsgSource}=await api(),file=msgFixture({body:'אישור מקור',subject:'Synthetic native source'}),before=digest(file),result=await extractMsgSource(file),root=result.parts.find(p=>p.id===result.rootPartId);
 assert.equal(root.body.text,'אישור מקור');assert.equal(root.headers.subject,'Synthetic native source');assert.ok(root.headers.from.some(s=>s.includes('sender@example.invalid')));assert.equal(root.headers.sentAt,'2024-10-01T10:00:00.000Z');assert.equal(digest(file),before);assert.deepEqual(result.issues,[]);
});
