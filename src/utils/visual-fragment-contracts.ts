import type {ReadingScope,ReadingUnit,Rect,RenderedView,UnitReading,VerifiedUnit} from './visual-source-reading';
import {normalizeReadingTypography} from './visual-source-response';

export type FragmentAddress={kind:'line';line:number}|{kind:'table-row';table:number;row:number};
export type FragmentValue=string|string[];
/** Extract the observed tokens after the same typographic normalization used
 * for verification. Repeated occurrences cannot identify a line. */
export function observedPrintedLine(value:FragmentValue,cell:number,line:string):{offset:number;text:string}|null {
    const content=Array.isArray(value)?value[cell]:cell===0?value:undefined;
    if(typeof content!=='string')return null;
    const tokens=/[\p{L}\p{M}\p{N}]+|[^\s]/gu;
    const needle=normalizeReadingTypography(line).match(tokens)??[];
    if(needle.length<3)return null;
    const normalized=normalizeReadingTypography(content);
    const words=Array.from(normalized.matchAll(tokens));
    let match:{offset:number;text:string}|null=null;
    for(let i=0;i<=words.length-needle.length;i++){
        if(!needle.every((token,j)=>words[i+j][0]===token))continue;
        if(match)return null;
        const last=words[i+needle.length-1];
        match={offset:i,text:normalized.slice(words[i].index,last.index+last[0].length)};
    }
    return match;
}
export type FragmentAnchor={id:string;address:FragmentAddress;value:FragmentValue};
export type FragmentTarget={id:string;unitId:string;viewIds:string[];address:FragmentAddress;anchors:FragmentAnchor[];reason:string};
export type FragmentPlan={targets:FragmentTarget[];issues:string[]};
export type FragmentResponse={targetId:string;blocks:Array<{id:string;value:FragmentValue}>;uncertainties:string[]};
export type FragmentLocator={raw:string;viewId:string;imageHash:string};
export type PositionedLine={text:string;rect:Rect;objectIndex:number;rotation:number;terminalObjectIndex?:number};
export type PositionedDifference={line:PositionedLine;choice:0|1;cell:number};
export type PositionedWitness={match:PositionedDifference;image:Omit<RenderedView,'bytes'>} & (
    {raw:string;support?:never}|{raw?:never;support:Omit<FragmentAttempt,'reason'>}
);
export type FragmentProof={
    version:'visual-fragment-proof-v1';scope:ReadingScope;unitId:string;inputHash:string;baseEvidenceHash:string;
    target:FragmentTarget;rect:Rect;image:Omit<RenderedView,'bytes'>;raw:[string,string];readings:[FragmentResponse,FragmentResponse];
    value:FragmentValue;createdBy:{jobId:string;profileRevision:number};
    locator?:FragmentLocator;
    positioned?:PositionedWitness;
    correction?:{match:PositionedDifference;image:Omit<RenderedView,'bytes'>;raw:string};
};
export type FragmentAttempt=Pick<FragmentProof,'scope'|'unitId'|'inputHash'|'target'|'rect'|'image'|'raw'|'createdBy'|'locator'>&{reason:string};
export type FragmentComposition={version:'visual-fragment-assembly-v1';baseEvidenceHash:string;evidenceHash:string;proofs:FragmentProof[];pending:FragmentTarget[];issues:string[];locator?:FragmentLocator;attempts?:FragmentAttempt[]};
export type FragmentSummary={version:'visual-fragment-assembly-v1';baseEvidenceHash:string;evidenceHash:string;scope:ReadingScope;
    accepted:Array<{targetId:string;address:FragmentAddress;rect:Rect;imageHash:string}>;pending:FragmentTarget[];issues:string[]};
export type FragmentRenderer=((unit:ReadingUnit,rect:Rect)=>Promise<RenderedView|null>) & {
    positionedLines?:(unit:ReadingUnit)=>Promise<PositionedLine[]>;
};
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

