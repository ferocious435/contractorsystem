import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const sourceHash='1'.repeat(64);
export const fullRect={x:0,y:0,width:1,height:1};
export const literal='יש להשאיר את המעבר פתוח.';
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
