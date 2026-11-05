import 'server-only';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BusinessAiError,record,type AiExecutionContext} from '../contracts';
import {readVisualSource,reverifySavedPhysicalUnit} from '../visual-source-reader.server';
import {createVisualReadingCache,reverifySavedNumericUnit,retainedReadingUnit} from '../visual-reading-cache.server';
import {getRuntimeDirectory} from '../codex-client.server';
import {buildVisualSourceManifest} from '@/utils/visual-source-manifest';
import {assembleDocumentReading,createReadingPatch,getCurrentDocumentReading,hasSavedVisualReading} from '@/utils/document-reading-history';
import {preserveStableDocumentText} from '@/utils/stable-document-reading';
import {makeTextInput} from '@/utils/document-text-extraction';
import {assessVisualReading,VISUAL_READING_VERSION,VISUAL_READING_RULES,type OwnedSourceDocument,type ReadingAssembly,type VerifiedUnit} from '@/utils/visual-source-reading';
import type {DocxReadingVerification} from '@/utils/document-source-readiness';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export async function stageDocumentReading({client,document,file,execution}:{client:SupabaseClient;document:OwnedSourceDocument;file:Buffer;execution:AiExecutionContext}):Promise<{document:OwnedSourceDocument;reading:ReadingAssembly;cached:boolean}> {
    await execution.checkActive();
    const sourceHash=digest(file),current=getCurrentDocumentReading(document),parsed=record(document.parsed_json)?document.parsed_json:{};
    const scope={ownerId:execution.ownerId,projectId:execution.projectId,documentId:document.id,sourceHash};
    const previous=record(parsed.source_reading)?parsed.source_reading:null,previousMsg=previous&&record(previous.msg)?previous.msg:null;
    const previousScope=previousMsg&&record(previousMsg.scope)?previousMsg.scope:null;
    const scopeMatches=previous?.format!=='MSG'||Boolean(previousScope&&Object.entries(scope).every(([key,value])=>previousScope[key]===value));
    if(document.content_hash&&document.content_hash!==sourceHash)throw new BusinessAiError('AI_SOURCE_CHANGED',undefined,409);
    if(scopeMatches&&record(parsed.source_reading)&&parsed.source_reading.version===VISUAL_READING_VERSION&&assessVisualReading(parsed.source_reading,{...document,extracted_text_hash:current.textHash}).complete){
        const reading:ReadingAssembly={text:current.text,textHash:current.textHash,verification:parsed.source_reading as unknown as ReadingAssembly['verification'],
            units:Array.isArray(parsed.source_reading_units)?parsed.source_reading_units:[],visualDescriptions:current.visualDescriptions};
        await execution.reportProgress({phase:'reading',completedUnits:reading.verification.expectedUnits.length,totalUnits:reading.verification.expectedUnits.length});
        return {document,reading,cached:true};
    }
    await execution.reportProgress({phase:'reading',completedUnits:0,totalUnits:0});
    const manifest=await buildVisualSourceManifest(file,String(document.title||''));await execution.checkActive();
    if(manifest.format==='DOCX'&&manifest.units.length===0&&record(manifest.nativeVerification)&&manifest.nativeVerification.version==='docx-image-coverage-v1'){
        const native=makeTextInput(file,'docx_native_reading',manifest.nativeText,{readingVerification:manifest.nativeVerification as DocxReadingVerification,requiresReview:manifest.issues.length>0});
        const stable=preserveStableDocumentText(native,document,sourceHash);
        if(stable.kind==='text'&&stable.extractedText!==manifest.nativeText){manifest.nativeText=stable.extractedText;manifest.assembly=[{kind:'native',text:stable.extractedText}];manifest.manifestHash=digest(JSON.stringify({previous:manifest.manifestHash,textHash:digest(stable.extractedText)}));}
    }
    await execution.reportProgress({phase:'reading',completedUnits:0,totalUnits:manifest.units.length});
    let repaired:VerifiedUnit[]|null=null;
    if(scopeMatches&&hasSavedVisualReading(document,sourceHash)&&Array.isArray(parsed.source_reading_units)){
        const retained:VerifiedUnit[]=[];let canRetain=record(parsed.source_reading)&&parsed.source_reading.manifestHash===manifest.manifestHash,hasRepair=false;
        for(const unit of manifest.units){
            const previous=parsed.source_reading_units.find(value=>record(value)&&value.unitId===unit.id),saved=retainedReadingUnit(previous,unit);
            if(!saved){canRetain=false;continue;}
            const checked=reverifySavedNumericUnit(saved,unit)??await reverifySavedPhysicalUnit(saved,unit,execution),next=checked??saved;
            retained.push(next);if(checked)hasRepair=true;
            if(next.complete){await execution.checkActive();await createVisualReadingCache(getRuntimeDirectory()).write(scope,unit,next);}
        }
        if(canRetain&&hasRepair&&retained.length===manifest.units.length)repaired=retained;
    }
    const result=repaired?{units:repaired,issues:[...manifest.issues,...repaired.flatMap(unit=>unit.complete?[]:unit.uncertainties)]}:await readVisualSource(manifest,scope,execution);
    const reading=assembleDocumentReading(manifest,result.units);
    reading.verification.createdBy={jobId:execution.jobId,rulesVersion:VISUAL_READING_RULES,profileRevision:execution.profile.revision};
    if(reading.verification.msg)reading.verification.msg.scope=scope;
    reading.verification.issues=[...new Set([...reading.verification.issues,...result.issues])];
    const coverage=assessVisualReading(reading.verification,{...document,content_hash:sourceHash,extracted_text:reading.text,extracted_text_hash:reading.textHash});
    reading.verification.complete=coverage.complete;reading.verification.issues=[...new Set([...reading.verification.issues,...coverage.issues])];
    const patch=createReadingPatch(document,reading),saved={...document,...patch,content_hash:sourceHash};
    await execution.checkActive();
    const response=await client.from('documents').update({...patch,...(!document.content_hash?{content_hash:sourceHash}:{})}).eq('id',document.id).eq('project_id',execution.projectId);
    if(response.error)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
    await execution.reportProgress({phase:'reading',completedUnits:result.units.filter(u=>u.complete).length,totalUnits:manifest.units.length});
    await execution.checkActive();
    const savedReading:ReadingAssembly={...reading,text:patch.extracted_text,textHash:patch.extracted_text_hash,
        verification:patch.parsed_json.source_reading as unknown as ReadingAssembly['verification'],visualDescriptions:getCurrentDocumentReading(saved).visualDescriptions};
    return {document:saved,reading:savedReading,cached:false};
}
