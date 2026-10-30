import type { LetterDraftSnapshot, MarkLetterSentRequest, SavedLetterResult, SaveLetterDraftRequest } from '@/utils/letter-draft-types';
import { stableLetterValue, isRecord, isLetterDraftSnapshot } from '@/utils/letter-snapshot';
import {validUuid} from '@/server/ai/contracts';
import type { LetterPrintContext } from './letterPrintContext';

type DraftInput = Omit<SaveLetterDraftRequest, 'clientDraftId' | 'expectedRevision' | 'operationId'>;
export type LetterSaveAttempt = { epoch: number; request: SaveLetterDraftRequest };
export type LetterSentAttempt = { epoch: number; request: MarkLetterSentRequest };
export interface LetterGenerationAttempt {epoch:number;clientDraftId:string;signature:string;requestKey:string;}
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

/** Request identity for one editor. A browser checkpoint is a work buffer, never a saved business letter. */
export class LetterDraftSession {
    private epoch = 0;
    private current: LetterDraftSessionState;
    private pendingSave: LetterSaveAttempt | null = null;
    private pendingSent: LetterSentAttempt | null = null;
    private pendingGeneration:LetterGenerationAttempt|null=null;
    constructor(projectId: string) { this.current = this.initial(projectId); }
    private initial(projectId: string): LetterDraftSessionState {
        return { projectId, clientDraftId: crypto.randomUUID(), letterId: null, revision: 0, status: 'DRAFT', isLegacy: false,
            snapshot: null, sourceRevisions: {}, docType: 'general', savedSignature: null, operationId: null, operationKind: null };
    }
    get state(): LetterDraftSessionState { return { ...this.current }; }
    checkpoint(): unknown {return structuredClone({version:1,epoch:this.epoch,current:this.current,pendingSave:this.pendingSave,pendingSent:this.pendingSent,pendingGeneration:this.pendingGeneration});}
    static resume(projectId:string,raw:unknown):LetterDraftSession {
        const session=new LetterDraftSession(projectId);
        if(!isRecord(raw)||raw.version!==1||!Number.isSafeInteger(raw.epoch)||Number(raw.epoch)<0||!isRecord(raw.current))return session;
        const state=raw.current;
        if(state.projectId!==projectId||!validUuid(state.clientDraftId)||(state.letterId!==null&&!validUuid(state.letterId))
            ||!Number.isSafeInteger(state.revision)||Number(state.revision)<0||!['DRAFT','SENT'].includes(String(state.status))||typeof state.isLegacy!=='boolean'
            ||(state.snapshot!==null&&!isLetterDraftSnapshot(state.snapshot))||!isRecord(state.sourceRevisions)||!Object.values(state.sourceRevisions).every(value=>typeof value==='string')
            ||typeof state.docType!=='string'||(state.savedSignature!==null&&typeof state.savedSignature!=='string')
            ||(state.operationId!==null&&!validUuid(state.operationId))||![null,'save','sent'].includes(state.operationKind as null|'save'|'sent'))return session;
        const generation=raw.pendingGeneration;
        if(generation!==null&&(!isRecord(generation)||generation.epoch!==raw.epoch||generation.clientDraftId!==state.clientDraftId||typeof generation.signature!=='string'||!validUuid(generation.requestKey)))return session;
        for(const [kind,value] of [['save',raw.pendingSave],['sent',raw.pendingSent]] as const){
            if(value===null)continue;
            if(!isRecord(value)||value.epoch!==raw.epoch||!isRecord(value.request)||value.request.projectId!==projectId||!validUuid(value.request.operationId)
                ||value.request.operationId!==state.operationId||state.operationKind!==kind||value.request.expectedRevision!==state.revision)return session;
            const request=value.request;
            if(kind==='save'&&(request.clientDraftId!==state.clientDraftId||!Array.isArray(request.itemIds)||!request.itemIds.every(validUuid)
                ||!['docType','subject','recipientName','content'].every(key=>typeof request[key]==='string')||!isRecord(request.sourceRevisions)))return session;
            if(kind==='sent'&&request.letterId!==state.letterId)return session;
        }
        if((state.operationKind==='save')!==(raw.pendingSave!==null)||(state.operationKind==='sent')!==(raw.pendingSent!==null))return session;
        session.current=structuredClone(state) as unknown as LetterDraftSessionState;session.epoch=Number(raw.epoch);
        session.pendingSave=freeze(structuredClone(raw.pendingSave)) as LetterSaveAttempt|null;
        session.pendingSent=freeze(structuredClone(raw.pendingSent)) as LetterSentAttempt|null;
        session.pendingGeneration=structuredClone(generation) as LetterGenerationAttempt|null;return session;
    }
    generationStopped(attempt:LetterGenerationAttempt):void {if(attempt.epoch===this.epoch&&attempt.requestKey===this.pendingGeneration?.requestKey)this.pendingGeneration=null;}
    generationAttempt(signature:string):LetterGenerationAttempt{if(this.pendingGeneration?.signature===signature)return this.pendingGeneration;return this.pendingGeneration={epoch:this.epoch,clientDraftId:this.current.clientDraftId,signature,requestKey:crypto.randomUUID()};}
    generated(attempt:LetterGenerationAttempt,result:{letter:string},currentSignature:string):'apply'|'pending'|'ignore'{
        if(attempt.epoch!==this.epoch||attempt.clientDraftId!==this.current.clientDraftId||this.pendingGeneration?.requestKey!==attempt.requestKey||this.current.status==='SENT'||typeof result.letter!=='string')return 'ignore';
        if(this.pendingGeneration?.requestKey===attempt.requestKey)this.pendingGeneration=null;
        return attempt.signature===currentSignature?'apply':'pending';
    }
    reset(projectId: string): void {
        ++this.epoch; this.current = this.initial(projectId); this.pendingSave = null; this.pendingSent = null;this.pendingGeneration=null;
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
