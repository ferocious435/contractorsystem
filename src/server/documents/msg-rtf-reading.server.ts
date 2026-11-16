import 'server-only';
import {localOcrMcpExecutable} from '@/utils/local-ocr-mcp';
import type {MsgReadOptions} from '@/utils/msg-source-types';
import {runMsgProcess} from './msg-process.server';
/** Pinned installed local reader. No OCR, active content, remote resources or model calls. */
export async function readMsgRtf(file:Buffer,options:MsgReadOptions={}):Promise<string>{
 const raw:unknown=JSON.parse(await runMsgProcess(file,{inputName:'source.rtf',executable:localOcrMcpExecutable(),config:{max_archive_depth:0},args:(input,config)=>['extract',input,'--config',config,'--format','json','--ocr','false','--disable-ocr','true','--no-cache','true','--extract-images','false','--content-format','plain','--chunk','false','--quality','false','--token-reduction','off','--layout','false','--max-threads','2']},options));
 if(!raw||typeof raw!=='object'||!('content' in raw)||typeof raw.content!=='string'||'warnings' in raw&&Array.isArray(raw.warnings)&&raw.warnings.length)throw Error('MSG_RTF_READING_UNCONFIRMED');return raw.content;
}
