import React from 'react';
import PendingQueueTable from '@/components/pricing/PendingQueueTable';
import type { ContradictionItem } from '@/types';
import type { PricingContradictionItem } from '../types';

interface QueuePanelProps {
    items: PricingContradictionItem[];
    selectedIds: string[];
    scanningItems: string[];
    onToggleSelection: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onSelectForEstimation: (item: PricingContradictionItem) => void;
    onRescan: (item: PricingContradictionItem) => Promise<void>;
    onBulkRescan: (ids: string[]) => Promise<void>;
    onBulkDelete: (ids: string[]) => Promise<void>;
}
export default function QueuePanel({
    items,
    selectedIds,
    scanningItems,
    onToggleSelection,
    onSelectAll,
    onSelectForEstimation,
    onRescan,
    onBulkRescan,
    onBulkDelete,
}: QueuePanelProps) {
    const handleBulkDelete = async (ids: string[]) => {
        if (!confirm(`האם למחוק ${ids.length} פריטים מהתור?`)) {
            return;
        }

        await onBulkDelete(ids);
    };

    return (
        <div className="w-1/4 min-w-[320px] h-full flex flex-col shrink-0 space-y-4">
            <div className="bg-[#151C24]/60 border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 blur-[60px] group-hover:bg-orange-500/10 transition-all" />
                <div className="flex items-center justify-between relative z-10">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-black text-orange-500 uppercase tracking-[0.3em]">תור פעולות ממתינות</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shadow-[0_0_8px_#f59e0b]" />
                        </div>
                        <h2 className="text-xl font-black text-white font-mono uppercase tracking-tighter" dir="rtl">
                            תור הממתינים
                        </h2>
                    </div>
                </div>
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
                />
            </div>
        </div>
    );
}
