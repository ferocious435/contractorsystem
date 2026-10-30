import type { WorkChangeReview } from '@/utils/work-change-review';
import {requestPricingJob,restorePricingJob,cancelPricingJob} from './pricingJobApi';

export type WorkChangeReviewResponse = { success: true; review: WorkChangeReview; cached: boolean; updatedDocumentIds: string[];lastActionState?:string };

export async function requestWorkChangeReview(projectId: string, findingId: string, signal: AbortSignal): Promise<WorkChangeReviewResponse> {
    const payload = await requestPricingJob(projectId,findingId,'work_change',false,signal) as unknown as WorkChangeReviewResponse;
    if (payload.review?.version !== 'work-change-v1' || !Array.isArray(payload.review.facts) || !Array.isArray(payload.review.sources))
        throw new Error('תוצאת הבדיקה לא התקבלה במלואה. אפשר לנסות שוב.');
    return payload as WorkChangeReviewResponse;
}
export const restoreWorkChangeReview=async(projectId:string,findingId:string,signal?:AbortSignal)=>await restorePricingJob(projectId,findingId,'work_change',signal) as WorkChangeReviewResponse|null;
export const cancelWorkChangeReview=(projectId:string,findingId:string)=>cancelPricingJob(projectId,findingId,'work_change');