/** Project reflowed text onto original line addresses only between unique, ordered anchors.
 * Unknown spans stay null; the raw responses are never modified. */
export function alignFragmentLines(primary:string,other:string):{lines:Array<string|null>;unresolved:boolean} {
    const lines=primary.split(/\r?\n/u),flat=normalizeReadingTypography(other),base=normalizeReadingTypography(primary);
    if(normalizeReadingTypography(primary)===flat)return {lines,unresolved:false};
    if(lines.length>2000||base.length>200000||flat.length>200000)return {lines:lines.map(()=>null),unresolved:true};
    const uniqueAt=(haystack:string,needle:string)=>{const i=haystack.indexOf(needle);if(i<0||haystack.indexOf(needle,i+1)>=0)return -1;
        if(i>0&&!/\s/u.test(haystack[i-1])||i+needle.length<haystack.length&&!/\s/u.test(haystack[i+needle.length]))return -1;return i;};
    const result:Array<string|null>=lines.map(()=>null),anchors:Array<{line:number;start:number;end:number}>=[];
    for(let i=0;i<lines.length;i++){
        const value=normalizeReadingTypography(lines[i]);if(value.length<8||uniqueAt(base,value)<0)continue;
        const start=uniqueAt(flat,value);if(start<0||anchors.length&&start<anchors[anchors.length-1].end)continue;
        anchors.push({line:i,start,end:start+value.length});result[i]=lines[i];
    }
    let unresolved=false;
    const boundaries=[{line:-1,start:0,end:0},...anchors,{line:lines.length,start:flat.length,end:flat.length}];
    for(let i=1;i<boundaries.length;i++){
        const prev=boundaries[i-1],next=boundaries[i],indices:number[]=[];
        for(let k=prev.line+1;k<next.line;k++)if(lines[k].trim())indices.push(k);
        const gap=flat.slice(prev.end,next.start).trim();
        if(!indices.length&&!gap){for(let k=prev.line+1;k<next.line;k++)result[k]=lines[k];continue;}
        if(indices.length===1&&prev.line>=0&&next.line<lines.length&&gap&&gap.length<=normalizeReadingTypography(lines[indices[0]]).length*3+80){
            result[indices[0]]=gap;for(let k=prev.line+1;k<next.line;k++)if(!lines[k].trim())result[k]=lines[k];
        }else unresolved=true;
    }
    return {lines:result,unresolved};
}

/** Only one literal quote about transcription can be promoted to a physical check.
 * Spatial, diagrammatic and multi-part uncertainties remain blocking. */
