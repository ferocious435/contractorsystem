import type {ReadingScope,ReadingUnit,Rect,RenderedView,UnitReading,VerifiedUnit} from './visual-source-reading';
import {normalizeReadingTypography} from './visual-source-response';

export type FragmentAddress={kind:'line';line:number}|{kind:'table-row';table:number;row:number};
export type FragmentValue=string|string[];
export type FragmentAnchor={id:string;address:FragmentAddress;value:FragmentValue};
export type FragmentTarget={id:string;unitId:string;viewIds:string[];address:FragmentAddress;anchors:FragmentAnchor[];reason:string};
export type FragmentPlan={targets:FragmentTarget[];issues:string[]};
export type FragmentResponse={targetId:string;blocks:Array<{id:string;value:FragmentValue}>;uncertainties:string[]};
export type FragmentLocator={raw:string;viewId:string;imageHash:string};
export type FragmentProof={
    version:'visual-fragment-proof-v1';scope:ReadingScope;unitId:string;inputHash:string;baseEvidenceHash:string;
    target:FragmentTarget;rect:Rect;image:Omit<RenderedView,'bytes'>;raw:[string,string];readings:[FragmentResponse,FragmentResponse];
    value:FragmentValue;createdBy:{jobId:string;profileRevision:number};
    locator?:FragmentLocator;
};
export type FragmentAttempt=Pick<FragmentProof,'scope'|'unitId'|'inputHash'|'target'|'rect'|'image'|'raw'|'createdBy'|'locator'>&{reason:string};
export type FragmentComposition={version:'visual-fragment-assembly-v1';baseEvidenceHash:string;evidenceHash:string;proofs:FragmentProof[];pending:FragmentTarget[];issues:string[];locator?:FragmentLocator;attempts?:FragmentAttempt[]};
export type FragmentSummary={version:'visual-fragment-assembly-v1';baseEvidenceHash:string;evidenceHash:string;scope:ReadingScope;
    accepted:Array<{targetId:string;address:FragmentAddress;rect:Rect;imageHash:string}>;pending:FragmentTarget[];issues:string[]};
export type FragmentRenderer=(unit:ReadingUnit,rect:Rect)=>Promise<RenderedView|null>;
export const FRAGMENT_LIMIT=4;
export const fragmentAddressKey=(a:FragmentAddress)=>a.kind==='line'?`line:${a.line}`:`table:${a.table}:row:${a.row}`;
export function fragmentValuesEqual(a:FragmentValue,b:FragmentValue):boolean {
    if(typeof a==='string'||typeof b==='string')return typeof a==='string'&&typeof b==='string'&&normalizeReadingTypography(a)===normalizeReadingTypography(b);
    return a.length===b.length&&a.every((cell,i)=>normalizeReadingTypography(cell)===normalizeReadingTypography(b[i]));
}
export function fragmentBlocks(reading:UnitReading):FragmentAnchor[] {
    return [...reading.text.split(/\r?\n/u).map((value,line)=>({id:`line:${line}`,address:{kind:'line' as const,line},value})),
        ...reading.tables.flatMap((table,t)=>table.map((value,row)=>({id:`table:${t}:row:${row}`,address:{kind:'table-row' as const,table:t,row},value:[...value]})))];
}
export function primaryFragmentReading(unit:ReadingUnit,saved:VerifiedUnit):UnitReading|null {
    const full=unit.views.filter(v=>v.rect.x===0&&v.rect.y===0&&v.rect.width===1&&v.rect.height===1).sort((a,b)=>b.width*b.height-a.width*a.height);
    return saved.views.find(v=>v.viewId===(full[0]?.id??unit.views[0]?.id))?.reading??null;
}
function sameTables(a:UnitReading,b:UnitReading) {
    return a.tables.length===b.tables.length
        &&a.tables.every((table,t)=>table.length===b.tables[t].length&&table.every((row,r)=>row.length===b.tables[t][r].length));
}
const sameSection=(a:FragmentAddress,b:FragmentAddress)=>a.kind===b.kind&&(a.kind==='line'||b.kind==='table-row'&&a.table===b.table);
const hasValue=(value:FragmentValue)=>typeof value==='string'?Boolean(value.trim()):value.some(v=>Boolean(v.trim()));

