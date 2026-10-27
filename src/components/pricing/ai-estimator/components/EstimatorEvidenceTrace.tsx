"use client";

import React from 'react';
import {Button} from '@/components/ui/titanium/Button';

import type { ContradictionItem } from '@/types';
import type { AIPricingEvaluationResponse, AIPricingEvidenceReference, AIPricingGoverningNote } from '../types';
import { normalizeDocumentPage } from '@/components/features/contradiction-radar/utils/documentPage';

type Scope = NonNullable<AIPricingEvaluationResponse['scope_review']>;
export function scopeSourceReference(scope: Scope, position: Scope['positions'][number], anchor: { documentId: string; quote: string; page?: number | null }, finding: Pick<ContradictionItem, 'target_contract_doc_id'>): AIPricingEvidenceReference {
    const direct = scope.requirements.some(item => item.evidence.some(evidence => evidence.documentId === anchor.documentId)) || anchor.documentId === finding.target_contract_doc_id;
    const documentId = direct ? anchor.documentId : position.documentId || undefined;
    const page = normalizeDocumentPage(anchor.page) ?? (documentId && documentId === position.documentId ? normalizeDocumentPage(position.page) : null);
    return { document_id: documentId, quote: anchor.quote, page };
}

interface EstimatorEvidenceTraceProps {
    contradiction: ContradictionItem;
    estimateData?: AIPricingEvaluationResponse | null;
    onViewSource: (evidence: AIPricingEvidenceReference) => void;
}

const GOVERNING_NOTE_LABELS: Record<string, string> = {
    Digital_Twin_Evidence: 'ראיות דיגיטליות',
    REGULATORY_NOTE: 'הערה רגולטורית',
    CONTRACTUAL_BASIS: 'בסיס חוזי',
    MARKET_ANALYSIS: 'בדיקת מחיר תומכת',
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noteValue(value:unknown){return typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'—');}

function toOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

