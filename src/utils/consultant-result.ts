import {record} from '@/server/ai/contracts';
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
