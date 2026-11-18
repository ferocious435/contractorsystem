import {record} from '@/server/ai/contracts';
import {consultantBoqRowKey,savedConsultantBoqRows} from '@/utils/consultant-result';
import type {ConsultantBoqRow} from '@/utils/consultant-boq';
import type {BoqEditionComparison} from '@/utils/consultant-boq-editions';

export type BoqComparisons = Record<string, BoqEditionComparison | null>;
export interface ConversationBoqComparisons {available:boolean; jobs:Record<string,BoqComparisons>}

/** One abortable read per restored job set. It never gates the saved answer. */
export async function readBoqComparisons(projectId:string,conversationId:string,signal:AbortSignal):Promise<ConversationBoqComparisons> {
    const response=await fetch(`/api/chat/boq-revisions?${new URLSearchParams({projectId,conversationId})}`,{signal,cache:'no-store'});
    if(!response.ok)throw new Error('Comparison unavailable');
    const data:unknown=await response.json();
    if(!record(data)||data.success!==true||!['AVAILABLE','UNAVAILABLE'].includes(String(data.availability))||!Array.isArray(data.jobs))throw new Error('Invalid comparison');
    const jobs:Record<string,BoqComparisons>={};
    for(const job of data.jobs){
        if(!record(job)||typeof job.jobId!=='string'||!Array.isArray(job.rows))continue;
        const rows:BoqComparisons={};
        for(const value of job.rows){
            if(!record(value)||typeof value.rowKey!=='string')continue;
            const original=savedConsultantBoqRows({boqRows:[value.originalRow]})[0];
            if(!original||consultantBoqRowKey(original)!==value.rowKey)continue;
            const comparison=value.comparison;
            if(record(comparison)&&['REPLACED','UNKNOWN','CONFLICT'].includes(String(comparison.status))
                &&savedConsultantBoqRows({boqRows:[comparison.currentRow]}).length
                &&savedConsultantBoqRows({boqRows:[comparison.originalRow]}).length
                &&consultantBoqRowKey(comparison.originalRow as ConsultantBoqRow)===value.rowKey
                &&typeof comparison.description==='string'&&(comparison.reason===null||typeof comparison.reason==='string')
                &&Array.isArray(comparison.warnings)&&comparison.warnings.every(w=>typeof w==='string')
                &&Array.isArray(comparison.editionHistory)&&comparison.editionHistory.every(h=>record(h)&&record(h.evidence)&&typeof h.evidence.quote==='string')){
                rows[value.rowKey]=comparison as BoqEditionComparison;
            } else rows[value.rowKey]=null;
        }
        jobs[job.jobId]=rows;
    }
    return {available:data.availability==='AVAILABLE',jobs};
}

export function boqSourceUrl(projectId:string,row:ConsultantBoqRow):string|null {
    if(!row.sourceHash||!/^[a-f\d]{64}$/iu.test(row.sourceHash)||row.page===null)return null;
    return `/api/documents/file?${new URLSearchParams({projectId,documentId:row.documentId,sourceHash:row.sourceHash})}`;
}

export async function readBoqPdf(projectId:string,row:ConsultantBoqRow,signal:AbortSignal):Promise<Blob> {
    const url=boqSourceUrl(projectId,row);
    if(!url)throw new Error('Saved source unavailable');
    const response=await fetch(url,{signal,cache:'no-store'});
    if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf'))throw new Error('Original PDF unavailable');
    return response.blob();
}
