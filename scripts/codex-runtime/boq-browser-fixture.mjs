// Entirely invented PDFs/results. No model, SQL writes or owner document reads.
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createHash} from 'node:crypto';
import {selectConsultantBoqRows} from '../../src/utils/consultant-boq.ts';
import {compareBoqEdition} from '../../src/utils/consultant-boq-editions.ts';
import {consultantBoqRowKey} from '../../src/utils/consultant-result.ts';
import {verifyDocumentSourceHash} from '../../src/utils/document-source-hash.server.ts';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function createBoqBrowserFixture(){
 const projectId='20000000-0000-4000-8000-000000000001',conversationId='70000000-0000-4000-8000-000000000001';
 const documents=[],files=new Map();
 for(const [edition,base,date]of [['A',100,'01.01.2024'],['B',140,'02.02.2024']]){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=4;i++){const page=pdf.addPage([595,842]);page.drawText(`SYNTHETIC BOQ ${edition} - ORIGINAL ${edition} - PAGE ${i}`,{x:45,y:750,size:18,font});page.drawText(`Item ${i===3?'57.91.0016':'57.91.0022'} - unit price ${i===3?base:base+10}.00 ILS`,{x:45,y:700,size:15,font});}
  const bytes=Buffer.from(await pdf.save()),documentId=`80000000-0000-4000-8000-00000000000${edition==='A'?1:2}`;
  const text=`כתב כמויות לביצוע\nמספר כתב כמויות: FIXTURE; מהדורה: ${edition}\nתאריך מהדורה: ${date}\nתאריך הדפסה: 03.03.2024\n${edition==='B'?'כתב כמויות FIXTURE מהדורה B מחליף את כתב כמויות FIXTURE מהדורה A.\n':''}סעיף תיאור יחידה כמות מחיר סה"כ\nהמחירים ללא מע"מ\nדחיקת צינורות GRP בקוטר 450 מ"מ 57.91.0016\n${base*2} ${base} 2 מטר\n-- 3 of 4 --\nאספקת צינורות GRP בקוטר 450 מ"מ 57.91.0022\n${(base+10)*2} ${base+10} 2 מטר\n-- 4 of 4 --`;
  const document={id:documentId,project_id:projectId,title:`מקור סינתטי ${edition}.pdf`,extracted_text:text,extracted_text_hash:hash(text),content_hash:hash(bytes),ocr_status:'COMPLETED',parsed_json:{source_reading:{version:'page-coverage-v1',complete:true,totalPages:4,readPages:[1,2,3,4],unreadablePages:[]}}};
  documents.push(document);files.set(documentId,bytes);
 }
 const rows=selectConsultantBoqRows(documents,'דחיקת צינורות GRP בקוטר 450 מ"מ ברחוב יהלום',[]);
 if(rows.length!==4)throw Error('BOQ browser fixture must preserve two rows from two originals');
 const job={id:'90000000-0000-4000-8000-000000000001',projectId,kind:'consultant',state:'SUCCEEDED',revision:1,conversationId,clientContextId:conversationId,error:null,result:{displayVersion:'consultant-v2',question:'מה הבסיס לתשלום על דחיקת צינורות GRP ברחוב יהלום?',response:'דוגמה סינתטית בלבד: יש לפעול לפי ההנחיה הכתובה. תשלום ואישור שיטת העבודה טעונים בירור עם מנהל הפרויקט והמפקח. שני סעיפים מוצגים בשני מקורות; אין לחברם לתוספת תשלום.',details:'בדיקת מקורות בדויים בלבד.',answeredAt:'2026-11-18T10:00:00.000Z',boqRows:rows}};
 const jobSavedA={...job,id:'90000000-0000-4000-8000-000000000002',result:{...job.result,boqRows:rows.filter(row=>row.documentId===documents[0].id)}};
 let config={scenario:'four-sources',includeB:true,missingOld:false,tamperedOld:false,delayMs:0,unavailable:false};
 return async(url,request)=>{
  if(url.pathname==='/fixture/boq-config'){if(request.method==='POST'){const next=await request.json();config={scenario:next.scenario==='saved-a'?'saved-a':next.scenario==='four-sources'?'four-sources':config.scenario,includeB:typeof next.includeB==='boolean'?next.includeB:next.scenario==='saved-a'?false:next.scenario==='four-sources'?true:config.includeB,missingOld:next.missingOld===true,tamperedOld:next.tamperedOld===true,delayMs:Math.min(10000,Math.max(0,Number(next.delayMs)||0)),unavailable:next.unavailable===true};}return Response.json({syntheticOnly:true,...config});}
  if(url.pathname==='/api/system/ai-status')return Response.json({available:true,provider:'Codex',reason:null});
  if(url.pathname==='/fixture/stats')return Response.json({syntheticOnly:true,mode:'boq',legacySql:false,...config});
  const savedJob=config.scenario==='saved-a'?jobSavedA:job;
  if(url.pathname==='/api/ai/jobs'&&url.searchParams.get('kind')==='consultant')return Response.json({success:true,jobs:url.searchParams.get('projectId')===projectId&&(!url.searchParams.get('clientContextId')||url.searchParams.get('clientContextId')===conversationId)?[savedJob]:[]});
  if(url.pathname==='/api/chat/boq-revisions'){
   const snapshot={...config},catalog=documents.filter((document,index)=>(snapshot.includeB||index===0)&&(!snapshot.missingOld||index!==0));
   if(snapshot.delayMs)await new Promise(resolve=>setTimeout(resolve,snapshot.delayMs));
   return Response.json({success:true,availability:snapshot.unavailable?'UNAVAILABLE':'AVAILABLE',jobs:url.searchParams.get('projectId')===projectId&&url.searchParams.get('conversationId')===conversationId?[{jobId:savedJob.id,rows:savedJob.result.boqRows.map(originalRow=>({rowKey:consultantBoqRowKey(originalRow),originalRow,comparison:snapshot.unavailable?null:compareBoqEdition(originalRow,catalog)}))}]:[]});
  }
  if(url.pathname==='/api/documents/file'){
   const documentId=url.searchParams.get('documentId'),old=documentId===documents[0].id;
   if(config.delayMs)await new Promise(resolve=>setTimeout(resolve,config.delayMs));
   const bytes=config.tamperedOld&&old?files.get(documents[1].id):files.get(documentId);
   if(url.searchParams.get('projectId')!==projectId||!bytes||(config.missingOld&&old)||(!config.includeB&&!old))return Response.json({success:false},{status:404});
   if(!verifyDocumentSourceHash(bytes,url.searchParams.get('sourceHash')))return Response.json({success:false,code:'SOURCE_CHANGED'},{status:409});
   return new Response(bytes,{headers:{'Content-Type':'application/pdf','Cache-Control':'no-store'}});
  }
  return null;
 };
}
