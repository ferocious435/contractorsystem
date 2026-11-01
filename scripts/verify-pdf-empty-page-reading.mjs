import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import sharp from 'sharp';
const hook=registerHooks({resolve(s,c,n){return n(s.startsWith('@/')?new URL(`../src/${s.slice(2)}.ts`,import.meta.url).href:s,c);}});
const ocr=await import('../src/utils/local-document-ocr.ts');
const readiness=await import('../src/utils/document-source-readiness.ts');
hook.deregister();
const png=body=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="white"/>${body}</svg>`)).png().toBuffer();
const folio='<text x="100" y="290" font-family="Arial" font-size="10" fill="black">3</text>';
const words=[{text:'3',confidence:96,bbox:{x0:98,y0:279,x1:109,y1:292}}];
const makeProof=async(image,page,text,boxes)=>ocr.getRenderedEmptyPageProof?.(image,page,{text,words:boxes});

test('a physically white page gets an image-bound empty-page proof',async()=>{
 const image=await png(''),proof=await makeProof(image,2,'',[]);
 assert.equal(proof?.kind,'BLANK');assert.equal(proof.page,2);assert.match(proof.imageSha256,/^[a-f\d]{64}$/);
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:2,text:'',confidence:0,emptyPageProof:proof}],[2]),true);
});

test('a folio-only page is read when all visible ink belongs to the recognized folio',async()=>{
 const image=await png(folio),proof=await makeProof(image,5,'3',words);
 assert.equal(proof?.kind,'PAGE_NUMBER_ONLY');assert.equal(proof.page,5);
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:5,text:'3',confidence:96,emptyPageProof:proof}],[5]),true);
});

test('an empty-page proof cannot conceal an extra unrecognized mark or instruction',async()=>{
 for(const body of [folio+'<text x="20" y="100" font-size="14">KEEP OPEN</text>',folio+'<rect x="20" y="140" width="70" height="20" fill="black"/>',folio+'<rect x="20" y="140" width="1" height="1" fill="#fefefe"/>']){
  assert.equal(await makeProof(await png(body),5,'3',words),undefined);
 }
});

test('a page counter without physical proof remains unread',()=>{
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:5,text:'3',confidence:99}],[5]),false);
});

test('empty-page evidence is rejected for another page or a missing image fingerprint',()=>{
 const proof={version:'rendered-empty-v1',kind:'BLANK',page:2,width:200,height:300,imageSha256:'a'.repeat(64)};
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:2,text:'',confidence:0,emptyPageProof:proof}],[2]),true);
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:3,text:'',confidence:0,emptyPageProof:proof}],[3]),false);
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:2,text:'',confidence:0,emptyPageProof:{...proof,imageSha256:null}}],[2]),false);
 assert.equal(readiness.hasCompleteOcrPageCoverage([{page:2,text:'Unverified content',confidence:0,emptyPageProof:proof}],[2]),false);
});

test('physical page coverage does not turn a file containing only a counter into a usable instruction',()=>{
 const result=readiness.assessDocumentSourceReadiness({title:'counter.pdf',ocr_status:'COMPLETED',extracted_text:'3',parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:1,readPages:[1],unreadablePages:[]}}});
 assert.equal(result.hasReadableText,false);assert.equal(result.canCompare,false);
});
