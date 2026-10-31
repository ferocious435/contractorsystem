import 'server-only';
import {createHash} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createAdminClient} from '@/utils/supabase/admin';
import {downloadDocumentBuffer} from '@/utils/document-storage';
import {makeTextInput,prepareDocumentAnalysisInput,type PreparedDocumentAnalysisInput} from '@/utils/document-text-extraction';
import {assessDocumentSourceReadiness,type DocumentSourceInput} from '@/utils/document-source-readiness';
import {prepareDocumentAiInput,type DocumentAiProfile} from '@/utils/document-ai-input';
import {DOCUMENT_ANALYSIS_VERSION,DOCUMENT_ANALYSIS_SCHEMA,DOCUMENT_ANALYSIS_PROMPT} from '@/utils/document-analysis-prompt';
import {isReferenceDocument} from '@/utils/contract-document-hierarchy';
import {BusinessAiError,record,validUuid,type AiJobHandler,type JsonObject,type PreparedAiResult} from '../contracts';
import {createProjectEffectClient} from '../project-effects.server';
import {getCodexClient,getRuntimeDirectory} from '../codex-client.server';
type SavedReading=PreparedDocumentAnalysisInput&{title:string};
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** A renderer update may repad Markdown tables. Keep the complete saved source
 * representation so existing exact citations remain valid for identical bytes. */
