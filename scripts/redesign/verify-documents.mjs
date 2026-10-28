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
