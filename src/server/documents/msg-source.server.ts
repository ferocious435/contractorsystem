import 'server-only';
import type {MsgExtraction,MsgNativeResult,MsgReadOptions} from '@/utils/msg-source-types';
import {readMsgContainer} from './msg-container.server';import {extractMsgNative} from './msg-native.server';
export function createMsgSourceExtractor(deps:{container:typeof readMsgContainer;native:typeof extractMsgNative}) {
    return async(file:Buffer,options:MsgReadOptions={}):Promise<MsgExtraction>=>{
        options.signal?.throwIfAborted();const result=await deps.container(file,options);
        for(const part of result.parts){
            if(part.kind!=='MESSAGE')continue;const payload=result.payloads.get(part.id);if(!payload||!part.body)continue;
            try{const native:MsgNativeResult=await deps.native(payload,options);part.headers=native.headers;part.issues.push(...native.issues);}
            catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;part.issues.push('MSG_NATIVE_EXTRACTION_FAILED');}
        }
        result.issues=[...new Set([...result.issues,...result.parts.flatMap(p=>p.issues)])];return result;
    };
}
export const extractMsgSource=createMsgSourceExtractor({container:readMsgContainer,native:extractMsgNative});
