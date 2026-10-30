import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createAdminClient} from '@/utils/supabase/admin';
import {enrichProjectFindingsWithSupportSources} from '@/utils/support-source-enrichment-server';
import {BusinessAiError,record,type AiJobHandler,type JsonObject} from '../contracts';
import {createProjectEffectClient} from '../project-effects.server';
export function createSupportHandler({database=createAdminClient}:{database?:()=>SupabaseClient}={}):AiJobHandler{return {
    validate(raw){if(!record(raw)||Object.keys(raw).length)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return {};},
    async execute(_payload,execution){const transaction=await createProjectEffectClient(database(),execution);
        const result=await enrichProjectFindingsWithSupportSources({supabase:transaction.client,projectId:execution.projectId,execution});
        return {result:{success:result.failed===0,partial:result.failed>0,...result} as unknown as JsonObject,effects:await transaction.effects()};}
};}
export const supportHandler=createSupportHandler();
