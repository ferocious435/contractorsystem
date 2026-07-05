import type { ContradictionItem } from '@/types';
import type { ApprovePricingEstimationPayload } from '@/components/features/pricing-ledger';

export interface AIEstimatorModalProps {
    contradiction: ContradictionItem;
    onClose: () => void;
    onApprove: (data: ApprovePricingEstimationPayload) => Promise<void>;
}

export interface AIEstimatorFormState {
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    markup: number;
    source: string;
}

export interface AIPricingMatchedItem extends Record<string, unknown> {
    description?: string;
    item_code?: string;
    pricelists?: { name?: string };
    source?: string;
}

export interface AIPricingMatchedItems extends Record<string, unknown> {
    contract?: AIPricingMatchedItem[];
    pricelist?: AIPricingMatchedItem[];
}

export interface AIPricingEvidenceReference extends Record<string, unknown> {
    document_id?: string;
    document_title?: string;
    page?: number | string | null;
    quote?: string;
    reference?: string;
}

export type AIPricingGoverningNote = string | Record<string, unknown>;

export interface AIPricingExpertStrategy extends Record<string, unknown> {
    contractual_diagnostic?: { argument_for_supervisor?: string; legal_basis?: string };
    operational_instructions?: { site_diary_draft?: string };
    professional_argument?: string;
    ripple_effect?: { technical_analysis?: string };
    site_diary_instruction?: string;
    technical_foundation?: string;
}

export interface AiEstimatorSourceDocument extends Record<string, unknown> {
    ai_status?: string | null;
    category?: string | null;
    created_at?: string | null;
    extracted_text_hash?: string | null;
    file_url?: string | null;
    id: string;
    ocr_status?: string | null;
    project_id?: string | null;
    title?: string | null;
}

export interface AIPricingEvaluationResponse {
    success?: boolean;
    item_code?: string;
    suggested_description?: string;
    suggested_unit?: string;
    suggested_quantity?: number;
    suggested_unit_price_excl_vat?: number;
    source?: string;
    confidence?: unknown;
    confidence_score?: unknown;
    match_found?: boolean;
    match_quality?: string;
    quantity_basis?: string | null;
    quantity_review_required?: boolean;
    ancillary_scope?: unknown;
    source_trace?: unknown;
    source_basis?: string[];
    pricing_breakdown?: Array<{
        item_code?: string;
        source?: string;
        source_name?: string;
        description?: string;
        unit?: string;
        quantity?: number;
        unit_price_excl_vat?: number;
        amount_excl_vat?: number;
        basis?: string;
        is_inference?: boolean;
    }>;
    matched_items?: AIPricingMatchedItems | null;
    needed_documents?: string[];
    questions?: string[];
    requires_user_answer_before_approval?: boolean;
    ancillary_notes?: string[];
    zero_match_reason?: string | null;
    governing_notes?: AIPricingGoverningNote[];
    ai_rationale?: string;
    expert_strategy?: AIPricingExpertStrategy | null;
    [key: string]: unknown;
}

export interface EvaluateAiPricingInput {
    contradictionId: string;
    projectId: string;
    expertMode: boolean;
}

export interface AiEstimatorSourceDocumentQuery {
    documentId?: string;
    documentTitle?: string;
    projectId?: string;
}
