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

for(const [action,label] of [['תיקון','repair'],['פירוק','dismantling']]){
 test(`${label} cannot inherit jacking or supply prices for the same pipe`,()=>{
  assert.deepEqual(selectConsultantBoqRows([doc()],`מה המחיר ל${action} צינורות GRP בקוטר 450 מ"מ?`,[]),[]);
 });
 test(`${label} selects its own work while jacking retains separate supply`,()=>{
  const text=body.replace('דחיקת צינורות פיברגלס בשיטת Micro Tunneling',`${action} צינורות GRP`);
  const rows=selectConsultantBoqRows([doc('action',text)],`מה המחיר ל${action} צינורות GRP בקוטר 450 מ"מ?`,[]);
  assert.equal(rows.length,1);assert.equal(rows[0].unitPrice,3310.34);
  assert.equal(selectConsultantBoqRows([doc()],question,[]).length,2);
 });
}
test('dismantling a pipe cannot inherit dismantling a shaft through the letters in the action',()=>{
 const text=body.replace('דחיקת צינורות פיברגלס בשיטת Micro Tunneling','פירוק פיר GRP');
 assert.deepEqual(selectConsultantBoqRows([doc('shaft',text)],'מה המחיר לפירוק צינורות GRP בקוטר 450 מ"מ?',[]),[]);
});
for(const location of ['body','title'])test(`explicit non-execution designation in ${location} blocks contractual prices`,()=>{
 const candidate=doc('not-execution',location==='body'?body.replace('כתב כמויות לביצוע','כתב כמויות לא לביצוע'):body,
  location==='title'?{title:'כתב כמויות לא לביצוע.pdf'}:{});
 assert.deepEqual(selectConsultantBoqRows([candidate],question,[]),[]);
});
test('a reference to another non-execution edition does not revoke the current execution BOQ',()=>{
 for(const note of ['המהדורה הקודמת סומנה "כתב כמויות לא לביצוע"; מסמך זה הוא המהדורה לביצוע.',
  'הקבלן צירף מסמך אחר שכותרתו "לא לביצוע".',
  'כתב כמויות לביצוע; המהדורה הקודמת לא לביצוע']){
  assert.equal(selectConsultantBoqRows([doc('other-edition',body+'\n'+note)],question,[]).length,2);
 }
});
test('a standalone non-execution stamp on the current BOQ blocks its execution heading',()=>{
 assert.deepEqual(selectConsultantBoqRows([doc('stamp',body+'\nלא לביצוע')],question,[]),[]);
});
test('revision and printed dates on one line retain separate exact fields in either order',()=>{
 for(const header of ['תאריך מהדורה: 01.01.2024; תאריך הדפסה: 02.02.2024','תאריך הדפסה: 02.02.2024; תאריך מהדורה: 01.01.2024']){
  const text=header+'\n'+body,revision=selectConsultantBoqRows([doc('dates',text)],question,[])[0].revision;
  assert.equal(revision.date,'01.01.2024');assert.equal(revision.printedDate,'02.02.2024');assert.equal(revision.datePurpose,'DOCUMENT');
  assert.equal(revision.dateEvidence.quote,'תאריך מהדורה: 01.01.2024');
  assert.equal(revision.printedDateEvidence.quote,'תאריך הדפסה: 02.02.2024');
  for(const evidence of [revision.dateEvidence,revision.printedDateEvidence])assert.equal(text.slice(evidence.start,evidence.end),evidence.quote);
 }
});
test('conflicting revision dates on one line stay unknown with both literal ranges',()=>{
 const text='תאריך מהדורה: 01.01.2024; תאריך מהדורה: 02.02.2024\n'+body;
 const revision=selectConsultantBoqRows([doc('conflict',text)],question,[])[0].revision;
 assert.equal(revision.date,null);assert.equal(revision.datePurpose,'UNKNOWN');assert.equal(revision.conflictingDateEvidence.length,2);
 assert.deepEqual(revision.conflictingDateEvidence.map(e=>e.quote),['תאריך מהדורה: 01.01.2024','תאריך מהדורה: 02.02.2024']);
 for(const evidence of revision.conflictingDateEvidence)assert.equal(text.slice(evidence.start,evidence.end),evidence.quote);
});
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

