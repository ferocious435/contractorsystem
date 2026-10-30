import 'server-only';
import {BusinessAiError,type AiJobHandler,type AiJobKind} from '../contracts';
import {letterHandler} from './letter';
import {consultantHandler} from './consultant';
import {radarHandler,scanPreviewHandler} from './radar';
import {pricingHandler,workChangeHandler} from './pricing';
import {supportHandler} from './support';
import {documentHandler} from './document';
const allowed=new Set(['letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis']);
const handlers=new Map<AiJobKind,AiJobHandler>();
handlers.set('letter',letterHandler);
handlers.set('consultant',consultantHandler);
handlers.set('scan',radarHandler);
handlers.set('scan_preview',scanPreviewHandler);
handlers.set('pricing',pricingHandler);
handlers.set('work_change',workChangeHandler);
handlers.set('support_enrichment',supportHandler);
handlers.set('document_analysis',documentHandler);
export function registerAiHandler(kind:AiJobKind,handler:AiJobHandler):void {
    if(!allowed.has(kind)||typeof handler?.validate!=='function'||typeof handler?.execute!=='function')throw new BusinessAiError('AI_HANDLER_INVALID');
    if(handlers.has(kind)&&handlers.get(kind)!==handler)throw new BusinessAiError('AI_HANDLER_CONFLICT');handlers.set(kind,handler);
}
export function getAiHandler(kind:AiJobKind):AiJobHandler|null{return handlers.get(kind)??null;}
export function registeredAiKinds():AiJobKind[]{return [...handlers.keys()];}
