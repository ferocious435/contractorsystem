"use client";
import React, { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { LedgerWorkspace } from '@/components/features/pricing-ledger/components/LedgerWorkspace';
import { Panel } from '@/components/ui/titanium/Panel';
import { Button } from '@/components/ui/titanium/Button';
import { Feedback } from '@/components/ui/titanium/Feedback';
import AIEstimatorModal from '@/components/pricing/AIEstimatorModal';
import LetterGeneratorModal from '@/components/pricing/LetterGeneratorModal';
import PricingStatusBar from '@/components/pricing/PricingStatusBar';
import { usePricingLedgerState, } from '@/components/features/pricing-ledger';
import type { ApprovePricingEstimationPayload, PricingLedgerProps, } from '@/components/features/pricing-ledger';
import type { ContradictionItem } from '@/types';
export type ApproveEstimationPayload = ApprovePricingEstimationPayload;
export default function PricingLedgerUI({ projectId, initialParams, onNavigate }: PricingLedgerProps) {
    return (<Suspense fallback={<Feedback>טוען נתונים פיננסיים…</Feedback>}>
            <PricingLedgerInternal projectId={projectId} initialParams={initialParams} onNavigate={onNavigate}/>
        </Suspense>);
}
function PricingLedgerInternal({ projectId, initialParams, onNavigate }: PricingLedgerProps) {
    const searchParams = useSearchParams();
    const searchEstimateId = searchParams.get('estimate_id');
    const routedEstimateId = String(initialParams?.estimateId
        || initialParams?.contradictionId
        || searchEstimateId
        || '');
    const clearSearchEstimate = useCallback(() => {
        if (searchEstimateId) {
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, [searchEstimateId]);
    const { state, totals, derived, setters, actions } = usePricingLedgerState(projectId, {
        routedEstimateId,
        onClearRoutedEstimate: clearSearchEstimate,
    });
    const { handleApproveEstimation: approveEstimation } = actions;
    const isFocusedPricingFlow = Boolean(routedEstimateId) && !state.isFocusedPricingDismissed;
    const focusedQueueItem = derived.focusedQueueItem;
    const focusedContradictionTitle = focusedQueueItem?.title || initialParams?.contradictionTitle || 'הסתירה שנבחרה';
    const focusedContradictionSummary = focusedQueueItem?.description || initialParams?.contradictionSummary || 'המערכת פתחה עבורך מסלול תמחור ישיר לפי הסתירה שנבחרה.';
    const focusedSourceDocTitle = focusedQueueItem?.source_doc?.title || initialParams?.sourceDocTitle || '';
    const focusedTargetDocTitle = focusedQueueItem?.target_doc?.title || initialParams?.targetDocTitle || '';
    const handleBackToSource = useCallback(() => {
        onNavigate?.(String(initialParams?.returnTo || 'radar'));
    }, [initialParams?.returnTo, onNavigate]);
    const handleApproveEstimation = useCallback(async (data: ApproveEstimationPayload) => {
        await approveEstimation(data);
    }, [approveEstimation]);
    return <div className="ti-pricing-root">
        {isFocusedPricingFlow && <Panel className="ti-ledger-focused"><h2 className="ti-section-title">תמחור מתוך ממצא</h2><p className="ti-copy">{String(focusedContradictionTitle)}</p><details><summary>הקשר ומקורות</summary><p className="ti-copy">{String(focusedContradictionSummary)}</p><p className="ti-meta">{String(focusedSourceDocTitle)} · {String(focusedTargetDocTitle)}</p></details><div className="ti-actions"><Button variant="primary" onClick={() => focusedQueueItem && setters.setSelectedContradiction(focusedQueueItem)} disabled={!focusedQueueItem} disabledReason={!focusedQueueItem ? 'הממצא טרם נטען לתמחור' : undefined}>פתח תמחור מונחה</Button><Button onClick={handleBackToSource}>חזרה לסתירות</Button><Button variant="text" onClick={() => setters.setIsFocusedPricingDismissed(true)}>למסך התמחור המלא</Button></div></Panel>}
        <LedgerWorkspace state={state} totals={totals} derived={derived} setters={setters} actions={actions} focusedFlow={isFocusedPricingFlow}/>
        {!isFocusedPricingFlow && <PricingStatusBar projectId={projectId}/>}
            {state.selectedContradiction && (<AIEstimatorModal contradiction={state.selectedContradiction as unknown as ContradictionItem} onClose={() => setters.setSelectedContradiction(null)} onApprove={handleApproveEstimation}/>)}

            {state.isGeneratingLetter && (<LetterGeneratorModal projectId={projectId} initialSelectedItems={derived.selectedVOIds} onClose={() => { void actions.handleCloseLetterModal(); }}/>)}

    </div>;
}
