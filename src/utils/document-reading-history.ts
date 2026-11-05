import 'server-only';
import {createHash} from 'node:crypto';
import {assessDocumentSourceReadiness,hasDocumentBodyText,type DocumentSourceInput} from './document-source-readiness';
import {VISUAL_READING_VERSION,VISUAL_READING_RULES,validReadingHash,type SourceManifest,type VerifiedUnit,type ReadingAssembly,
    type VisualDescription,type VisualReadingVerification,type OwnedSourceDocument,type DocumentReadingPatch,type ReadingTextVersion,type EffectiveDocumentReading} from './visual-source-reading';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const json=(document:OwnedSourceDocument)=>object(document.parsed_json)?document.parsed_json:{};
const viewWithoutBytes=(v:SourceManifest['units'][number]['views'][number])=>({id:v.id,sha256:v.sha256,width:v.width,height:v.height,rect:v.rect});

/** A local OCR pass must not replace a server reading, including its unresolved units. */
export function hasSavedVisualReading(saved:DocumentSourceInput,sourceHash=saved.content_hash):boolean {
    const parsed=object(saved.parsed_json)?saved.parsed_json:{},reading=parsed.source_reading;
    return object(reading)&&reading.version===VISUAL_READING_VERSION&&validReadingHash(sourceHash)&&reading.sourceHash===sourceHash
        &&reading.currentTextHash===hash(String(saved.extracted_text||''))&&reading.currentTextHash===saved.extracted_text_hash
        &&object(reading.createdBy)&&typeof reading.createdBy.jobId==='string'&&reading.createdBy.rulesVersion===VISUAL_READING_RULES
        &&Number.isSafeInteger(reading.createdBy.profileRevision)&&(reading.createdBy.profileRevision as number)>0;
}
export function readingAnalysisFingerprint(reading:unknown):string {
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort()
        .filter(key=>key!=='createdBy').map(key=>[key,canonical(value[key])])):value;
    return hash(JSON.stringify(canonical(reading)));
}

export function assembleDocumentReading(manifest:SourceManifest,units:VerifiedUnit[]):ReadingAssembly {
    const expected=new Set(manifest.units.map(u=>u.id)),byId=new Map<string,VerifiedUnit>();
    for(const unit of units){if(!expected.has(unit.unitId)||byId.has(unit.unitId))throw Error('Unexpected or repeated source reading');byId.set(unit.unitId,unit);}
    const issues=[...manifest.issues],visualDescriptions:VisualDescription[]=[];
    const expectedUnits=manifest.units.map(unit=>{
        const verified=byId.get(unit.id);
        const complete=Boolean(verified?.complete&&validReadingHash(verified.inputHash)&&verified.textHash===hash(verified.text)
            &&verified.uncertainties.length===0&&verified.views.length===unit.views.length&&unit.views.length>0
            &&unit.views.every(view=>verified.views.filter(proof=>proof.viewId===view.id&&proof.imageHash===view.sha256).length===1));
        if(!complete)issues.push('Unverified unit: '+unit.id);
        if(complete&&verified?.contentRole!=='BRANDING_ONLY'&&verified?.visualDescription.trim())for(const location of unit.locations)visualDescriptions.push({unitId:unit.id,location,text:verified.visualDescription});
        return {id:unit.id,kind:unit.kind,locations:unit.locations,views:unit.views.map(viewWithoutBytes),status:complete?'READ' as const:'REQUIRES_REVIEW' as const,
            inputHash:verified?.inputHash||'',textHash:verified?.textHash||'',literalHasBody:hasDocumentBodyText(verified?.text||''),visualHasContent:Boolean(verified?.visualDescription.trim()),
            verifiedViews:(verified?.views||[]).map(proof=>({viewId:proof.viewId,imageHash:proof.imageHash,textHash:proof.textHash,method:proof.method,confirmationHash:proof.confirmationHash,
                ...(proof.readingImage?{readingImage:proof.readingImage}:{}),...(proof.confirmationImage?{confirmationImage:proof.confirmationImage}:{}),
                ...(proof.emptyPageProof?{emptyPageProof:proof.emptyPageProof}:{}),...(proof.recognitionVersion?{recognitionVersion:proof.recognitionVersion}:{})})),uncertainties:verified?.uncertainties||['Unit not read'],
            ...(verified?.contentRole?{contentRole:verified.contentRole}:{}),...(verified?.nonBlockingNotes?.length?{nonBlockingNotes:verified.nonBlockingNotes}:{})};
    });
    const msg=manifest.msg?structuredClone(manifest.msg):undefined;
    if(msg)for(const part of msg.parts)part.textRanges=[];
    let textLength=0;
    const text=manifest.assembly.map(block=>{
        const remember=(value:string)=>{if(msg&&block.msgPartId){const part=msg.parts.find(p=>p.id===block.msgPartId);if(!part)issues.push('MSG_ASSEMBLY_PART_UNKNOWN');else if(value.length){const last=part.textRanges.at(-1);if(last?.end===textLength)last.end+=value.length;else part.textRanges.push({start:textLength,end:textLength+value.length});}}textLength+=value.length;return value;};
        if(block.kind==='native')return remember(block.text);
        const unit=manifest.units.find(u=>u.id===block.unitId);
        if(!unit){issues.push('Unknown assembly unit: '+block.unitId);return '';}
        const verified=byId.get(unit.id),entry=expectedUnits.find(u=>u.id===unit.id);
        const literal=entry?.status==='READ'?verified!.text:unit.localText;
        return remember(manifest.format==='PDF'||manifest.format==='MSG'&&unit.kind==='PDF_PAGE'?`\n[PAGE ${unit.locations[0]?.page}]\n${literal}\n`:literal);
    }).join('');
    if(msg)for(const part of [...msg.parts].reverse())part.status=part.nativeComplete&&part.issues.length===0&&part.unitIds.every(id=>expectedUnits.some(u=>u.id===id&&u.status==='READ'))&&msg.parts.filter(p=>p.parentId===part.id).every(p=>p.status==='READ')?'READ':'REQUIRES_REVIEW';
    const textHash=hash(text);
    const verification:VisualReadingVerification={version:VISUAL_READING_VERSION,sourceHash:manifest.sourceHash,currentTextHash:textHash,manifestHash:manifest.manifestHash,
        format:manifest.format,nativeComplete:manifest.issues.length===0,expectedUnits,issues,complete:issues.length===0,...(msg?{msg}:{}),
        // The live handler replaces these deliberately invalid placeholders with the actual job provenance.
        createdBy:{jobId:'',rulesVersion:VISUAL_READING_RULES,profileRevision:0}};
    return {text,textHash,verification,units,visualDescriptions};
}

