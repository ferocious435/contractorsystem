import type { LetterFinancialItem, LetterFinancialSnapshot } from './letter-financials';

export interface LetterSourceRef {
    documentId: string | null;
    title: string | null;
    pageLabel: string | null;
    quote: string | null;
    basis: 'DOCUMENT' | 'MANUAL';
    status: 'VERIFIED' | 'REQUIRES_VERIFICATION';
    manualNote: string | null;
}
export interface LetterDraftItem extends LetterFinancialItem {
    sources: LetterSourceRef[];
    description: string | null;
    itemCode: string | null;
    unit: string | null;
}
export interface LetterDraftSnapshot extends Omit<LetterFinancialSnapshot, 'items'> {
    items: LetterDraftItem[];
}
export interface LetterDraftPreview {
    snapshot: LetterDraftSnapshot;
    sourceRevisions: Record<string, string>;
}
export interface SavedLetterResult {
    letterId: string;
    status: 'DRAFT' | 'SENT';
    revision: number;
    clientDraftId: string;
    snapshot: LetterDraftSnapshot;
    sentMarkedAt: string | null;
}
export interface PreviewLetterRequest {
    projectId: string;
    docType: string;
    itemIds: string[];
}
export interface SaveLetterDraftRequest extends PreviewLetterRequest {
    clientDraftId: string;
    expectedRevision: number;
    operationId: string;
    subject: string;
    recipientName: string;
    content: string;
    sourceRevisions: Record<string, string>;
}
export interface MarkLetterSentRequest {
    projectId: string;
    letterId: string;
    expectedRevision: number;
    operationId: string;
}
