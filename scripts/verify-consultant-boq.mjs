import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
const moduleUrl=new URL('../src/utils/consultant-boq.ts',import.meta.url);
const {selectConsultantBoqRows}=existsSync(moduleUrl)?await import(moduleUrl.href):{selectConsultantBoqRows:()=>[]};
const hash=text=>createHash('sha256').update(text).digest('hex');
const question='מה הבסיס לתשלום על דחיקת צינורות GRP בקוטר 450 מ"מ ברחוב יהלום?';
const body='כתב כמויות לביצוע\nסעיף תיאור יחידה כמות מחיר סה"כ\nהמחירים ללא מע"מ\n'
 +'דחיקת צינורות פיברגלס בשיטת Micro Tunneling בקוטר 450 מ"מ 57.91.0016\n'
 +'אספקת הצינורות נמדדת בנפרד\n496,551.00 3,310.34 150.00 מ\tט\tר\n-- 17 of 18 --\n'
 +'אספקה בלבד של צינורות GRP בקוטר 361 מ"מ פנים / 450 מ"מ חוץ 57.91.0022\n'
 +'402,085.50 2,680.57 150.00 מטר\n-- 18 of 18 --';
const doc=(id='boq',text=body,extra={})=>({id,project_id:'p',title:'כתב כמויות לביצוע.pdf',extracted_text:text,
 content_hash:hash('bytes-'+id),extracted_text_hash:hash(text),ocr_status:'COMPLETED',category:'CONTRACT',
 parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:18,readPages:Array.from({length:18},(_,i)=>i+1),unreadablePages:[]}},...extra});
