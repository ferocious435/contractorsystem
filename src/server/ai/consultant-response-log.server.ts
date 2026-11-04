import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {BusinessAiError,validUuid,type AiTurnInput} from './contracts';
import {getRuntimeDirectory} from './codex-client.server';
import {checkedReadingDirectory} from './visual-reading-cache.server';

/** Keep the exact untrusted answer before factual validation can reject it.
 * This private diagnostic never supplies evidence or a successful job result. */
export async function retainConsultantResponse(
    job:{id:string;ownerId:string;projectId:string;profile:{revision:number}},input:AiTurnInput,response:string,
) {
    if(![job.id,job.ownerId,job.projectId].every(validUuid)||!Number.isSafeInteger(job.profile.revision)||job.profile.revision<1)throw new BusinessAiError('AI_POLICY_UNSAFE');
    const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
    const payload=JSON.stringify({version:'consultant-response-log-v1',at:new Date().toISOString(),jobId:job.id,ownerId:job.ownerId,
        projectId:job.projectId,profileRevision:job.profile.revision,acceptedAsEvidence:false,input,inputHash:digest(JSON.stringify(input)),response,responseHash:digest(response)});
    if(Buffer.byteLength(payload,'utf8')>16*1024*1024)throw new BusinessAiError('AI_RESPONSE_INVALID');
    const root=path.resolve(getRuntimeDirectory()),directory=path.join(root,'jobs',job.id);
    await checkedReadingDirectory(root,directory,true);
    await writeFile(path.join(directory,'consultant-response-'+randomUUID()+'.json'),payload,{flag:'wx',mode:0o600});
}
