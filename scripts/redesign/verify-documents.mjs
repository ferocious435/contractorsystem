import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {documentFixture,documentStates,completePdfReading} from './fixtures.mjs';
const {DocumentListRow}=await import('../../src/components/documents/DocumentListRow.tsx');
const {DocumentsCatalogView,selectCatalogDocuments}=await import('../../src/components/documents/DocumentsCatalogView.tsx');
const {DocumentSourceView}=await import('../../src/components/documents/DocumentSourceView.tsx');
const {getDocumentDisplayState}=await import('../../src/components/documents/documentDisplayStatus.ts');
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const rowProps={selected:false,processing:false,analysisAvailable:true,onSelect:()=>{},onAnalyze:async()=>{},onPreview:()=>{},onDelete:async()=>{}};

const imageReading=(part,index,overrides={})=>({part,anchor:`${part}#rId${index}:${index}`,mediaName:`word/media/image${index}.png`,sha256:'b'.repeat(64),status:'READ',confidence:92,numericReviewRequired:false,reason:null,...overrides});
const embeddedImageDocument=(overrides={})=>documentFixture('embedded-images',{title:'הוראות.docx',content_hash:'a'.repeat(64),ocr_status:'COMPLETED',extracted_text:'הוראה שלמה עם תמונות בכותרת המסמך.',parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:false,sourceHash:'a'.repeat(64),expectedImageReferences:3,images:[imageReading('word/header1.xml',1),imageReading('word/header1.xml',2),imageReading('word/header1.xml',3,{status:'REQUIRES_REVIEW',confidence:68,numericReviewRequired:true,reason:'OCR_NUMBERS_REQUIRE_REVIEW'})],issues:[]}},...overrides});
const visibleText=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

test('an unread Word header image identifies the affected part and numeric review without hiding two read images',()=>{
  const document=embeddedImageDocument();
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text}),text=visibleText(html);
  assert.ok(text.includes('2 / 3'),text);
  assert.match(html,/<ul[^>]*aria-label="תמונות שדורשות בדיקה"/u);
  assert.match(text,/כותרת עליונה.*תמונה 3.*מספרים/u);
  assert.ok(!/תמונה [12] —/.test(text));
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

test('completed Word image coverage has a complete count and no unread-image list',()=>{
  const document=embeddedImageDocument({parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:true,sourceHash:'a'.repeat(64),expectedImageReferences:2,images:[imageReading('word/document.xml',1),imageReading('word/footer1.xml',2)],issues:[]}}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text});
  assert.ok(visibleText(html).includes('2 / 2'));
  assert.ok(!html.includes('aria-label="תמונות שדורשות בדיקה"'));
  assert.ok(html.includes('data-source-status="READABLE"'));
});

test('a missing Word image record remains visible as a coverage gap',()=>{
  const document=embeddedImageDocument({parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:false,sourceHash:'a'.repeat(64),expectedImageReferences:3,images:[imageReading('word/document.xml',1),imageReading('word/document.xml',2)],issues:[]}}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text}),text=visibleText(html);
  assert.ok(text.includes('2 / 3'));
  assert.match(text,/חסרות תוצאות קריאה/u);
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

test('malformed Word image metadata is reported as unread instead of crashing or appearing complete',()=>{
  const document=embeddedImageDocument({parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:false,sourceHash:'a'.repeat(64),expectedImageReferences:1,images:[null],issues:[]}}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text}),text=visibleText(html);
  assert.ok(text.includes('0 / 1'));
  assert.match(text,/קריאת התמונה לא אומתה/u);
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

test('a legacy Word source cannot display unknown image coverage as complete zero of zero',()=>{
  const document=embeddedImageDocument({parsed_json:{}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text});
  assert.match(visibleText(html),/מספר התמונות לא אומת/u);
  assert.ok(!visibleText(html).includes('0 / 0'));
});

test('Word image verification for different file bytes cannot be presented as current coverage',()=>{
  const document=embeddedImageDocument({content_hash:'c'.repeat(64)});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text});
  assert.match(visibleText(html),/אימות התמונות אינו תואם לקובץ השמור/u);
  assert.ok(!visibleText(html).includes('2 / 3'));
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