export function preserveStableDocumentText(prepared:PreparedDocumentAnalysisInput,saved:DocumentSourceInput,fileHash:string):PreparedDocumentAnalysisInput{
    if(prepared.kind!=='text'||prepared.readingVerification?.version!=='docx-image-coverage-v1'||prepared.requiresReview||saved.content_hash!==fileHash||typeof saved.extracted_text!=='string')return prepared;
    const current={...saved,extracted_text:prepared.extractedText,ocr_status:'COMPLETED',parsed_json:{source_reading:prepared.readingVerification}};
    if(!assessDocumentSourceReadiness(saved).extractionComplete||!assessDocumentSourceReadiness(current).extractionComplete)return prepared;
    const tables=(text:string)=>text.replaceAll('\r\n','\n').split('\n').map(line=>/^\s*\|.*\|\s*$/.test(line)?line.trim().split('|').map(cell=>cell.trim()).join('|'):line).join('\n');
    if(tables(saved.extracted_text)!==tables(prepared.extractedText))return prepared;
    return makeTextInput(prepared.fileBuffer,prepared.extractionSource,saved.extracted_text,{readingVerification:prepared.readingVerification,requiresReview:prepared.requiresReview,ocrConfidence:prepared.ocrConfidence});
}
const numberIn=(body:string,value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&[...body.matchAll(/(?<![\p{L}\d])\d[\d,.]*(?![\p{L}\d])/gu)].some(match=>[Number(match[0].replace(/,/g,'')),Number(match[0].replace(',','.'))].includes(value));
type DocumentSchema={type?:string|readonly string[];enum?:readonly unknown[];required?:readonly string[];properties?:Record<string,DocumentSchema>;items?:DocumentSchema;additionalProperties?:boolean};
function matchesDocumentSchema(value:unknown,schema:DocumentSchema):boolean{
    const actual=value===null?'null':Array.isArray(value)?'array':typeof value,types=typeof schema.type==='string'?[schema.type]:schema.type;
    if(types&&!types.includes(actual)||typeof value==='number'&&!Number.isFinite(value)||schema.enum&&!schema.enum.includes(value))return false;
    if(Array.isArray(value))return !schema.items||value.every(item=>matchesDocumentSchema(item,schema.items!));
    if(record(value)){const properties=schema.properties??{};return (!schema.required||schema.required.every(key=>Object.hasOwn(value,key)))&&Object.keys(value).every(key=>properties[key]?matchesDocumentSchema(value[key],properties[key]):schema.additionalProperties!==false);}
    return true;
}
/** Reading proof and the complete original text belong to the program, never to model output. */
export function validateDocumentAnalysis(raw:string,savedReading:SavedReading):JsonObject{
    let value:unknown;try{value=JSON.parse(raw);}catch{throw new BusinessAiError('AI_RESPONSE_INCOMPLETE');}
    if(!record(value)||!matchesDocumentSchema(value,DOCUMENT_ANALYSIS_SCHEMA)||typeof value.type!=='string'||!value.type.trim()||typeof value.summary!=='string'||!value.summary.trim()||typeof value.full_markdown!=='string'||!record(value.financial_data))throw new BusinessAiError('AI_RESPONSE_INCOMPLETE');
    const text=savedReading.kind==='text'?savedReading.extractedText:value.full_markdown;
    if(!text.trim())throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
    const reading=savedReading.kind==='text'?savedReading.readingVerification:undefined;
    const readiness=assessDocumentSourceReadiness({title:savedReading.title,extracted_text:text,ocr_status:'COMPLETED',parsed_json:reading?{source_reading:reading}:{}});
    const uncertain=savedReading.kind==='direct'||savedReading.kind==='text'&&savedReading.requiresReview===true||!readiness.extractionComplete;
    const sourceReading=reading&&reading.version==='page-coverage-v1'&&!readiness.extractionComplete?{...reading,complete:false}:reading;
    const partial=uncertain||savedReading.wasTruncated;
    const financial=value.financial_data,rawItems=financial.items,items=(Array.isArray(rawItems)?rawItems:[]).filter(record).flatMap(item=>typeof item.quote==='string'&&item.quote.trim()&&text.includes(item.quote)?[{...item,quantity:numberIn(item.quote,item.quantity)?item.quantity:null,unit_price_excl_vat:numberIn(item.quote,item.unit_price_excl_vat)?item.unit_price_excl_vat:null}]:[]);
    const reference=isReferenceDocument({title:savedReading.title,category:String(value.category),parsed_json:value});
    const title=savedReading.title.toLowerCase(),family=/3210|חוזה\s*מדף/iu.test(title)?'SHELF_CONTRACT_3210':/ספר\s*(?:ה)?כחול|מפרט\s*כללי|blue\s*book/iu.test(title)?'BLUE_BOOK':['BLUE_BOOK','SHELF_CONTRACT_3210','ISRAELI_STANDARD','OTHER_REFERENCE'].includes(String(value.reference_family))?value.reference_family:'OTHER_REFERENCE';
    return JSON.parse(JSON.stringify({...value,category:reference?'REFERENCE':value.category,is_reference:reference,
        ...(reference?{reference_family:family,authority_scope:'REFERENCE_ONLY'}:{}),full_markdown:text,financial_data:{total_amount:numberIn(text,financial.total_amount)?financial.total_amount:null,items},financial_data_verification:'REQUIRES_MANUAL_REVIEW',
        autoValidated:false,analysis_source:'Codex',analysis_version:DOCUMENT_ANALYSIS_VERSION,analysis_status:partial?'PARTIAL':'COMPLETE',analysis_context_truncated:savedReading.wasTruncated,
        extraction_source:savedReading.extractionSource,reading_requires_review:uncertain,document_purpose:readiness.documentStatus,...(sourceReading?{source_reading:sourceReading}:{})})) as JsonObject;
}
type Options={database?:()=>SupabaseClient;download?:typeof downloadDocumentBuffer;prepare?:typeof prepareDocumentAnalysisInput;runtimeDir?:string;models?:()=>Promise<unknown>};
export function createDocumentHandler({database=createAdminClient,download=downloadDocumentBuffer,prepare=prepareDocumentAnalysisInput,runtimeDir=getRuntimeDirectory(),models=()=>getCodexClient().request('model/list',{includeHidden:false,limit:100})}:Options={}):AiJobHandler{return {
    validate(raw){if(!record(raw)||Object.keys(raw).some(key=>key!=='documentId')||!validUuid(raw.documentId))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return {documentId:raw.documentId};},
    async execute(payload,execution):Promise<PreparedAiResult>{const transaction=await createProjectEffectClient(database(),execution),client=transaction.client;
        const found=await client.from('documents').select('*').eq('id',payload.documentId).eq('project_id',execution.projectId).maybeSingle();if(found.error||!found.data)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');const document=found.data;
        if(document.ai_status==='VALIDATED')return {result:{success:false,partial:true,alreadyValidated:true,documentId:document.id,ai_status:'VALIDATED',message:'הנתונים אושרו ידנית ונשמרו. לא בוצע ניתוח חוזר.'},effects:[]};
        const file=await download(client,document),prepared=preserveStableDocumentText(await prepare(file,String(document.title||'')),document,digest(file));await execution.checkActive();
        if(prepared.kind==='direct'&&!prepared.mimeType.startsWith('image/'))throw new BusinessAiError('AI_INPUT_UNSUPPORTED',undefined,422);
        const previous=record(document.parsed_json)?document.parsed_json:{};
        const inputHash=digest(JSON.stringify({version:DOCUMENT_ANALYSIS_VERSION,prompt:DOCUMENT_ANALYSIS_PROMPT,schema:DOCUMENT_ANALYSIS_SCHEMA,projectId:execution.projectId,documentId:document.id,title:document.title,category:document.category,file:digest(file),text:digest(prepared.extractedText),aiText:digest(prepared.aiText),truncated:prepared.wasTruncated,reading:prepared.kind==='text'?prepared.readingVerification??null:null}));
        if(prepared.kind==='text'&&previous.analysis_input_hash===inputHash&&previous.analysis_version===DOCUMENT_ANALYSIS_VERSION&&previous.analysis_status==='COMPLETE'&&previous.autoValidated===false&&previous.full_markdown===prepared.extractedText){
            try{const cached=validateDocumentAnalysis(JSON.stringify(Object.fromEntries(Object.keys(DOCUMENT_ANALYSIS_SCHEMA.properties).map(key=>[key,previous[key]]))),{...prepared,title:String(document.title||'')});
                if(cached.analysis_status==='COMPLETE'&&JSON.stringify(cached.financial_data)===JSON.stringify(previous.financial_data))return {result:{success:true,partial:false,cached:true,documentId:document.id,ai_status:document.ai_status,autoValidated:false,inputHash} as JsonObject,effects:[]};
            }catch{/* An invalid saved proposal never grants reuse. */}
        }
        const profile:DocumentAiProfile={...execution.profile,images:false};
        if(prepared.kind==='direct'){const catalog=await models(),rows=record(catalog)&&Array.isArray(catalog.data)?catalog.data:[];const selected=rows.find(row=>record(row)&&row.model===execution.profile.model);profile.images=record(selected)&&Array.isArray(selected.inputModalities)&&selected.inputModalities.includes('image');}
        const root=path.resolve(runtimeDir),directory=path.join(root,'jobs',execution.jobId);let created=false;
        try{if(prepared.kind==='direct'){if(!validUuid(execution.jobId))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);await mkdir(path.dirname(directory),{recursive:true});await mkdir(directory,{mode:0o700});created=true;}
            const input=await prepareDocumentAiInput(prepared,profile,directory),analysis=validateDocumentAnalysis(await execution.generate(input),{...prepared,title:String(document.title||'')});await execution.checkActive();
            analysis.analysis_input_hash=inputHash;
            const fullText=String(analysis.full_markdown),complete=analysis.analysis_status==='COMPLETE';
            const retained=Object.fromEntries(Object.entries(previous).filter(([key])=>!['source_reading','system_error','system_errors','ai_degraded'].includes(key))),parsed={...retained,...analysis};
            const saved=await client.from('documents').update({parsed_json:parsed,ai_status:complete?'SCANNED':'PENDING',extracted_text:fullText,content_hash:digest(file),extracted_text_hash:digest(fullText),ocr_status:analysis.reading_requires_review?'REQUIRES_REVIEW':'COMPLETED',processed_at:new Date().toISOString()}).eq('id',document.id).eq('project_id',execution.projectId);if(saved.error)throw saved.error;
            return {result:{success:complete,partial:!complete,documentId:document.id,ai_status:complete?'SCANNED':'PENDING',autoValidated:false,inputHash,analysisStatus:analysis.analysis_status},effects:await transaction.effects()};
        }finally{if(created){const actualRoot=await realpath(root),actualDirectory=await realpath(directory);if(actualDirectory!==path.join(actualRoot,'jobs',execution.jobId)||!actualDirectory.startsWith(actualRoot+path.sep))throw new BusinessAiError('AI_POLICY_UNSAFE');await rm(actualDirectory,{recursive:true,force:false});}}
    }
};}
export const documentHandler=createDocumentHandler();
