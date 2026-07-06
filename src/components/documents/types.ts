export type DocumentCategory = 'CONTRACT' | 'EXECUTION' | 'PRICELIST';

export interface ParsedFinancialItem extends Record<string, unknown> {
    code?: string | null;
    description?: string | null;
    quantity?: number | string | null;
    unit?: string | null;
    total_price?: number | string | null;
}

export interface ParsedFinancialData extends Record<string, unknown> {
    total_amount?: number | string | null;
    items?: ParsedFinancialItem[];
}

export interface ParsedSystemError extends Record<string, unknown> {
    code?: string | null;
    message?: string | null;
    technical_message?: string | null;
}

export interface ParsedDocumentJson extends Record<string, unknown> {
    analysis_source?: string | null;
    analysis_status?: string | null;
    category?: DocumentCategory | string | null;
    confidence?: number | string | null;
    confidence_score?: number | string | null;
    date?: string | null;
    document_confidence?: number | string | null;
    document_type?: string | null;
    financial_data?: ParsedFinancialData | null;
    summary?: string | null;
    system_error?: string | null;
    system_errors?: ParsedSystemError[];
    type?: string | null;
    warnings?: string[];
}

export interface ProjectDocument extends Record<string, unknown> {
    id: string;
    ai_status?: string | null;
    category?: DocumentCategory | string | null;
    created_at?: string | null;
    extracted_text?: string | null;
    extracted_text_hash?: string | null;
    file_url?: string | null;
    ocr_status?: string | null;
    parsed_json?: ParsedDocumentJson | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
    title?: string | null;
}
