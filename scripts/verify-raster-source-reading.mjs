import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {buildVisualSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {assessVisualReading,coversReadingPage} from '../src/utils/visual-source-reading.ts';
import {digest,visualRegistry} from './codex-runtime/visual-reading-fixtures.mjs';

const solid=(format,width=80,height=40)=>sharp({create:{width,height,channels:3,background:{r:255,g:0,b:0}}})[format]().toBuffer();
const twoFrames=()=>Buffer.from('47494638396101000100800000ff00000000ff'+'21f904000a0000002c0000000001000100000202440100'+'21f904000a0000002c00000000010001000002024c0100'+'3b','hex');
async function build(bytes,title){let result;await assert.doesNotReject(async()=>{result=await buildVisualSourceManifest(bytes,title);},'The document reader must accept a real standalone source image');return result;}

for(const format of ['png','jpeg'])test('standalone '+format+' retains actual image bytes and frame origin',async()=>{
 const bytes=await solid(format),before=Buffer.from(bytes),manifest=await build(bytes,'photo.'+format);
 assert.equal(manifest.format,'IMAGE');assert.equal(manifest.sourceHash,digest(bytes));assert.equal(manifest.nativeText,'');assert.deepEqual(manifest.issues,[]);
 assert.equal(manifest.units.length,1);const unit=manifest.units[0];assert.equal(unit.kind,'IMAGE_FRAME');assert.equal(unit.locations[0].frame,1);assert.equal(unit.locations[0].part,'image');
 assert.equal(unit.views.length,1);assert.deepEqual(Buffer.from(unit.views[0].bytes),bytes);assert.deepEqual(bytes,before);assert.ok(manifest.assembly.some(a=>a.kind==='unit'&&a.unitId===unit.id));
});

test('animated GIF reads its second frame instead of replaying the first',async()=>{
 const bytes=twoFrames(),manifest=await build(bytes,'sequence.gif');assert.equal(manifest.units.length,2);assert.deepEqual(manifest.units.map(u=>u.locations[0].frame),[1,2]);
 const pixels=[];for(const unit of manifest.units){const buffer=await sharp(unit.views[0].bytes).removeAlpha().raw().toBuffer();pixels.push([...buffer.subarray(0,3)]);}
 assert.deepEqual(pixels,[[255,0,0],[0,0,255]]);assert.notEqual(manifest.units[0].views[0].sha256,manifest.units[1].views[0].sha256);
});

test('missing proof for one large-image view leaves its source unread',async()=>{
 const bytes=await solid('png',5000,4000),manifest=await build(bytes,'large.png'),unit=manifest.units[0];assert.ok(unit.views.length>1);assert.ok(coversReadingPage(unit.views.map(v=>v.rect)));
 for(const view of unit.views)assert.ok(view.width*view.height<=16_000_000);
 const registry=visualRegistry(),template=registry.expectedUnits[0],proof=template.verifiedViews[0];
 Object.assign(registry,{format:'IMAGE',sourceHash:manifest.sourceHash,manifestHash:manifest.manifestHash});
 registry.expectedUnits=[{...template,id:unit.id,kind:unit.kind,locations:unit.locations,views:unit.views.map(view=>({id:view.id,sha256:view.sha256,width:view.width,height:view.height,rect:view.rect})),verifiedViews:unit.views.map(view=>({...proof,viewId:view.id,imageHash:view.sha256}))}];
 const source={content_hash:manifest.sourceHash,extracted_text_hash:registry.currentTextHash};
 assert.equal(assessVisualReading(registry,source).complete,true);registry.expectedUnits[0].verifiedViews.pop();
 const missing=assessVisualReading(registry,source);assert.equal(missing.complete,false);assert.deepEqual(missing.missingUnitIds,[unit.id]);
});

test('corrupt PNG is an explicit reading gap with no invented source text',async()=>{
 const broken=Buffer.from('89504e470d0a1a0a000000000000','hex'),manifest=await build(broken,'broken.png');assert.equal(manifest.format,'IMAGE');assert.equal(manifest.nativeText,'');assert.ok(manifest.issues.length>0);assert.equal(manifest.units.length,0);
});

for(const format of ['IMAGE','XLSX'])test(format+' cannot reuse a valid PDF page proof as its image inventory',()=>{
 const registry=visualRegistry();registry.format=format;
 assert.equal(assessVisualReading(registry,{content_hash:registry.sourceHash,extracted_text_hash:registry.currentTextHash}).complete,false);
});
