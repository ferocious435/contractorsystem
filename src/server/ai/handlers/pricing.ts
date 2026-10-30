import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createAdminClient} from '@/utils/supabase/admin';
import {AiEstimatorService} from '@/app/api/pricing/evaluate-ai/ai-estimator-service';
import {reviewWorkChangeCase} from '@/utils/work-change-review-server';
import type {WorkChangeCacheStore} from '@/utils/work-change-cache-server';
import {BusinessAiError,record,validUuid,type AiJobHandler,type JsonObject} from '../contracts';
import {createProjectEffectClient} from '../project-effects.server';
type Options={database?:()=>SupabaseClient;cache?:WorkChangeCacheStore};
function checked(raw:unknown,workChange:boolean):JsonObject{
    if(!record(raw)||Object.keys(raw).some(key=>!['contradictionId',...(workChange?[]:['expertMode'])].includes(key))||!validUuid(raw.contradictionId)||raw.expertMode!==undefined&&typeof raw.expertMode!=='boolean')throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
    return {contradictionId:raw.contradictionId,...(workChange?{}:{expertMode:raw.expertMode===true})};
}
export function createPricingHandler({database=createAdminClient}:Options={}):AiJobHandler{return {
    validate:raw=>checked(raw,false),
    async execute(payload,execution){const transaction=await createProjectEffectClient(database(),execution);
        const result=await new AiEstimatorService(transaction.client).evaluate({contradictionId:String(payload.contradictionId),projectId:execution.projectId,contractorId:execution.ownerId,expertMode:payload.expertMode===true,execution});
        return {result:result as unknown as JsonObject,effects:await transaction.effects()};}
};}
export function createWorkChangeHandler({database=createAdminClient,cache}:Options={}):AiJobHandler{return {
    validate:raw=>checked(raw,true),
    async execute(payload,execution){const transaction=await createProjectEffectClient(database(),execution);
        const result=await reviewWorkChangeCase({supabase:transaction.client,projectId:execution.projectId,findingId:String(payload.contradictionId),refreshReading:true,signal:execution.signal,execution,cache});
        return {result:{success:true,...result} as unknown as JsonObject,effects:await transaction.effects()};}
};}
export const pricingHandler=createPricingHandler();
export const workChangeHandler=createWorkChangeHandler();