function descriptions(value:unknown):VisualDescription[] {
    return Array.isArray(value)?value.filter((v):v is VisualDescription=>object(v)&&typeof v.unitId==='string'&&typeof v.text==='string'&&object(v.location)):[];
}
function currentVersion(saved:OwnedSourceDocument):ReadingTextVersion {
    const text=String(saved.extracted_text||''),parsed=json(saved);
    return {sourceHash:String(saved.content_hash||''),textHash:hash(text),text,reading:parsed.source_reading??null,
        visualDescriptions:descriptions(parsed.source_reading_visual_descriptions)};
}
function readingVersions(saved:OwnedSourceDocument):ReadingTextVersion[] {
    const current=currentVersion(saved),history=json(saved).source_reading_history;
    const versions=[current,...(Array.isArray(history)?history:[]).filter((v):v is ReadingTextVersion=>object(v)&&v.sourceHash===current.sourceHash
        &&typeof v.text==='string'&&v.textHash===hash(v.text))];
    return versions.filter((v,i)=>validReadingHash(v.sourceHash)&&versions.findIndex(other=>other.textHash===v.textHash&&other.sourceHash===v.sourceHash)===i);
}

export function createReadingPatch(saved:OwnedSourceDocument,reading:ReadingAssembly):DocumentReadingPatch {
    if(!validReadingHash(reading.verification.sourceHash)||saved.content_hash&&reading.verification.sourceHash!==saved.content_hash||reading.textHash!==hash(reading.text))throw Error('Reading does not match the saved source');
    const parsed=json(saved),previousReading=parsed.source_reading;
    if(!saved.content_hash&&object(previousReading)&&validReadingHash(previousReading.sourceHash)
        &&previousReading.sourceHash!==reading.verification.sourceHash)throw Error('Previous reading belongs to a different source');
    // A first verified hash of this stored file must not strand its earlier transcript.
    const before=currentVersion({...saved,content_hash:saved.content_hash||reading.verification.sourceHash}),retainPrevious=!reading.verification.complete&&before.text.length>0;
    const text=retainPrevious?before.text:reading.text,textHash=hash(text);
    const history=Array.isArray(parsed.source_reading_history)?[...parsed.source_reading_history]:[];
    if(object(previousReading)&&previousReading.format==='MSG'&&reading.verification.format==='MSG'
        &&readingAnalysisFingerprint(previousReading)!==readingAnalysisFingerprint(reading.verification)){
        const evidenceHash=readingAnalysisFingerprint(previousReading);
        if(!history.some(v=>object(v)&&v.sourceHash===before.sourceHash&&v.textHash===before.textHash&&v.evidenceHash===evidenceHash))history.push({...before,evidenceHash});
    }
    if(before.text&&before.textHash!==textHash&&!history.some(v=>object(v)&&v.sourceHash===before.sourceHash&&v.textHash===before.textHash))history.push(before);
    // Keep the full newly assembled source even when another region is still unresolved.
    // The previous transcript stays current; the new attempt is an explicitly partial version.
    if(retainPrevious&&reading.text&&reading.textHash!==textHash
        &&!history.some(value=>object(value)&&value.sourceHash===reading.verification.sourceHash&&value.textHash===reading.textHash)){
        history.push({sourceHash:reading.verification.sourceHash,textHash:reading.textHash,text:reading.text,
            reading:reading.verification,visualDescriptions:reading.visualDescriptions});
    }
    const changed=before.textHash!==textHash;
    const previousUnits=Array.isArray(parsed.source_reading_units)?parsed.source_reading_units:[];
    if(previousUnits.length&&JSON.stringify(previousUnits)!==JSON.stringify(reading.units)){
        const unitsHash=hash(JSON.stringify(previousUnits));
        if(!history.some(value=>object(value)&&value.sourceHash===before.sourceHash&&value.unitsHash===unitsHash)){
            const index=history.findIndex(value=>object(value)&&value.sourceHash===before.sourceHash&&value.textHash===before.textHash&&!value.unitsHash);
            const previous={...(index<0?before:history[index]),unitsHash,units:structuredClone(previousUnits)};
            if(index<0)history.push(previous);else history[index]=previous;
        }
    }
    let currentReading={...reading.verification,currentTextHash:textHash};
    let currentDescriptions=reading.visualDescriptions;
    if(retainPrevious&&textHash!==reading.textHash&&currentReading.msg){
        if(object(previousReading)&&previousReading.version===VISUAL_READING_VERSION&&previousReading.format==='MSG'&&previousReading.currentTextHash===before.textHash&&Array.isArray(previousReading.expectedUnits)&&Array.isArray(previousReading.issues))currentReading=structuredClone(previousReading) as unknown as VisualReadingVerification;
        else {
            const msg=structuredClone(currentReading.msg);for(const part of msg.parts){part.textRanges=[];part.status='REQUIRES_REVIEW';part.nativeComplete=false;}
            currentReading={...currentReading,complete:false,nativeComplete:false,msg,issues:[...currentReading.issues,'MSG_CURRENT_TEXT_IS_PREVIOUS_VERSION']};
        }
        currentReading={...currentReading,complete:false,nativeComplete:false,issues:[...new Set([...currentReading.issues,'MSG_CURRENT_TEXT_IS_PREVIOUS_VERSION'])]};
        currentDescriptions=before.visualDescriptions||[];
    }
    return {extracted_text:text,extracted_text_hash:textHash,ocr_status:reading.verification.complete?'COMPLETED':'REQUIRES_REVIEW',processed_at:new Date().toISOString(),
        parsed_json:{...parsed,source_reading:currentReading,source_reading_units:reading.units,
            source_reading_visual_descriptions:currentDescriptions,source_reading_history:history,
            ...(changed?{analysis_stale:true,analysis_reading_text_hash:typeof parsed.analysis_reading_text_hash==='string'?parsed.analysis_reading_text_hash:before.textHash}:{})}};
}