test('duplicate Word image anchors cannot inflate the visible coverage count',()=>{
  const document=embeddedImageDocument({parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:true,sourceHash:'a'.repeat(64),expectedImageReferences:3,images:[imageReading('word/header1.xml',1),imageReading('word/header1.xml',1),imageReading('word/footer1.xml',2)],issues:[]}}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text}),text=visibleText(html);
  assert.ok(text.includes('2 / 3'));
  assert.ok(!text.includes('3 / 3'));
  assert.match(text,/חסרות תוצאות קריאה/u);
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

test('unverified Word header and comment placement remains visible even when no image requires review',()=>{
  const document=embeddedImageDocument({parsed_json:{source_reading:{version:'docx-image-coverage-v1',complete:false,sourceHash:'a'.repeat(64),expectedImageReferences:0,images:[],issues:['word/header1.xml:CONTENT_NOT_POSITIONED_BY_PARSER','word/comments.xml:CONTENT_NOT_POSITIONED_BY_PARSER']}}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text}),text=visibleText(html);
  assert.match(html,/<ul[^>]*aria-label="חלקים נוספים שדורשים בדיקה"/u);
  assert.match(text,/כותרת עליונה.*מיקום הטקסט/u);
  assert.match(text,/הערות המסמך.*מיקום הטקסט/u);
  assert.ok(!text.includes('CONTENT_NOT_POSITIONED_BY_PARSER'));
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

for(const [key,document] of documentStates)test(`document state ${key} retains its existing domain classification and a readable label`,()=>{
  assert.equal(getDocumentDisplayState(document).key,key);
  const html=render(DocumentListRow,{...rowProps,document});
  assert.ok(html.includes(`data-document-state="${key}"`));
  assert.ok(html.includes(document.title));
  assert.match(html,/aria-label="פתיחת/u);
});

test('manual approval never hides an unread page or turns the analysis green',()=>{
  const document=documentStates.find(([key])=>key==='SOURCE_INCOMPLETE')[1];
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text});
  for(const text of ['אושר ידנית','הקריאה לא הושלמה','עמודים שלא נקראו','2'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('ניתוח הושלם'));
  assert.ok(html.includes('data-source-status="EXTRACTION_INCOMPLETE"'));
});

test('empty PDF page counters remain unknown rather than becoming complete zero of zero',()=>{
  const document=documentFixture('empty-pages',{title:'ריק.pdf',ai_status:'VALIDATED',ocr_status:'COMPLETED',extracted_text:'תוכן חלקי שמור.',parsed_json:{source_reading:{...completePdfReading,totalPages:0,readPages:[],unreadablePages:[]}}});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text});
  assert.ok(html.includes('מספר העמודים לא אומת'));
  assert.ok(html.includes('הקריאה לא הושלמה'));
});

test('the full long source text remains available beyond the former 16000-character preview',()=>{
  const text='הוראה שמורה במקור\n'.repeat(1700)+'סוף_הטקסט_המלא_לבדיקה';
  const document=documentFixture('long',{ocr_status:'COMPLETED',extracted_text:text});
  const html=render(DocumentSourceView,{document,fullText:text});
  assert.ok(html.includes('סוף_הטקסט_המלא_לבדיקה'));
  assert.equal((html.match(/הוראה שמורה במקור/gu)||[]).length,1700);
});

test('a short finished instruction is not relabelled as a fragment',()=>{
  const document=documentFixture('short',{ocr_status:'COMPLETED',extracted_text:'עצור את העבודה.'});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text});
  assert.ok(html.includes('data-source-status="READABLE"'));
  assert.ok(!html.includes('data-document-marker="FRAGMENT"'));
});

test('explicit draft and fragment markers remain visible independently of extraction completeness',()=>{
  for(const [text,marker,label]of [['טיוטה\nיש לבדוק את ההוראות.','DRAFT','טיוטה'],['קטע מתוך הוראות הביצוע\nיש לבדוק את ההוראות.','FRAGMENT','קטע מתוך מסמך']]){
    const document=documentFixture(marker,{ocr_status:'COMPLETED',extracted_text:text});
    const html=render(DocumentSourceView,{document,fullText:text});
    assert.ok(html.includes(`data-document-marker="${marker}"`));
    assert.ok(html.includes(label));
    assert.ok(html.includes('אינו הוראה מחייבת מאומתת'));
  }
});

