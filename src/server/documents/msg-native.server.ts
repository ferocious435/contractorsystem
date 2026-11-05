import 'server-only';
import {localOcrMcpExecutable} from '@/utils/local-ocr-mcp';
import type {MsgNativeResult,MsgReadOptions} from '@/utils/msg-source-types';
import {runMsgProcess} from './msg-process.server';
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export async function extractMsgNative(file:Buffer,options:MsgReadOptions={}):Promise<MsgNativeResult> {
    const raw:unknown=JSON.parse(await runMsgProcess(file,{executable:localOcrMcpExecutable(),config:{max_archive_depth:0},args:(input,config)=>['extract',input,'--config',config,'--format','json','--ocr','false','--disable-ocr','true','--no-cache','true','--extract-images','false','--content-format','plain','--chunk','false','--quality','false','--token-reduction','off','--layout','false','--max-threads','2']},options));
    if(!record(raw)||!record(raw.metadata)||typeof raw.content!=='string')throw Error('MSG_NATIVE_RESPONSE_INVALID');
    const m=raw.metadata,strings=(key:string)=>Array.isArray(m[key])?(m[key] as unknown[]).filter((v):v is string=>typeof v==='string'):[];
    const email=typeof m.from_email==='string'?m.from_email:'',name=typeof m.from_name==='string'?m.from_name:'',sentAtRaw=typeof m.created_at==='string'?m.created_at:null;
    const date=sentAtRaw?new Date(sentAtRaw):null,issues:string[]=[];
    if(sentAtRaw&&(!date||!Number.isFinite(date.getTime())))issues.push('MSG_SENT_DATE_UNCONFIRMED');
    if(Array.isArray(raw.warnings)&&raw.warnings.length)issues.push('MSG_NATIVE_EXTRACTION_WARNING');
    return {headers:{subject:typeof m.subject==='string'?m.subject:'',from:email?[name?`${name} <${email}>`:email]:name?[name]:strings('authors'),to:strings('to_emails'),cc:strings('cc_emails'),bcc:strings('bcc_emails'),sentAt:date&&Number.isFinite(date.getTime())?date.toISOString():null,sentAtRaw},bodyText:raw.content,issues};
}
