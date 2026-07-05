export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = Record<string, unknown>;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type EvidenceData = JsonObject | null;

export interface LedgerItem {
    id: string;
    project_id?: string;
    type?: 'BASE_CONTRACT' | 'APPROVED_VO' | 'PENDING_VO' | 'SENT_VO';
    source?: string;
    item_code: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price_excl_vat: number;
    total_price_excl_vat: number;
    markup_percentage?: number;
    ai_rationale?: string;
    governing_notes?: string[] | JsonValue;
    evidence_data?: EvidenceData;
    confidence_score?: number | null;
    ai_metadata?: JsonObject | null;
    item_type?: 'CHAPTER' | 'SUBCHAPTER' | 'ITEM' | 'NOTE' | string;
    contradiction_id?: string;
    source_execution_doc_id?: string;
    source_execution_doc?: string;
    vat_rate?: number;
    created_at?: string;
    updated_at?: string;
}

export interface QueueItem {
    id: string;
    project_id: string;
    status: string;
    pricing_status: string;
    description?: string;
    source_execution_doc_id?: string;
    target_contract_doc_id?: string;
    source_execution_doc?: { id?: string; title: string; file_url?: string; storage_path?: string };
    target_contract_doc?: { id?: string; title: string; file_url?: string; storage_path?: string };
    evidence_data?: EvidenceData;
    [key: string]: unknown;
}

export interface ContradictionItem extends QueueItem {
    title: string;
    category: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    created_at: string;
    source_doc?: { id?: string; title: string; file_url?: string; storage_path?: string };
    target_doc?: { id?: string; title: string; file_url?: string; storage_path?: string };
}

export interface EstimationData {
    type?: 'BASE_CONTRACT' | 'APPROVED_VO' | 'PENDING_VO' | 'SENT_VO';
    source?: string;
    item_code?: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price_excl_vat: number;
    markup_percentage?: number;
    ai_rationale?: string;
    governing_notes?: string[];
    contradiction_id?: string;
    evidence_data?: EvidenceData;
}

export interface PricingLedgerProps {
    projectId: string;
    initialParams?: Record<string, unknown>;
    onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}
