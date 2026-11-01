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
