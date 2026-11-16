import 'server-only';
import {createHash} from 'node:crypto';
import {record,validUuid} from './contracts';
import {readingUnitInputHash,retainedReadingUnit,unitReadingLiteral} from './visual-reading-cache.server';
import {validReadingRect,validReadingHash,type ReadingScope,type ReadingUnit,type RenderedView,type VerifiedUnit} from '@/utils/visual-source-reading';
import {normalizeReadingTypography} from '@/utils/visual-source-response';
import {findPositionedDifference,confirmPositionedReading,matchingPrintedWitnesses} from '@/server/documents/pdf-positioned-text.server';
import {fragmentAddressKey,fragmentBlocks,fragmentValuesEqual,planFragmentTargets,primaryFragmentReading,
    type FragmentProof,type FragmentResponse,type FragmentTarget,type FragmentValue,type FragmentRenderer} from '@/utils/visual-fragment-contracts';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function canonicalFragmentJson(value:unknown):string {
    const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):record(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,sort(v[key])])):v;
    return JSON.stringify(sort(value));
}
export const fragmentBaseHash=(base:VerifiedUnit)=>digest(canonicalFragmentJson(base.views));
export const fragmentProofsHash=(proofs:FragmentProof[])=>digest(canonicalFragmentJson(proofs));
function validBase(unit:ReadingUnit,base:VerifiedUnit) {
    const reading=primaryFragmentReading(unit,base);if(!reading)return false;
    const literal=unitReadingLiteral(reading);
    const original={...base};delete original.composition;
    return Boolean(retainedReadingUnit({...original,complete:false,text:literal,textHash:digest(literal),tables:reading.tables,
        uncertainties:['Numeric or source verification failed: retained fragment base']},unit));
}
function response(value:unknown,target:FragmentTarget):FragmentResponse|null {
    if(!record(value)||Object.keys(value).some(k=>!['targetId','blocks','uncertainties'].includes(k))||value.targetId!==target.id
        ||!Array.isArray(value.blocks)||value.blocks.length!==target.anchors.length+1||!Array.isArray(value.uncertainties)||value.uncertainties.length)return null;
    const expected=[...target.anchors,{id:target.id,address:target.address}];const seen=new Set<string>();
    for(let i=0;i<value.blocks.length;i++){
        const b=value.blocks[i];if(!record(b)||Object.keys(b).some(k=>!['id','value'].includes(k))||typeof b.id!=='string'||seen.has(b.id))return null;
        const block=expected.find(e=>e.id===b.id);if(!block)return null;seen.add(b.id);
        if(block.address.kind==='line'?typeof b.value!=='string':!Array.isArray(b.value)||!b.value.every(cell=>typeof cell==='string'))return null;
        for(const previous of value.blocks.slice(0,i)){
            if(!record(previous))return null;const a=expected.find(e=>e.id===previous.id)!.address,c=block.address;
            if(a.kind==='line'&&c.kind==='line'&&a.line>=c.line||a.kind==='table-row'&&c.kind==='table-row'&&a.table===c.table&&a.row>=c.row)return null;
        }
        const anchor=target.anchors.find(a=>a.id===b.id);
        if(anchor&&!fragmentValuesEqual(b.value as FragmentValue,anchor.value))return null;
    }
    return value as unknown as FragmentResponse;
}
const normalizedFragmentText=(text:string)=>normalizeReadingTypography(text).replace(/\s*\)\s*,/gu,'),');
function preservesAgreedText(chosen:string,source:string[]):boolean {
    const values=source.map(normalizedFragmentText),value=normalizedFragmentText(chosen);
    if(values.every(v=>v===values[0]))return value===values[0];
    const numberCounts=values.map(v=>(v.match(/\p{N}+/gu)??[]).length);
    if(numberCounts.every(n=>n===numberCounts[0])&&(value.match(/\p{N}+/gu)??[]).length!==numberCounts[0])return false;
    const words=values.map(v=>v.trim().split(/\s+/u)),result=value.trim().split(/\s+/u);
    if(words.every(w=>w.length===words[0].length)){
        if(result.length!==words[0].length)return false;
        if(words[0].some((word,i)=>words.every(w=>w[i]===word)&&result[i]!==word))return false;
    }
    return true;
}
export function preservesAgreedContent(chosen:FragmentValue,base:VerifiedUnit,target:FragmentTarget):boolean {
    const values=base.views.flatMap(p=>[p.reading,...(p.confirmation?[p.confirmation]:[])]).map(r=>fragmentBlocks(r).find(b=>fragmentAddressKey(b.address)===fragmentAddressKey(target.address))?.value);
    if(typeof chosen==='string')return values.every(v=>typeof v==='string')&&preservesAgreedText(chosen,values as string[]);
    return values.every(v=>Array.isArray(v)&&v.length===chosen.length)&&chosen.every((cell,i)=>preservesAgreedText(cell,(values as string[][]).map(row=>row[i])));
}
function sameWitnessText(a:FragmentValue,b:FragmentValue):boolean {
    if(fragmentValuesEqual(a,b))return true;
    // A space touching a closing bracket before a comma does not move the
    // comma or bracket. Keep every word boundary, number, sign and raw answer.
    const key=normalizedFragmentText;
    if(typeof a==='string'||typeof b==='string')return typeof a==='string'&&typeof b==='string'&&key(a)===key(b);
    return a.length===b.length&&a.every((s,i)=>key(s)===key(b[i]));
}
export function attemptReadings(raw:[string,string],target:FragmentTarget){
    try{
        const first=response(JSON.parse(raw[0]),target),second=response(JSON.parse(raw[1]),target);
        if(!first||!second||first.blocks.some((b,i)=>b.id!==second.blocks[i].id||b.id!==target.id&&!fragmentValuesEqual(b.value,second.blocks[i].value)))return null;
        return {readings:[first,second] as [FragmentResponse,FragmentResponse],values:[first,second].map(r=>r.blocks.find(b=>b.id===target.id)!.value) as [FragmentValue,FragmentValue]};
    }catch{return null;}
}
/** Checks persisted witnesses; physical bytes are checked by verifyFragmentProof at creation/re-render. */
export function verifyStoredFragmentProof(value:unknown,scope:ReadingScope,unit:ReadingUnit,base:VerifiedUnit,target:FragmentTarget):FragmentProof|null {
    try{
        if(!record(value)||value.version!=='visual-fragment-proof-v1'||!record(value.scope)||!record(value.image)||!record(value.createdBy)
            ||!validUuid(value.createdBy.jobId)||!Number.isSafeInteger(value.createdBy.profileRevision)||Number(value.createdBy.profileRevision)<1
            ||canonicalFragmentJson(value.scope)!==canonicalFragmentJson(scope)||value.unitId!==unit.id||value.inputHash!==readingUnitInputHash(unit)
            ||value.baseEvidenceHash!==fragmentBaseHash(base)||canonicalFragmentJson(value.target)!==canonicalFragmentJson(target)
            ||!validReadingRect(value.rect)||!validReadingRect(value.image.rect)||canonicalFragmentJson(value.rect)!==canonicalFragmentJson(value.image.rect)
            ||!validReadingHash(value.image.sha256)||typeof value.image.id!=='string'||!Number.isSafeInteger(value.image.width)||Number(value.image.width)<=0
            ||!Number.isSafeInteger(value.image.height)||Number(value.image.height)<=0||Number(value.image.width)*Number(value.image.height)>16_000_000
            ||!Array.isArray(value.raw)||value.raw.length!==2||!value.raw.every(r=>typeof r==='string'&&Buffer.byteLength(r)<=4*1024*1024)
            ||!Array.isArray(value.readings)||value.readings.length!==2||!validBase(unit,base))return null;
        const planned=planFragmentTargets(unit,base).targets.find(t=>t.id===target.id);
        if(!planned||canonicalFragmentJson(planned)!==canonicalFragmentJson(target))return null;
        const pair=attemptReadings(value.raw as [string,string],target);
        if(!pair||canonicalFragmentJson(pair.readings)!==canonicalFragmentJson(value.readings))return null;
        let choice=0;
        if(value.positioned!==undefined){
            const witness=(value as unknown as FragmentProof).positioned!;
            if(!witness?.match?.line||!validReadingRect(witness.match.line.rect)||!validReadingHash(witness.image?.sha256)
                ||canonicalFragmentJson(witness.image.rect)!==canonicalFragmentJson(witness.match.line.rect))return null;
            const match=findPositionedDifference(...pair.values,[witness.match.line],value.rect);
            if(!match||canonicalFragmentJson(match)!==canonicalFragmentJson(witness.match))return null;
            if(witness.support){
                const s=witness.support,box=s.rect,r=match.line.rect;
                if(witness.raw!==undefined||!validUuid(s.createdBy?.jobId)||s.createdBy.jobId===value.createdBy.jobId
                    ||!Number.isSafeInteger(s.createdBy.profileRevision)||s.createdBy.profileRevision<1
                    ||canonicalFragmentJson(s.scope)!==canonicalFragmentJson(scope)||s.inputHash!==value.inputHash||s.unitId!==unit.id||canonicalFragmentJson(s.target)!==canonicalFragmentJson(target)
                    ||!validReadingRect(box)||canonicalFragmentJson(s.image?.rect)!==canonicalFragmentJson(box)||!validReadingHash(s.image.sha256)
                    ||r.x<box.x||r.y<box.y||r.x+r.width>box.x+box.width||r.y+r.height>box.y+box.height
                    ||!Array.isArray(s.raw)||s.raw.length!==2||!s.raw.every(raw=>typeof raw==='string'&&Buffer.byteLength(raw)<=4*1024*1024))return null;
                const both=attemptReadings(s.raw,target);
                if(!both||!matchingPrintedWitnesses(match,pair.values[match.choice],both.values))return null;
            }else if(typeof witness.raw!=='string'||Buffer.byteLength(witness.raw)>65536||!confirmPositionedReading(match,JSON.parse(witness.raw)))return null;
            choice=match.choice;
        }else if(!sameWitnessText(...pair.values))return null;
        const chosen=pair.values[choice],original=primaryFragmentReading(unit,base)!;
        const targetValue=fragmentBlocks(original).find(b=>fragmentAddressKey(b.address)===fragmentAddressKey(target.address))?.value;
        if(chosen===undefined||targetValue===undefined||canonicalFragmentJson(chosen)!==canonicalFragmentJson(value.value)
            ||typeof chosen!==typeof targetValue||Array.isArray(chosen)&&(!Array.isArray(targetValue)||chosen.length!==targetValue.length)
            ||!preservesAgreedContent(chosen,base,target))return null;
        return structuredClone(value) as unknown as FragmentProof;
    }catch{return null;}
}
export function verifyFragmentProof(value:unknown,scope:ReadingScope,unit:ReadingUnit,base:VerifiedUnit,target:FragmentTarget,image:RenderedView):FragmentProof|null {
    const proof=verifyStoredFragmentProof(value,scope,unit,base,target);
    if(!proof||digest(image.bytes)!==image.sha256||canonicalFragmentJson(proof.image)!==canonicalFragmentJson({...image,bytes:undefined}))return null;
    return proof;
}
export function composeFragmentReading(unit:ReadingUnit,base:VerifiedUnit,proofs:FragmentProof[],scope:ReadingScope):VerifiedUnit {
    const plan=planFragmentTargets(unit,base),reading=primaryFragmentReading(unit,base),issues=[...plan.issues],accepted:FragmentProof[]=[],seen=new Set<string>();
    if(!validBase(unit,base))issues.push('Fragment source evidence is invalid');
    for(const proof of proofs){
        const target=plan.targets.find(t=>t.id===proof.target?.id),checked=target&&verifyStoredFragmentProof(proof,scope,unit,base,target);
        if(!checked||seen.has(checked.target.id)){issues.push('Fragment proof is invalid or repeated');continue;}
        seen.add(checked.target.id);accepted.push(checked);
    }
    if(!reading)return {...structuredClone(base),complete:false,uncertainties:[...issues,'Fragment base reading is absent']};
    const assembled=structuredClone(reading),lines=assembled.text.split(/\r?\n/u);
    for(const proof of accepted){const a=proof.target.address;if(a.kind==='line')lines[a.line]=proof.value as string;else assembled.tables[a.table][a.row]=[...(proof.value as string[])];}
    assembled.text=lines.join('\n');const text=unitReadingLiteral(assembled),pending=plan.targets.filter(t=>!seen.has(t.id));
    if(!text.trim()&&!base.visualDescription.trim())issues.push('Fragment reading has no source content');
    const uncertainties=[...new Set([...issues,...pending.map(t=>'Fragment pending: '+t.id)])];
    return {...structuredClone(base),text,textHash:digest(text),tables:assembled.tables,complete:uncertainties.length===0,uncertainties,
        composition:{version:'visual-fragment-assembly-v1',baseEvidenceHash:fragmentBaseHash(base),evidenceHash:fragmentProofsHash(accepted),proofs:accepted,pending,issues:[...new Set(issues)]}};
}

