import {BusinessAiError,record,type JsonValue} from '@/server/ai/contracts';
import {isLetterDraftSnapshot} from './letter-snapshot';
import type {LetterDraftSnapshot,LetterSourceRef} from './letter-draft-types';
import {unverifiedWritingNumbers,maskKnownWritingDates} from './writing-number-evidence';
export interface WritingFacts {kind:'letter'|'consultant';projectName:string;userText:string;sources:Array<LetterSourceRef&{sourceId:string}>;unverifiedSourceLabels?:string[];payload?:Record<string,unknown>;}
export interface WritingResult {body:string;sourceIds:string[];unknowns?:string[];nextActions?:string[];}
const invalid=(code='AI_WRITING_INVALID')=>new BusinessAiError(code,'התשובה כוללת פרט שלא אומת. הטקסט הקודם נשמר.',422);
const SOURCE_MARKER=/(?<![\p{L}\p{N}_])S\d+(?![\p{L}\p{N}_])/gu;
const isSourceMarker=(text:string,start:number)=>!/(?:סעיף|סעיפים|תת[ -]?סעיף|פרק|קוד|מק["״']?ט|clause|section|code|item)\s*(?:מס[.'״]?\s*)?$/iu.test(text.slice(Math.max(0,start-48),start));
// A source ID has the same role in [S1], (S1, S2), or prose; a document code keeps its factual digits.
const sourceMarkers=(text:string)=>[...text.matchAll(SOURCE_MARKER)].filter(match=>isSourceMarker(text,match.index)).map(match=>match[0]);
const maskSourceMarkers=(text:string)=>text.replace(SOURCE_MARKER,(id,start:number)=>isSourceMarker(text,start)?' [source] ':id);
const referenceContext=(text:string)=>text.normalize('NFKC').replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,'');
function hasFactualReferenceContext(text:string,start:number,end:number):boolean {
    const before=referenceContext(text.slice(Math.max(0,start-48),start)),after=referenceContext(text.slice(end));
    return !isSourceMarker(text,start)
        ||/(?:\p{Sc}|%)\s*$|(?:^|[^\p{L}])(?:ש[״"']?ח|שקלים?|ILS|NIS|USD|EUR|סכום|מחיר|עלות|לתשלום|לשלם)\s*(?:של|הוא|היא|:)?\s*$/iu.test(before)
        ||/^\s*(?:\p{Sc}|%|(?:ש[״"']?ח|שקלים?|ILS|NIS|USD|EUR)(?!\p{L}))/iu.test(after)
        ||/(?:כמות|מגרש|קוטר|אורך|רוחב|גובה|עומק|quantity|count|diameter|length|width|height|depth)\s*(?:היא|הוא|של|:)?\s*$/iu.test(before)
        ||/^\s*(?:מטר(?:ים)?|[מס]["״']מ|מ["״]?[רק]|יחידות?|יח['׳]|צינורות|meters?|mm|cm|m|pcs|kg)(?!\p{L})/iu.test(after);
}
function maskConsultantSourceReferences(text:string,facts:WritingFacts,selected:readonly string[]):string {
    if(facts.kind!=='consultant')return text;
    return text.split(/(\n\s*\n)/u).map(paragraph=>{
        const cited=new Set(sourceMarkers(paragraph));
        const sources=facts.sources.filter(source=>selected.includes(source.sourceId)&&cited.has(source.sourceId)
            &&source.basis==='DOCUMENT'&&source.status==='VERIFIED'&&source.documentId&&source.quote);
        const pages=new Set(sources.map(source=>source.pageLabel).filter(page=>page&&/^[1-9]\d*$/u.test(page)));
        let masked=paragraph;
        for(const title of new Set(sources.map(source=>source.title).filter((title):title is string=>!!title&&/\.[a-z][a-z\d]{0,9}$/iu.test(title)))){
            const literal=new RegExp(title.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'gu');
            const current=masked;
            masked=current.replace(literal,(reference,start:number)=>{
                const before=current.slice(Math.max(0,start-2),start).normalize('NFKC');
                const after=current.slice(start+reference.length,start+reference.length+2).normalize('NFKC');
                if(/[\p{L}\p{N}_./\\\p{Pd}−]$|\p{N}[.,/:]$/u.test(before)
                    ||/^[\p{L}\p{N}_/\\\p{Pd}−]|^\.[\p{L}\p{N}_]/u.test(after)
                    ||hasFactualReferenceContext(current,start,start+reference.length))return reference;
                return ' [source filename] ';
            });
        }
        // Consume the complete enumeration before checking its boundary. Never backtrack
        // from an invalid final numeric token into an apparently valid shorter list.
        const pageText=maskSourceMarkers(masked).normalize('NFKC');
        return pageText.replace(/(?<![\p{L}\p{N}_])ו?[בלמ]?ה?(?:עמודים|עמוד|עמ['׳’])\s+([1-9]\d*(?:(?:,\s+(?:ו[־-]?\s*)?|\s+ו[־-]?\s*)[1-9]\d*)*)/gu,
            (reference,list:string,start:number)=>{
                const after=pageText.slice(start+reference.length).normalize('NFKC');
                if([...list.matchAll(/[1-9]\d*/gu)].some(match=>!pages.has(match[0]))
                    ||/^[\p{L}\p{N}_/:\-\u2010-\u2015]|^[.,]\s*\p{N}/u.test(after)
                    ||/^\s*(?:ו?עד|to|through)\s*[−-]?\p{N}/iu.test(after)
                    ||hasFactualReferenceContext(pageText,start,start+reference.length))return reference;
                return ' [source page] ';
            });
    }).join('');
}
function checkedBody(value:unknown,facts:WritingFacts,selected:readonly string[]):string {
    if(typeof value!=='string'||!value.trim()||value.length>30000)throw invalid();
    const evidence=[facts.userText,facts.projectName,...facts.sources.map(source=>source.quote??'')].join('\n');
    // An unread filename may identify a reading gap; it supplies no quote or financial evidence.
    const labels=facts.kind==='consultant'?facts.unverifiedSourceLabels??[]:[];
    if(sourceMarkers(value).some(id=>!facts.sources.some(source=>source.sourceId===id)))throw invalid('AI_SOURCE_UNVERIFIED');
    const factualText=maskSourceMarkers(value).replace(/^\s*\d{1,3}[.)]\s+/gm,'');
    // Source metadata only validates explicit references to selected, locally cited sources.
    // Money and literal quotations below still inspect the original page-bearing text.
    const referencedText=maskConsultantSourceReferences(value,facts,selected);
    const numericText=(facts.kind==='consultant'?referencedText:factualText).replace(/^\s*\d{1,3}[.)]\s+/gm,'');
    if(unverifiedWritingNumbers(numericText,[evidence,...labels].join('\n')).length)throw invalid('AI_FACT_UNVERIFIED');
    // Dates/codes from the input are allowed. Financial figures are rendered from the server snapshot.
    const withoutDates=maskKnownWritingDates(factualText,evidence);
    if(/\p{N}[\p{N}\s.,]*\s*(?:₪|ש[״"']?ח|שקלים?|%|ILS|NIS|USD|EUR)|(?:₪|\$|€|£)\s*\p{N}|(?:סכום|מחיר|עלות|לתשלום|לשלם)[^\n.!?]{0,30}\p{N}/iu.test(withoutDates))throw invalid('AI_AMOUNT_UNVERIFIED');
    if(/(?<![א-ת])(?:אחד|אחת|שניים|שתיים|שלוש[הת]?|ארבע[הת]?|חמש[הת]?|שש[הת]?|שבע[הת]?|שמונה|תשע[הת]?|עשר[הת]?|עשרים|שלושים|ארבעים|חמישים|מאה|מאתיים|מאות|אלף|אלפים|מיליון|מיליונים|מיליארד)(?:\s+[א-ת]+){0,4}\s+(?:שקלים?|ש[״"']ח|דולרים?|יורו)(?![א-ת])|(?:סכום|מחיר|עלות|לתשלום|לשלם)[^\n.!?]{0,30}(?:אלף|אלפים|מיליון|מיליארד)/u.test(value))throw invalid('AI_AMOUNT_UNVERIFIED');
    for(const match of value.matchAll(/(?:^|\s)["“«]([^"”»\n]+)["”»](?=\s|[.,;:!?]|$)/gu))if(!facts.sources.some(source=>source.quote?.includes(match[1])))throw invalid('AI_QUOTE_UNVERIFIED');
    return value.trim();
}
export function validateWritingResult(raw:string,facts:WritingFacts,snapshot?:LetterDraftSnapshot):JsonValue {
    let value:unknown;try{value=JSON.parse(raw);}catch{throw invalid();}
    const keys=facts.kind==='letter'?['body','sourceIds']:['body','sourceIds','unknowns','nextActions'];
    if(!record(value)||Object.keys(value).some(key=>!keys.includes(key))||!keys.every(key=>Object.hasOwn(value,key)))throw invalid();
    if(snapshot&&!isLetterDraftSnapshot(snapshot))throw invalid();
    const allowed=new Set(facts.sources.map(source=>source.sourceId));
    if(!Array.isArray(value.sourceIds)||value.sourceIds.some(id=>typeof id!=='string'||!allowed.has(id))||new Set(value.sourceIds).size!==value.sourceIds.length)throw invalid('AI_SOURCE_UNVERIFIED');
    const result:WritingResult={body:checkedBody(value.body,facts,value.sourceIds),sourceIds:value.sourceIds};
    if(facts.kind==='consultant')for(const key of ['unknowns','nextActions'] as const){if(!Array.isArray(value[key])||value[key].length>20)throw invalid();result[key]=value[key].map(text=>checkedBody(text,facts,result.sourceIds));}
    if([result.body,...result.unknowns||[],...result.nextActions||[]].some(text=>sourceMarkers(text).some(id=>!result.sourceIds.includes(id))))throw invalid('AI_SOURCE_UNVERIFIED');
    return result as unknown as JsonValue;
}
const money=(value:number)=>value.toFixed(2)+' ₪';
export function renderWritingSources(sources:readonly (LetterSourceRef&{sourceId?:string})[]):string {
    return sources.map(source=>source.basis==='MANUAL'?'אישור ידני — דורש בדיקה: '+(source.manualNote??'לא צוין'):
        [source.sourceId?'['+source.sourceId+']':'',source.status==='VERIFIED'?'ציטוט מהטקסט השמור':'מקור שטרם אומת',source.title??'מסמך',source.pageLabel?'עמוד '+source.pageLabel:'',source.quote??'לא נמצא ציטוט שניתן לאמת'].filter(Boolean).join(' · ')).join('\n');
}
export function renderBusinessLetter(result:WritingResult,facts:WritingFacts,snapshot:LetterDraftSnapshot):{letter:string;snapshot:LetterDraftSnapshot}{
    if(!isLetterDraftSnapshot(snapshot))throw invalid();const payload=facts.payload??{};
    const all=snapshot.items.flatMap(item=>item.sources),verified=facts.sources;
    const sources=[...verified,...all.filter(source=>!verified.some(item=>item.documentId===source.documentId&&item.quote===source.quote))];
    return {snapshot,letter:[`לכבוד: ${payload.recipient||'הנמען'}`,`פרויקט: ${facts.projectName}`,`הנדון: ${payload.subject||'פנייה לבירור'}`,result.body,
        'מקורות שמורים:\n'+renderWritingSources(sources),'פירוט הסכומים לפי השורות שנבחרו:',
        ...snapshot.items.map(item=>`${item.itemCode||item.ledgerItemId} · ${item.description||'תמחור'} · ללא מע״מ ${money(item.net)} · מע״מ ${money(item.vat)} · כולל מע״מ ${money(item.gross)}`),
        'סה״כ לפני מע״מ: '+money(snapshot.totals.net),'מע״מ: '+money(snapshot.totals.vat),'סה״כ כולל מע״מ: '+money(snapshot.totals.gross)].join('\n\n')};
}
