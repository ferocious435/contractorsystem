import type {DocumentSourceInput, RenderedEmptyPageProof} from './document-source-readiness';
import type {JobDto} from '../server/ai/contracts';
import type {MsgReadingProof,MsgReadingPart} from './msg-source-types';
import {assessMsgReadingProof} from './msg-reading-proof';
import type {FragmentComposition,FragmentSummary} from './visual-fragment-contracts';

export const VISUAL_READING_VERSION = 'visual-source-reading-v2';
export const VISUAL_READING_RULES = 'visual-reading-rules-v2';
export const BRANDING_RECOGNITION_VERSION = 'branding-recognition-v1';
export type ContentRole = 'CONTENT'|'BRANDING_ONLY'|'UNKNOWN';
export type Rect = {x:number;y:number;width:number;height:number};
export type Coverage = {complete:boolean;missingUnitIds:string[];verifiedUnitIds:string[];issues:string[]};
export type NumericCheck = {matched:boolean;unresolved:string[]};
export type ReadingScope = {ownerId:string;projectId:string;documentId:string;sourceHash:string};
export type ReadingLocation = {page?:number;part?:string;anchor?:string;mediaName?:string;sheet?:string;cellRange?:string;frame?:number;msgPartId?:string;msgPartName?:string};
export type RenderedView = {id:string;sha256:string;bytes:Uint8Array;width:number;height:number;rect:Rect};
export type ReadingUnit = {
    id:string;kind:'PDF_PAGE'|'DOCX_IMAGE'|'IMAGE_FRAME'|'XLSX_IMAGE';locations:ReadingLocation[];views:RenderedView[];
    contextText:string;localText:string;localMethod?:'native'|'local-ocr';emptyPageProof?:RenderedEmptyPageProof;
};
export type SourceManifest = {
    sourceHash:string;manifestHash:string;format:'PDF'|'DOCX'|'TEXT'|'IMAGE'|'XLSX'|'MSG';nativeText:string;nativeVerification:unknown;msg?:MsgReadingProof;
    units:ReadingUnit[];issues:string[];assembly:Array<({kind:'native';text:string}|{kind:'unit';unitId:string})&{msgPartId?:string}>;
};
export type UnitReading = {unitId:string;viewId:string;text:string;tables:string[][][];visualDescription:string;uncertainties:string[];contentRole?:ContentRole;nonBlockingNotes?:string[]};
export type ReadingMethod = 'native-match'|'local-ocr-match'|'visual-double-pass'|'no-numbers'|'physical-empty'|'branding-recognition';
export type VerifiedView = {
    viewId:string;imageHash:string;textHash:string;method:ReadingMethod;confirmationHash:string;
    reading:UnitReading;confirmation:UnitReading|null;emptyPageProof?:RenderedEmptyPageProof;
    initialReading?:UnitReading;
    recognitionVersion?:typeof BRANDING_RECOGNITION_VERSION;
    readingImage?:Omit<RenderedView,'id'|'bytes'>;confirmationImage?:Omit<RenderedView,'id'|'bytes'>;
};
export type VerifiedUnit = {
    unitId:string;inputHash:string;textHash:string;text:string;tables:string[][][];visualDescription:string;
    uncertainties:string[];views:VerifiedView[];complete:boolean;formattingNotes?:string[];
    createdBy?:{jobId:string;rulesVersion:string;profileRevision:number};
    contentRole?:ContentRole;nonBlockingNotes?:string[];
    brandingOrigin?:ReadingScope&{unitId:string;jobId:string;inputHash:string;profileRevision:number;profileFingerprint:string};
    composition?:FragmentComposition;
};
export type RegistryUnit = {
    id:string;kind:ReadingUnit['kind'];locations:ReadingLocation[];views:Array<Omit<RenderedView,'bytes'>>;
    status:'READ'|'REQUIRES_REVIEW';inputHash:string;textHash:string;literalHasBody:boolean;visualHasContent:boolean;
    verifiedViews:Array<Omit<VerifiedView,'reading'|'confirmation'|'initialReading'>>;uncertainties:string[];
    contentRole?:ContentRole;nonBlockingNotes?:string[];
    composition?:FragmentSummary;
};
export type VisualReadingVerification = {
    version:typeof VISUAL_READING_VERSION;sourceHash:string;currentTextHash:string;manifestHash:string;
    format:SourceManifest['format'];nativeComplete:boolean;expectedUnits:RegistryUnit[];issues:string[];complete:boolean;
    createdBy:{jobId:string;rulesVersion:string;profileRevision:number};msg?:MsgReadingProof;
};
export type OwnedSourceDocument = DocumentSourceInput & Record<string,unknown> & {
    id:string;project_id:string;extracted_text_hash?:string|null;storage_bucket?:string|null;
    ai_status?:string|null;processed_at?:string|null;
};
export type ReadingTextVersion = {sourceHash:string;textHash:string;text:string;reading:unknown;visualDescriptions?:VisualDescription[]};
export type VisualDescription = {unitId:string;location:ReadingLocation;text:string};
export type ReadingAssembly = {text:string;textHash:string;verification:VisualReadingVerification;units:VerifiedUnit[];visualDescriptions:VisualDescription[]};
export type DocumentReadingPatch = {extracted_text:string;extracted_text_hash:string;ocr_status:'COMPLETED'|'REQUIRES_REVIEW';parsed_json:Record<string,unknown>;processed_at:string};
export type EffectiveDocumentReading = {text:string;textHash:string;sourceHash:string;visualDescriptions:VisualDescription[];ready:boolean};
export type ReadingDetail = EffectiveDocumentReading & {current:boolean;reading:unknown;versions:Array<Omit<ReadingTextVersion,'text'|'reading'>>;part?:MsgReadingPart};
export type DocumentJobOptions = {signal?:AbortSignal;onAccepted?:(job:JobDto)=>void;onProgress?:(job:JobDto)=>void};

