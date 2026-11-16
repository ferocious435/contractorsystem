import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {PDFDocument,degrees} from 'pdf-lib';
import {docx,paragraph,image} from './fixtures/docx-image-fixtures.mjs';
import {prepareWordLayoutCopy,extractDocxWithImages} from '../src/utils/docx-image-extraction.ts';
import {renderWordShapes} from '../src/server/documents/word-layout.server.ts';
import {compareWordShapePixels} from '../src/server/documents/word-shape-pixels.server.ts';
import {buildWordSourceManifest} from '../src/utils/visual-source-manifest.ts';
import {matchesPreviousNativeWordManifestHash,previousNativeWordManifestSnapshot,wordManifestDigest} from '../src/utils/word-native-manifest-compatibility.ts';
import {readingUnitInputHash} from '../src/server/ai/visual-reading-cache.server.ts';
import {digest} from './codex-runtime/visual-reading-fixtures.mjs';
const require=createRequire(import.meta.url),{unzipSync,zipSync}=createRequire(require.resolve('officeparser'))('fflate');
const shape=(label='')=>'<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:posOffset>200</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>200</wp:posOffset></wp:positionV><wp:extent cx="1000" cy="200"/><wp:wrapNone/><wp:docPr id="5" name="work-outline"/><a:graphic><a:graphicData><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:spPr><a:prstGeom prst="roundRect"/></wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:roundrect id="work-outline" style="width:80pt;height:20pt" filled="f" strokecolor="yellow">'+(label?'<v:textbox><w:txbxContent>'+paragraph(label)+'</w:txbxContent></v:textbox>':'')+'</v:roundrect></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>';
const point={part:'word/document.xml',paragraph:2,name:'work-outline',issue:'word/document.xml:UNSUPPORTED_PICT',nativeEligible:true};
async function pdf(visible=true){const p=await PDFDocument.create(),page=p.addPage([250,250]);if(visible)page.drawRectangle({x:60,y:80,width:100,height:12,rotate:degrees(20)});return Buffer.from(await p.save());}

test('passive Word removes dangling external IDs but preserves source text, geometry and its visible fingerprint',async()=>{
 const z=unzipSync(docx({body:paragraph('Work requirement 12 m')+'<w:p><w:hyperlink r:id="web"><w:r><w:t>Visible source 3400</w:t></w:r></w:hyperlink></w:p>'+shape(),media:{},rels:[]}));
 z['word/_rels/document.xml.rels']=Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="web" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>');
 z['word/settings.xml']=Buffer.from('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:attachedTemplate r:id="tpl"/></w:settings>');
 z['word/_rels/settings.xml.rels']=Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="tpl" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///not-opened.dotm" TargetMode="External"/></Relationships>');
 const bytes=Buffer.from(zipSync(z)),before=digest(bytes),safe=await prepareWordLayoutCopy(bytes,{native:true});assert.ok(safe);assert.equal(digest(bytes),before);
 const out=unzipSync(safe.bytes),xml=Buffer.from(out['word/document.xml']).toString('utf8');
 for(const value of ['Work requirement 12 m','Visible source 3400','width:80pt;height:20pt'])assert.ok(xml.includes(value));
 assert.ok(!xml.includes('r:id="web"'));assert.ok(!Buffer.from(out['word/settings.xml']).toString('utf8').includes('attachedTemplate'));
 assert.equal((await prepareWordLayoutCopy(safe.bytes,{native:true})).visibleHash,safe.visibleHash);
});

test('external resources, active fields and an unknown working text box cannot enter the bounded native fallback',async()=>{
 for(const extra of ['<w:p><w:r><w:instrText>INCLUDETEXT "https://example.invalid"</w:instrText></w:r></w:p>','<w:p><w:r><w:pict><v:shape><v:imagedata src="https://example.invalid/remote.png"/></v:shape></w:pict></w:r></w:p>'])assert.equal(await prepareWordLayoutCopy(docx({body:shape()+extra,media:{},rels:[]}),{native:true}),null);
 for(const label of ['', 'Working dimension 250 mm']){let shapes;await extractDocxWithImages(docx({body:paragraph('Source')+shape(label),media:{},rels:[]}),{recognizeImage:async()=>({text:'',confidence:0}),onLayout:(_,s)=>shapes=s});assert.ok(shapes?.length);assert.equal(shapes[0].nativeEligible,!label);}
});

test('native Word receives only unplaced shapes and does not replace confirmed LibreOffice pages',async()=>{
 const a={...point,name:'already-placed'},b=point;let calls=0;
 const result=await renderWordShapes(Buffer.from('fixture'),[a,b],{libreOffice:async()=>({file:Buffer.from('old PDF'),pages:[{page:2,anchors:[a]}],unplaced:[b]}),nativeWord:async(_,remaining)=>{calls++;assert.deepEqual(remaining,[b]);return {regions:[],unplaced:remaining};}});
 assert.equal(calls,1);assert.deepEqual(result.pages[0].anchors,[a]);assert.deepEqual(result.unplaced,[b]);
 await renderWordShapes(Buffer.from('fixture'),[a],{libreOffice:async()=>({file:Buffer.alloc(0),pages:[{page:2,anchors:[a]}],unplaced:[]}),nativeWord:async()=>{throw Error('Do not start native Word for an already confirmed shape');}});
});

