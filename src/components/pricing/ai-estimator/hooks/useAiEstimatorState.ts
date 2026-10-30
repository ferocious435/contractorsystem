import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { createClient } from '@/utils/supabase/client';
import { applyPricingScopeFormEdit, getPricingFormAmounts, getReviewedPricingFormAmounts, getPricingFormApproval, toPricingScopeForm } from '../pricingScopeForm';
import { normalizeConfidenceScore } from '@/utils/pricing-confidence';
import {
    evaluateAiPricing,
    restoreAiPricing,
    cancelAiPricing,
    fetchAiEstimatorSourceDocument,
} from '../api/aiEstimatorApi';
import type {
    AIEstimatorFormState,
    AIEstimatorModalProps,
    AIPricingEvaluationResponse,
    AIPricingEvidenceReference,
    AiEstimatorSourceDocument,
} from '../types';

type UseAiEstimatorStateOptions = AIEstimatorModalProps;

function createDefaultFormState(): AIEstimatorFormState {
    return toPricingScopeForm({});
}

function createTransactionDisplayId() {
    return Math.random().toString(36).substring(7).toUpperCase();
}

function toPricingNote(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function toPricingNotes(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map(toPricingNote)
        .filter((note): note is string => Boolean(note));
}
export function useAiEstimatorState({
    contradiction,
    onClose,
    onApprove,
}: UseAiEstimatorStateOptions) {
    const projectId=String(contradiction.project_id||contradiction.projectId||''),scope=projectId+':'+contradiction.id;
    const observation=useRef<AbortController|null>(null),currentScope=useRef(scope);currentScope.current=scope;
    const readDraft=useCallback(()=>{try{const saved=JSON.parse(sessionStorage.getItem('pricing-form:'+scope)||'null');return saved?.version===1&&saved.form&&typeof saved.form.description==='string'&&typeof saved.form.unit==='string'?saved.form as AIEstimatorFormState:null;}catch{return null;}},[scope]);
    const [isLoading, setIsLoading] = useState(true);
    const [estimateData, setEstimateData] = useState<AIPricingEvaluationResponse | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isExpertMode, setIsExpertMode] = useState(false);
    const [estimationError, setEstimationError] = useState<string | null>(null);
    const [formDraft,setFormDraft]=useState(()=>({scope,form:readDraft()||createDefaultFormState(),edited:Boolean(readDraft())}));
    const formState=formDraft.scope===scope?formDraft.form:createDefaultFormState();
    const setFormState=useCallback<Dispatch<SetStateAction<AIEstimatorFormState>>>(update=>setFormDraft(previous=>({scope,edited:true,form:typeof update==='function'?update(previous.scope===scope?previous.form:createDefaultFormState()):update})),[scope]);
    useEffect(()=>{if(formDraft.scope!==scope||!formDraft.edited)return;try{sessionStorage.setItem('pricing-form:'+scope,JSON.stringify({version:1,form:formDraft.form}));}catch{}},[formDraft,scope]);
    const [viewerDoc, setViewerDoc] = useState<AiEstimatorSourceDocument | null>(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    const [transactionDisplayId] = useState(createTransactionDisplayId);
    const supabase = useMemo(() => createClient(), []);

    const getEffectiveUnitPriceExclVat = useCallback(
        () => getPricingFormAmounts(formState).effectiveUnitPriceExclVat,
        [formState]
    );

    const runEstimation = useCallback(async (withExpert: boolean = false) => {
        observation.current?.abort();const controller=new AbortController();observation.current=controller;
        setIsLoading(true);
        setEstimationError(null);

        try {
            const data = await evaluateAiPricing({
                contradictionId: contradiction.id,
                projectId: String(contradiction.project_id || contradiction.projectId || ''),
                expertMode: withExpert,
                signal:controller.signal,
            });
            if(controller.signal.aborted||currentScope.current!==scope)return;
            setEstimateData(data);
            setFormDraft(previous=>previous.scope===scope&&previous.edited?previous:{scope,edited:false,form:toPricingScopeForm({ ...data, suggested_description: data.suggested_description || contradiction.description || '' })});
        } catch (error) {
            if(controller.signal.aborted||currentScope.current!==scope)return;
            console.error('[AI_TERMINAL_ERROR]:', error);
            setEstimationError('בדיקת המחיר לא הושלמה. הנתונים נשארו לבדיקה.');
        } finally {
            if(!controller.signal.aborted&&currentScope.current===scope)setIsLoading(false);
        }
    }, [contradiction.description, contradiction.id, contradiction.projectId, contradiction.project_id,scope]);

    useEffect(() => {
        const controller=new AbortController();observation.current?.abort();observation.current=controller;setIsLoading(true);setEstimationError(null);setEstimateData(null);
        const draft=readDraft();setFormDraft({scope,form:draft||createDefaultFormState(),edited:Boolean(draft)});
        void restoreAiPricing(projectId,contradiction.id,controller.signal).then(data=>{if(controller.signal.aborted)return;setEstimateData(data);if(data?.lastActionState)setEstimationError('הבדיקה האחרונה לא הושלמה. מוצגת התוצאה השמורה הקודמת.');if(data)setFormDraft(previous=>previous.scope===scope&&previous.edited?previous:{scope,edited:false,form:toPricingScopeForm(data)});}).catch(error=>{if(!controller.signal.aborted)setEstimationError(error instanceof Error?error.message:'לא ניתן לשחזר את הבדיקה.');}).finally(()=>{if(!controller.signal.aborted)setIsLoading(false);});
        return()=>{controller.abort();observation.current?.abort();};
    }, [projectId,contradiction.id,scope,readDraft]);
    const cancelEstimation=useCallback(async()=>{try{await cancelAiPricing(projectId,contradiction.id);observation.current?.abort();setIsLoading(false);setEstimationError('הבדיקה בוטלה. הנתונים שהיו בחלון נשמרו.');}catch{setEstimationError('לא ניתן לאשר שהבדיקה בוטלה. ניתן לנסות שוב.');}},[projectId,contradiction.id]);

    const handleFormChange = useCallback((
        event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) => {
        const { name, value } = event.target;

        setFormState((prev) => applyPricingScopeFormEdit(prev, name, value));
    }, [setFormState]);

    const handleSubmit = useCallback(async () => {
        setIsSaving(true);

        try {
            const effectiveUnitPriceExclVat = getEffectiveUnitPriceExclVat();
            if (effectiveUnitPriceExclVat === null || effectiveUnitPriceExclVat <= 0 || formState.quantity === null || formState.quantity <= 0) {
                throw new Error('Pricing draft is incomplete: unit price and quantity must be positive before saving.');
            }
            const approval = getPricingFormApproval(estimateData, formState, { isLoading, error: estimationError });
            if (!approval.allowed) {
                throw new Error('Pricing draft requires user answers before approval.');
            }
            const confidenceScore = normalizeConfidenceScore(
                estimateData?.confidence_score ?? estimateData?.confidence
            );
            const zeroMatchNotes = estimateData?.match_quality === 'ZERO_MATCH'
                ? [
                    toPricingNote(estimateData.zero_match_reason),
                    ...toPricingNotes(estimateData.needed_documents).map((doc) => `לדיוק סופי כדאי לבדוק: ${doc}`),
                ].filter((note): note is string => Boolean(note))
                : [];
            const pricingNotes: string[] = [
                ...toPricingNotes(estimateData?.governing_notes),
                ...(estimateData?.quantity_review_required ? [
                    'הכמות בתמחור הזה עדיין דורשת אימות סופי לפני אישור.',
                ] : []),
                ...toPricingNotes(estimateData?.ancillary_notes),
                ...zeroMatchNotes,
            ];
            const linkedEvidence = {
                ...(contradiction.evidence_data || {}),
                pricing_evaluation: {
                    scope_review: estimateData?.scope_review || null,
                    match_found: estimateData?.match_found,
                    source: estimateData?.source,
                    confidence: estimateData?.confidence,
                    confidence_score: confidenceScore,
                    match_quality: estimateData?.match_quality,
                    quantity_basis: estimateData?.quantity_basis || null,
                    quantity_review_required: Boolean(estimateData?.quantity_review_required),
                    requires_user_answer_before_approval: Boolean(estimateData?.requires_user_answer_before_approval),
                    ancillary_scope: estimateData?.ancillary_scope || null,
                    source_trace: estimateData?.source_trace,
                    matched_items: estimateData?.matched_items,
                    source_basis: estimateData?.source_basis || [],
                    pricing_breakdown: estimateData?.pricing_breakdown || [],
                    needed_documents: estimateData?.needed_documents || [],
                    questions: estimateData?.questions || [],
                    ancillary_notes: estimateData?.ancillary_notes || [],
                    zero_match_reason: estimateData?.zero_match_reason || null,
                },
            };

            await onApprove({
                contradiction_id: contradiction.id,
                type: 'PENDING_VO',
                source: formState.source,
                item_code: estimateData?.item_code || '',
                description: formState.description,
                unit: formState.unit,
                quantity: formState.quantity,
                unit_price_excl_vat: effectiveUnitPriceExclVat,
                markup_percentage: formState.markup / 100,
                manual_pricing_inputs: formState.manualPricingInputs,
                ai_rationale: estimateData?.ai_rationale || '',
                governing_notes: pricingNotes,
                expert_strategy: estimateData?.expert_strategy || null,
                evidence_data: linkedEvidence,
            });
            onClose();
        } catch (error) {
            console.error('[COMMIT_ERROR]:', error);
        } finally {
            setIsSaving(false);
        }
    }, [
        contradiction.evidence_data,
        contradiction.id,
        estimateData,
        estimationError,
        isLoading,
        formState,
        getEffectiveUnitPriceExclVat,
        onApprove,
        onClose,
    ]);

    const handleViewSource = useCallback(async (ev: AIPricingEvidenceReference) => {
        try {
            const data = await fetchAiEstimatorSourceDocument(supabase as unknown as Parameters<typeof fetchAiEstimatorSourceDocument>[0], {
                documentId: ev.document_id,
                documentTitle: ev.document_title,
                projectId: contradiction.project_id,
            });

            if (!data) {
                return;
            }

            setViewerDoc(data);
            setIsViewerOpen(true);
        } catch (error) {
            console.error('Error viewing source:', error);
            alert('לא ניתן היה לטעון את המסמך המקורי.');
        }
    }, [contradiction.project_id, supabase]);

    const derived = useMemo(() => {
        const themeColor = isExpertMode ? 'amber' : 'emerald';
        const themeHex = isExpertMode ? '#f59e0b' : '#10b981';
        const { effectiveUnitPriceExclVat, totalExclVat, vatAmount, totalInclVat } = getReviewedPricingFormAmounts(estimateData, formState, { isLoading, error: estimationError });
        const hasPricingDraft = totalExclVat !== null && totalExclVat > 0;
        const confidencePct = Math.round((normalizeConfidenceScore(estimateData?.confidence) ?? 0) * 100);
        const isZeroMatch = estimateData?.match_quality === 'ZERO_MATCH' || estimateData?.match_found === false;
        const approval = getPricingFormApproval(estimateData, formState, { isLoading, error: estimationError });
        const requiresUserAnswerBeforeApproval = !approval.allowed;
        const pricingBlockReason = approval.reason;
        const expert = estimateData?.expert_strategy;
        const expertTechnical = expert?.technical_foundation || expert?.ripple_effect?.technical_analysis;
        const expertArgument = expert?.professional_argument || expert?.contractual_diagnostic?.argument_for_supervisor;
        const expertDiary = expert?.site_diary_instruction || expert?.operational_instructions?.site_diary_draft;

        return {
            themeColor,
            themeHex,
            effectiveUnitPriceExclVat,
            totalExclVat,
            vatAmount,
            totalInclVat,
            hasPricingDraft,
            requiresUserAnswerBeforeApproval,
            pricingBlockReason,
            confidencePct,
            isZeroMatch,
            expert,
            expertTechnical,
            expertArgument,
            expertDiary,
            transactionDisplayId,
        };
    }, [estimateData, formState, estimationError, isLoading, isExpertMode, transactionDisplayId]);

    const state = useMemo(() => ({
        isLoading,
        estimateData,
        isSaving,
        isExpertMode,
        formState,
        viewerDoc,
        isViewerOpen,
    }), [
        estimateData,
        formState,
        isExpertMode,
        isLoading,
        isSaving,
        isViewerOpen,
        viewerDoc,
    ]);

    const setters = useMemo(() => ({
        setEstimateData,
        setFormState,
        setIsExpertMode,
        setIsViewerOpen,
        setViewerDoc,
    }), [setFormState]);

    const actions = useMemo(() => ({
        runEstimation,
        cancelEstimation,
        handleFormChange,
        handleSubmit,
        handleViewSource,
    }), [
        handleFormChange,
        handleSubmit,
        handleViewSource,
        runEstimation,
        cancelEstimation,
    ]);

    return {
        state,
        setters,
        actions,
        derived,
    };
}