export function resolveReadingVersion(saved:OwnedSourceDocument,query:{textHash?:string;quote?:string;page?:number}):ReadingTextVersion|null {
    let versions=readingVersions(saved);
    if(query.textHash)versions=versions.filter(v=>v.textHash===query.textHash);
    if(query.quote)versions=versions.filter(v=>v.text.includes(query.quote!));
    if(query.page!==undefined)versions=versions.filter(v=>{
        if(!Number.isInteger(query.page)||query.page!<1)return false;
        if(!object(v.reading))return true;
        if(v.reading.version===VISUAL_READING_VERSION&&Array.isArray(v.reading.expectedUnits))return v.reading.expectedUnits.some(unit=>object(unit)&&Array.isArray(unit.locations)&&unit.locations.some(l=>object(l)&&l.page===query.page));
        return typeof v.reading.totalPages!=='number'||query.page!<=v.reading.totalPages;
    });
    if(!query.textHash&&!query.quote)return versions[0]??null;
    return versions.length===1?versions[0]:null;
}

export function getCurrentDocumentReading(saved:OwnedSourceDocument):EffectiveDocumentReading {
    const current=currentVersion(saved);
    return {text:current.text,textHash:current.textHash,sourceHash:current.sourceHash,visualDescriptions:current.visualDescriptions||[],
        ready:assessDocumentSourceReadiness({...saved,extracted_text_hash:current.textHash}).canCompare};
}
export function projectDocumentForCatalog(saved:OwnedSourceDocument):OwnedSourceDocument {
    const parsed={...json(saved)};
    for(const key of ['source_reading_history','source_reading_units','source_reading_attempt_units','raw_response','raw_model_response','source_reading_raw'])delete parsed[key];
    parsed.source_reading_versions=readingVersions(saved).map(({sourceHash,textHash})=>({sourceHash,textHash}));
    return {...saved,parsed_json:parsed};
}
export function documentReadingVersions(saved:OwnedSourceDocument) {
    return readingVersions(saved).map(({sourceHash,textHash})=>({sourceHash,textHash}));
}
