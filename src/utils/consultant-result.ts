import {record} from '@/server/ai/contracts';
import {parsePrintedBoqRows} from './printed-boq-rows';
/** Stored business replies remain intact. Only program-added evidence is folded
 * away for reading; an older reply can be reopened without another model turn. */
export function consultantDisplay(value:unknown):{content:string;details?:string}{
    if(!record(value)||typeof value.response!=='string')return {content:''};
    if(value.displayVersion==='consultant-v2')return {content:value.response,...(typeof value.details==='string'&&value.details?{details:value.details}:{})};
    if(!Array.isArray(value.sourceIds))return {content:value.response};
    const response=value.response;
    const positions=['\n\nמקורות שמורים:\n','\n\nלא נמצא מקור מאומת לציטוט עבור השאלה הזו.'].map(marker=>response.indexOf(marker)).filter(index=>index>=0);
    if(!positions.length)return {content:value.response};
    const start=Math.min(...positions),actions=value.response.lastIndexOf('\n\nצעדים מוצעים:\n');
    return {content:value.response.slice(0,start)+(actions>start?value.response.slice(actions):'')+'\n\nמקורות ומגבלות הקריאה זמינים בפירוט.',details:value.response.slice(start,actions>start?actions:undefined).trim()};
}

// Stable across reloads, independent of a later catalogue order or source IDs.
export function consultantBoqRowKey(row:import('./consultant-boq').ConsultantBoqRow):string {
    return JSON.stringify([row.documentId,row.sourceHash,row.textHash,row.start,row.end,row.itemCode]);
}
function anchor(value:unknown):boolean {
    return record(value)&&typeof value.documentId==='string'&&!!value.documentId&&typeof value.quote==='string'&&!!value.quote.trim()
        &&Number.isSafeInteger(value.start)&&Number.isSafeInteger(value.end)&&(value.start as number)>=0&&(value.end as number)>(value.start as number)
        &&value.quote.length===(value.end as number)-(value.start as number)
        &&(value.page===null||(Number.isSafeInteger(value.page)&&(value.page as number)>0));
}
function strings(value:unknown):value is string[]{return Array.isArray(value)&&value.every(item=>typeof item==='string');}
function nullableString(value:unknown){return value===null||typeof value==='string';}
function revision(value:unknown):boolean {
    if(!record(value)||!nullableString(value.date)||!nullableString(value.printedDate)||!['DOCUMENT','PRINTED','UNKNOWN'].includes(String(value.datePurpose))
        ||!['EXECUTION_BOQ','CONTRACT_BOQ'].includes(String(value.designation))||!anchor(value.designationEvidence)
        ||!(value.dateEvidence===null||anchor(value.dateEvidence))||!(value.printedDateEvidence===null||anchor(value.printedDateEvidence)))return false;
    if(value.identifier!=null&&(!record(value.identifier)||typeof value.identifier.boq!=='string'||typeof value.identifier.edition!=='string'||!anchor(value.identifier.evidence)))return false;
    return value.conflictingDateEvidence===undefined||(Array.isArray(value.conflictingDateEvidence)&&value.conflictingDateEvidence.every(anchor));
}
/** A corrupt optional appendix must never prevent an older conversation opening. */
export function savedConsultantBoqRows(value:unknown):import('./consultant-boq').ConsultantBoqRow[]{
    if(!record(value)||!Array.isArray(value.boqRows))return [];
    return value.boqRows.filter((row):row is import('./consultant-boq').ConsultantBoqRow=>{
        if(!record(row)||!anchor(row)||typeof row.itemCode!=='string'||!row.itemCode||typeof row.scope!=='string'||typeof row.unit!=='string'
            ||typeof row.title!=='string'||!nullableString(row.sourceHash)||!nullableString(row.textHash)
            ||![row.quantity,row.unitPrice,row.total].every(number=>typeof number==='number'&&Number.isFinite(number)&&number>=0)
            ||!(row.vatBasis===null||['EXCL','INCL'].includes(String(row.vatBasis)))||typeof row.ambiguousItemCode!=='boolean'||!strings(row.duplicateDocumentIds)
            ||!record(row.binding)||!['VERIFIED','UNVERIFIED'].includes(String(row.binding.status))||!strings(row.binding.warnings)
            ||!Array.isArray(row.binding.evidence)||!row.binding.evidence.every(anchor)||!revision(row.revision))return false;
        return parsePrintedBoqRows(row.quote as string).some(parsed=>parsed.arithmeticVerified&&parsed.itemCode===row.itemCode
            &&parsed.scope===row.scope&&parsed.unit===row.unit&&parsed.quantity===row.quantity
            &&parsed.unitPrice===row.unitPrice&&parsed.total===row.total);
    });
}
