import 'server-only';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BusinessAiError,record,type AiExecutionContext} from '../contracts';
import {readVisualSource,reverifySavedPhysicalUnit} from '../visual-source-reader.server';
import {createVisualReadingCache,reverifySavedNumericUnit,retainedReadingUnit,verifiedReadingUnit} from '../visual-reading-cache.server';
import {verifyFragmentImages,canonicalFragmentJson} from '../visual-fragment-proof.server';
import {createSourceFragmentRenderer} from '@/server/documents/visual-fragment-renderer.server';
import {getRuntimeDirectory} from '../codex-client.server';
import {buildVisualSourceManifest} from '@/utils/visual-source-manifest';
import {assembleDocumentReading,createReadingPatch,getCurrentDocumentReading,hasSavedVisualReading} from '@/utils/document-reading-history';
import {preserveStableDocumentText} from '@/utils/stable-document-reading';
import {makeTextInput} from '@/utils/document-text-extraction';
import {assessVisualReading,VISUAL_READING_VERSION,VISUAL_READING_RULES,type OwnedSourceDocument,type ReadingAssembly,type VerifiedUnit,type SourceManifest} from '@/utils/visual-source-reading';
import type {DocxReadingVerification} from '@/utils/document-source-readiness';
import {isMsgSource} from '@/utils/msg-source-manifest';
import {readMsgContainer} from '@/server/documents/msg-container.server';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export async function stageDocumentReading({client,document,file,execution}:{client:SupabaseClient;document:OwnedSourceDocument;file:Buffer;execution:AiExecutionContext}):Promise<{document:OwnedSourceDocument;reading:ReadingAssembly;cached:boolean}> {
    await execution.checkActive();
    const sourceHash=digest(file),current=getCurrentDocumentReading(document),parsed=record(document.parsed_json)?document.parsed_json:{};
    const scope={ownerId:execution.ownerId,projectId:execution.projectId,documentId:document.id,sourceHash};
    const previous=record(parsed.source_reading)?parsed.source_reading:null,previousMsg=previous&&record(previous.msg)?previous.msg:null;
    const previousScope=previousMsg&&record(previousMsg.scope)?previousMsg.scope:null;
    const scopeMatches=previous?.format!=='MSG'||Boolean(previousScope&&Object.entries(scope).every(([key,value])=>previousScope[key]===value));
    if(document.content_hash&&document.content_hash!==sourceHash)throw new BusinessAiError('AI_SOURCE_CHANGED',undefined,409);
    const msgInput=isMsgSource(file,String(document.title||''));
    let cached=scopeMatches&&record(parsed.source_reading)&&parsed.source_reading.version===VISUAL_READING_VERSION
        &&(!msgInput||parsed.source_reading.format==='MSG')&&assessVisualReading(parsed.source_reading,{...document,extracted_text_hash:current.textHash}).complete;
    if(cached&&msgInput){const physical=await readMsgContainer(file);await execution.checkActive();cached=physical.issues.length===0&&physical.inventoryHash===previousMsg?.inventoryHash;}
    let manifest:SourceManifest|undefined;
    const hasComposition=Array.isArray(parsed.source_reading_units)&&parsed.source_reading_units.some(unit=>record(unit)&&unit.composition!==undefined)
        ||previous&&Array.isArray(previous.expectedUnits)&&previous.expectedUnits.some(unit=>record(unit)&&unit.composition!==undefined);
    if(cached&&hasComposition){
        manifest=await buildVisualSourceManifest(file,String(document.title||''));await execution.checkActive();
        const render=createSourceFragmentRenderer(file,String(document.title||''),manifest),savedUnits=Array.isArray(parsed.source_reading_units)?parsed.source_reading_units:[];
        cached=manifest.manifestHash===previous?.manifestHash&&savedUnits.length===manifest.units.length;
        for(const source of manifest.units){
            const matches=savedUnits.filter(value=>record(value)&&value.unitId===source.id),unit=matches[0];
            if(matches.length!==1||!verifiedReadingUnit(unit,source,scope)||record(unit)&&unit.composition&&!await verifyFragmentImages(unit as VerifiedUnit,source,scope,render)){cached=false;break;}
            await execution.checkActive();
        }
    }
    if(cached&&record(parsed.source_reading)){
        const reading:ReadingAssembly={text:current.text,textHash:current.textHash,verification:parsed.source_reading as unknown as ReadingAssembly['verification'],
            units:Array.isArray(parsed.source_reading_units)?parsed.source_reading_units:[],visualDescriptions:current.visualDescriptions};
        await execution.reportProgress({phase:'reading',completedUnits:reading.verification.expectedUnits.length,totalUnits:reading.verification.expectedUnits.length});
        return {document,reading,cached:true};
    }
    await execution.reportProgress({phase:'reading',completedUnits:0,totalUnits:0});
    manifest??=await buildVisualSourceManifest(file,String(document.title||''));await execution.checkActive();
    if(manifest.format==='DOCX'&&manifest.units.length===0&&record(manifest.nativeVerification)&&manifest.nativeVerification.version==='docx-image-coverage-v1'){
        const native=makeTextInput(file,'docx_native_reading',manifest.nativeText,{readingVerification:manifest.nativeVerification as DocxReadingVerification,requiresReview:manifest.issues.length>0});
        const stable=preserveStableDocumentText(native,document,sourceHash);
        if(stable.kind==='text'&&stable.extractedText!==manifest.nativeText){manifest.nativeText=stable.extractedText;manifest.assembly=[{kind:'native',text:stable.extractedText}];manifest.manifestHash=digest(JSON.stringify({previous:manifest.manifestHash,textHash:digest(stable.extractedText)}));}
    }
    await execution.reportProgress({phase:'reading',completedUnits:0,totalUnits:manifest.units.length});
    const retained:VerifiedUnit[]=[];
    if(scopeMatches&&hasSavedVisualReading(document,sourceHash)&&previous?.manifestHash===manifest.manifestHash&&Array.isArray(parsed.source_reading_units)){
        for(const unit of manifest.units){
            const previous=parsed.source_reading_units.find(value=>record(value)&&value.unitId===unit.id),saved=retainedReadingUnit(previous,unit,scope);
            if(!saved)continue;
            const checked=saved.composition?null:reverifySavedNumericUnit(saved,unit)??await reverifySavedPhysicalUnit(saved,unit,execution),next=checked??saved;
            // A failed physical blank/folio check has no substantive source pair
            // to repair; it must go through the normal source reader.
            if(!checked&&!saved.composition&&saved.uncertainties.length===1&&saved.uncertainties[0]==='Source content is not verified')continue;
            retained.push(next);
            if(next.complete&&!next.composition){await execution.checkActive();await createVisualReadingCache(getRuntimeDirectory()).write(scope,unit,next);}
        }
    }
    const result=await readVisualSource(manifest,scope,execution,{retainedUnits:retained,renderFragment:createSourceFragmentRenderer(file,String(document.title||''),manifest)});
    const reading=assembleDocumentReading(manifest,result.units,scope);
    reading.verification.createdBy={jobId:execution.jobId,rulesVersion:VISUAL_READING_RULES,profileRevision:execution.profile.revision};
    if(reading.verification.msg)reading.verification.msg.scope=scope;
    reading.verification.issues=[...new Set([...reading.verification.issues,...result.issues])];
    const coverage=assessVisualReading(reading.verification,{...document,content_hash:sourceHash,extracted_text:reading.text,extracted_text_hash:reading.textHash});
    reading.verification.complete=coverage.complete;reading.verification.issues=[...new Set([...reading.verification.issues,...coverage.issues])];
    // Reading may take minutes. Merge the owner's latest fields, then use the
    // database row revision to avoid overwriting a change made during this write.
    await execution.checkActive();
    const latest=await client.from('documents').select('*,xmin').eq('id',document.id).eq('project_id',execution.projectId).maybeSingle();
    if(latest.error||!record(latest.data)||!/^\d+$/u.test(String(latest.data.xmin??'')))throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
    const fresh=latest.data as OwnedSourceDocument&{xmin:string;deleted_at?:string|null};
    const readingState=(row:OwnedSourceDocument)=>{
        const parsed=record(row.parsed_json)?row.parsed_json:{};
        return {source:Object.fromEntries(['id','project_id','title','file_url','storage_bucket','storage_path','content_hash','extracted_text','extracted_text_hash','ocr_status','processed_at'].map(key=>[key,row[key as keyof OwnedSourceDocument]??null])),
            evidence:Object.fromEntries(['source_reading','source_reading_units','source_reading_history','source_reading_visual_descriptions'].map(key=>[key,parsed[key]??null]))};
    };
    if(fresh.deleted_at||canonicalFragmentJson(readingState(fresh))!==canonicalFragmentJson(readingState(document)))throw new BusinessAiError('AI_SOURCE_CHANGED',undefined,409);
    const patch=createReadingPatch(fresh,reading),saved={...fresh,...patch,content_hash:sourceHash};
    await execution.checkActive();
    const response=await client.from('documents').update({...patch,...(!fresh.content_hash?{content_hash:sourceHash}:{})},{count:'exact'}).eq('id',document.id).eq('project_id',execution.projectId).eq('xmin',fresh.xmin);
    if(response.error||response.count!==1)throw new BusinessAiError(response.count===0?'AI_SOURCE_CHANGED':'AI_SOURCE_UNVERIFIED',undefined,response.count===0?409:500);
    await execution.reportProgress({phase:'reading',completedUnits:result.units.filter(u=>u.complete).length,totalUnits:manifest.units.length});
    await execution.checkActive();
    const savedReading:ReadingAssembly={...reading,text:patch.extracted_text,textHash:patch.extracted_text_hash,
        verification:patch.parsed_json.source_reading as unknown as ReadingAssembly['verification'],visualDescriptions:getCurrentDocumentReading(saved).visualDescriptions};
    return {document:saved,reading:savedReading,cached:false};
}