/** Rebuild the authoritative transcript from the immutable source pair and witnesses. */
export function retainedFragmentComposition(value:unknown,unit:ReadingUnit,scope?:ReadingScope):VerifiedUnit|null {
    try{
        if(!scope||!record(value)||!record(value.composition)||value.composition.version!=='visual-fragment-assembly-v1'
            ||!Array.isArray(value.composition.proofs)||!Array.isArray(value.composition.issues)||!Array.isArray(value.composition.pending))return null;
        const saved=value as unknown as VerifiedUnit,rebuilt=composeFragmentReading(unit,saved,saved.composition!.proofs,scope),composition=saved.composition!;
        if(!validBase(unit,saved)||!rebuilt.composition||composition.baseEvidenceHash!==rebuilt.composition.baseEvidenceHash
            ||composition.evidenceHash!==rebuilt.composition.evidenceHash||canonicalFragmentJson(composition.proofs)!==canonicalFragmentJson(rebuilt.composition.proofs)
            ||canonicalFragmentJson(composition.pending)!==canonicalFragmentJson(rebuilt.composition.pending))return null;
        const extra=composition.issues.filter(note=>!rebuilt.composition!.issues.includes(note));
        if(extra.some(note=>typeof note!=='string'||!note.startsWith('Fragment check failed: '))||extra.length&&!composition.pending.length)return null;
        const issues=[...new Set([...rebuilt.composition.issues,...extra])],uncertainties=[...new Set([...rebuilt.uncertainties,...extra])];
        if(canonicalFragmentJson(composition.issues)!==canonicalFragmentJson(issues)||canonicalFragmentJson(saved.uncertainties)!==canonicalFragmentJson(uncertainties)
            ||saved.text!==rebuilt.text||saved.textHash!==rebuilt.textHash||canonicalFragmentJson(saved.tables)!==canonicalFragmentJson(rebuilt.tables)
            ||saved.complete!==(rebuilt.complete&&!extra.length))return null;
        return structuredClone(saved);
    }catch{return null;}
}

