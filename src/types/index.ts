export interface LedgerItem {
    id: string;
    project_id: string;
    type: 'BASE_CONTRACT' | 'APPROVED_VO' | 'PENDING_VO' | 'SENT_VO';
    source: string;
    item_code: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price_excl_vat: number;
    total_price_excl_vat: number;
    markup_percentage: number;
    ai_rationale?: string;
    governing_notes?: string[];
    contradiction_id?: string;
    source_execution_doc_id?: string;
    source_execution_doc?: string;
    vat_rate: number;
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
    source_execution_doc?: { title: string; file_url?: string };
    target_contract_doc?: { title: string; file_url?: string };
    evidence_data?: any;
    [key: string]: any; 
}

export interface ContradictionItem extends QueueItem {
    title: string;
    category: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    created_at: string;
    source_doc?: { title: string; file_url?: string };
    target_doc?: { title: string; file_url?: string };
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
}

export interface PricingLedgerProps {
    projectId: string;
    initialParams?: Record<string, any>;
    onNavigate?: (view: string, params?: Record<string, any>) => void;
}
