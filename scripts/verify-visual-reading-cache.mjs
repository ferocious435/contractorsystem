import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readingUnit,unitResponse,digest,sourceHash,literal} from './codex-runtime/visual-reading-fixtures.mjs';
const load=async file=>import(file).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith(file.slice(2)))return {};throw error;});
const api=await load('../src/server/ai/visual-reading-cache.server.ts');
const scope={ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',documentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',sourceHash};
function cache(root){assert.equal(typeof api.createVisualReadingCache,'function','Missing checked source reading cache');return api.createVisualReadingCache(root);}
function verified(unit=readingUnit()){
 assert.equal(typeof api.readingUnitInputHash,'function');const response=unitResponse(unit);
 return {unitId:unit.id,inputHash:api.readingUnitInputHash(unit),text:literal,textHash:digest(literal),tables:[],visualDescription:'',uncertainties:[],complete:true,
  views:[{viewId:unit.views[0].id,imageHash:unit.views[0].sha256,textHash:digest(literal),method:'native-match',confirmationHash:digest(literal),reading:response,confirmation:response}]};
}
async function fixture(action){const root=await fs.mkdtemp(path.join(os.tmpdir(),'contractorsystem-visual-cache-'));try{await action(root);}finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}}

test('cache_rejects_wrong_scope_hash_or_symlink',async()=>fixture(async root=>{
 const instance=cache(root),unit=readingUnit();await instance.write(scope,unit,verified(unit));assert.equal((await instance.read(scope,unit)).text,literal);
 assert.equal(await instance.read({...scope,ownerId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},unit),null);
 assert.equal(await instance.read({...scope,sourceHash:'9'.repeat(64)},unit),null);
 assert.equal(await instance.read(scope,{...unit,contextText:'different context'}),null);
 await assert.rejects(()=>instance.read({...scope,documentId:'../escape'},unit));
 const link=path.join(root,'alias');await fs.symlink(root,link,'junction');
 await assert.rejects(()=>cache(link).read(scope,unit));
}));
test('cache_rejects_a_tampered_transcript_and_incomplete_units',async()=>fixture(async root=>{
 const instance=cache(root),unit=readingUnit();await instance.write(scope,unit,verified(unit));
 const directory=path.join(root,'reading-cache',scope.ownerId,scope.projectId,scope.documentId,sourceHash,'visual-reading-rules-v2');
 const [file]=await fs.readdir(directory),absolute=path.join(directory,file),payload=JSON.parse(await fs.readFile(absolute,'utf8'));
 payload.unit.text='Modified text';await fs.writeFile(absolute,JSON.stringify(payload));assert.equal(await instance.read(scope,unit),null);
 await assert.rejects(()=>instance.write(scope,unit,{...verified(unit),complete:false}));
}));
test('a_changed_image_cannot_reuse_a_previously_verified_input',async()=>fixture(async root=>{
 const instance=cache(root),unit=readingUnit();await instance.write(scope,unit,verified(unit));
 const changed={...unit,views:[{...unit.views[0],bytes:Buffer.from('changed'),sha256:digest('changed')}]};
 assert.equal(await instance.read(scope,changed),null);
}));
test('a_recomputed_file_checksum_cannot_detach_text_from_its_verified_response',async()=>fixture(async root=>{
 const instance=cache(root),unit=readingUnit();await instance.write(scope,unit,verified(unit));
 const directory=path.join(root,'reading-cache',scope.ownerId,scope.projectId,scope.documentId,sourceHash,'visual-reading-rules-v2');
 const [file]=await fs.readdir(directory),absolute=path.join(directory,file),payload=JSON.parse(await fs.readFile(absolute,'utf8'));
 payload.unit.text='Unrelated substituted source';payload.unit.textHash=digest(payload.unit.text);payload.payloadHash=digest(JSON.stringify(payload.unit));
 await fs.writeFile(absolute,JSON.stringify(payload));assert.equal(await instance.read(scope,unit),null);
}));
test('saved_independent_numeric_reads_can_be_rechecked_without_repeating_the_model',()=>{
 assert.equal(typeof api.reverifySavedNumericUnit,'function');const unit=readingUnit({localText:''}),text='1. Work\n2. Quantity 12\n3. Terms',reading=unitResponse(unit,{text,visualDescription:'Underlined headings.'}),confirmation={...reading,visualDescription:'Items 1–3 are underlined.'};
 const saved={...verified(unit),text,textHash:digest(text),complete:false,uncertainties:['Numeric or source verification failed: '+unit.views[0].id],createdBy:{jobId:scope.ownerId,rulesVersion:'visual-reading-rules-v2',profileRevision:1},
  views:[{...verified(unit).views[0],method:'visual-double-pass',reading,confirmation,textHash:digest(text),confirmationHash:digest(text)}]};
 const result=api.reverifySavedNumericUnit(saved,unit);assert.equal(result.complete,true);assert.equal(result.text,text);assert.equal(saved.complete,false);
 assert.equal(api.reverifySavedNumericUnit({...saved,uncertainties:['Crop text not reconciled']},unit),null);
 assert.equal(api.reverifySavedNumericUnit(saved,{...unit,contextText:'different context'}),null);
 const mismatch=structuredClone(saved);mismatch.views[0].confirmation.text=text.replace('12','21');mismatch.views[0].confirmationHash=digest(mismatch.views[0].confirmation.text);assert.equal(api.reverifySavedNumericUnit(mismatch,unit),null);
});
test('a_saved_clear_pair_can_resolve_an_earlier_uncertain_view_of_only_the_same_source_region',()=>{
 const first=readingUnit({localText:''}).views[0],bytes=Buffer.from('larger-source-image'),second={...first,id:'page:1:enlarged',bytes,sha256:digest(bytes),width:200,height:200};
 const unit=readingUnit({localText:'',views:[first,second]}),text='Quantity: 12',a=unitResponse(unit,{text}),b={...a,viewId:second.id},unclear={...b,uncertainties:['Unclear spelling']};
 const image=view=>({sha256:view.sha256,width:view.width,height:view.height,rect:view.rect});
 const saved={...verified(unit),text,textHash:digest(text),complete:false,uncertainties:['Unclear spelling'],createdBy:{jobId:scope.ownerId,rulesVersion:'visual-reading-rules-v2',profileRevision:1},views:[
  {viewId:first.id,imageHash:first.sha256,textHash:digest(text),method:'visual-double-pass',confirmationHash:digest(text),reading:a,confirmation:unclear,readingImage:image(first),confirmationImage:image(second)},
  {viewId:second.id,imageHash:second.sha256,textHash:digest(text),method:'visual-double-pass',confirmationHash:digest(text),reading:a,confirmation:b,initialReading:unclear,readingImage:image(first),confirmationImage:image(second)}]};
 const result=api.reverifySavedNumericUnit(saved,unit);assert.equal(result?.complete,true);assert.equal(result.text,text);assert.equal(saved.complete,false);
 assert.ok(result.views.some(view=>view.initialReading?.uncertainties.includes('Unclear spelling')));
 const missingWitness=structuredClone(saved);delete missingWitness.views[1].initialReading;assert.equal(api.reverifySavedNumericUnit(missingWitness,unit),null);
 assert.equal(api.reverifySavedNumericUnit({...saved,uncertainties:['A different unresolved area']},unit),null);
 const mismatch=structuredClone(saved);mismatch.views[1].confirmation.text='Quantity: 21';mismatch.views[1].confirmationHash=digest('Quantity: 21');assert.equal(api.reverifySavedNumericUnit(mismatch,unit),null);
 const differentRegion={...unit,views:[first,{...second,rect:{x:0,y:0,width:0.5,height:1}}]};
 assert.equal(api.reverifySavedNumericUnit({...saved,inputHash:api.readingUnitInputHash(differentRegion)},differentRegion),null);
 assert.equal(api.reverifySavedNumericUnit(saved,{...unit,contextText:'changed'}),null);
});