test('ordinary contractor question finds separate laying and supply rows without item codes',()=>{
 const rows=selectConsultantBoqRows([doc()],question,[]);
 assert.deepEqual(rows.map(r=>[r.itemCode,r.page,r.unitPrice]),[['57.91.0016',17,3310.34],['57.91.0022',18,2680.57]]);
 for(const row of rows){assert.equal(body.slice(row.start,row.end),row.quote);assert.ok(!row.quote.includes('יהלום'));assert.equal(row.binding.status,'UNVERIFIED');assert.ok(row.binding.warnings.length);assert.equal(row.vatBasis,'EXCL');assert.equal(row.sourceHash,hash('bytes-boq'));assert.equal(row.textHash,hash(body));}
});
test('other site, diameter, draft, partial reading and contractor offer cannot supply contractual rows',()=>{
 const variants=[doc('other',body.replaceAll('450','600')),doc('street',body.replace('דחיקת','ברחוב התאנה דחיקת')),doc('draft',body,{title:'כתב כמויות טיוטה.pdf'}),doc('partial',body,{ocr_status:'REQUIRES_REVIEW'}),doc('offer',body.replace('כתב כמויות לביצוע','הצעת מחיר של הקבלן'))];
 for(const candidate of variants)assert.deepEqual(selectConsultantBoqRows([candidate],question,[]),[],candidate.id);
});
test('same code for a different construction object does not match pipe works',()=>{
 assert.deepEqual(selectConsultantBoqRows([doc('different',body.replaceAll(/דחיקת צינורות פיברגלס בשיטת Micro Tunneling|אספקה בלבד של צינורות GRP/g,'הקמת מבנה בטון'))],question,[]),[]);
});
test('exact duplicate source does not duplicate prices',()=>{
 const a=doc(),b=doc('copy',body,{content_hash:a.content_hash});const rows=selectConsultantBoqRows([a,b],question,[]);
 assert.equal(rows.length,2);assert.deepEqual(rows[0].duplicateDocumentIds,['copy']);
});
test('unknown topic and empty input return no prices',()=>{
 assert.deepEqual(selectConsultantBoqRows([doc()],'מה נאמר על עבודות צבע במשרד?',[]),[]);
 assert.deepEqual(selectConsultantBoqRows([],question,[]),[]);
});
test('grounded topic instruction supplies dimensions and codes in same project only',()=>{
 const instruction=doc('instruction','ברחוב יהלום יש לבצע דחיקת צינורות בקוטר 450 מ"מ לפי סעיפים 57.91.0016 ו-57.91.0022.',{title:'instruction.txt',parsed_json:{}});
 const source={documentId:'instruction',quote:instruction.extracted_text,start:0,end:instruction.extracted_text.length};
 assert.equal(selectConsultantBoqRows([instruction,doc(),doc('foreign',body,{project_id:'other'})],'מה הוחלט ברחוב יהלום?',[source]).length,2);
 assert.deepEqual(selectConsultantBoqRows([doc(),doc('foreign',body,{project_id:'other'})],question,[]),[]);
 assert.deepEqual(selectConsultantBoqRows([doc()],'מה הוחלט?',[{...source,quote:'fake'}]),[]);
});
test('layout split reversed digits match dimensions while saved quote remains literal',()=>{
 const text=body.replaceAll('450','0\t5\t4').replaceAll('361','1\t6\t3').replaceAll('דחיקת','ד\tח\tי\tק\tת');
 const rows=selectConsultantBoqRows([doc('layout',text)],question,[]);assert.equal(rows.length,2);
 assert.ok(rows[0].quote.includes('0\t5\t4'));assert.equal(text.slice(rows[0].start,rows[0].end),rows[0].quote);
});
test('print date is marked separately and upload time never becomes document date',()=>{
 const rows=selectConsultantBoqRows([doc('dated','תאריך הדפסה: 06.06.2023\n'+body,{created_at:'2026-11-16'})],question,[]);
 assert.equal(rows[0].revision.date,null);assert.equal(rows[0].revision.datePurpose,'PRINTED');assert.equal(rows[0].revision.printedDate,'06.06.2023');assert.ok(rows[0].revision.dateEvidence.quote.includes('תאריך הדפסה'));
});
test('duplicate codes are explicitly ambiguous and invalid arithmetic yields no row',()=>{
 const rows=selectConsultantBoqRows([doc('repeated',body+'\n'+body)],question,[]);
 assert.equal(rows.length,4);assert.ok(rows.every(row=>row.ambiguousItemCode));
 assert.deepEqual(selectConsultantBoqRows([doc('wrong',body.replace('496,551.00','496,000.00').replace('402,085.50','400,000.00'))],question,[]),[]);
});
test('another construction object is selected by its own scope and dimensions',()=>{
 const text=body.replaceAll(/דחיקת צינורות פיברגלס בשיטת Micro Tunneling|אספקה בלבד של צינורות GRP/g,'הקמת קיר בטון');
 const rows=selectConsultantBoqRows([doc('wall',text)],'מה מחיר הקמת קיר בטון בקוטר 450 מ"מ?',[]);
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.scope.includes('קיר בטון')));
});
test('document revision and designation each retain their own literal evidence and page',()=>{
 const text='תאריך מהדורה: 02.05.2023\nתאריך הדפסה: 06.06.2023\n'+body;
 const rows=selectConsultantBoqRows([doc('revision',text)],question,[]);
 const revision=rows[0].revision;
 assert.equal(revision.date,'02.05.2023');assert.equal(revision.datePurpose,'DOCUMENT');assert.equal(revision.printedDate,'06.06.2023');
 assert.equal(revision.designation,'EXECUTION_BOQ');
 for(const evidence of [revision.dateEvidence,revision.printedDateEvidence,revision.designationEvidence]){
  assert.equal(text.slice(evidence.start,evidence.end),evidence.quote);assert.equal(evidence.page,17);
 }
});
test('bare date and upload date are not evidence of a document revision',()=>{
 const rows=selectConsultantBoqRows([doc('bare','06/06/2023\n'+body,{created_at:'2026-11-16'})],question,[]);
 assert.equal(rows[0].revision.date,null);assert.equal(rows[0].revision.datePurpose,'UNKNOWN');assert.equal(rows[0].revision.dateEvidence,null);
});
test('an explicit site in the row can verify binding with its original quote',()=>{
 const text=body.replaceAll('בקוטר','ברחוב יהלום בקוטר');const rows=selectConsultantBoqRows([doc('bound',text)],question,[]);
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.binding.status==='VERIFIED'));
 for(const row of rows)for(const evidence of row.binding.evidence)assert.equal(text.slice(evidence.start,evidence.end),evidence.quote);
});
test('same text in different source versions does not prove replacement or discard a version',()=>{
 const a=doc(),b=doc('new',body,{created_at:'2030-01-01'});
 assert.equal(selectConsultantBoqRows([a,b],question,[]).length,4);
});
test('contractor offer title cannot become a contractual BOQ through copied execution headings',()=>{
 assert.deepEqual(selectConsultantBoqRows([doc('offer-title',body,{title:'הצעת מחיר של הקבלן.pdf'})],question,[]),[]);
});

