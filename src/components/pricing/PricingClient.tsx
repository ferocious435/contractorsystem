"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PendingQueue from './PendingQueue';
import LedgerTable from './LedgerTable';
import AIEstimatorModal from './AIEstimatorModal';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Clock } from 'lucide-react';

interface PricingClientProps {
    projectId: string;
    initialQueue: any[];
    initialLedger: any[];
}

export default function PricingClient({ projectId, initialQueue, initialLedger }: PricingClientProps) {
    return (
        <Suspense fallback={<div className="p-8 text-white font-mono uppercase tracking-widest animate-pulse text-center w-full">טוען_ליבת_תמחור...</div>}>
            <PricingClientInternal projectId={projectId} initialQueue={initialQueue} initialLedger={initialLedger} />
        </Suspense>
    );
}

function PricingClientInternal({ projectId, initialQueue, initialLedger }: PricingClientProps) {
    const [queue, setQueue] = useState(initialQueue);
    const [ledger, setLedger] = useState(initialLedger);
    const [selectedContradiction, setSelectedContradiction] = useState<any | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleSelectForEstimation = (item: any) => {
        setSelectedContradiction(item);
    };

    // Auto-select from URL parameter ?estimate_id=...
    useEffect(() => {
        const estimateId = searchParams.get('estimate_id');
        if (estimateId && queue.length > 0) {
            const item = queue.find(q => q.id === estimateId);
            if (item) {
                setSelectedContradiction(item);
                // Clear URL param without refresh
                window.history.replaceState({}, '', window.location.pathname);
            }
        }
    }, [searchParams, queue]);

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

            router.refresh(); 

        } catch (e) {
            console.error("Failed to approve estimation", e);
            alert("שגיאה בשמירת פריט בספר.");
        }
    };

    const handleUpdateStatus = async (itemId: string, newStatus: string) => {
        try {
            const res = await fetch('/api/pricing/update-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId, status: newStatus })
            });

            if (!res.ok) throw new Error("Failed to update status");

            // Update local state
            setLedger(prev => prev.map(item => 
                item.id === itemId ? { ...item, type: newStatus } : item
            ));

            router.refresh();
        } catch (e) {
            console.error("Failed to update status", e);
            alert("שגיאה בעדכון סטטוס הפריט.");
        }
    };

    return (
        <div className="flex-1 flex gap-8 h-[calc(100vh-10rem)] px-2">
            {/* חלונית שמאלית - תור (25%) */}
            <div className="w-1/4 h-full flex flex-col gap-6">
                <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-[#151C24]/50 border border-white/5 rounded-[2rem] p-6 z-10 shadow-xl shrink-0 relative overflow-hidden"
                >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-orange-500/20 to-transparent" />
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-500/10 rounded-xl border border-orange-500/20">
                                <Clock className="w-4 h-4 text-orange-400" />
                            </div>
                            <h2 className="font-mono font-black text-white text-sm uppercase tracking-widest">
                                תור_הערכה
                            </h2>
                        </div>
                        <span className="font-mono font-black text-orange-400 bg-orange-500/10 px-3 py-1 rounded-full text-xs border border-orange-500/20">
                            {queue.length}
                        </span>
                    </div>
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest leading-relaxed">רשימת_המתנה: אובייקטים_הדורשים_הערכת_AI</p>
                </motion.div>

                <div className="flex-1 min-h-0">
                    <PendingQueue items={queue} onSelectForEstimation={handleSelectForEstimation} />
                </div>
            </div>

            {/* Right Side - Ledger Table (75%) - The Core of Loki Pricing */}
            <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-3/4 h-full"
            >
                <LedgerTable 
                    items={ledger} 
                    onUpdateStatus={handleUpdateStatus} 
                />
            </motion.div>

            {/* Modals with AnimatePresence */}
            <AnimatePresence>
                {selectedContradiction && (
                    <AIEstimatorModal
                        contradiction={selectedContradiction}
                        onClose={() => setSelectedContradiction(null)}
                        onApprove={handleApproveEstimation}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