const editionsUrl=new URL('../src/utils/consultant-boq-editions.ts',import.meta.url);
const {compareBoqEdition}=existsSync(editionsUrl)?await import(editionsUrl.href):{compareBoqEdition:()=>({status:'UNKNOWN',originalRow:null})};
const edition=(id,version,price=100,options={})=>{
 const {date='01.01.2024',replacement='',unit='מטר',scope='אספקת צינורות GRP בקוטר 450 מ"מ',page=3,...extra}=options;
 return doc(id,`מספר כתב כמויות: BOQ-P; מהדורה: ${version}\n${date?`תאריך מהדורה: ${date}\n`:''}${replacement?replacement+'\n':''}כתב כמויות לביצוע\nסעיף תיאור יחידה כמות מחיר סה"כ\nהמחירים ללא מע"מ\n${scope} 57.91.0022\n${price*2} ${price} 2 ${unit}\n-- ${page} of 18 --`,extra);
};
const replaces=(from,to)=>`כתב כמויות BOQ-P מהדורה ${to} מחליף את כתב כמויות BOQ-P מהדורה ${from}.`;
const savedFrom=d=>selectConsultantBoqRows([d],'אספקת צינורות GRP בקוטר 450 מ"מ',[])[0];
test('explicit replacement preserves both grounded editions dates prices pages and literal basis',()=>{
 const a=edition('old','A'),b=edition('new','B',140,{date:'02.02.2024',replacement:replaces('A','B'),page:7});
 const saved=savedFrom(a),before=structuredClone(saved),out=compareBoqEdition(saved,[a,b]);
 assert.equal(out.status,'REPLACED');assert.deepEqual(saved,before);assert.deepEqual(out.originalRow,before);
 assert.equal(out.currentRow.unitPrice,140);assert.equal(out.currentRow.page,7);assert.equal(out.originalRow.page,3);
 assert.equal(out.originalRow.revision.date,'01.01.2024');assert.equal(out.currentRow.revision.date,'02.02.2024');
 assert.deepEqual(out.changes,['PRICE']);assert.equal(out.chain.length,1);
 for(const anchor of [out.currentRow,...out.chain.map(h=>h.evidence)]){const d=[a,b].find(d=>d.id===anchor.documentId);assert.equal(d.extracted_text.slice(anchor.start,anchor.end),anchor.quote);}
});
test('no same-code date title or generic designation proves replacement',()=>{
 const a=edition('a','A'),b=edition('b','B',150,{date:'04.04.2030'});
 assert.equal(compareBoqEdition(savedFrom(a),[a,b]).status,'UNKNOWN');
 assert.equal(compareBoqEdition(savedFrom(a),[a,edition('c','B',150,{replacement:'כתב כמויות לביצוע מחליף כתב כמויות חוזי'})]).status,'UNKNOWN');
});
test('same price unit and scope changes and missing date remain explicit',()=>{
 const a=edition('a','A');
 for(const [options,expected] of [[{},[]],[{unit:'יחידה'},['UNIT']],[{scope:'אספקת צינורות פלדה בקוטר 450 מ"מ'},['SCOPE']]]){
  const b=edition('b','B',100,{date:null,replacement:replaces('A','B'),...options});const out=compareBoqEdition(savedFrom(a),[a,b]);
  assert.equal(out.status,'REPLACED');assert.deepEqual(out.changes,expected);assert.equal(out.currentRow.revision.date,null);assert.ok(out.warnings.some(w=>w.includes('תאריך לא צוין')));
  if(expected.length)assert.ok(out.description.includes(out.currentRow[expected[0]==='UNIT'?'unit':'scope']));
 }
});
test('replacement chain reaches latest unambiguous edition and reports competing successors',()=>{
 const a=edition('a','A'),b=edition('b','B',120,{replacement:replaces('A','B')}),c=edition('c','C',130,{replacement:replaces('B','C')});
 const out=compareBoqEdition(savedFrom(a),[a,b,c]);assert.equal(out.currentRow.documentId,'c');assert.equal(out.chain.length,2);
 const conflict=compareBoqEdition(savedFrom(a),[a,b,c,edition('d','D',160,{replacement:replaces('B','D')})]);
 assert.equal(conflict.status,'CONFLICT');assert.equal(conflict.currentRow.documentId,'b');assert.equal(conflict.originalRow.documentId,'a');
});
test('separate active project letter may prove replacement while drafts foreign and unread sources cannot',()=>{
 const a=edition('a','A'),b=edition('b','B',120),letter=doc('letter',replaces('A','B'),{title:'approval.txt',parsed_json:{}});
 assert.equal(compareBoqEdition(savedFrom(a),[a,b,letter]).status,'REPLACED');
 for(const extra of [{title:'approval טיוטה.txt'},{project_id:'foreign'},{ocr_status:'REQUIRES_REVIEW'},{deleted_at:'2024-01-01'}]){
  assert.equal(compareBoqEdition(savedFrom(a),[a,b,{...letter,...extra}]).status,'UNKNOWN');
 }
});
test('replacement is directional affirmative and only new edition or separate letter can establish it',()=>{
 const a=edition('a','A',100,{replacement:replaces('A','B')}),b=edition('b','B',120);
 assert.equal(compareBoqEdition(savedFrom(a),[a,b]).status,'UNKNOWN');
 for(const phrase of [`לא ${replaces('A','B')}`,`האם ${replaces('A','B')}`,`טיוטה: ${replaces('A','B')}`]){
  assert.equal(compareBoqEdition(savedFrom(a),[a,edition('b','B',120,{replacement:phrase})]).status,'UNKNOWN');
 }
});
test('rereading same bytes with a new text hash is never a new edition',()=>{
 const a=edition('a','A'),b=edition('b','B',190,{replacement:replaces('A','B'),content_hash:a.content_hash});
 const out=compareBoqEdition(savedFrom(a),[a,b]);assert.equal(out.status,'UNKNOWN');assert.equal(out.currentRow.unitPrice,100);
});
test('absent ambiguous or changed section item cannot supply replacement price',()=>{
 const a=edition('a','A'),b=edition('b','B',120,{replacement:replaces('A','B')});
 for(const text of [b.extracted_text.replace('57.91.0022','58.91.0022'),b.extracted_text+'\n'+b.extracted_text]){
  assert.equal(compareBoqEdition(savedFrom(a),[a,{...b,extracted_text:text,extracted_text_hash:hash(text)}]).status,'UNKNOWN');
 }
});
test('cycles and multiple files claiming the same edition are conflicts',()=>{
 const a=edition('a','A',100,{replacement:replaces('B','A')}),b=edition('b','B',120,{replacement:replaces('A','B')});
 assert.equal(compareBoqEdition(savedFrom(a),[a,b]).status,'CONFLICT');
 const a2=edition('baseline','A'),b2=edition('competing','B',140,{replacement:replaces('A','B')});
 assert.equal(compareBoqEdition(savedFrom(a2),[a2,b,b2]).status,'CONFLICT');
});
test('identifiers and replacement quotes must both match exact BOQ identities',()=>{
 const a=edition('a','A'),b=edition('b','B',120,{replacement:replaces('A','B')});
 const text=b.extracted_text.replace('מספר כתב כמויות: BOQ-P','מספר כתב כמויות: BOQ-Q');
 assert.equal(compareBoqEdition(savedFrom(a),[a,{...b,extracted_text:text,extracted_text_hash:hash(text)}]).status,'UNKNOWN');
 const out=compareBoqEdition({...savedFrom(a),unitPrice:999},[a,b]);assert.equal(out.status,'UNKNOWN');
});
test('print upload and contradictory dates cannot silently become revision dates',()=>{
 const a=edition('a','A'),b=edition('b','B',120,{date:null,replacement:replaces('A','B')});
 const text='תאריך הדפסה: 03.03.2030\n'+b.extracted_text;
 const out=compareBoqEdition(savedFrom(a),[a,{...b,extracted_text:text,extracted_text_hash:hash(text),created_at:'2031-01-01'}]);
 assert.equal(out.status,'REPLACED');assert.equal(out.currentRow.revision.date,null);assert.equal(out.currentRow.revision.printedDate,'03.03.2030');
 const conflicting='תאריך מהדורה: 06.06.2025\n'+edition('c','B',120,{replacement:replaces('A','B')}).extracted_text;
 const result=compareBoqEdition(savedFrom(a),[a,doc('c',conflicting)]);
 assert.equal(result.currentRow.revision.date,null);assert.ok(result.warnings.some(w=>w.includes('תאריכים סותרים')));
});
if(process.env.CONSULTANT_BOQ_FIXTURES){
 test('real project BOQs retain all original rows without an invented replacement',async()=>{
  const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');
  const root=process.env.CONSULTANT_BOQ_FIXTURES;const documents=JSON.parse(await readFile(join(root,'project-documents.json'),'utf8'));
  const request=JSON.parse(await readFile(join(root,'request.json'),'utf8'));const rows=selectConsultantBoqRows(documents,request.question,[]);
  assert.equal(rows.length,4);for(const row of rows){const out=compareBoqEdition(row,documents);assert.equal(out.status,'UNKNOWN');assert.deepEqual(out.currentRow,row);assert.deepEqual(out.originalRow,row);}
 });
}
test('a contractor offer and an unrelated third BOQ cannot authoritatively replace two editions',()=>{
 const a=edition('a','A'),b=edition('b','B',120);
 const letter=doc('offer',replaces('A','B'),{title:'הצעת מחיר של הקבלן.txt',parsed_json:{}});
 assert.equal(compareBoqEdition(savedFrom(a),[a,b,letter]).status,'UNKNOWN');
 const c=edition('third','C',130,{replacement:replaces('A','B')});assert.equal(compareBoqEdition(savedFrom(a),[a,b,c]).status,'UNKNOWN');
});
test('a replacement phrase selects an edition not one of its competing source files',()=>{
 const a=edition('baseline-conflict','A'),b=edition('replacement','B',120,{replacement:replaces('A','B')});
 const alternate=edition('alternate-file','B',999);const saved=savedFrom(a);
 const out=compareBoqEdition(saved,[a,b,alternate]);
 assert.equal(out.status,'CONFLICT');assert.deepEqual(out.originalRow,saved);assert.equal(out.currentRow.documentId,a.id);assert.ok(out.reason);
});
test('a successor without the saved item invalidates the intermediate current price and keeps the proof history',()=>{
 const a=edition('history-a','A'),b=edition('history-b','B',120,{replacement:replaces('A','B')});
 const c=edition('history-c','C',180,{replacement:replaces('B','C')});
 c.extracted_text=c.extracted_text.replace('57.91.0022','58.91.0022');c.extracted_text_hash=hash(c.extracted_text);
 const saved=savedFrom(a),out=compareBoqEdition(saved,[a,b,c]);
 assert.equal(out.status,'UNKNOWN');assert.ok(out.reason);assert.deepEqual(out.originalRow,saved);
 assert.equal(out.chain.length,1);assert.equal(out.chain[0].to.documentId,b.id);
 assert.deepEqual(out.editionHistory.map(h=>h.toDocumentId),[b.id,c.id]);
 for(const hop of out.editionHistory){const source=[a,b,c].find(d=>d.id===hop.evidence.documentId);assert.equal(source.extracted_text.slice(hop.evidence.start,hop.evidence.end),hop.evidence.quote);}
 const d=edition('history-d','D',190,{replacement:replaces('C','D')});
 const extended=compareBoqEdition(saved,[a,b,c,d]);assert.equal(extended.status,'REPLACED');assert.equal(extended.currentRow.documentId,d.id);
 assert.deepEqual(extended.editionHistory.map(h=>h.toDocumentId),[b.id,c.id,d.id]);
 assert.equal(extended.chain.length,1); // No fabricated B→D row hop: C has no corresponding row.
});
const editionGap=()=>{
 const a=edition('warning-a','A',100,{title:'A.pdf'}),b=edition('warning-b','B',120,{replacement:replaces('A','B'),title:'B.pdf'});
 const c=edition('warning-c','C',130,{replacement:replaces('B','C'),date:null,title:'C.pdf'});
 c.extracted_text=c.extracted_text.replace('57.91.0022','58.91.0022');c.extracted_text_hash=hash(c.extracted_text);
 return [a,b,c];
};
test('missing date of the latest edition stays visible after an intermediate edition without the item',()=>{
 const documents=editionGap(),d=edition('warning-d','D',190,{replacement:replaces('C','D'),date:null,title:'D.pdf'});
 const out=compareBoqEdition(savedFrom(documents[0]),[...documents,d]);
 assert.equal(out.status,'REPLACED');assert.equal(out.currentRow.documentId,d.id);assert.equal(out.currentRow.revision.date,null);
 assert.deepEqual(out.chain.map(h=>h.to.documentId),['warning-b']);assert.equal(out.editionHistory.length,3);
 assert.equal(out.warnings.filter(w=>w.includes('D.pdf')&&w.includes('תאריך לא צוין')).length,1);
 assert.equal(out.warnings.filter(w=>w.includes('C.pdf')&&w.includes('תאריך לא צוין')).length,1);
 assert.equal(out.warnings.length,new Set(out.warnings).size);
});
test('conflicting dates of the latest edition stay visible after an intermediate edition without the item',()=>{
 const documents=editionGap(),d=edition('warning-d','D',190,{replacement:replaces('C','D'),title:'D.pdf'});
 d.extracted_text='תאריך מהדורה: 05.05.2025\n'+d.extracted_text;d.extracted_text_hash=hash(d.extracted_text);
 const out=compareBoqEdition(savedFrom(documents[0]),[...documents,d]);
 assert.equal(out.status,'REPLACED');assert.equal(out.currentRow.documentId,d.id);assert.equal(out.currentRow.revision.date,null);
 assert.equal(out.currentRow.revision.conflictingDateEvidence.length,2);
 assert.equal(out.warnings.filter(w=>w.includes('D.pdf')&&w.includes('תאריכים סותרים')).length,1);
 assert.equal(out.warnings.filter(w=>w.includes('C.pdf')&&w.includes('תאריך לא צוין')).length,1);
 assert.equal(out.warnings.length,new Set(out.warnings).size);
});

test('explicit question constraints survive a broad grounded packet mentioning other materials sizes and codes',()=>{
 const history=doc('history','הקמת קיר בטון בקוטר 600 מ"מ לפי סעיף 99.99.9999; אספקת צינורות פלדה לבדיקת חלופה.',{title:'history.txt',parsed_json:{}});
 const rows=selectConsultantBoqRows([doc(),history],question,[{documentId:history.id,quote:history.extracted_text,start:0,end:history.extracted_text.length}]);
 assert.deepEqual(rows.map(row=>row.itemCode),['57.91.0016','57.91.0022']);
 // An actual conflicting question keeps its constraints, even when history agrees with the BOQ.
 assert.deepEqual(selectConsultantBoqRows([doc(),history],question.replace('GRP','פלדה'),[{documentId:'boq',quote:body,start:0,end:body.length}]),[]);
});
