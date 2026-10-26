import test from 'node:test';
import assert from 'node:assert/strict';
import { docx, paragraph } from './fixtures/docx-image-fixtures.mjs';
import { finding, document, sourceDocuments, registerWorkChangeModules, storageModuleUrl, workChangeDatabase } from './fixtures/work-change-fixtures.mjs';
const hook=registerWorkChangeModules({'@/utils/document-storage':storageModuleUrl});
const {buildWorkChangePacket}=await import('../src/utils/work-change-sources.ts');
const {refreshWorkChangeReading}=await import('../src/utils/work-change-reading-server.ts');
const storage=await import(storageModuleUrl);
hook.deregister();

test('the real selector keeps related proposal and protocol with the original work source',()=>{
  const packet=buildWorkChangePacket(finding(),sourceDocuments());
  assert.deepEqual(packet.primarySourceIds,['primary']);
  assert.ok(packet.sources.some(source=>source.id==='proposal'));
  assert.ok(packet.sources.some(source=>source.id==='protocol'));
  assert.equal(packet.sources.find(source=>source.id==='proposal').connection.kind,'CANDIDATE');
});
test('a referenced original BOQ is found without the new method name',()=>{
  const packet=buildWorkChangePacket(finding(),sourceDocuments());
  const original=packet.sources.find(source=>source.id==='boq');
  assert.ok(original); assert.equal(original.connection.kind,'REFERENCE');
  assert.ok(original.connection.evidence.some(anchor=>anchor.documentId==='primary'));
});
test('other projects, deleted documents and unrelated common words do not join the case',()=>{
  const packet=buildWorkChangePacket(finding(),sourceDocuments());
  for(const id of ['other-project','deleted','unrelated']) assert.ok(!packet.sources.some(source=>source.id===id),id);
});
test('unverified Word coverage stays visible and full saved text is retained',()=>{
  const docs=sourceDocuments();docs[0].title='annex.docx';docs[0].storage_path='annex.docx';
  docs[0].extracted_text+='\n'+'תנאים נוספים לעבודה. '.repeat(1500);
  const source=buildWorkChangePacket(finding(),docs).sources.find(source=>source.id==='primary');
  assert.equal(source.readiness.canCompare,false);
  assert.equal(source.extracted_text,docs[0].extracted_text);
  assert.ok(source.selection.source_anchors.every(anchor=>docs[0].extracted_text.slice(anchor.start,anchor.end)===anchor.quote));
});
test('missing primary source never becomes a complete empty review',()=>{
  const packet=buildWorkChangePacket(finding(),sourceDocuments().filter(source=>source.id!=='primary'));
  assert.ok(packet.limitations.includes('primary_source_missing'));
});
test('contract boilerplate alone does not attach another design subject to a named technology change',()=>{
  const f=finding();f.evidence_data.work_quote='והואיל הקבלן פנה לתאגיד בבקשה לשנות את השיטה לשיטת DTX ברחוב הרימון.';
  const docs=sourceDocuments();docs[0].extracted_text=f.evidence_data.work_quote;
  docs.push(document('other-design','והואיל הקבלן פנה לתאגיד בבקשה לשנות הסכם תכנון ניקוז בשכונה אחרת.'));
  assert.ok(!buildWorkChangePacket(f,docs).sources.some(source=>source.id==='other-design'));
});
test('all directly cited BOQ ranges survive a long unrelated section between them',()=>{
  const f=finding();const docs=[document('primary','ברחוב הרימון תוחלף שיטת הביצוע. ראו סעיפים 71.02.0001 ו-91.03.0004.'),
    document('boq','71.02.0001 דחיקת צינור: 100 מטר.\n'+'טקסט שאינו נוגע לעבודה. '.repeat(2000)+'\n91.03.0004 תא קליטה: 2 יחידות.',{category:'CONTRACT'})];
  const source=buildWorkChangePacket(f,docs).sources.find(source=>source.id==='boq');
  const selected=source.selection.source_anchors.map(anchor=>anchor.quote).join('\n');
  assert.match(selected,/71\.02\.0001/);assert.match(selected,/91\.03\.0004/);
});
test('references inside a related annex identify original work with no new method name',()=>{
  const f=finding();const docs=[document('primary','ברחוב הרימון תוחלף השיטה בקידוח אופקי.'),
    document('annex','קידוח אופקי ברחוב הרימון: העבודות המקוריות הן סעיפים 71.02.0001 ו-91.03.0004.'),
    document('original-excerpt','71.02.0001 דחיקת צנרת.\n91.03.0004 תא קליטה.')];
  const source=buildWorkChangePacket(f,docs).sources.find(source=>source.id==='original-excerpt');
  assert.ok(source);assert.equal(source.connection.kind,'REFERENCE');
  assert.ok(source.connection.evidence.some(anchor=>anchor.documentId==='annex'));
});