export function uncertaintyQuote(note:string):string|null {
    const quotes=[...note.matchAll(/«([^«»\r\n]{3,200})»/gu)];if(quotes.length!==1)return null;
    const q=normalizeReadingTypography(quotes[0][1]),outside=note.replace(quotes[0][0],' ');
    if(!/[\p{L}\p{N}]/u.test(q)||q.split(/\s+/u).length>10||/[\p{N}]/u.test(outside)
        ||/[.!?]\s*\S/u.test(outside)||!/(?:букв|слов|текст|надпис|фамили|имя|числ|номер|цифр|обознач|letters?|words?|text|number|digit|label)/iu.test(outside)
        ||!/(?:неразборчив|неувер|неяс|сомнен|недостаточно\s+ч[её]тк|предполож|unclear|uncertain|unreadable|illegible)/iu.test(outside)
        ||/[;:]/u.test(outside)||/(?:схем|чертеж|чертёж|стрелк|изображ|рисунк|логотип|эмблем|печать|штамп|подпис|располож|положени|направлен|порядок|размер|столб|ячейк|диаграм|diagram|drawing|arrow|image|logo|signature|stamp|layout|position|direction|dimension|column|cell)/iu.test(outside)
        ||/(?:^|[^\p{L}])(?:и|или|либо|а также|также|отдельно|другой|другая|ещё|еще|and|or|also|another)(?:$|[^\p{L}])/iu.test(outside))return null;
    return q;
}
export function quoteOccurrences(value:string,quote:string):number {
    const text=normalizeReadingTypography(value);let count=0,start=0;
    for(;;){const i=text.indexOf(quote,start);if(i<0)return count;const end=i+quote.length;
        if((i===0||!/[\p{L}\p{M}\p{N}]/u.test(text[i-1]))&&(end===text.length||!/[\p{L}\p{M}\p{N}]/u.test(text[end])))count++;
        start=i+Math.max(1,quote.length);
    }
}

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
    const primaryLines=primary.text.split(/\r?\n/u),projected=aligned.map(r=>r.text.split(/\r?\n/u).length===primaryLines.length?{lines:r.text.split(/\r?\n/u),unresolved:false}:alignFragmentLines(primary.text,r.text));
    if(projected.some(item=>item.unresolved||item.lines.some(value=>value===null)))issues.push('Fragment text or table structure differs');
    const blocks=fragmentBlocks(primary),others=aligned.map((r,index)=>{
        const map=new Map(fragmentBlocks(r).filter(b=>b.address.kind!=='line').map(b=>[b.id,b]));
        projected[index].lines.forEach((value,line)=>{if(value!==null)map.set(`line:${line}`,{id:`line:${line}`,address:{kind:'line',line},value});});return map;
    });
    const eligible=(b:FragmentAnchor)=>b.address.kind==='line'?others.every(all=>all.has(b.id)):tablesAligned;
    const sourceNotes=new Set(readings.flatMap(r=>r.uncertainties));
    // Assembly diagnostics are derived from the unchanged source pair. Do not feed
    // them back as new source uncertainties when validating a saved composition.
    const derived=new Set(saved.composition?planFragmentTargets(unit,{...saved,uncertainties:[],composition:undefined}).issues:[]);
    const savedNotes=saved.uncertainties.filter(note=>!derived.has(note)).map(note=>note.startsWith('Unbound source uncertainty: ')?note.slice('Unbound source uncertainty: '.length):note).filter(note=>!sourceNotes.has(note)&&!/^Numeric or source verification failed: |^Fragment (?:pending|check failed): /u.test(note)&&note!=='Source content is not verified');
    const notes=[...new Set([...sourceNotes,...savedNotes])],noteTargets=new Map<string,string>();
    for(const note of notes){
        const quote=uncertaintyQuote(note);if(!quote||readings.some(r=>quoteOccurrences(r.visualDescription,quote)>0
            ||fragmentBlocks(r).reduce((count,b)=>count+(typeof b.value==='string'?[b.value]:b.value).reduce((n,v)=>n+quoteOccurrences(v,quote),0),0)!==1))continue;
        const matches=others.map(all=>[...all.values()].flatMap(block=>(typeof block.value==='string'?[block.value]:block.value).flatMap((cell,index)=>
            Array.from({length:quoteOccurrences(cell,quote)},()=>({id:block.id,cell:index})))));
        if(matches.every(m=>m.length===1&&m[0].id===matches[0][0].id&&m[0].cell===matches[0][0].cell))noteTargets.set(note,matches[0][0].id);
    }
    const requested=new Set(noteTargets.values());
    const disputed=blocks.map(b=>eligible(b)&&(requested.has(b.id)||others.some(all=>!all.has(b.id)||!fragmentValuesEqual(b.value,all.get(b.id)!.value))));
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
    }
    for(const note of notes){
        const id=noteTargets.get(note);
        if(!id||!targets.some(target=>fragmentAddressKey(target.address)===id))issues.push('Unbound source uncertainty: '+note);
    }
    return {targets,issues:[...new Set(issues)]};
}

export const fragmentResponseSchema={type:'object',additionalProperties:false,required:['targetId','blocks','uncertainties'],properties:{
    targetId:{type:'string'},blocks:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['id','value'],properties:{id:{type:'string'},value:{anyOf:[{type:'string'},{type:'array',items:{type:'string'}}]}}}},
    uncertainties:{type:'array',items:{type:'string'}},
}};
