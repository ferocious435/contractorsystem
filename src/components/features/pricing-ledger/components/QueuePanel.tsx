import React from 'react';
import PendingQueueTable from '@/components/pricing/PendingQueueTable';
import type { ContradictionItem } from '@/types';
import { AI_BULK_APPROVE_CONFIDENCE_THRESHOLD } from '../constants';
import { formatConfidencePercent, getQueueItemConfidenceScore } from '../utils/aiConfidence';
import type {
    BulkApprovePreviewResult,
    PricingContradictionItem,
    PricingLedgerDerivedState,
} from '../types';

interface QueuePanelProps {
    items: PricingContradictionItem[];
    selectedIds: string[];
    scanningItems: string[];
    confidence: Pick<PricingLedgerDerivedState, 'queueConfidenceStats' | 'selectedHighConfidenceQueueIds'>;
    onToggleSelection: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onSelectForEstimation: (item: PricingContradictionItem) => void;
    onRescan: (item: PricingContradictionItem) => Promise<void>;
    onBulkRescan: (ids: string[]) => Promise<void>;
    onBulkDelete: (ids: string[]) => Promise<void>;
    onBulkApprove: (ids?: string[]) => Promise<BulkApprovePreviewResult>;
}

export default function QueuePanel({
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
    const { queueConfidenceStats, selectedHighConfidenceQueueIds } = confidence;
    const thresholdPercent = formatConfidencePercent(AI_BULK_APPROVE_CONFIDENCE_THRESHOLD);
    const averageConfidence = formatConfidencePercent(queueConfidenceStats.averageScore);

    const handleBulkDelete = async (ids: string[]) => {
        if (!confirm(`האם למחוק ${ids.length} פריטים מהתור?`)) {
            return;
        }

        await onBulkDelete(ids);
    };

    const handleSmartBulkApprove = async () => {
        setIsBulkApproving(true);

        try {
            const result = await onBulkApprove(selectedIds);

            if (result.approvedIds.length === 0) {
                alert(`לא נמצאו פריטים עם Confidence מעל ${thresholdPercent}.`);
                return;
            }

            alert(`נבחרו ${result.approvedIds.length} פריטים עם Confidence מעל ${thresholdPercent}. דולגו ${result.skippedIds.length} פריטים.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Server confidence check failed';
            alert(`בדיקת Confidence נכשלה: ${message}`);
        } finally {
            setIsBulkApproving(false);
        }
    };

    return (
        <div className="w-1/4 min-w-[320px] h-full flex flex-col shrink-0 space-y-4">
            <div className="bg-[#151C24]/60 border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
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
            </div>

            <div className="flex-1 min-h-0 overflow-hidden rounded-[2.5rem] border border-white/5 bg-[#0B0F14]/30 backdrop-blur-xl">
                <PendingQueueTable
                    items={items as unknown as ContradictionItem[]}
                    selectedIds={selectedIds}
                    onToggleSelection={onToggleSelection}
                    onSelectAll={onSelectAll}
                    onSelectForEstimation={(item) => onSelectForEstimation(item as unknown as PricingContradictionItem)}
                    onRescan={(item) => onRescan(item as unknown as PricingContradictionItem)}
                    onBulkRescan={onBulkRescan}
                    onBulkDelete={handleBulkDelete}
                    scanningItems={scanningItems}
                    getConfidencePercent={(item) => {
                        const score = getQueueItemConfidenceScore(item as unknown as PricingContradictionItem);
                        return score === null ? null : formatConfidencePercent(score);
                    }}
                />
            </div>
        </div>
    );
}