const object = (value:unknown):value is Record<string,unknown> => Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export const validReadingHash = (value:unknown):value is string => typeof value==='string'&&/^[a-f\d]{64}$/i.test(value);
const identifier = (value:unknown):value is string => typeof value==='string'&&value.length>0&&value.length<=512;
const strings = (value:unknown):value is string[] => Array.isArray(value)&&value.every(v=>typeof v==='string');
export function validReadingRect(value:unknown):value is Rect {
    if(!object(value))return false;
    const {x,y,width,height}=value;
    return [x,y,width,height].every(v=>typeof v==='number'&&Number.isFinite(v))
        && (x as number)>=0&&(y as number)>=0&&(width as number)>0&&(height as number)>0
        && (x as number)+(width as number)<=1+1e-9&&(y as number)+(height as number)<=1+1e-9;
}

/** Exact sweep over rectangle edges; summed area alone can conceal an overlap and a gap. */
export function coversReadingPage(rectangles:Rect[]) {
    if(!rectangles.length||rectangles.some(r=>!validReadingRect(r)))return false;
    const edges=[...new Set([0,1,...rectangles.flatMap(r=>[r.x,r.x+r.width])])].sort((a,b)=>a-b);
    for(let i=1;i<edges.length;i++){
        if(edges[i]-edges[i-1]<1e-10)continue;
        const mid=(edges[i]+edges[i-1])/2;
        const spans=rectangles.filter(r=>r.x<=mid&&r.x+r.width>=mid).map(r=>[r.y,r.y+r.height]).sort((a,b)=>a[0]-b[0]);
        let end=0;
        for(const [start,stop] of spans){if(start>end+1e-9)return false;end=Math.max(end,stop);}
        if(end<1-1e-9)return false;
    }
    return true;
}

export function planPageViews(width:number,height:number,maxPixels:number,overlap:number):Rect[] {
    if(![width,height,maxPixels].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isSafeInteger(overlap)||overlap<0)throw Error('Invalid page geometry');
    if(width*height<=maxPixels)return [{x:0,y:0,width:1,height:1}];
    const side=Math.floor(Math.sqrt(maxPixels)),step=side-overlap;
    if(step<1)throw Error('Overlap consumes the page view');
    const cols=Math.ceil(Math.max(0,width-side)/step)+1,rows=Math.ceil(Math.max(0,height-side)/step)+1;
    if(cols*rows>10000)throw Error('Too many page views');
    const rects:Rect[]=[];
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const x=col*step,y=row*step;
        rects.push({x:x/width,y:y/height,width:Math.min(side,width-x)/width,height:Math.min(side,height-y)/height});
    }
    return rects;
}

