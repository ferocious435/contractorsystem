import type {
    AIPricingEvaluationResponse,
    AiEstimatorSourceDocument,
    AiEstimatorSourceDocumentQuery,
    EvaluateAiPricingInput,
} from '../types';

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
    'created_at',
].join(', ');

export async function evaluateAiPricing({
    contradictionId,
    projectId,
    expertMode,
}: EvaluateAiPricingInput): Promise<AIPricingEvaluationResponse> {
    const response = await fetch('/api/pricing/evaluate-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contradictionId,
            projectId,
            expertMode,
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error || 'AI pricing evaluation failed');
    }

    return data as AIPricingEvaluationResponse;
}

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
