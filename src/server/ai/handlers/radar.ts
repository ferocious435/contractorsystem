import 'server-only';
import {createAdminClient} from '@/utils/supabase/admin';
import {BusinessAiError,record,validUuid,type AiJobHandler,type JsonObject} from '../contracts';
import {runRadarScan} from '../radar-service.server';
import {runRadarPreview} from '../radar-preview.server';
export const radarHandler:AiJobHandler={
    validate(raw){if(!record(raw)||Object.keys(raw).some(key=>!['force','background','batchCursor','retrySkipped','workDocId','retryDocumentId'].includes(key))
        ||['force','background','retrySkipped'].some(key=>raw[key]!==undefined&&typeof raw[key]!=='boolean')
        ||['workDocId','retryDocumentId'].some(key=>raw[key]!=null&&!validUuid(raw[key]))
        ||raw.workDocId&&raw.retryDocumentId&&raw.workDocId!==raw.retryDocumentId
        ||raw.batchCursor!==undefined&&(!Number.isSafeInteger(raw.batchCursor)||Number(raw.batchCursor)<0))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        return {workDocId:raw.workDocId||raw.retryDocumentId||null,retrySkipped:raw.retrySkipped===true} as JsonObject;},
    execute(payload,execution){return runRadarScan(createAdminClient(),payload,execution);},
};
export const scanPreviewHandler:AiJobHandler={
    validate(raw){if(!record(raw)||Object.keys(raw).some(key=>!['findingId','findingRef'].includes(key))||!validUuid(raw.findingId)||typeof raw.findingRef!=='string'||!/^C-[A-F0-9]{6,32}$/iu.test(raw.findingRef)||!raw.findingId.replaceAll('-','').toUpperCase().startsWith(raw.findingRef.slice(2).toUpperCase()))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return {findingId:raw.findingId,findingRef:raw.findingRef.toUpperCase()};},
    execute(payload,execution){return runRadarPreview(createAdminClient(),payload,execution);},
};
