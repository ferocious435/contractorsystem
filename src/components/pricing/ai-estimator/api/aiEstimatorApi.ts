import type {
    AIPricingEvaluationResponse,
    AiEstimatorSourceDocument,
    AiEstimatorSourceDocumentQuery,
    EvaluateAiPricingInput,
} from '../types';
import {requestPricingJob,restorePricingJob,cancelPricingJob} from '../../pricingJobApi';

interface SupabaseDocumentQuery {
    eq(column: string, value: string): SupabaseDocumentQuery;
    single(): Promise<{ data: AiEstimatorSourceDocument | null; error: Error | null }>;
}

interface SupabaseDocumentsClient {
    from(table: string): {
        select(columns: string): SupabaseDocumentQuery;
    };
}

const AI_ESTIMATOR_SOURCE_DOCUMENT_SELECT_COLUMNS = [
    'id',
    'project_id',
    'title',
    'category',
    'file_url',
    'ai_status',
    'ocr_status',
    'extracted_text_hash',
    'extracted_text',
    'parsed_json',
    'created_at',
].join(', ');

export async function evaluateAiPricing({
    contradictionId,
    projectId,
    expertMode,
    signal,
}: EvaluateAiPricingInput): Promise<AIPricingEvaluationResponse> {
    return await requestPricingJob(projectId,contradictionId,'pricing',expertMode,signal) as unknown as AIPricingEvaluationResponse;
}
export const restoreAiPricing=async(projectId:string,findingId:string,signal?:AbortSignal)=>await restorePricingJob(projectId,findingId,'pricing',signal) as AIPricingEvaluationResponse|null;
export const cancelAiPricing=(projectId:string,findingId:string)=>cancelPricingJob(projectId,findingId,'pricing');

export async function fetchAiEstimatorSourceDocument(
    supabase: SupabaseDocumentsClient,
    { documentId, documentTitle, projectId }: AiEstimatorSourceDocumentQuery,
) {
    let query = supabase.from('documents').select(AI_ESTIMATOR_SOURCE_DOCUMENT_SELECT_COLUMNS);

    if (documentId) {
        query = query.eq('id', documentId);
    } else if (documentTitle && projectId) {
        query = query.eq('title', documentTitle).eq('project_id', projectId);
    } else {
        return null;
    }

    const { data, error } = await query.single();

    if (error || !data) {
        throw error || new Error('Document not found');
    }

    return data;
}