/** Addresses are structural positions, never a bag of matching words or numbers. */
export function planFragmentTargets(unit:ReadingUnit,saved:VerifiedUnit):FragmentPlan {
    const issues:string[]=[],targets:FragmentTarget[]=[],primary=primaryFragmentReading(unit,saved);
    if(!primary||saved.views.length!==unit.views.length)return {targets,issues:['Fragment base does not cover the source views']};
    const rects=new Set(unit.views.map(v=>JSON.stringify(v.rect)));
    if(rects.size!==1)return {targets,issues:['Fragment addresses across different source regions are not aligned']};
    const readings:UnitReading[]=[];
    for(const proof of saved.views){
        if(proof.method!=='visual-double-pass'||!proof.confirmation){issues.push('Fragment base lacks an independent source pair: '+proof.viewId);continue;}
        readings.push(proof.reading,proof.confirmation);
    }
    if(!readings.length)return {targets,issues:[...issues,'Fragment base lacks source readings']};
    const tablesAligned=readings.every(r=>sameTables(primary,r));
    if(!tablesAligned)issues.push('Fragment text or table structure differs');
    // Line wrapping is harmless only when the entire ordered body is identical.
    // This alignment is for comparison; the original responses stay untouched.
    const aligned=readings.map(r=>normalizeReadingTypography(r.text)===normalizeReadingTypography(primary.text)?{...r,text:primary.text}:r);
    const textAligned=aligned.every(r=>r.text.split(/\r?\n/u).length===primary.text.split(/\r?\n/u).length);
    if(!textAligned)issues.push('Fragment text or table structure differs');
    const blocks=fragmentBlocks(primary),others=aligned.map(r=>new Map(fragmentBlocks(r).map(b=>[b.id,b])));
    const eligible=(b:FragmentAnchor)=>b.address.kind==='line'?textAligned:tablesAligned;
    const disputed=blocks.map(b=>eligible(b)&&others.some(all=>!all.has(b.id)||!fragmentValuesEqual(b.value,all.get(b.id)!.value)));
    const unique=(b:FragmentAnchor)=>blocks.filter(other=>fragmentValuesEqual(other.value,b.value)).length===1;
    for(let i=0;i<blocks.length;i++){
        if(!disputed[i])continue;
        const block=blocks[i],agreed=blocks.map((b,index)=>({b,index})).filter(v=>v.index!==i&&eligible(v.b)&&!disputed[v.index]&&hasValue(v.b.value));
        const neighbors=agreed.filter(v=>sameSection(block.address,v.b.address));
        const before=neighbors.filter(v=>v.index<i).reverse(),after=neighbors.filter(v=>v.index>i);
        let chosen=before.length&&after.length?[before[0],after[0]]:before.length?before.slice(0,2):after.slice(0,2);
        if(chosen.length===1&&block.address.kind==='table-row'&&unique(chosen[0].b)){
            const text=agreed.find(v=>v.b.address.kind==='line'&&unique(v.b));if(text)chosen=[chosen[0],text];
        }
        if(chosen.length!==2||chosen.some(v=>!unique(v.b))){
            issues.push('Fragment has ambiguous or insufficient context: '+block.id);continue;
        }
        targets.push({id:'fragment:'+block.id,unitId:unit.id,viewIds:unit.views.map(v=>v.id),address:block.address,
            anchors:chosen.sort((a,b)=>a.index-b.index).map(v=>v.b),reason:'Independent source readings disagree at '+block.id});
    }
    for(const reading of readings){
        if(reading.visualDescription!==primary.visualDescription&&/\p{N}/u.test(reading.visualDescription+' '+primary.visualDescription))issues.push('Numeric visual description is not bound to a literal fragment');
        for(const note of reading.uncertainties){
            const normalized=normalizeReadingTypography(note),bound=targets.filter(t=>{
                const key=fragmentAddressKey(t.address);
                return others.some(all=>{const v=all.get(key)?.value;return v!==undefined&&(typeof v==='string'?[v]:v).some(cell=>cell.trim().length>=3&&normalized.includes(normalizeReadingTypography(cell)));});
            });
            if(bound.length!==1)issues.push('Unbound source uncertainty: '+note);
        }
    }
    const sourceNotes=new Set(readings.flatMap(r=>r.uncertainties));
    for(const note of saved.uncertainties)if(!sourceNotes.has(note)&&!/^Numeric or source verification failed: |^Fragment (?:pending|check failed): /u.test(note)&&note!=='Source content is not verified')issues.push(note);
    return {targets,issues:[...new Set(issues)]};
}

export const fragmentResponseSchema={type:'object',additionalProperties:false,required:['targetId','blocks','uncertainties'],properties:{
    targetId:{type:'string'},blocks:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['id','value'],properties:{id:{type:'string'},value:{anyOf:[{type:'string'},{type:'array',items:{type:'string'}}]}}}},
    uncertainties:{type:'array',items:{type:'string'}},
}};
