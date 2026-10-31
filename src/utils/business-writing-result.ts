import {BusinessAiError,record,type JsonValue} from '@/server/ai/contracts';
import {isLetterDraftSnapshot} from './letter-snapshot';
import type {LetterDraftSnapshot,LetterSourceRef} from './letter-draft-types';
export interface WritingFacts {kind:'letter'|'consultant';projectName:string;userText:string;sources:Array<LetterSourceRef&{sourceId:string}>;payload?:Record<string,unknown>;}
export interface WritingResult {body:string;sourceIds:string[];unknowns?:string[];nextActions?:string[];}
const invalid=(code='AI_WRITING_INVALID')=>new BusinessAiError(code,'התשובה כוללת פרט שלא אומת. הטקסט הקודם נשמר.',422);
const numbers=(text:string)=>text.normalize('NFKC').match(/\p{N}+(?:[.,/:\-]\p{N}+)*/gu)??[];
function checkedBody(value:unknown,facts:WritingFacts):string {
    if(typeof value!=='string'||!value.trim()||value.length>30000)throw invalid();
    const evidence=[facts.userText,facts.projectName,...facts.sources.map(source=>source.quote??'')].join('\n'),allowed=new Set(numbers(evidence));
    const factualText=value.replace(/^\s*\d{1,3}[.)]\s+/gm,'');
    if(numbers(factualText).some(number=>!allowed.has(number)))throw invalid('AI_FACT_UNVERIFIED');
    // Dates/codes from the input are allowed. Financial figures are rendered from the server snapshot.
    const withoutDates=value.replace(/\b(\d{1,2})[/.](\d{1,2})(?:[/.]\d{2,4})?\b/g,(match,day,month)=>Number(day)<=31&&Number(month)<=12&&evidence.includes(match)?' [date] ':match);
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
    const result:WritingResult={body:checkedBody(value.body,facts),sourceIds:value.sourceIds};
    if(facts.kind==='consultant')for(const key of ['unknowns','nextActions'] as const){if(!Array.isArray(value[key])||value[key].length>20)throw invalid();result[key]=value[key].map(text=>checkedBody(text,facts));}
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
