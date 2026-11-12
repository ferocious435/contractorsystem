import 'server-only';
import {createHash} from 'node:crypto';
import {record,validUuid} from './contracts';
import {readingUnitInputHash,retainedReadingUnit,unitReadingLiteral} from './visual-reading-cache.server';
import {validReadingRect,validReadingHash,type ReadingScope,type ReadingUnit,type RenderedView,type VerifiedUnit} from '@/utils/visual-source-reading';
import {normalizeReadingTypography} from '@/utils/visual-source-response';
import {fragmentAddressKey,fragmentBlocks,fragmentValuesEqual,planFragmentTargets,primaryFragmentReading,
    type FragmentProof,type FragmentResponse,type FragmentTarget,type FragmentValue} from '@/utils/visual-fragment-contracts';

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
    return Boolean(retainedReadingUnit({...base,complete:false,text:literal,textHash:digest(literal),tables:reading.tables,
        uncertainties:['Numeric or source verification failed: retained fragment base']},unit));
}
function response(value:unknown,target:FragmentTarget):FragmentResponse|null {
    if(!record(value)||Object.keys(value).some(k=>!['targetId','blocks','uncertainties'].includes(k))||value.targetId!==target.id
        ||!Array.isArray(value.blocks)||value.blocks.length!==target.anchors.length+1||!Array.isArray(value.uncertainties)||value.uncertainties.length)return null;
    const order=[...target.anchors.map(a=>({id:a.id,address:a.address})),{id:target.id,address:target.address}].sort((a,b)=>{
        const index=(v:typeof a)=>v.address.kind==='line'?v.address.line:v.address.row;return index(a)-index(b);
    });
    for(let i=0;i<value.blocks.length;i++){
        const b=value.blocks[i];if(!record(b)||Object.keys(b).some(k=>!['id','value'].includes(k))||b.id!==order[i].id)return null;
        if(target.address.kind==='line'?typeof b.value!=='string':!Array.isArray(b.value)||!b.value.every(cell=>typeof cell==='string'))return null;
        const anchor=target.anchors.find(a=>a.id===b.id);
        if(anchor&&!fragmentValuesEqual(b.value as FragmentValue,anchor.value))return null;
    }
    return value as unknown as FragmentResponse;
}
function preservesAgreedText(chosen:string,source:string[]):boolean {
    const values=source.map(normalizeReadingTypography),value=normalizeReadingTypography(chosen);
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
function preservesAgreedContent(chosen:FragmentValue,base:VerifiedUnit,target:FragmentTarget):boolean {
    const values=base.views.flatMap(p=>[p.reading,...(p.confirmation?[p.confirmation]:[])]).map(r=>fragmentBlocks(r).find(b=>fragmentAddressKey(b.address)===fragmentAddressKey(target.address))?.value);
    if(typeof chosen==='string')return values.every(v=>typeof v==='string')&&preservesAgreedText(chosen,values as string[]);
    return values.every(v=>Array.isArray(v)&&v.length===chosen.length)&&chosen.every((cell,i)=>preservesAgreedText(cell,(values as string[][]).map(row=>row[i])));
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
        const first=response(JSON.parse(value.raw[0]),target),second=response(JSON.parse(value.raw[1]),target);
        if(!first||!second||canonicalFragmentJson([first,second])!==canonicalFragmentJson(value.readings)
            ||!first.blocks.every((b,i)=>fragmentValuesEqual(b.value,second.blocks[i].value)))return null;
        const chosen=first.blocks.find(b=>b.id===target.id)?.value,original=primaryFragmentReading(unit,base)!;
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
