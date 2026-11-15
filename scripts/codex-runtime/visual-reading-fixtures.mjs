import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const sourceHash='1'.repeat(64);
export const fullRect={x:0,y:0,width:1,height:1};
export const literal='יש להשאיר את המעבר פתוח.';
/** A real PNG with source-bound independent table reads; never writes a business document. */
export async function fragmentReadingFixture({disputes=1,kind='PDF_PAGE'}={}){
 const sharp=(await import('sharp')).default,{readingUnitInputHash,unitReadingLiteral}=await import('../../src/server/ai/visual-reading-cache.server.ts');
 const bytes=await sharp({create:{width:900,height:600,channels:3,background:'#ffffff'}}).png().toBuffer();
 const locations=kind==='IMAGE_FRAME'?[{part:'image',anchor:'image#frame1',mediaName:'source-image',frame:1}]:[{page:1}];
 const unit=readingUnit({kind,locations,localText:'',views:[{id:'source:full',sha256:digest(bytes),bytes,width:900,height:600,rect:{...fullRect}}]}),rows=[['שם','כמות','יחידה','הערה']];
 for(let i=0;i<disputes;i++)rows.push(['לפני '+i,String(10+i),'מטר',''],['מקטע '+i,'כ570','מטר',''],['אחרי '+i,String(30+i),'מטר','']);
 const a=unitResponse(unit,{text:'הוראות ביצוע',tables:[rows]}),b=structuredClone(a);for(let i=0;i<disputes;i++)b.tables[0][2+i*3][1]='570';
 const image={sha256:unit.views[0].sha256,width:900,height:600,rect:{...fullRect}},base={unitId:unit.id,inputHash:readingUnitInputHash(unit),text:unitReadingLiteral(a),textHash:digest(unitReadingLiteral(a)),tables:structuredClone(a.tables),visualDescription:'',uncertainties:['Numeric or source verification failed: source:full'],complete:false,
  views:[{viewId:unit.views[0].id,imageHash:image.sha256,textHash:digest(unitReadingLiteral(a)),confirmationHash:digest(unitReadingLiteral(b)),method:'visual-double-pass',reading:a,confirmation:b,readingImage:image,confirmationImage:image}],createdBy:{jobId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',rulesVersion:'visual-reading-rules-v2',profileRevision:1}};
 const scope={ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',documentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',sourceHash:digest(bytes)};
 const manifest={sourceHash:scope.sourceHash,manifestHash:'2'.repeat(64),format:kind==='PDF_PAGE'?'PDF':'IMAGE',nativeText:'',nativeVerification:{complete:true},units:[unit],issues:[],assembly:[{kind:'unit',unitId:unit.id}]};
 return {unit,base,scope,manifest,bytes};
}
export function readingUnit(overrides={}){
 const bytes=Buffer.from('synthetic-image');
 return {id:'pdf:1',kind:'PDF_PAGE',locations:[{page:1}],views:[{id:'page:1:full',sha256:digest(bytes),bytes,width:100,height:100,rect:{...fullRect}}],contextText:'',localText:literal,...overrides};
}
export function unitResponse(unit=readingUnit(),overrides={}){
 return {unitId:unit.id,viewId:unit.views[0].id,text:literal,tables:[],visualDescription:'',uncertainties:[],...overrides};
}
export function visualRegistry(overrides={}){
 const unit=readingUnit();
 return {version:'visual-source-reading-v2',sourceHash,currentTextHash:digest(literal),manifestHash:'2'.repeat(64),format:'PDF',nativeComplete:true,
  expectedUnits:[{id:unit.id,kind:unit.kind,locations:unit.locations,views:unit.views.map(view=>({id:view.id,sha256:view.sha256,width:view.width,height:view.height,rect:view.rect})),status:'READ',inputHash:'3'.repeat(64),textHash:digest(literal),literalHasBody:true,visualHasContent:false,
   verifiedViews:[{viewId:unit.views[0].id,imageHash:unit.views[0].sha256,textHash:digest(literal),method:'native-match',confirmationHash:digest(literal)}],uncertainties:[]}],
  issues:[],complete:true,createdBy:{jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rulesVersion:'visual-reading-rules-v2',profileRevision:1},...overrides};
}
export function sourceDocument(overrides={}){
 return {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',project_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',title:'synthetic.pdf',content_hash:sourceHash,
  extracted_text:literal,extracted_text_hash:digest(literal),ocr_status:'COMPLETED',parsed_json:{source_reading:visualRegistry()},...overrides};
}
export function readingAssembly(text=literal,overrides={}){
 return {text,textHash:digest(text),verification:visualRegistry({currentTextHash:digest(text)}),units:[],visualDescriptions:[],...overrides};
}
export function imageRegistry({format='IMAGE',text=literal,locations=[{part:'image',anchor:'image#frame1',mediaName:'source-image',frame:1}],complete=true}={}){
 const registry=visualRegistry({format,currentTextHash:digest(text),complete}),unit=registry.expectedUnits[0];
 Object.assign(unit,{id:'image:fixture:frame:1',kind:format==='XLSX'?'XLSX_IMAGE':'IMAGE_FRAME',locations,textHash:digest(text),literalHasBody:Boolean(text),visualHasContent:!text,status:complete?'READ':'REQUIRES_REVIEW'});
 unit.verifiedViews[0]={...unit.verifiedViews[0],textHash:digest(text),method:'no-numbers',confirmationHash:digest(text)};
 if(!complete){unit.uncertainties=['Unclear source image'];registry.issues=['Unclear source image'];}
 return registry;
}
