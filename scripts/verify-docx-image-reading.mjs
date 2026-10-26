import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { docx, image, paragraph, alternate, vml, relationships } from './fixtures/docx-image-fixtures.mjs';
const hook=registerHooks({resolve(s,c,n){return n(s.startsWith('@/')?new URL(`../src/${s.slice(2)}.ts`,import.meta.url).href:s,c);}});
const {prepareDocumentAnalysisInput}=await import('../src/utils/document-text-extraction.ts');
const {extractDocxWithImages:extract}=await import('../src/utils/docx-image-extraction.ts');
const readiness=await import('../src/utils/document-source-readiness.ts');
const {getDocumentDisplayState}=await import('../src/components/documents/documentDisplayStatus.ts');
hook.deregister();
const recognizeImage=async()=>({text:'Keep the gate open.',confidence:95});
const read=(buffer,recognize=recognizeImage)=>extract(buffer,{recognizeImage:recognize});

test('native_and_image_text_keep_order',async()=>{
 const r=await read(docx({body:paragraph('Before image')+image()+paragraph('After image')}));
 assert.ok(r.text.indexOf('Before image')<r.text.indexOf('Keep the gate open.'));
 assert.ok(r.text.indexOf('Keep the gate open.')<r.text.indexOf('After image'));
 assert.equal(r.readingVerification.expectedImageReferences,1);
 assert.match(r.readingVerification.images[0].anchor,/word\/document.xml/);
 assert.match(r.readingVerification.images[0].sha256,/^[a-f\d]{64}$/);
});
test('table_and_auxiliary_image_references_are_accounted_for',async()=>{
 const body=`<w:tbl><w:tr><w:tc>${paragraph('Table context')+image()}</w:tc></w:tr></w:tbl>`;
 const r=await read(docx({body,parts:{'word/header1.xml':paragraph('Header text')+image(),'word/_rels/header1.xml.rels':relationships([['rId1','media/image1.png']]),'word/footnotes.xml':`<w:footnote w:id="1">${paragraph('Footnote text')+image()}</w:footnote>`,'word/_rels/footnotes.xml.rels':relationships([['rId1','media/image1.png']])}}));
 assert.equal(r.readingVerification.expectedImageReferences,3);
 assert.equal(r.readingVerification.images.length,3);
 for(const part of ['word/document.xml','word/header1.xml','word/footnotes.xml'])assert.ok(r.readingVerification.images.some(x=>x.part===part));
 assert.match(r.text,/Header text/);
 assert.match(r.text,/Footnote text/);
});
test('same_image_is_recognized_once',async()=>{
 let calls=0;const r=await read(docx({body:image()+paragraph('Between')+image()}),async()=>{calls++;return recognizeImage();});
 assert.equal(calls,1);
 assert.equal(r.readingVerification.images.length,2);
 assert.equal(new Set(r.readingVerification.images.map(x=>x.anchor)).size,2);
 assert.equal(r.text.match(/Keep the gate open\./g).length,2);
});
test('alternate_content_is_not_double_counted',async()=>{
 const r=await read(docx({body:alternate()}));
 assert.equal(r.readingVerification.expectedImageReferences,1);
 assert.equal(r.text.match(/Keep the gate open\./g).length,1);
});
test('image_only_docx_keeps_body',async()=>{
 const r=await read(docx({body:image()}));assert.match(r.text,/Keep the gate open\./);
 assert.equal(r.requiresReview,false);
});
test('missing_unsupported_or_external_image_is_explicit',async()=>{
 for(const input of [docx({body:paragraph('Original text')+image(),media:{}}),docx({body:paragraph('Original text')+image(),media:{'old.emf':Buffer.from('unsupported')},rels:[['rId1','media/old.emf']]}),docx({body:paragraph('Original text')+image(),rels:[['rId1','https://invalid.test/image.png',true]]})]){
  let calls=0;const r=await read(input,async()=>{calls++;return recognizeImage();});
  assert.equal(r.requiresReview,true);assert.equal(r.readingVerification.complete,false);
  assert.ok(r.readingVerification.images[0].reason);assert.match(r.text,/Original text/);assert.equal(calls,0);
 }
});
test('ocr_failure_keeps_native_text',async()=>{
 const r=await read(docx({body:paragraph('Original text')+image()}),async()=>{throw Error('Synthetic OCR failure');});
 assert.match(r.text,/Original text/);assert.equal(r.requiresReview,true);assert.equal(r.readingVerification.images[0].status,'UNREADABLE');
});
test('high_confidence_does_not_verify_image_numbers',async()=>{
 const r=await read(docx({body:image()}),async()=>({text:'Total 1234.50 ILS',confidence:99}));
 assert.match(r.text,/1234.50/);assert.equal(r.requiresReview,true);
 assert.equal(r.readingVerification.images[0].numericReviewRequired,true);assert.equal(r.readingVerification.complete,false);
});
test('vml_image_and_inline_text_are_kept',async()=>{
 const body=`<w:p><w:r><w:t>First </w:t>${vml()}<w:t> Last</w:t></w:r></w:p>`;
 const r=await read(docx({body}));assert.match(r.text,/First[\s\S]*Keep the gate open\.[\s\S]*Last/);
});

