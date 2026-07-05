import React from 'react';
import PendingQueueTable from '@/components/pricing/PendingQueueTable';
import type { ContradictionItem } from '@/types';
import { AI_BULK_APPROVE_CONFIDENCE_THRESHOLD } from '../constants';
import { formatConfidencePercent } from '../utils/aiConfidence';
import type {
    BulkApprovePreviewResult,
    PricingContradictionItem,
    PricingLedgerDerivedState,
} from '../types';

interface QueuePanelProps {
    items: PricingContradictionItem[];
    selectedIds: string[];
    scanningItems: string[];
    confidence: Pick<PricingLedgerDerivedState, 'queueConfidencePercentById' | 'queueConfidenceStats' | 'selectedHighConfidenceQueueIds'>;
    onToggleSelection: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onSelectForEstimation: (item: PricingContradictionItem) => void;
    onRescan: (item: PricingContradictionItem) => Promise<void>;
    onBulkRescan: (ids: string[]) => Promise<void>;
    onBulkDelete: (ids: string[]) => Promise<void>;
    onBulkApprove: (ids?: string[]) => Promise<BulkApprovePreviewResult>;
}

type BulkApproveFeedbackTone = 'success' | 'warning' | 'error';

interface BulkApproveFeedback {
    tone: BulkApproveFeedbackTone;
    message: string;
    stagedCount: number;
    skippedCount: number;
}

const BULK_APPROVE_FEEDBACK_STYLES: Record<BulkApproveFeedbackTone, string> = {
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    error: 'border-red-500/20 bg-red-500/10 text-red-200',
};

function buildBulkApproveFeedback(
    result: BulkApprovePreviewResult,
    thresholdPercent: string
): BulkApproveFeedback {
    const stagedIds = result.stagedIds || result.approvedIds;

    if (stagedIds.length === 0) {
        return {
            tone: 'warning',
            message: `No selected items passed Confidence > ${thresholdPercent}.`,
            stagedCount: 0,
            skippedCount: result.skippedIds.length,
        };
    }

    return {
        tone: 'success',
        message: `${stagedIds.length} items staged after Confidence > ${thresholdPercent}. ${result.skippedIds.length} items skipped.`,
        stagedCount: stagedIds.length,
        skippedCount: result.skippedIds.length,
    };
}

function buildBulkApproveErrorFeedback(message: string, skippedCount: number): BulkApproveFeedback {
    return {
        tone: 'error',
        message: `Confidence check failed: ${message}`,
        stagedCount: 0,
        skippedCount,
    };
}

