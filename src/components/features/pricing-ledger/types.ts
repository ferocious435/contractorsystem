export type PricingLedgerRowType = 'BASE_CONTRACT' | 'APPROVED_VO' | 'PENDING_VO' | 'SENT_VO';

export type EditablePricingLedgerRowType = Extract<PricingLedgerRowType, 'APPROVED_VO' | 'PENDING_VO'>;

export type PricingLedgerStatusUpdate = Exclude<PricingLedgerRowType, 'BASE_CONTRACT'>;

export type PricingLedgerSource = 'BOQ' | 'DEKEL' | 'CONTRACTOR' | 'CUSTOM_ANALYSIS';

export type PricingLedgerItemType = 'ITEM' | 'CHAPTER' | 'SUBCHAPTER' | 'NOTE';

export type PricingLedgerActiveTab = 'queue' | 'ledger';

export type PricingQueueStatus = 'PENDING' | 'PRICED' | 'MOVED_TO_PRICING' | string;

export type ContradictionSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export type AiConfidenceScore = number;

export interface PricingAiContradictionMetadata {
    confidence_score?: AiConfidenceScore | null;
    confidence_reason?: string | null;
    match_quality?: string | null;
    comparison_type?: string | null;
    evidence_status?: string | null;
    source?: string | null;
    linked_ids?: string[];
    missing_evidence?: string[];
    [key: string]: unknown;
}

export interface EvidenceDocumentRef {
    title: string;
    file_url?: string;
}

export interface PricingLedgerItem {
    id: string;
    project_id: string;
    type: PricingLedgerRowType;
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
    expert_strategy?: Record<string, unknown> | null;
    evidence_data?: unknown;
    confidence_score?: AiConfidenceScore | null;
    ai_metadata?: PricingAiContradictionMetadata | null;
    contradiction_id?: string;
    source_execution_doc_id?: string;
    source_execution_doc?: string;
    item_type?: PricingLedgerItemType | string;
    vat_rate: number;
    created_at?: string;
    updated_at?: string;
}

export interface PricingQueueItem {
    id: string;
    project_id: string;
    status: string;
    pricing_status: PricingQueueStatus;
    description?: string;
    source_execution_doc_id?: string;
    target_contract_doc_id?: string;
    source_execution_doc?: EvidenceDocumentRef;
    target_contract_doc?: EvidenceDocumentRef;
    evidence_data?: Record<string, unknown> | unknown[] | null;
    confidence_score?: AiConfidenceScore | null;
    ai_metadata?: PricingAiContradictionMetadata | null;
    [key: string]: unknown;
}

export interface PricingContradictionItem extends PricingQueueItem {
    title: string;
    category: string;
    severity: ContradictionSeverity;
    created_at: string;
    source_doc?: EvidenceDocumentRef;
    target_doc?: EvidenceDocumentRef;
}

export interface PricingEstimationData {
    type?: PricingLedgerRowType;
    source?: PricingLedgerSource | string;
    item_code?: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price_excl_vat: number;
    markup_percentage?: number;
    ai_rationale?: string;
    governing_notes?: string[];
    contradiction_id?: string;
    evidence_data?: Record<string, unknown> | unknown[] | null;
}

export interface ApprovePricingEstimationPayload extends PricingEstimationData {
    contradiction_id?: string;
    ai_rationale?: string;
    governing_notes?: string[];
    expert_strategy?: Record<string, unknown> | null;
    evidence_data?: Record<string, unknown> | unknown[] | null;
}

export interface SavePricingLedgerPayload extends Partial<ApprovePricingEstimationPayload> {
    project_id: string;
    item_id?: string;
    queue_id?: string;
    item_name?: string;
    ai_explanation?: string;
    user_notes?: string;
    vat_rate?: number;
}

export interface DeletePricingLedgerPayload {
    project_id: string;
    item_id: string;
}

export interface UpdatePricingLedgerStatusPayload {
    itemId: string;
    status: PricingLedgerStatusUpdate;
}

export interface ArchivePricingQueueResult {
    success: boolean;
    archivedIds: string[];
    skippedIds: string[];
    error?: string;
}

export interface PricingLedgerApiResult<TItem = PricingLedgerItem> {
    success: boolean;
    item?: TItem;
    error?: string;
}

export interface FetchLedgerRowsResult {
    rows: PricingLedgerItem[];
    projectBudget: number;
}

export interface ProjectContractBaseSyncPayload {
    projectIds: string[];
}

export interface ProjectContractBaseLedgerSyncSummary {
    eligiblePricelists: number;
    candidateItems: number;
    inserted: number;
    updated: number;
    skipped: number;
}

export interface SyncedProjectContractBase {
    projectId: string;
    amount: number | null;
    sourceTitle: string | null;
    strategy: string;
    ledgerSync?: ProjectContractBaseLedgerSyncSummary;
}

export interface ProjectContractBaseSyncResult {
    results: SyncedProjectContractBase[];
}

export interface SyncBoqAndContractResult {
    syncedContractBase: SyncedProjectContractBase | null;
}

export interface PricingLedgerProps {
    projectId: string;
    initialParams?: Record<string, unknown>;
    onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}

export interface PricingLedgerTotals {
    totalBaseExclVat: number;
    totalVOExclVat: number;
    grandTotalExclVat: number;
    grandTotalVat: number;
    grandTotalInclVat: number;
}

export interface PricingLedgerState {
    ledgerRows: PricingLedgerItem[];
    pendingQueue: PricingContradictionItem[];
    selectedContradiction: PricingContradictionItem | null;
    newItemForm: PricingEstimationData;
    editForm: Partial<PricingLedgerItem>;
    selectedLedgerIds: string[];
    selectedQueueIds: string[];
    scanningItems: string[];
    loading: boolean;
    isLoading: boolean;
    isSyncing: boolean;
    error: string | null;
    activeTab: PricingLedgerActiveTab;
    isAddingNew: boolean;
    isEditing: string | null;
    isGeneratingLetter: boolean;
    isFocusedPricingDismissed: boolean;
    projectBudget: number;
}

export interface PricingLedgerDerivedState {
    visibleLedgerRows: PricingLedgerItem[];
    selectedVOIds: string[];
    focusedQueueItem: PricingContradictionItem | null;
    queueConfidenceScoreById: Map<string, number | null>;
    queueConfidencePercentById: Map<string, string | null>;
    highConfidenceQueueIds: string[];
    selectedHighConfidenceQueueIds: string[];
    queueConfidenceStats: {
        averageScore: number | null;
        highConfidenceCount: number;
        totalWithConfidence: number;
    };
}

export interface BulkApprovePreviewResult {
    success?: boolean;
    superseded?: boolean;
    /**
     * Preferred semantic ids staged in the UI after server-side confidence preview.
     * These are not ledger mutations and must not be treated as persisted approvals.
     */
    stagedIds?: string[];
    /**
     * Legacy wire alias kept for backward compatibility with existing server responses.
     * Treat these as staged preview ids, not persisted approvals.
     */
    approvedIds: string[];
    skippedIds: string[];
    threshold: number;
    error?: string;
}
