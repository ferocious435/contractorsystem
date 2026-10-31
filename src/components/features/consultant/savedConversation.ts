import {record,validUuid,type JobDto} from '@/server/ai/contracts';
import type {Message} from '../AIConsultant';
import {consultantDisplay} from '@/utils/consultant-result';

export function latestSavedConversation(jobs:JobDto[],projectId:string):string|null{
    const latest=jobs.find(job=>job.projectId===projectId&&job.kind==='consultant'&&['SUCCEEDED','QUEUED','RUNNING'].includes(job.state)&&validUuid(job.conversationId)&&job.clientContextId===job.conversationId);
    return latest?.conversationId??null;
}

export function savedConversation(jobs:JobDto[],projectId:string,conversationId:string):Message[] {
    const seen=new Set<string>();
    return jobs.filter(job=>job.projectId===projectId&&job.kind==='consultant'&&job.conversationId===conversationId&&job.clientContextId===conversationId&&job.state==='SUCCEEDED')
        .reverse().flatMap(job=>{
            if(seen.has(job.id)||!record(job.result)||typeof job.result.question!=='string'||typeof job.result.response!=='string'||typeof job.result.answeredAt!=='string'||!Number.isFinite(Date.parse(job.result.answeredAt)))return [];
            seen.add(job.id);const timestamp=new Date(job.result.answeredAt);
            return [{role:'user' as const,content:job.result.question,timestamp},{role:'assistant' as const,...consultantDisplay(job.result),timestamp}];
        });
}
