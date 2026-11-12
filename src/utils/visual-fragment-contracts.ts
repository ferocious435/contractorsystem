import type {ReadingScope,ReadingUnit,Rect,RenderedView,UnitReading,VerifiedUnit} from './visual-source-reading';
import {normalizeReadingTypography} from './visual-source-response';

export type FragmentAddress={kind:'line';line:number}|{kind:'table-row';table:number;row:number};
export type FragmentValue=string|string[];
export type FragmentAnchor={id:string;address:FragmentAddress;value:FragmentValue};
export type FragmentTarget={id:string;unitId:string;viewIds:string[];address:FragmentAddress;anchors:FragmentAnchor[];reason:string};
export type FragmentPlan={targets:FragmentTarget[];issues:string[]};
export type FragmentResponse={targetId:string;blocks:Array<{id:string;value:FragmentValue}>;uncertainties:string[]};
export type FragmentProof={
    version:'visual-fragment-proof-v1';scope:ReadingScope;unitId:string;inputHash:string;baseEvidenceHash:string;
    target:FragmentTarget;rect:Rect;image:Omit<RenderedView,'bytes'>;raw:[string,string];readings:[FragmentResponse,FragmentResponse];
    value:FragmentValue;createdBy:{jobId:string;profileRevision:number};
};
export type FragmentComposition={version:'visual-fragment-assembly-v1';baseEvidenceHash:string;evidenceHash:string;proofs:FragmentProof[];pending:FragmentTarget[];issues:string[]};
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
function sameShape(a:UnitReading,b:UnitReading) {
    return a.text.split(/\r?\n/u).length===b.text.split(/\r?\n/u).length&&a.tables.length===b.tables.length
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
    if(!readings.length||readings.some(r=>!sameShape(primary,r)))return {targets,issues:[...issues,'Fragment text or table structure differs']};
    const blocks=fragmentBlocks(primary),others=readings.map(fragmentBlocks);
    const disputed=blocks.map((b,i)=>others.some(all=>!fragmentValuesEqual(b.value,all[i].value)));
    for(let i=0;i<blocks.length;i++){
        if(!disputed[i])continue;
        const block=blocks[i],neighbors=blocks.map((b,index)=>({b,index})).filter(v=>v.index!==i&&!disputed[v.index]&&sameSection(block.address,v.b.address)&&hasValue(v.b.value));
        const before=neighbors.filter(v=>v.index<i).reverse(),after=neighbors.filter(v=>v.index>i);
        const chosen=before.length&&after.length?[before[0],after[0]]:before.length?before.slice(0,2):after.slice(0,2);
        if(chosen.length!==2||chosen.some(v=>blocks.filter(b=>sameSection(b.address,v.b.address)&&fragmentValuesEqual(b.value,v.b.value)).length!==1)){
            issues.push('Fragment has ambiguous or insufficient context: '+block.id);continue;
        }
        targets.push({id:'fragment:'+block.id,unitId:unit.id,viewIds:unit.views.map(v=>v.id),address:block.address,
            anchors:chosen.sort((a,b)=>a.index-b.index).map(v=>v.b),reason:'Independent source readings disagree at '+block.id});
    }
    for(const reading of readings){
        if(reading.visualDescription!==primary.visualDescription&&/\p{N}/u.test(reading.visualDescription+' '+primary.visualDescription))issues.push('Numeric visual description is not bound to a literal fragment');
        for(const note of reading.uncertainties){
            const normalized=normalizeReadingTypography(note),bound=targets.filter(t=>{
                const index=blocks.findIndex(b=>fragmentAddressKey(b.address)===fragmentAddressKey(t.address));
                return others.some(all=>{const v=all[index].value;return (typeof v==='string'?[v]:v).some(cell=>cell.trim().length>=3&&normalized.includes(normalizeReadingTypography(cell)));});
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
