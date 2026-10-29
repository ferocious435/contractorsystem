import type { LetterDraftSnapshot, MarkLetterSentRequest, SavedLetterResult, SaveLetterDraftRequest } from '@/utils/letter-draft-types';
import { stableLetterValue } from '@/utils/letter-snapshot';
import type { LetterPrintContext } from './letterPrintContext';

type DraftInput = Omit<SaveLetterDraftRequest, 'clientDraftId' | 'expectedRevision' | 'operationId'>;
export type LetterSaveAttempt = { epoch: number; request: SaveLetterDraftRequest };
export type LetterSentAttempt = { epoch: number; request: MarkLetterSentRequest };
export interface LetterDraftSessionState {
    projectId: string; clientDraftId: string; letterId: string | null; revision: number;
    status: 'DRAFT' | 'SENT'; isLegacy: boolean; snapshot: LetterDraftSnapshot | null;
    sourceRevisions: Record<string, string>; docType: string; savedSignature: string | null;
    operationId: string | null;
    operationKind: 'save' | 'sent' | null;
}
export function letterDraftSignature(input: Pick<DraftInput, 'projectId' | 'docType' | 'itemIds' | 'subject' | 'recipientName' | 'content'>): string {
    return stableLetterValue([input.projectId, input.docType, input.itemIds, input.subject, input.recipientName, input.content]);
}
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
    return value;
}

/** In-memory request identity for one editor. It does not store letters or send them. */
export class LetterDraftSession {
    private epoch = 0;
    private current: LetterDraftSessionState;
    private pendingSave: LetterSaveAttempt | null = null;
    private pendingSent: LetterSentAttempt | null = null;
    constructor(projectId: string) { this.current = this.initial(projectId); }
    private initial(projectId: string): LetterDraftSessionState {
        return { projectId, clientDraftId: crypto.randomUUID(), letterId: null, revision: 0, status: 'DRAFT', isLegacy: false,
            snapshot: null, sourceRevisions: {}, docType: 'general', savedSignature: null, operationId: null, operationKind: null };
    }
    get state(): LetterDraftSessionState { return { ...this.current }; }
    reset(projectId: string): void {
        ++this.epoch; this.current = this.initial(projectId); this.pendingSave = null; this.pendingSent = null;
    }
    open(projectId: string, context: LetterPrintContext): void {
        if (context.projectId !== projectId) throw new Error('DRAFT_PROJECT_CHANGED');
        this.reset(projectId);
        this.current = { ...this.current, letterId: context.letterId, clientDraftId: context.clientDraftId || this.current.clientDraftId,
            revision: context.revision || 0, status: context.status === 'SENT' ? 'SENT' : 'DRAFT', isLegacy: context.mode === 'legacy',
            snapshot: context.snapshot, sourceRevisions: context.sourceRevisions, docType: context.docType || 'general',
            savedSignature: letterDraftSignature({ projectId, docType: context.docType || 'general',
                itemIds: context.snapshot?.items.map(item => item.ledgerItemId) || [], subject: context.subject,
                recipientName: context.recipientName, content: context.content }) };
    }
    saveAttempt(input: DraftInput): LetterSaveAttempt {
        if (input.projectId !== this.current.projectId) throw new Error('DRAFT_PROJECT_CHANGED');
        if (this.pendingSent || this.current.status === 'SENT' || this.current.isLegacy || (this.current.letterId && !this.current.snapshot)) {
            throw new Error('SENT or historical letter is read only');
        }
        if (this.pendingSave) return this.pendingSave;
        const request = freeze(structuredClone({ ...input, clientDraftId: this.current.clientDraftId,
            expectedRevision: this.current.revision, operationId: crypto.randomUUID() }));
        this.pendingSave = { epoch: this.epoch, request }; this.current.operationId = request.operationId; this.current.operationKind = 'save';
        return this.pendingSave;
    }
    saved(attempt: LetterSaveAttempt, result: SavedLetterResult): boolean {
        if (attempt.epoch !== this.epoch || attempt.request.operationId !== this.pendingSave?.request.operationId
            || result.clientDraftId !== this.current.clientDraftId || result.status !== 'DRAFT'
            || result.revision !== attempt.request.expectedRevision + 1
            || (this.current.letterId && result.letterId !== this.current.letterId)) return false;
        this.current = { ...this.current, letterId: result.letterId, revision: result.revision, status: result.status,
            snapshot: result.snapshot, sourceRevisions: attempt.request.sourceRevisions, docType: attempt.request.docType,
            savedSignature: letterDraftSignature(attempt.request), operationId: null, operationKind: null };
        this.pendingSave = null; return true;
    }
    rejectedSave(attempt: LetterSaveAttempt): void {
        if (attempt.epoch === this.epoch && attempt.request.operationId === this.pendingSave?.request.operationId) {
            this.pendingSave = null; this.current.operationId = null; this.current.operationKind = null;
        }
    }
    sentAttempt(): LetterSentAttempt {
        if (this.pendingSent) return this.pendingSent;
        if (this.pendingSave || !this.current.letterId || !this.current.snapshot || this.current.isLegacy || this.current.status !== 'DRAFT') {
            throw new Error('Save and review the DRAFT before marking sent');
        }
        this.pendingSent = { epoch: this.epoch, request: freeze({ projectId: this.current.projectId, letterId: this.current.letterId,
            expectedRevision: this.current.revision, operationId: crypto.randomUUID() }) };
        this.current.operationId = this.pendingSent.request.operationId; this.current.operationKind = 'sent'; return this.pendingSent;
    }
    markedSent(attempt: LetterSentAttempt, result: SavedLetterResult): boolean {
        if (attempt.epoch !== this.epoch || attempt.request.operationId !== this.pendingSent?.request.operationId
            || result.letterId !== this.current.letterId || result.clientDraftId !== this.current.clientDraftId
            || result.revision !== attempt.request.expectedRevision + 1 || result.status !== 'SENT'
            || stableLetterValue(result.snapshot) !== stableLetterValue(this.current.snapshot)) return false;
        this.current = { ...this.current, revision: result.revision, status: 'SENT', operationId: null, operationKind: null };
        this.pendingSent = null; return true;
    }
    rejectedSent(attempt: LetterSentAttempt): void {
        if (attempt.epoch === this.epoch && attempt.request.operationId === this.pendingSent?.request.operationId) {
            this.pendingSent = null; this.current.operationId = null; this.current.operationKind = null;
        }
    }
}
