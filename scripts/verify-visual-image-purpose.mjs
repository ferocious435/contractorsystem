import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {readingUnit,unitResponse,digest,sourceDocument,literal,sourceHash} from './codex-runtime/visual-reading-fixtures.mjs';
import {recheckSavedImagePurpose} from '../src/server/ai/visual-image-purpose.server.ts';
import {readVisualSource} from '../src/server/ai/visual-source-reader.server.ts';
import {readingUnitInputHash,retainedReadingUnit,verifiedReadingUnit,createVisualReadingCache} from '../src/server/ai/visual-reading-cache.server.ts';
import {assembleDocumentReading,createReadingPatch} from '../src/utils/document-reading-history.ts';
const scope={ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',documentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',sourceHash};
const jobId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const profile={ownerId:scope.ownerId,accountFingerprint:'synthetic',model:'fixture',effort:null,revision:1};
const exec=generate=>({jobId,ownerId:scope.ownerId,projectId:scope.projectId,profile,signal:new AbortController().signal,checkActive:async()=>{},reportProgress:async()=>{},generate});
const pictures={logo:'<rect x="30" y="25" width="100" height="90" fill="blue"/><text x="150" y="80">Company</text>',letter:'<rect width="450" height="300" fill="white"/><text x="30" y="40">Company letterhead</text><text x="30" y="100">Work instruction: pipe 12 m</text><text x="30" y="150">Payment 3400</text>',diagram:'<path d="M30 80 L400 80 L400 220 L30 220 Z" fill="none" stroke="black"/><text x="180" y="60">12 m</text><text x="80" y="140">Drainage work</text>',signature:'<path d="M20 120 Q150 20 200 130 T420 100 M100 170 L300 30" fill="none" stroke="black" stroke-width="3"/>'};
async function unit(kind='logo'){
 const bytes=await sharp(Buffer.from('<svg width="450" height="300" xmlns="http://www.w3.org/2000/svg">'+pictures[kind]+'</svg>')).png().toBuffer(),id='docx:'+digest(bytes);
 return readingUnit({id,kind:'DOCX_IMAGE',locations:[{part:'word/document.xml',anchor:'word/document.xml#rId1:1',mediaName:'word/media/image1.png'}],localText:'',contextText:'OLD MODEL TEXT MUST NOT BE IN PURPOSE REQUEST',views:[{id:'image:'+digest(bytes),sha256:digest(bytes),bytes,width:450,height:300,rect:{x:0,y:0,width:1,height:1}}]});
}
function partial(u,text='OLD PRIVATE SOURCE ANSWER 9001'){
 const a=unitResponse(u,{text,uncertainties:['Old lettering was uncertain']}),b=structuredClone(a);
 return {unitId:u.id,inputHash:readingUnitInputHash(u),text,textHash:digest(text),tables:[],visualDescription:'',complete:false,uncertainties:['Old lettering was uncertain'],createdBy:{jobId,rulesVersion:'visual-reading-rules-v2',profileRevision:1},
  views:[{viewId:u.views[0].id,imageHash:u.views[0].sha256,textHash:digest(text),method:'visual-double-pass',confirmationHash:digest(text),reading:a,confirmation:b}]};
}
const answer=(u,role)=>JSON.stringify(unitResponse(u,{contentRole:role,text:'',tables:[],visualDescription:role==='BRANDING_ONLY'?'Standalone company branding.':role==='CONTENT'?'A substantive document, work drawing or signature.':'Image function is unclear.',uncertainties:[]}));
async function fixture(action){const root=await fs.mkdtemp(path.join(os.tmpdir(),'contractor-purpose-')),before=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=root;try{await action(root);}finally{if(before===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=before;assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}}
async function recheck(root,u,saved,execution,onCheckpoint=async()=>{}){return recheckSavedImagePurpose({unit:u,saved,scope,execution,directory:root,jobDirectory:root,onCheckpoint});}
const manifest=u=>({sourceHash,manifestHash:'2'.repeat(64),format:'DOCX',nativeText:literal,nativeVerification:null,units:[u],issues:[],assembly:[{kind:'native',text:literal},{kind:'unit',unitId:u.id}]});

test('legacy branding gets exactly two blind purpose readings and its original answers remain in history',async()=>fixture(async root=>{
 const u=await unit(),saved=partial(u),before=structuredClone(saved);let calls=0;
 const result=await readVisualSource(manifest(u),scope,exec(async request=>{calls++;assert.match(request.text,/Classify only the function/);assert.ok(!request.text.includes(saved.text));assert.ok(!request.text.includes(u.contextText));assert.equal(digest(await fs.readFile(request.images[0])),u.views[0].sha256);return answer(u,'BRANDING_ONLY');}),{retainedUnits:[saved]});
 assert.equal(calls,2);assert.equal(result.units[0].complete,true);assert.equal(result.units[0].contentRole,'BRANDING_ONLY');assert.equal(result.units[0].text,'');assert.deepEqual(saved,before);assert.deepEqual(result.units[0].views[0].initialReading,saved.views[0].reading);
 assert.equal(verifiedReadingUnit(result.units[0],u),true);
 const assembled=assembleDocumentReading(manifest(u),result.units);assembled.verification.createdBy={jobId,rulesVersion:'visual-reading-rules-v2',profileRevision:1};
 const doc=sourceDocument({title:'synthetic.docx',parsed_json:{source_reading_units:[saved]}}),patch=createReadingPatch(doc,assembled);
 assert.deepEqual(patch.parsed_json.source_reading_history.find(v=>v.units)?.units,[saved]);
 const reopened=await readVisualSource(manifest(u),scope,exec(async()=>{throw Error('Do not reclassify confirmed source');}),{retainedUnits:result.units});assert.equal(reopened.units[0].complete,true);
}));

for(const kind of ['letter','diagram','signature'])test('a synthetic '+kind+' remains content and its two purpose readings are not repeated',async()=>fixture(async root=>{
 const u=await unit(kind),saved=partial(u,'KEEP SUBSTANTIVE '+kind+' 12 m 3400');let calls=0;
 const execute=exec(async request=>{calls++;assert.ok(!request.text.includes(saved.text));assert.ok(!request.text.includes(u.contextText));assert.match(request.text,/signature/);return answer(u,'CONTENT');});
 const next=await recheck(root,u,saved,execute);assert.equal(calls,2);assert.equal(next.complete,false);assert.equal(next.text,saved.text);assert.deepEqual(next.views,saved.views);assert.equal(next.imagePurpose.raw.length,2);
 const repeated=await recheck(root,u,next,exec(async()=>{throw Error('A current CONTENT purpose must not be checked again');}));assert.deepEqual(repeated,next);
 const full=await readVisualSource(manifest(u),scope,exec(async()=>{throw Error('Purpose-only continuation must honor the saved pair');}),{retainedUnits:[next]});assert.equal(full.units[0].complete,false);assert.equal(full.units[0].text,saved.text);
}));

test('UNKNOWN or disagreed image function is never promoted to branding or checked twice again',async()=>fixture(async root=>{
 const u=await unit(),saved=partial(u);let calls=0;const next=await recheck(root,u,saved,exec(async()=>answer(u,++calls===1?'BRANDING_ONLY':'UNKNOWN')));
 assert.equal(calls,2);assert.equal(next.complete,false);assert.equal(next.text,saved.text);assert.equal(next.imagePurpose.raw.length,2);
 await recheck(root,u,next,exec(async()=>{throw Error('UNKNOWN was already assessed twice');}));
}));

test('a checkpoint after the first purpose observation resumes with only the missing independent observation',async()=>fixture(async root=>{
 const u=await unit(),saved=partial(u);let checkpoint,calls=0;
 await assert.rejects(recheck(root,u,saved,exec(async()=>{calls++;return answer(u,'CONTENT');}),async next=>{checkpoint=next;throw Error('cancel after persisted first observation');}),/cancel/);
 assert.equal(calls,1);assert.equal(checkpoint.imagePurpose.raw.length,1);
 const secondExecution={...exec(async()=>{calls++;return answer(u,'CONTENT');}),jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
 const next=await recheck(root,u,checkpoint,secondExecution);assert.equal(calls,2);assert.equal(next.imagePurpose.raw.length,2);assert.deepEqual(next.imagePurpose.observations.map(o=>o.jobId),[jobId,secondExecution.jobId]);
}));

for(const invalid of ['source','recognition-version','profile'])test('a changed '+invalid+' cannot reuse a prior purpose decision',async()=>fixture(async root=>{
 const u=await unit(),saved=partial(u),checked=await recheck(root,u,saved,exec(async()=>answer(u,'CONTENT')));let calls=0;
 if(invalid==='source')checked.imagePurpose.scope.sourceHash='4'.repeat(64);
 if(invalid==='recognition-version')checked.imagePurpose.recognitionVersion='retired-branding-version';
 if(invalid==='profile')checked.imagePurpose.profileFingerprint='5'.repeat(64);
 await recheck(root,u,checked,exec(async()=>{calls++;return answer(u,'CONTENT');}));assert.equal(calls,2);
}));

test('a stored JSON object with reordered keys reuses both independent observations',async()=>fixture(async root=>{
 const u=await unit(),saved=await recheck(root,u,partial(u),exec(async()=>answer(u,'CONTENT')));
 const physical=saved.imagePurpose.image;
 physical.rect=Object.fromEntries(Object.entries(physical.rect).reverse());
 saved.imagePurpose.image=Object.fromEntries(Object.entries(physical).reverse());
 const next=await recheck(root,u,saved,exec(async()=>{throw Error('Repeated image classification');}));
 assert.deepEqual(next.imagePurpose.raw,saved.imagePurpose.raw);
}));

test('a purpose answer containing a transcribed instruction cannot erase the old source text',async()=>fixture(async root=>{
 const u=await unit('letter'),saved=partial(u,'WORK 12 m'),result=await recheck(root,u,saved,exec(async()=>JSON.stringify(unitResponse(u,{contentRole:'BRANDING_ONLY',text:'WORK 12 m',tables:[],visualDescription:'Company logo'}))));
 assert.equal(result.complete,false);assert.equal(result.text,'WORK 12 m');assert.deepEqual(result.views,saved.views);
}));

test('a current verified role for identical pixels is reused before a second document legacy resume',async()=>fixture(async root=>{
 const u=await unit(),saved=partial(u);let calls=0;
 const first=await readVisualSource(manifest(u),scope,exec(async()=>{calls++;return answer(u,'BRANDING_ONLY');}),{retainedUnits:[saved]});assert.equal(calls,2);
 const target={...u,contextText:'Another source document context'},nextScope={...scope,documentId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',sourceHash:'4'.repeat(64)},old=partial(target);
 const next=await readVisualSource({...manifest(target),sourceHash:nextScope.sourceHash},nextScope,exec(async()=>{throw Error('Current exact-image purpose has already been proven');}),{retainedUnits:[old]});
 assert.equal(next.units[0].complete,true);assert.equal(next.units[0].brandingOrigin.documentId,scope.documentId);assert.equal(verifiedReadingUnit(next.units[0],target),true);assert.equal(calls,2);assert.equal(old.text,saved.text);
}));

test('a previously accepted substantive fragment cannot be erased by a new purpose classification',async()=>fixture(async root=>{
 const u=await unit('diagram'),saved=partial(u,'Confirmed work dimension 12 m');saved.composition={proofs:[{id:'previously-accepted-region'}]};
 const result=await recheck(root,u,saved,exec(async()=>{throw Error('A confirmed fragment must stay authoritative');}));assert.deepEqual(result,saved);
}));

test('a completed source unit is preserved exactly and does not consume a purpose assessment',async()=>fixture(async root=>{
 const u=await unit('signature'),saved={...partial(u),complete:true,uncertainties:[]};
 const result=await recheck(root,u,saved,exec(async()=>{throw Error('A complete source does not need reclassification');}));assert.deepEqual(result,saved);
}));

test('persisted first-purpose progress is reused even when the business document still has the earlier partial unit',async()=>fixture(async root=>{
 const u=await unit('letter'),saved=partial(u),runtime=path.join(root,'ContractorSystem','ai-runtime');let checkpoint;
 await assert.rejects(recheck(root,u,saved,exec(async()=>answer(u,'CONTENT')),async next=>{checkpoint=next;throw Error('interrupted');}),/interrupted/);
 await createVisualReadingCache(runtime).writeProgress(scope,u,checkpoint);let calls=0;
 const next=await readVisualSource(manifest(u),scope,exec(async()=>{calls++;return answer(u,'CONTENT');}),{retainedUnits:[saved]});assert.equal(calls,1);assert.equal(next.units[0].imagePurpose.raw.length,2);assert.equal(next.units[0].text,saved.text);
}));