function QueuePanel({
    items,
    selectedIds,
    scanningItems,
    confidence,
    onToggleSelection,
    onSelectAll,
    onSelectForEstimation,
    onRescan,
    onBulkRescan,
    onBulkDelete,
    onBulkApprove,
}: QueuePanelProps) {
    const [isBulkApproving, setIsBulkApproving] = React.useState(false);
    const [bulkApproveFeedback, setBulkApproveFeedback] = React.useState<BulkApproveFeedback | null>(null);
    const bulkApproveInFlightRef = React.useRef(false);
    const { queueConfidencePercentById, queueConfidenceStats, selectedHighConfidenceQueueIds } = confidence;
    const thresholdPercent = React.useMemo(
        () => formatConfidencePercent(AI_BULK_APPROVE_CONFIDENCE_THRESHOLD),
        []
    );
    const averageConfidence = React.useMemo(
        () => formatConfidencePercent(queueConfidenceStats.averageScore),
        [queueConfidenceStats.averageScore]
    );

    const handleBulkDelete = React.useCallback(async (ids: string[]) => {
        if (!confirm(`האם למחוק ${ids.length} פריטים מהתור?`)) {
            return;
        }

        await onBulkDelete(ids);
    }, [onBulkDelete]);

    const handleSmartBulkApprove = React.useCallback(async () => {
        if (bulkApproveInFlightRef.current) {
            return;
        }

        bulkApproveInFlightRef.current = true;
        setIsBulkApproving(true);
        setBulkApproveFeedback(null);

        try {
            const result = await onBulkApprove(selectedIds);

            if (result.superseded) {
                return;
            }

            setBulkApproveFeedback(buildBulkApproveFeedback(result, thresholdPercent));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Server confidence check failed';
            setBulkApproveFeedback(buildBulkApproveErrorFeedback(message, selectedIds.length));
        } finally {
            bulkApproveInFlightRef.current = false;
            setIsBulkApproving(false);
        }
    }, [onBulkApprove, selectedIds, thresholdPercent]);

    const handleSelectForEstimation = React.useCallback((item: ContradictionItem) => {
        onSelectForEstimation(item as unknown as PricingContradictionItem);
    }, [onSelectForEstimation]);

    const handleRescan = React.useCallback((item: ContradictionItem) => (
        onRescan(item as unknown as PricingContradictionItem)
    ), [onRescan]);

    const getConfidencePercent = React.useCallback((item: ContradictionItem) => {
        return queueConfidencePercentById.get(item.id) ?? null;
    }, [queueConfidencePercentById]);

    return (
        <div className="w-full lg:w-1/4 lg:min-w-[320px] max-h-[42dvh] lg:max-h-none lg:h-full flex flex-col shrink-0 space-y-4">
            <div className="bg-[#151C24]/60 border border-white/5 rounded-3xl p-4 sm:p-6 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 blur-[60px] group-hover:bg-orange-500/10 transition-all" />
                <div className="flex items-start justify-between gap-4 relative z-10">
                    <div className="flex flex-col gap-1" dir="rtl">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-black text-orange-500 uppercase tracking-[0.3em]">תור פעולות ממתינות</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shadow-[0_0_8px_#f59e0b]" />
                        </div>
                        <h2 className="text-xl font-black text-white font-mono uppercase tracking-tighter">
                            תור הממתינים
                        </h2>
                    </div>

                    <div className="text-left shrink-0">
                        <div className="text-[9px] font-mono font-black text-emerald-400 uppercase tracking-[0.2em]">AI Confidence</div>
                        <div className="text-2xl font-black text-white font-mono">{averageConfidence}</div>
                    </div>
                </div>

                <div className="relative z-10 mt-5 grid grid-cols-3 gap-2" dir="rtl">
                    <div className="rounded-2xl border border-white/5 bg-black/20 p-3">
                        <div className="text-[9px] font-mono font-black text-gray-500 uppercase tracking-widest">נמדדו</div>
                        <div className="text-lg font-black text-gray-200">{queueConfidenceStats.totalWithConfidence}</div>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                        <div className="text-[9px] font-mono font-black text-emerald-400 uppercase tracking-widest">{`>${thresholdPercent}`}</div>
                        <div className="text-lg font-black text-emerald-200">{queueConfidenceStats.highConfidenceCount}</div>
                    </div>
                    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-3">
                        <div className="text-[9px] font-mono font-black text-blue-300 uppercase tracking-widest">נבחרו</div>
                        <div className="text-lg font-black text-blue-100">{selectedHighConfidenceQueueIds.length}</div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleSmartBulkApprove}
                    disabled={selectedIds.length === 0 || isBulkApproving}
                    className="relative z-10 mt-4 w-full rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {isBulkApproving ? 'בודק Confidence בשרת...' : 'אישור חכם לפי Confidence'}
                </button>

                {bulkApproveFeedback && (
                    <div
                        role="status"
                        aria-live="polite"
                        className={`relative z-10 mt-3 rounded-2xl border p-3 text-left text-xs leading-5 ${BULK_APPROVE_FEEDBACK_STYLES[bulkApproveFeedback.tone]}`}
                        dir="ltr"
                    >
                        <div className="font-bold">{bulkApproveFeedback.message}</div>
                        <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.15em] opacity-80">
                            <span>{`Staged: ${bulkApproveFeedback.stagedCount}`}</span>
                            <span>{`Skipped: ${bulkApproveFeedback.skippedCount}`}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden rounded-[2.5rem] border border-white/5 bg-[#0B0F14]/30 backdrop-blur-xl">
                <PendingQueueTable
                    items={items as unknown as ContradictionItem[]}
                    selectedIds={selectedIds}
                    onToggleSelection={onToggleSelection}
                    onSelectAll={onSelectAll}
                    onSelectForEstimation={handleSelectForEstimation}
                    onRescan={handleRescan}
                    onBulkRescan={onBulkRescan}
                    onBulkDelete={handleBulkDelete}
                    scanningItems={scanningItems}
                    getConfidencePercent={getConfidencePercent}
                />
            </div>
        </div>
    );
}

export default React.memo(QueuePanel);
