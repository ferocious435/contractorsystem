import 'server-only';
import {BusinessAiError,type AiJobHandler,type AiJobKind} from '../contracts';
const allowed=new Set(['letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis']);
const handlers=new Map<AiJobKind,AiJobHandler>();
export function registerAiHandler(kind:AiJobKind,handler:AiJobHandler):void {
    if(!allowed.has(kind)||typeof handler?.validate!=='function'||typeof handler?.execute!=='function')throw new BusinessAiError('AI_HANDLER_INVALID');
    if(handlers.has(kind)&&handlers.get(kind)!==handler)throw new BusinessAiError('AI_HANDLER_CONFLICT');handlers.set(kind,handler);
}
export function getAiHandler(kind:AiJobKind):AiJobHandler|null{return handlers.get(kind)??null;}
export function registeredAiKinds():AiJobKind[]{return [...handlers.keys()];}
