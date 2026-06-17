import React, { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, FileSearch, Zap } from 'lucide-react';
import AIEstimatorModal from '@/components/pricing/AIEstimatorModal';
import LetterGeneratorModal from '@/components/pricing/LetterGeneratorModal';
import PricingStatusBar from '@/components/pricing/PricingStatusBar';
import {
    ActionBar,
    LedgerTable,
    QueuePanel,
    TotalsSummary,
    usePricingLedgerState,
} from '@/components/features/pricing-ledger';
import type {
    ApprovePricingEstimationPayload,
    PricingContradictionItem,
    PricingLedgerProps,
} from '@/components/features/pricing-ledger';

export type ApproveEstimationPayload = ApprovePricingEstimationPayload;

export default function PricingLedgerUI({ projectId, initialParams, onNavigate }: PricingLedgerProps) {
    return (
        <Suspense fallback={<div className="p-8 text-white font-mono uppercase tracking-widest animate-pulse">טוען נתונים פיננסיים...</div>}>
            <PricingLedgerInternal projectId={projectId} initialParams={initialParams} onNavigate={onNavigate} />
        </Suspense>
    );
}
function PricingLedgerInternal({ projectId, initialParams, onNavigate }: PricingLedgerProps) {
    const searchParams = useSearchParams();
    const searchEstimateId = searchParams.get('estimate_id');
    const routedEstimateId = String(
        initialParams?.estimateId
        || initialParams?.contradictionId
        || searchEstimateId
        || ''
    );

    const clearSearchEstimate = useCallback(() => {
        if (searchEstimateId) {
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, [searchEstimateId]);

    const { state, totals, derived, setters, actions } = usePricingLedgerState(projectId, {
        routedEstimateId,
        onClearRoutedEstimate: clearSearchEstimate,
    });

    const isFocusedPricingFlow = Boolean(routedEstimateId) && !state.isFocusedPricingDismissed;
    const focusedQueueItem = derived.focusedQueueItem;
    const focusedContradictionTitle = focusedQueueItem?.title || initialParams?.contradictionTitle || 'הסתירה שנבחרה';
    const focusedContradictionSummary = focusedQueueItem?.description || initialParams?.contradictionSummary || 'המערכת פתחה עבורך מסלול תמחור ישיר לפי הסתירה שנבחרה.';
    const focusedSourceDocTitle = focusedQueueItem?.source_doc?.title || initialParams?.sourceDocTitle || '';
    const focusedTargetDocTitle = focusedQueueItem?.target_doc?.title || initialParams?.targetDocTitle || '';

    const handleBackToSource = () => {
        onNavigate?.(String(initialParams?.returnTo || 'radar'));
    };

    const handleApproveEstimation = async (data: ApproveEstimationPayload) => {
        await actions.handleApproveEstimation(data);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col h-full bg-[#0B0F14]"
        >
            {isFocusedPricingFlow && (
                <div className="px-8 pt-8">
                    <div className="bg-[#151C24]/70 border border-emerald-500/20 rounded-[2rem] p-6 md:p-8 shadow-2xl">
                        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                            <div className="space-y-4 max-w-4xl">
                                <div className="flex items-center gap-3">
                                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">
                                        <Zap className="w-4 h-4" />
                                        הגעת לתמחור מתוך סתירה
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    <h2 className="text-2xl md:text-3xl font-black text-white">עכשיו מתמחרים את הסעיף הזה</h2>
                                    <p className="text-lg text-emerald-300 font-bold">{String(focusedContradictionTitle)}</p>
                                    <p className="text-sm md:text-base text-gray-300 leading-7">{String(focusedContradictionSummary)}</p>
                                </div>
                                {(focusedSourceDocTitle || focusedTargetDocTitle) && (
                                    <div className="flex flex-col md:flex-row gap-3 md:gap-6 text-sm text-gray-400">
                                        {focusedSourceDocTitle && (
                                            <div className="flex items-center gap-2">
                                                <FileSearch className="w-4 h-4 text-blue-400" />
                                                <span>מסמך ביצוע: {String(focusedSourceDocTitle)}</span>
                                            </div>
                                        )}
                                        {focusedTargetDocTitle && (
                                            <div className="flex items-center gap-2">
                                                <FileSearch className="w-4 h-4 text-emerald-400" />
                                                <span>מסמך חוזה: {String(focusedTargetDocTitle)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 xl:min-w-[360px]">
                                <button
                                    onClick={() => focusedQueueItem && setters.setSelectedContradiction(focusedQueueItem)}
                                    disabled={!focusedQueueItem}
                                    className="px-5 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    פתח תמחור מונחה
                                </button>
                                <button
                                    onClick={handleBackToSource}
                                    className="px-5 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                                >
                                    <ArrowRight className="w-4 h-4" />
                                    חזרה לסתירות
                                </button>
                                <button
                                    onClick={() => setters.setIsFocusedPricingDismissed(true)}
                                    className="px-5 py-3 bg-transparent border border-white/10 text-gray-400 rounded-xl font-bold hover:text-white hover:border-white/20 transition-all"
                                >
                                    למסך התמחור המלא
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className={`flex gap-8 flex-1 overflow-hidden p-8 ${isFocusedPricingFlow ? 'pt-6' : 'pb-0'}`}>
                {!isFocusedPricingFlow && (
                    <QueuePanel
                        items={state.pendingQueue}
                        selectedIds={state.selectedQueueIds}
                        scanningItems={state.scanningItems}
                        onToggleSelection={actions.handleToggleQueueSelection}
                        onSelectAll={actions.handleSelectAllQueue}
                        onSelectForEstimation={actions.handleSelectForEstimation}
                        onRescan={actions.handleRescan}
                        onBulkRescan={actions.handleBulkRescan}
                        onBulkDelete={actions.handleBulkDeleteQueue}
                    />
                )}

                <div className="flex-1 min-w-0 flex flex-col gap-8">
                    <ActionBar
                        selectedCount={derived.selectedVOIds.length}
                        isSyncing={state.isSyncing}
                        onGenerateLetter={() => setters.setIsGeneratingLetter(true)}
                        onExportCSV={() => { void actions.handleExportCSV(); }}
                        onAddNew={() => setters.setIsAddingNew(true)}
                        onSync={() => { void actions.handleSync(); }}
                    />

                    <TotalsSummary totals={totals} />

                    {state.error && (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-sm font-bold text-red-300" dir="rtl">
                            {state.error}
                        </div>
                    )}

                    <LedgerTable
                        rows={derived.visibleLedgerRows}
                        isLoading={state.loading}
                        isAddingNew={state.isAddingNew}
                        isEditing={state.isEditing}
                        newItemForm={state.newItemForm}
                        setNewItemForm={setters.setNewItemForm}
                        editForm={state.editForm}
                        setEditForm={setters.setEditForm}
                        selectedLedgerIds={derived.selectedVOIds}
                        toggleSelectItem={actions.handleToggleLedgerSelection}
                        toggleSelectAll={actions.handleSelectAllLedger}
                        handleAddNew={actions.handleAddNew}
                        setIsAddingNew={setters.setIsAddingNew}
                        handleSaveEdit={actions.handleSaveEdit}
                        handleCancelEdit={actions.handleCancelEdit}
                        approveVO={actions.approveVO}
                        handleEditClick={actions.handleEditClick}
                        handleDelete={actions.handleDelete}
                    />
                </div>
            </div>

            {!isFocusedPricingFlow && <PricingStatusBar projectId={projectId} />}

            {state.selectedContradiction && (
                <AIEstimatorModal
                    contradiction={state.selectedContradiction as unknown as PricingContradictionItem}
                    onClose={() => setters.setSelectedContradiction(null)}
                    onApprove={handleApproveEstimation}
                />
            )}

            {state.isGeneratingLetter && (
                <LetterGeneratorModal
                    projectId={projectId}
                    initialSelectedItems={derived.selectedVOIds}
                    onClose={() => { void actions.handleCloseLetterModal(); }}
                />
            )}
        </motion.div>
    );
}