export async function verifyFragmentImages(value:VerifiedUnit,unit:ReadingUnit,scope:ReadingScope,render:FragmentRenderer):Promise<boolean> {
    const saved=retainedFragmentComposition(value,unit,scope);if(!saved)return false;
    for(const proof of saved.composition!.proofs){const image=await render(unit,proof.rect);if(!image||!verifyFragmentProof(proof,scope,unit,saved,proof.target,image)||!await verifyPositionedImage(proof,unit,render))return false;}
    return true;
}
export async function verifyPositionedImage(proof:FragmentProof,unit:ReadingUnit,render:FragmentRenderer):Promise<boolean>{
    const witness=proof.positioned;if(!witness)return true;
    const pair=attemptReadings(proof.raw,proof.target);
    const lines=await render.positionedLines?.(unit);
    if(!pair||!lines)return false;
    const match=findPositionedDifference(...pair.values,lines,proof.rect);
    if(canonicalFragmentJson(match)!==canonicalFragmentJson(witness.match))return false;
    if(witness.support){
        const supporting=await render(unit,witness.support.rect);
        if(!supporting||digest(supporting.bytes)!==supporting.sha256||canonicalFragmentJson({...supporting,bytes:undefined})!==canonicalFragmentJson(witness.support.image))return false;
    }
    const image=await render(unit,witness.match.line.rect);
    return Boolean(image&&digest(image.bytes)===image.sha256&&canonicalFragmentJson({...image,bytes:undefined})===canonicalFragmentJson(witness.image));
}