function locationValid(value:unknown,kind:ReadingUnit['kind']) {
    if(!object(value))return false;
    if(kind==='PDF_PAGE')return Number.isInteger(value.page)&&(value.page as number)>0;
    if(kind==='IMAGE_FRAME')return value.part==='image'&&Number.isInteger(value.frame)&&(value.frame as number)>0
        &&value.anchor==='image#frame'+value.frame&&identifier(value.mediaName);
    if(kind==='XLSX_IMAGE')return typeof value.part==='string'&&/^xl\/worksheets\/[^/\\]+\.xml$/.test(value.part)
        &&typeof value.anchor==='string'&&value.anchor.startsWith(value.part+'#')&&identifier(value.sheet)&&identifier(value.mediaName)
        &&Number.isInteger(value.frame)&&(value.frame as number)>0
        &&(value.cellRange===undefined||typeof value.cellRange==='string'&&/^[A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?$/.test(value.cellRange));
    return typeof value.part==='string'&&/^word\/.+\.xml$/.test(value.part)&&typeof value.anchor==='string'
        &&value.anchor.startsWith(value.part+'#')&&identifier(value.mediaName);
}
function emptyProofValid(proof:unknown,view:Record<string,unknown>,location:unknown) {
    if(!object(proof)||!object(location)||proof.version!=='rendered-empty-v1'||proof.imageSha256!==view.sha256
        ||proof.width!==view.width||proof.height!==view.height||proof.page!==location.page)return false;
    if(proof.kind==='BLANK')return true;
    return proof.kind==='PAGE_NUMBER_ONLY'&&typeof proof.numberText==='string'
        &&/^(?:(?:page|עמוד|עמ')\s*)?\d+(?:\s*(?:of|מתוך|\/)\s*\d+)?$/iu.test(proof.numberText.trim())
        &&typeof proof.numberConfidence==='number'&&proof.numberConfidence>=65&&proof.numberConfidence<=100
        &&Array.isArray(proof.numberBounds)&&proof.numberBounds.length>0&&proof.numberBounds.every(box=>object(box)
            &&[box.x0,box.y0,box.x1,box.y1].every(Number.isInteger)&&(box.x0 as number)>=0&&(box.y0 as number)>=0
            &&(box.x1 as number)>(box.x0 as number)&&(box.y1 as number)>(box.y0 as number)
            &&(box.x1 as number)<=(proof.width as number)&&(box.y1 as number)<=(proof.height as number)
            &&((box.y1 as number)<=(proof.height as number)*0.1||(box.y0 as number)>=(proof.height as number)*0.9));
}

export function assessVisualReading(registry:unknown,source:DocumentSourceInput):Coverage {
    const issues:string[]=[],missingUnitIds:string[]=[],verifiedUnitIds:string[]=[];
    const invalid=(reason:string):Coverage=>({complete:false,missingUnitIds,verifiedUnitIds:[],issues:[...issues,reason]});
    if(!object(registry)||registry.version!==VISUAL_READING_VERSION)return invalid('Visual reading evidence is absent');
    if(!validReadingHash(registry.sourceHash)||registry.sourceHash!==source.content_hash
        ||!validReadingHash(registry.currentTextHash)||registry.currentTextHash!==source.extracted_text_hash
        ||!validReadingHash(registry.manifestHash))return invalid('Reading source or text version changed');
    if(!object(registry.createdBy)||!identifier(registry.createdBy.jobId)||registry.createdBy.rulesVersion!==VISUAL_READING_RULES
        ||!Number.isSafeInteger(registry.createdBy.profileRevision)||(registry.createdBy.profileRevision as number)<1)return invalid('Server reading provenance is absent');
    if(!['PDF','DOCX','TEXT','IMAGE','XLSX','MSG'].includes(String(registry.format))||!Array.isArray(registry.expectedUnits)
        ||registry.expectedUnits.length>10000||!strings(registry.issues))return invalid('Invalid reading inventory');
    if(registry.format==='PDF'&&registry.expectedUnits.length===0)return invalid('PDF page inventory is empty');
    if(registry.format==='IMAGE'&&registry.expectedUnits.length===0)return invalid('Image frame inventory is empty');
    const ids=new Set<string>();
    for(const raw of registry.expectedUnits){
        if(!object(raw)||!identifier(raw.id)||ids.has(raw.id))return invalid('Unknown or repeated reading unit');
        ids.add(raw.id);
        const kind=raw.kind;
        const branding=raw.contentRole==='BRANDING_ONLY';
        const compatible=registry.format==='MSG'||(registry.format==='IMAGE'?kind==='IMAGE_FRAME':registry.format==='XLSX'?kind==='XLSX_IMAGE':kind!=='IMAGE_FRAME'&&kind!=='XLSX_IMAGE');
        let valid=(kind==='PDF_PAGE'||kind==='DOCX_IMAGE'||kind==='IMAGE_FRAME'||kind==='XLSX_IMAGE')&&compatible&&raw.status==='READ'&&validReadingHash(raw.inputHash)&&validReadingHash(raw.textHash)
            &&Array.isArray(raw.locations)&&raw.locations.length>0&&raw.locations.every(l=>locationValid(l,kind))
            &&strings(raw.uncertainties)&&raw.uncertainties.length===0&&Array.isArray(raw.views)&&raw.views.length>0
            &&Array.isArray(raw.verifiedViews)&&raw.verifiedViews.length===raw.views.length;
        if(raw.contentRole!==undefined&&!['CONTENT','BRANDING_ONLY','UNKNOWN'].includes(String(raw.contentRole)))valid=false;
        if(branding&&(kind==='PDF_PAGE'||raw.literalHasBody!==false||raw.visualHasContent!==true
            ||raw.textHash!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'))valid=false;
        const views=Array.isArray(raw.views)?raw.views:[],proofs=Array.isArray(raw.verifiedViews)?raw.verifiedViews:[];
        const viewIds=new Set<string>(),regions=new Map<string,{hashes:Set<string>;physical:boolean}>();let physicalEmpty=views.length>0;
        for(const view of views){
            if(!object(view)||!identifier(view.id)||viewIds.has(view.id)||!validReadingHash(view.sha256)||!validReadingRect(view.rect)
                ||!Number.isSafeInteger(view.width)||!Number.isSafeInteger(view.height)||(view.width as number)<1||(view.height as number)<1
                ||(view.width as number)*(view.height as number)>16_000_000){valid=false;physicalEmpty=false;continue;}
            viewIds.add(view.id);
            const matches=proofs.filter(p=>object(p)&&p.viewId===view.id),proof=matches[0];
            if(matches.length!==1||!object(proof)||proof.imageHash!==view.sha256||!validReadingHash(proof.textHash)
                ||!validReadingHash(proof.confirmationHash)||!(branding?proof.method==='branding-recognition'&&proof.recognitionVersion===BRANDING_RECOGNITION_VERSION
                    &&proof.textHash==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
                    &&proof.confirmationHash===proof.textHash&&view.rect.x===0&&view.rect.y===0&&view.rect.width===1&&view.rect.height===1
                    :['native-match','local-ocr-match','visual-double-pass','no-numbers','physical-empty'].includes(String(proof.method)))){valid=false;physicalEmpty=false;continue;}
            if(branding)for(const image of [proof.readingImage,proof.confirmationImage])if(!object(image)||image.sha256!==view.sha256||image.width!==view.width||image.height!==view.height||JSON.stringify(image.rect)!==JSON.stringify(view.rect))valid=false;
            const key=JSON.stringify(view.rect),region=regions.get(key)??{hashes:new Set<string>(),physical:false};
            region.hashes.add(proof.textHash);region.physical||=proof.method==='physical-empty';regions.set(key,region);
            if(proof.method!=='physical-empty'||!emptyProofValid(proof.emptyPageProof,view,Array.isArray(raw.locations)?raw.locations[0]:null))physicalEmpty=false;
        }
        if([...regions.values()].some(region=>region.physical&&region.hashes.size!==1))valid=false;
        if(['PDF_PAGE','IMAGE_FRAME','XLSX_IMAGE'].includes(String(kind))&&!coversReadingPage(views.filter(object).map(v=>v.rect as Rect)))valid=false;
        if(raw.literalHasBody!==true&&raw.visualHasContent!==true&&!physicalEmpty)valid=false;
        if(!valid){missingUnitIds.push(raw.id);issues.push('Unverified reading unit: '+raw.id);}else verifiedUnitIds.push(raw.id);
    }
    issues.push(...registry.issues);
    if(registry.format==='MSG'){
        issues.push(...assessMsgReadingProof(registry.msg,{sourceHash:String(registry.sourceHash),text:String(source.extracted_text??''),expectedUnits:registry.expectedUnits as RegistryUnit[]}).issues);
        const owned=source as DocumentSourceInput&{id?:string;project_id?:string},scope=object(registry.msg)&&object(registry.msg.scope)?registry.msg.scope:null;
        if(owned.id||owned.project_id){if(!scope||!identifier(scope.ownerId)||scope.sourceHash!==registry.sourceHash||owned.id&&scope.documentId!==owned.id||owned.project_id&&scope.projectId!==owned.project_id)issues.push('MSG_READING_SCOPE_UNCONFIRMED');}
    }
    if(registry.nativeComplete!==true)issues.push('Native source reading is incomplete');
    return {complete:registry.complete===true&&issues.length===0,missingUnitIds,verifiedUnitIds,issues};
}
