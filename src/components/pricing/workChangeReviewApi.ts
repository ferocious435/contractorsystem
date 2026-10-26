import type { WorkChangeReview } from '@/utils/work-change-review';

export type WorkChangeReviewResponse = { success: true; review: WorkChangeReview; cached: boolean; updatedDocumentIds: string[] };

export async function requestWorkChangeReview(projectId: string, findingId: string, signal: AbortSignal): Promise<WorkChangeReviewResponse> {
    const response = await fetch('/api/pricing/evaluate-ai', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, contradictionId: findingId, reviewCaseOnly: true }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(typeof payload?.error === 'string' ? payload.error : 'לא ניתן להשלים את בדיקת המקורות כרגע.');
    if (payload.review?.version !== 'work-change-v1' || !Array.isArray(payload.review.facts) || !Array.isArray(payload.review.sources))
        throw new Error('תוצאת הבדיקה לא התקבלה במלואה. אפשר לנסות שוב.');
    return payload as WorkChangeReviewResponse;
}