test('status and local search filters never mix categories or modify the loaded records',()=>{
  const docs=[...documentStates.map(([,doc])=>doc),documentFixture('execution',{category:'EXECUTION',title:'C-CE6070_פרוטוקול.txt'})];
  assert.ok(selectCatalogDocuments(docs,'CONTRACT','ALL','').every(doc=>doc.category==='CONTRACT'));
  assert.deepEqual(selectCatalogDocuments(docs,'EXECUTION','ALL','c-ce6070').map(doc=>doc.id),['execution']);
  assert.equal(selectCatalogDocuments(docs,'CONTRACT','VALIDATED','').length,3);
  assert.equal(selectCatalogDocuments(docs,undefined,'ERROR','').length,2);
  assert.equal(docs.length,9);
});

test('an unavailable service blocks analysis with a visible reason but leaves the stored source readable',()=>{
  const html=render(DocumentListRow,{...rowProps,document:documentStates[0][1],analysisAvailable:false,analysisDisabledReason:'חיבור העוזר אינו זמין'});
  assert.ok(html.includes('חיבור העוזר אינו זמין'));
  assert.match(html,/<button[^>]*disabled/u);
  assert.ok(html.includes('פתיחת מקור'));
});

test('catalog read failure offers only another read and never triggers analysis during rendering',()=>{
  let analyses=0,reads=0;
  const html=render(DocumentsCatalogView,{documents:[],category:'CONTRACT',activeFilter:'ALL',uploading:false,processingId:null,selectedId:null,loadError:'לא ניתן לטעון מסמכים כרגע',onSelect:()=>{},onFilter:()=>{},onRetryRead:async()=>reads++,onUpload:async()=>{},onAnalyze:async()=>analyses++,onPreview:()=>{},onDelete:async()=>{}});
  assert.ok(html.includes('לא ניתן לטעון מסמכים כרגע'));
  assert.ok(html.includes('ניסיון נוסף'));
  assert.ok(!html.includes('עדיין אין מסמכים'));
  assert.equal(analyses,0);assert.equal(reads,0);
});

test('source preview failure and unsupported formats keep text available and do not validate on open',()=>{
  let validations=0;
  const document=documentFixture('unsupported',{title:'קובץ_לתצוגה.dwg',ocr_status:'COMPLETED',extracted_text:'טקסט שמור מתוך קובץ הבדיקה.'});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text,previewKind:'unsupported',previewError:'התצוגה לא נטענה',canValidate:false,validationDisabledReason:'אין תוצאה מאומתת לאישור',onValidate:async()=>validations++});
  assert.ok(html.includes(document.extracted_text));
  assert.ok(html.includes('התצוגה לא נטענה'));
  assert.ok(html.includes('אין תוצאה מאומתת לאישור'));
  assert.equal(validations,0);
});

test('a failed refresh never presents an earlier source as the current full saved text',()=>{
  const document=documentFixture('read-error',{ocr_status:'COMPLETED',extracted_text:'OLD_SOURCE_SENTINEL'});
  const html=render(DocumentSourceView,{document,fullText:document.extracted_text,sourceReadError:'הטקסט העדכני לא נקרא למסך',sourceUrl:'/synthetic-original.pdf',onRetryRead:async()=>{}});
  assert.ok(html.includes('הטקסט העדכני לא נקרא למסך'));
  assert.ok(html.includes('ניסיון נוסף'));
  assert.ok(html.includes('/synthetic-original.pdf'));
  assert.ok(!html.includes('OLD_SOURCE_SENTINEL'));
  assert.ok(!html.includes('הטקסט המלא שנשמר'));
});

test('a catalog source read failure follows the selected document without hiding another source',()=>{
  const documents=[documentFixture('unread-view',{extracted_text:'STALE_SOURCE_SENTINEL'}),documentFixture('current-view',{extracted_text:'CURRENT_SOURCE_SENTINEL'})];
  const props={documents,activeFilter:'ALL',uploading:false,processingId:null,loadError:null,sourceReadErrors:{'unread-view':'הטקסט העדכני לא נקרא למסך'},onSelect:()=>{},onFilter:()=>{},onRetryRead:async()=>{},onUpload:async()=>{},onAnalyze:async()=>{},onPreview:()=>{},onDelete:async()=>{}};
  const stale=render(DocumentsCatalogView,{...props,selectedId:'unread-view'});
  assert.ok(stale.includes('הטקסט העדכני לא נקרא למסך'));
  assert.ok(!stale.includes('STALE_SOURCE_SENTINEL'));
  const current=render(DocumentsCatalogView,{...props,selectedId:'current-view'});
  assert.ok(current.includes('CURRENT_SOURCE_SENTINEL'));
  assert.ok(!current.includes('הטקסט העדכני לא נקרא למסך'));
});