function toPageValue(value: unknown): string | number | null | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function normalizeEvidenceReference(value: unknown): AIPricingEvidenceReference | null {
    if (!isRecord(value)) return null;

    return {
        ...value,
        document_id: toOptionalString(value.document_id),
        document_title: toOptionalString(value.document_title),
        page: toPageValue(value.page),
        quote: toOptionalString(value.quote),
        reference: toOptionalString(value.reference),
    };
}
function EstimatorEvidenceTrace({
    contradiction,
    estimateData,
    onViewSource,
}: EstimatorEvidenceTraceProps) {
    const directEvidence = React.useMemo<AIPricingEvidenceReference[] | null>(() => {
        const evidenceData = contradiction.evidence_data;

        if (Array.isArray(evidenceData)) {
            const normalizedEvidence = evidenceData
                .map(normalizeEvidenceReference)
                .filter((evidence): evidence is AIPricingEvidenceReference => Boolean(evidence));

            return normalizedEvidence.length > 0 ? normalizedEvidence : null;
        }

        if (!isRecord(evidenceData)) {
            return null;
        }

        if (evidenceData.contract_quote || evidenceData.work_quote) {
            return [
                {
                    document_title: toOptionalString(evidenceData.contract_title),
                    page: toPageValue(evidenceData.contract_page),
                    reference: '[1]',
                    document_id: contradiction.target_contract_doc_id,
                    quote: toOptionalString(evidenceData.contract_quote),
                },
                {
                    document_title: toOptionalString(evidenceData.work_title),
                    page: toPageValue(evidenceData.work_page),
                    reference: '[2]',
                    document_id: contradiction.source_execution_doc_id,
                    quote: toOptionalString(evidenceData.work_quote),
                },
            ].filter((evidence) => evidence.quote);
        }

        return null;
    }, [contradiction]);
    const scope = estimateData?.scope_review;
    const scopeLabels = { FULL: 'התאמה מלאה', PARTIAL: 'כיסוי חלקי', REJECTED: 'הסעיף אינו מתאים', NEEDS_REVIEW: 'נדרשת בדיקה' };

    return (
        <div className="ti-estimator-evidence-trace">
            {scope && (
                <div className="rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5 space-y-4">
                    <div className="font-bold text-blue-300">בדיקת התאמה והרכב העבודה · {scopeLabels[scope.status]}</div>
                    {scope.uncoveredRequirementIds.length > 0 && (
                        <p className="text-sm text-amber-300">טרם כוסה במחיר: {scope.uncoveredRequirementIds.map(id =>
                            scope.requirements.find(item => item.id === id)?.description || id).join(', ')}</p>
                    )}
                    {scope.positions.map((position, index) => (
                        <details key={`${position.candidateId}-${index}`} className="rounded-2xl border border-white/10 p-4 text-sm text-gray-300">
                            <summary className="cursor-pointer font-bold">
                                {position.sourceTitle || 'מקור מחיר'} · {position.itemCode || 'ללא קוד'}
                                {position.page ? ` · עמוד ${position.page}` : ''} · {scopeLabels[position.status]}
                            </summary>
                            <p className="mt-3">{position.reason}</p>
                            {position.requirementIds.length > 0 && <p className="mt-2 text-emerald-300">כולל: {position.requirementIds.map(id =>
                                scope.requirements.find(item => item.id === id)?.description || id).join(', ')}</p>}
                            {position.evidence.map((anchor, quoteIndex) => (
                                <div key={`${anchor.documentId}-${anchor.start}-${quoteIndex}`} className="mt-3 rounded-xl bg-black/30 p-3">
                                    <div className="text-xs text-gray-400">
                                        ציטוט מקור {anchor.page ? ` · עמוד ${anchor.page}` : ''}
                                    </div>
                                    <blockquote className="mt-2 whitespace-pre-wrap leading-6">{anchor.quote}</blockquote>
                                    {(scope.requirements.some(item => item.evidence.some(evidence => evidence.documentId === anchor.documentId))
                                        || anchor.documentId === contradiction.target_contract_doc_id
                                        || (position.documentId && (anchor.documentId === position.candidateId || anchor.documentId === position.documentId))) && (
                                        <Button variant="text" className="mt-2 text-xs text-blue-300" onClick={() => onViewSource(scopeSourceReference(scope, position, anchor, contradiction))}>פתח מקור</Button>
                                    )}
                                </div>
                            ))}
                        </details>
                    ))}
                </div>
            )}
            <div className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                <div className="w-8 h-[1px] bg-gray-800" />
                יומן ראיות
            </div>

            <div className="grid grid-cols-1 gap-4">
                {estimateData?.governing_notes?.map((note: AIPricingGoverningNote, idx: number) => (
                    <div
                        key={`note-${idx}`}
                        className="flex gap-6 p-6 bg-white/[0.02] border border-white/5 rounded-3xl hover:bg-white/[0.04] hover:border-white/10 transition-all group"
                    >
                        <div className="w-10 h-10 rounded-2xl bg-gray-900 border border-white/5 flex items-center justify-center shrink-0 group-hover:border-blue-500/30 transition-colors">
                            <span className="text-[11px] font-mono font-black text-gray-500 group-hover:text-blue-400">
                                {String(idx + 1).padStart(2, '0')}
                            </span>
                        </div>
                        <div className="flex-1">
                            <div className="text-[10px] font-mono text-gray-600 mb-1">הערת מערכת</div>
                            <div className="text-sm text-gray-400 leading-relaxed font-medium">
                                {typeof note === 'string' ? note : (
                                    (Object.entries(note) as [string, unknown][]).map(([key, value]) => (
                                        <div key={key} className="mb-1">
                                            <span className="text-blue-400 font-bold ml-1">
                                                {GOVERNING_NOTE_LABELS[key] || key}:
                                            </span>
                                            <span>{noteValue(value)}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {contradiction.evidence_data && (directEvidence || !estimateData?.scope_review?.lines.some(line => line.unitPriceExclVat.value !== null)) && (
                    <div className="mt-4 p-6 bg-blue-500/5 border border-blue-500/20 rounded-3xl space-y-4">
                        <div className="flex items-center gap-3 mb-2">

                            <span className="text-[11px] font-mono font-black text-blue-400 uppercase tracking-widest">
                                ראיות דיגיטליות
                            </span>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            {directEvidence ? (
                                directEvidence.map((evidence: AIPricingEvidenceReference, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-2xl hover:border-white/20 transition-all">
                                        <div className={evidence.quote ? 'flex flex-col' : 'flex items-center gap-4'}>
                                            {!evidence.quote && (
                                                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-black text-gray-500">
                                                    מסמך
                                                </div>
                                            )}
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-300">{evidence.document_title || 'מסמך מקור'}</span>
                                                <span className="text-[10px] font-mono text-gray-600 uppercase tracking-tight">
                                                    עמוד: {evidence.page || 'לא זמין'} | סימוכין: {evidence.reference || 'סימוכין מערכת'}
                                                </span>
                                                {evidence.quote && (
                                                    <details className="ti-estimator-quote-details"><summary>ציטוט המקור</summary><blockquote>{evidence.quote}</blockquote></details>
                                                )}
                                            </div>
                                        </div>
                                        <Button variant="text"
                                            disabled={!evidence.document_id&&!evidence.document_title} disabledReason={!evidence.document_id&&!evidence.document_title?'לא נמסר קובץ מקור לפתיחה':undefined} onClick={() => onViewSource(evidence)}
                                            className={`px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl text-[10px] font-black transition-all ${evidence.quote ? 'shrink-0' : ''}`}
                                        >
                                            הצג מקור
                                        </Button>
                                    </div>
                                ))
                            ) : (
                                <div className="text-xs text-amber-400 italic px-4">
                                    אין מקור ישיר מאומת לפריט זה. נדרש אימות לפני דרישה כספית.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default React.memo(EstimatorEvidenceTrace);