// Optional local regression uses owner-authorized snapshots; their contents are never committed.
if(process.env.CONSULTANT_BOQ_FIXTURES){
 test('real project question preserves both independently grounded BOQs and the original literal quotes',async()=>{
  const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');
  const root=process.env.CONSULTANT_BOQ_FIXTURES;
  const documents=JSON.parse(await readFile(join(root,'project-documents.json'),'utf8'));
  const request=JSON.parse(await readFile(join(root,'request.json'),'utf8'));
  const rows=selectConsultantBoqRows(documents,request.question,[]);
  const dedicated=rows.filter(row=>row.page===17||row.page===18);
  assert.deepEqual(dedicated.map(row=>[row.itemCode,row.page,row.unitPrice]),[['57.91.0016',17,3310.34],['57.91.0022',18,2680.57]]);
  assert.deepEqual(rows.map(row=>[row.itemCode,row.page,row.unitPrice]),[
   ['57.91.0016',137,3310.34],['57.91.0022',138,2680.57],['57.91.0016',17,3310.34],['57.91.0022',18,2680.57]]);
  for(const row of rows){const source=documents.find(document=>document.id===row.documentId);
   assert.equal(source.extracted_text.slice(row.start,row.end),row.quote);
   assert.ok(!row.quote.includes('יהלום'));assert.equal(row.binding.status,'UNVERIFIED');assert.ok(row.binding.warnings.length);
  }
 });
}
test('multiword streets with a common first word never verify a different street',()=>{
 const other=body.replaceAll('בקוטר','ברחוב בן גוריון בקוטר');
 const query=question.replace('יהלום','בן יהודה');
 assert.deepEqual(selectConsultantBoqRows([doc('other-ben',other)],query,[]),[]);
 const same=body.replaceAll('בקוטר','ברחוב בן יהודה בקוטר');
 const rows=selectConsultantBoqRows([doc('same-ben',same)],query,[]);
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.binding.status==='VERIFIED'));
 for(const mention of ['בן יהודה ובסמוך למתחם העבודה','בן יהודה...']){
  const uncertain=body.replaceAll('בקוטר',`ברחוב ${mention} בקוטר`);
  const uncertainRows=selectConsultantBoqRows([doc('uncertain-ben',uncertain)],query,[]);
  assert.equal(uncertainRows.length,2);assert.ok(uncertainRows.every(row=>row.binding.status==='UNVERIFIED'));
 }
});
test('explicit pipe materials reject conflicting GRP and steel in either direction',()=>{
 const steelQuestion=question.replace('GRP','פלדה');
 assert.deepEqual(selectConsultantBoqRows([doc()],steelQuestion,[]),[]);
 const steel=body.replaceAll('פיברגלס','פלדה').replaceAll('GRP','פלדה');
 assert.deepEqual(selectConsultantBoqRows([doc('steel',steel)],question,[]),[]);
 assert.equal(selectConsultantBoqRows([doc('steel',steel)],steelQuestion,[]).length,2);
});
test('a concrete building cannot supply a concrete wall price through shared action or material',()=>{
 const building=body.replaceAll(/דחיקת צינורות פיברגלס בשיטת Micro Tunneling|אספקה בלבד של צינורות GRP/g,'הקמת מבנה בטון');
 assert.deepEqual(selectConsultantBoqRows([doc('building',building)],'מה מחיר הקמת קיר בטון בקוטר 450 מ"מ?',[]),[]);
});
