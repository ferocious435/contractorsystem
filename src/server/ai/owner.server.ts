import 'server-only';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BusinessAiError,record,validUuid} from './contracts';

/** Same trusted ownership source as open-workspace; no role is accepted from browser metadata. */
export async function resolveRuntimeOwner(admin:SupabaseClient):Promise<string> {
    const result=await admin.from('profiles').select('id').eq('role','super_admin').limit(2);
    if(result.error||!Array.isArray(result.data)||result.data.length!==1||!validUuid(result.data[0]?.id)) throw new BusinessAiError('AI_OWNER_UNAVAILABLE');
    return result.data[0].id;
}
/** Keep account identity out of persisted model preferences and model inputs. */
export function accountFingerprint(account:unknown):string {
    if(!record(account)||account.type!=='chatgpt') throw new BusinessAiError('AI_LOGIN_REQUIRED');
    const identity=typeof account.id==='string'&&account.id.trim()?account.id.trim()
        :typeof account.email==='string'&&account.email.trim()?account.email.trim().toLowerCase():null;
    if(!identity) throw new BusinessAiError('AI_LOGIN_REQUIRED');
    return createHash('sha256').update('contractorsystem:chatgpt:'+identity).digest('hex');
}
