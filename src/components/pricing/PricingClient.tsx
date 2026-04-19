"use client";

import React, { useState } from 'react';
import PendingQueue from './PendingQueue';
import LedgerTable from './LedgerTable';
import AIEstimatorModal from './AIEstimatorModal';
import { createClient } from '@/utils/supabase/client';
import { useRouter } from 'next/navigation';

interface PricingClientProps {
    projectId: string;
    initialQueue: any[];
    initialLedger: any[];
}

export default function PricingClient({ projectId, initialQueue, initialLedger }: PricingClientProps) {
    const [queue, setQueue] = useState(initialQueue);
    const [ledger, setLedger] = useState(initialLedger);
    const [selectedContradiction, setSelectedContradiction] = useState<any | null>(null);
    const router = useRouter();

    const handleSelectForEstimation = (item: any) => {
        setSelectedContradiction(item);
    };

    const handleApproveEstimation = async (ledgerData: any) => {
        try {
            const res = await fetch('/api/pricing/save-ledger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: projectId,
                    ...ledgerData
                })
            });

            if (!res.ok) throw new Error("Failed to save to ledger");

            const { item: newLedgerItem } = await res.json();

            // Remove from queue
            setQueue(prev => prev.filter(q => q.id !== ledgerData.contradiction_id));

            // Add to ledger
            setLedger(prev => [newLedgerItem, ...prev]);

            router.refresh(); // Tell Next.js router to softly update in the background if possible

        } catch (e) {
            console.error("Failed to approve estimation", e);
            alert("Failed to save ledger item.");
        }
    };

    return (
        <div className="flex-1 flex gap-6 h-[calc(100vh-8rem)]">
            {/* Left Sidebar - Pending Queue (25%) */}
            <div className="w-1/4 h-full flex flex-col">
                <div className="bg-[#151C24] border border-white/10 rounded-xl p-4 mb-4 z-10 shadow-sm shrink-0">
                    <h2 className="font-semibold text-white flex items-center gap-2 justify-between">
                        תור המתנה (תמחור)
                        <span className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs border border-orange-500/30">
                            {queue.length}
                        </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">חריגים מהרדאר שממתינים להערכת שווי</p>
                </div>
                <div className="flex-1 min-h-0 bg-transparent rounded-xl">
                    <PendingQueue items={queue} onSelectForEstimation={handleSelectForEstimation} />
                </div>
            </div>

            {/* Right Side - Ledger Table (75%) */}
            <div className="w-3/4 h-full">
                <LedgerTable items={ledger} />
            </div>

            {/* Modals */}
            {selectedContradiction && (
                <AIEstimatorModal
                    contradiction={selectedContradiction}
                    onClose={() => setSelectedContradiction(null)}
                    onApprove={handleApproveEstimation}
                />
            )}
        </div>
    );
}