test('rotation-aware pixel evidence preserves both sides and rejects page reflow',async()=>{
 const original=await pdf(),removed=await pdf(false),proof=await compareWordShapePixels(original,removed,{widthMm100:100*2540/72,heightMm100:12*2540/72,rotationDegrees:20});
 assert.equal(proof.length,1);assert.notEqual(proof[0].original.sha256,proof[0].removed.sha256);assert.ok(proof[0].rect.width<0.5);
 assert.equal((await compareWordShapePixels(original,removed,{widthMm100:100*2540/72,heightMm100:12*2540/72})).length,0);
 const changed=await PDFDocument.load(removed);changed.addPage([250,250]);assert.deepEqual(await compareWordShapePixels(original,Buffer.from(await changed.save()),{widthMm100:4000,heightMm100:2000,rotationDegrees:20}),[]);
});

async function pair(){
 const bytes=docx({body:paragraph('Requirement 12 m')+image()+shape()}),original=await pdf(),empty=await pdf(false),pixel=(await compareWordShapePixels(original,empty,{widthMm100:100*2540/72,heightMm100:12*2540/72,rotationDegrees:20}))[0];
 const old=await buildWordSourceManifest(bytes,{renderLayout:async(_,shapes)=>({file:original,pages:[],unplaced:shapes})});
 const next=await buildWordSourceManifest(bytes,{renderLayout:async(_,shapes)=>({file:original,pages:[],unplaced:[],beforeNativeUnplaced:shapes,regions:[{file:original,page:1,shape:shapes[0],rect:{x:0.1,y:0.3,width:0.65,height:0.5},proof:{...pixel,version:'native-word-source-removal-v1',visibleHash:'a'.repeat(64),shape:{widthPoints:100,heightPoints:12,rotationDegrees:20}}}]})});return {old,next};
}

test('a target crop preserves the old image input and allows only its exact rebuilt previous manifest',async()=>{
 const {old,next}=await pair();assert.equal(next.units.length,old.units.length+1);assert.equal(readingUnitInputHash(next.units[0]),readingUnitInputHash(old.units[0]));
 const region=next.units.at(-1);assert.equal(region.views[0].rect.width,1);assert.ok(region.locations[0].sourceRect.width<1);assert.equal(region.locations[0].wordLayoutProof.sourceHash,next.sourceHash);assert.match(region.contextText,/clipped continuation/);assert.deepEqual(next.issues,[]);
 assert.equal(matchesPreviousNativeWordManifestHash(next,old.manifestHash),true);assert.equal(previousNativeWordManifestSnapshot(next).manifestHash,old.manifestHash);
 assert.equal(matchesPreviousNativeWordManifestHash(next,'0'.repeat(64)),false);assert.equal(matchesPreviousNativeWordManifestHash(structuredClone(next),old.manifestHash),false);
 const legacy=structuredClone(old);for(const image of legacy.nativeVerification.images){delete image.paragraph;delete image.relationshipId;delete image.alternateRelationships;}legacy.manifestHash=wordManifestDigest(legacy);assert.equal(matchesPreviousNativeWordManifestHash(next,legacy.manifestHash),true);
});

for(const change of ['source','text','old-unit','new-pixels'])test('changed '+change+' cannot use the private compatibility capability even after rehashing',async()=>{
 const {old,next}=await pair();if(change==='source')next.sourceHash='9'.repeat(64);if(change==='text')next.nativeText=next.nativeText.replace('12','13');if(change==='old-unit')next.units[0].contextText+=' changed';if(change==='new-pixels')next.units.at(-1).views[0].bytes[0]^=1;next.manifestHash=wordManifestDigest(next);assert.equal(matchesPreviousNativeWordManifestHash(next,old.manifestHash),false);
});

test('the exact worker ownership predicate rejects a foreign HWND, reused PID and an earlier process before any control action',{skip:process.platform!=='win32'},async()=>{
 const worker=await fs.readFile(new URL('../src/server/documents/word-native-worker.ps1',import.meta.url),'utf8'),definition=worker.match(/Add-Type -TypeDefinition @"[\s\S]*?"@/u)[0];
 const command=definition+'\nif(-not [LocalWordInstance]::OwnsProcess(101,101,7,7,$false,[uint32[]]@(999))){throw "Own process was rejected"}\nforeach($value in @([LocalWordInstance]::OwnsProcess(101,999,7,7,$false,[uint32[]]@(999)),[LocalWordInstance]::OwnsProcess(101,101,7,8,$false,[uint32[]]@(999)),[LocalWordInstance]::OwnsProcess(101,101,7,7,$true,[uint32[]]@(999)),[LocalWordInstance]::OwnsProcess(101,101,7,7,$false,[uint32[]]@(101)))){if($value){throw "Foreign process accepted"}}\nWrite-Output "OWNERSHIP_PREDICATE_REJECTED_MISMATCHES"';
 const shell=path.join(process.env.SystemRoot||'C:/Windows','SysWOW64/WindowsPowerShell/v1.0/powershell.exe'),r=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/OWNERSHIP_PREDICATE_REJECTED_MISMATCHES/);
 const guard=worker.indexOf("if(-not $bound){throw 'WORD_NATIVE_INSTANCE_UNVERIFIED'}");
 for(const text of ['|Out-File -LiteralPath $ownedPath','$word.Visible=$false','$word.DisplayAlerts=0','$word.AutomationSecurity=3',"$source=Join-Path $folder 'source.docx'"])assert.ok(worker.indexOf(text)>guard,text+' must follow direct binding');
 assert.match(worker,/if\(\$bound -and \$ownedProcess\)/u);assert.ok(!/\$word\.Options/u.test(worker));
});