test('legacy_completed_docx_needs_coverage',()=>{
 assert.equal(readiness.assessDocumentSourceReadiness({title:'old.docx',ocr_status:'COMPLETED',extracted_text:'Keep access open.'}).extractionComplete,false);
});
test('verified_zero_image_docx_is_complete',async()=>{
 const prepared=await prepareDocumentAnalysisInput(docx({body:paragraph('יש להשאיר את המעבר פתוח.'),media:{},rels:[]}),'one-line.docx');
 assert.equal(prepared.readingVerification?.expectedImageReferences,0);
 assert.equal(prepared.extractedText,'יש להשאיר את המעבר פתוח.');
 assert.equal(readiness.assessDocumentSourceReadiness({title:'one-line.docx',ocr_status:'COMPLETED',extracted_text:prepared.extractedText,parsed_json:{source_reading:prepared.readingVerification}}).canCompare,true);
});
test('false_count_or_missing_image_blocks_comparison',async()=>{
 const r=await read(docx({body:paragraph('Before')+image()}));
 for(const mutated of [{...r.readingVerification,expectedImageReferences:2},{...r.readingVerification,images:[]},{...r.readingVerification,sourceHash:'bad'},{...r.readingVerification,images:[{...r.readingVerification.images[0],status:'UNREADABLE'}]}]){
  assert.equal(readiness.assessDocumentSourceReadiness({title:'bad.docx',ocr_status:'COMPLETED',extracted_text:r.text,parsed_json:{source_reading:{...mutated,complete:true}}}).canCompare,false);
 }
});
test('numeric_review_blocks_comparison',async()=>{
 const r=await read(docx({body:image()}),async()=>({text:'Total 1234.50 ILS',confidence:99}));
 assert.equal(readiness.assessDocumentSourceReadiness({title:'money.docx',ocr_status:'COMPLETED',extracted_text:r.text,parsed_json:{source_reading:{...r.readingVerification,complete:true}}}).canCompare,false);
});
test('service_markers_are_not_document_body',()=>{
 assert.equal(readiness.hasDocumentBodyText('[DOCX_IMAGE word/document.xml#rId1:1 resource=word/media/image1.png status=UNREADABLE reason=OCR_FAILED]\n[END_DOCX_IMAGE]'),false);
});
test('full_docx_text_is_not_cut_to_ai_limit',async()=>{
 const original='Full original source. '.repeat(7000)+'END OF ORIGINAL';
 const r=await prepareDocumentAnalysisInput(docx({body:paragraph(original),media:{},rels:[]}),'long.docx');
 assert.equal(r.extractedText,original);assert.equal(r.wasTruncated,true);
 assert.equal(r.readingVerification?.complete,true);
});
test('api_metadata_and_display_keep_incomplete_state',async()=>{
 const r=await read(docx({body:paragraph('Source body')+image()}),async()=>({text:'Total 1234.50 ILS',confidence:99}));
 const document={title:'source.docx',ocr_status:'COMPLETED',extracted_text:r.text,parsed_json:{source_reading:r.readingVerification}};
 assert.equal(getDocumentDisplayState(document).key,'SOURCE_INCOMPLETE');
});
test('unsupported_image_only_document_reports_a_gap',async()=>{
 const r=await prepareDocumentAnalysisInput(docx({body:'<w:p><w:r><w:drawing><a:graphic/></w:drawing></w:r></w:p>'}),'unsupported.docx');
 assert.equal(r.requiresReview,true);assert.equal(r.readingVerification.complete,false);
 assert.equal(readiness.hasDocumentBodyText(r.extractedText),false);
});
test('a stored DOCX proof from different bytes cannot pass readiness',async()=>{
 const r=await read(docx({media:{},rels:[]}));
 assert.equal(readiness.assessDocumentSourceReadiness({title:'source.docx',ocr_status:'COMPLETED',extracted_text:r.text,content_hash:'b'.repeat(64),parsed_json:{source_reading:r.readingVerification}}).canCompare,false);
});
test('the real offline OCR reaches the public DOCX preparation entry point',async()=>{
 const {default:sharp}=await import('sharp');
 const bytes=await sharp(Buffer.from('<svg width="1700" height="450" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="80" y="180" font-family="Arial" font-size="120">PAYMENT TOTAL</text><text x="80" y="370" font-family="Arial" font-size="120">1234.50 ILS</text></svg>')).png().toBuffer();
 const r=await prepareDocumentAnalysisInput(docx({body:paragraph('Before OCR')+image()+paragraph('After OCR'),media:{'image1.png':bytes}}),'real-ocr.docx');
 assert.match(r.extractedText,/PAYMENT TOTAL/);assert.match(r.extractedText,/1234/);
 assert.equal(r.requiresReview,true);assert.equal(r.readingVerification.images[0].numericReviewRequired,true);
 assert.ok(r.extractedText.indexOf('Before OCR')<r.extractedText.indexOf('PAYMENT TOTAL'));
 assert.ok(r.extractedText.indexOf('PAYMENT TOTAL')<r.extractedText.indexOf('After OCR'));
});
test('unsupported_drawings_retain_their_native_text',async()=>{
 const r=await read(docx({body:`<w:p><w:r><w:drawing><w:txbxContent>${paragraph('Native text inside a shape')}</w:txbxContent></w:drawing></w:r></w:p>`}));
 assert.match(r.text,/Native text inside a shape/);assert.equal(r.requiresReview,true);
});
test('fallback_keeps_missing_content_without_repeating_placed_images',async()=>{
 const r=await read(docx({body:image()+`<w:sdt><w:sdtContent>${paragraph('Unpositioned content')+image()}</w:sdtContent></w:sdt>`}));
 assert.equal(r.text.match(/Keep the gate open\./g).length,2);assert.match(r.text,/Unpositioned content/);
 assert.equal(r.requiresReview,true);
});
test('additional_image_relationships_inside_a_drawing_cannot_be_silently_omitted',async()=>{
 const body='<w:p><w:r><w:drawing><a:blip r:embed="rId1"><a:extLst><a:ext><custom:image xmlns:custom="urn:fixture" r:embed="rId2"/></a:ext></a:extLst></a:blip></w:drawing></w:r></w:p>';
 const r=await read(docx({body,media:{'image1.png':Buffer.from('preview'),'image2.svg':Buffer.from('<svg/>')},rels:[['rId1','media/image1.png'],['rId2','media/image2.svg']]}));
 assert.equal(r.readingVerification.expectedImageReferences,2);
 assert.equal(r.requiresReview,true);assert.ok(r.readingVerification.images.some(x=>x.reason==='IMAGE_FORMAT_UNSUPPORTED'));
});