test('a cited interval includes middle positions and their full descriptions',()=>{
 const docs=[document('primary','ברחוב הרימון תוחלף שיטת הביצוע. ראו סעיפים 71.02.0001 - 71.02.0004.'),
  document('boq',[1,2,3,4].map(n=>`71.02.000${n} דחיקת צנרת.\n${'תנאי ביצוע ארוכים. '.repeat(120)}\nמטר 100 2000 200000`).join('\n'),{category:'BOQ'})];
 const source=buildWorkChangePacket(finding(),docs).sources.find(source=>source.id==='boq');
 const selected=source.selection.source_anchors.map(anchor=>anchor.quote).join('\n');
 assert.match(selected,/71\.02\.0002/);assert.match(selected,/71\.02\.0003/);
 assert.ok(source.selection.source_anchors.some(anchor=>anchor.quote.includes('71.02.0002')&&anchor.quote.includes('מטר 100 2000 200000')));
});
test('source reading uses the real installed DOCX reader without touching budget or finance',async()=>{
  const doc=document('legacy','Старый неполный текст',{title:'annex.docx',storage_path:'annex.docx',parsed_json:{owner_field:'preserve'}});
  const db=workChangeDatabase({documents:[doc]});storage.reset({legacy:docx({body:paragraph('הוראה שלמה על עבודות הקידוח.')})});
  const result=await refreshWorkChangeReading(db,'project',[doc]);
  assert.deepEqual(result.updatedIds,['legacy']);assert.deepEqual(result.failedIds,[]);
  const saved=db.tables.documents[0];
  assert.match(saved.extracted_text,/הוראה שלמה/);assert.equal(saved.parsed_json.owner_field,'preserve');
  assert.equal(saved.parsed_json.source_reading.version,'docx-image-coverage-v1');
  assert.equal(saved.parsed_json.source_reading.expectedImageReferences,0);
  assert.ok(db.writes.every(write=>write.table==='documents'));
  const again=await refreshWorkChangeReading(db,'project',db.tables.documents);
  assert.deepEqual(again.updatedIds,[]);assert.equal(storage.calls.length,1);
});
test('known numeric OCR review does not cause repeated recognition of the same bytes',async()=>{
  const doc=document('numeric','טקסט עם תמונה',{title:'annex.docx',storage_path:'annex.docx',content_hash:'a'.repeat(64),ocr_status:'REQUIRES_REVIEW',parsed_json:{source_reading:{version:'docx-image-coverage-v1',sourceHash:'a'.repeat(64),complete:false,issues:['OCR_NUMBERS_REQUIRE_REVIEW'],expectedImageReferences:1,images:[{numericReviewRequired:true,status:'REQUIRES_REVIEW'}]}}});
  const db=workChangeDatabase({documents:[doc]});storage.reset();
  assert.deepEqual((await refreshWorkChangeReading(db,'project',[doc])).updatedIds,[]);
  assert.equal(storage.calls.length,0);assert.equal(db.writes.length,0);
});
test('a failed read preserves the old text and owner metadata',async()=>{
  const doc=document('failure','Сохранённый исходный текст',{title:'annex.docx',storage_path:'annex.docx'});
  const db=workChangeDatabase({documents:[doc]});storage.reset({failure:new Error('offline')});
  const result=await refreshWorkChangeReading(db,'project',[doc]);
  assert.deepEqual(result.failedIds,['failure']);assert.equal(db.tables.documents[0].extracted_text,doc.extracted_text);
  assert.equal(db.writes.length,0);
});
test('a changed source is not overwritten with reading of older bytes',async()=>{
  const doc=document('changed','Старый текст',{title:'annex.docx',storage_path:'annex.docx',content_hash:'a'.repeat(64)});
  const db=workChangeDatabase({documents:[doc]});storage.reset({changed:docx({body:paragraph('הוראה חדשה')})},()=>{db.tables.documents[0].content_hash='b'.repeat(64);});
  const result=await refreshWorkChangeReading(db,'project',[doc]);
  assert.deepEqual(result.updatedIds,[]);assert.deepEqual(result.failedIds,['changed']);
  assert.equal(db.tables.documents[0].extracted_text,doc.extracted_text);
});
