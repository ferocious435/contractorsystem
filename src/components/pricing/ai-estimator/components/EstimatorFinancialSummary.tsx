import React from 'react';
import { Loader2, Layers } from 'lucide-react';
import { motion } from 'framer-motion';
import { VAT_RATE } from '@/utils/constants';

interface EstimatorFinancialSummaryProps {
    themeColor: string;
    themeHex: string;
    isExpertMode: boolean;
    isSaving: boolean;
    isLoading: boolean;
    totalExclVat: number;
    vatAmount: number;
    totalInclVat: number;
    transactionDisplayId: string;
    canSubmit: boolean;
    blockReason?: string;
    onSubmit: () => void;
}

function EstimatorFinancialSummary({
    themeColor,
    themeHex,
    isExpertMode,
    isSaving,
    isLoading,
    totalExclVat,
    vatAmount,
    totalInclVat,
    transactionDisplayId,
    canSubmit,
    blockReason,
    onSubmit,
}: EstimatorFinancialSummaryProps) {
    const isSubmitDisabled = isSaving || isLoading || !canSubmit;

    return (
        <div className="mt-auto bg-black/60 rounded-[2rem] sm:rounded-[3.5rem] p-5 sm:p-8 lg:p-12 border border-white/5 space-y-6 lg:space-y-10 relative overflow-hidden group shadow-2xl">
            <div className={`absolute inset-0 bg-gradient-to-br from-${themeColor}-500/[0.03] to-transparent pointer-events-none`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-10 relative z-10 border-b border-white/5 pb-6 sm:pb-8">
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-[0.2em]">ערך נטו (ללא מע&quot;מ)</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xs text-gray-600 font-mono">₪</span>
                        <span className="text-3xl font-mono font-black text-gray-200">{totalExclVat.toLocaleString()}</span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className="text-[10px] font-mono font-black text-blue-500/60 uppercase tracking-[0.2em]">מע&quot;מ {(VAT_RATE * 100).toFixed(0)}%</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-mono font-black text-blue-500/80">{vatAmount.toLocaleString()}</span>
                        <span className="text-xs text-blue-500/40 font-mono">₪</span>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full bg-${themeColor}-500 shadow-[0_0_10px_${themeHex}]`} />
                    <span className={`text-[11px] font-mono font-black text-${themeColor}-400 uppercase tracking-[0.5em]`}>סה&quot;כ כולל מע&quot;מ</span>
                </div>
                <div className="flex items-baseline gap-4">
                    <span className={`text-3xl sm:text-5xl lg:text-7xl break-words font-mono font-black text-${themeColor}-400 tracking-tighter drop-shadow-[0_0_30px_rgba(16,185,129,0.2)]`}>
                        ₪{totalInclVat.toLocaleString()}
                    </span>
                </div>
            </div>

            <motion.button
                whileHover={{ scale: 1.02, y: -5 }}
                whileTap={{ scale: 0.98 }}
                onClick={onSubmit}
                disabled={isSubmitDisabled}
                className={`w-full py-5 sm:py-8 rounded-[2rem] text-xs sm:text-sm font-black uppercase tracking-[0.25em] sm:tracking-[0.6em] transition-all flex items-center justify-center gap-4 sm:gap-6 shadow-2xl relative overflow-hidden group ${
                    isSubmitDisabled
                        ? 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/5'
                        : `${isExpertMode ? 'bg-amber-500 shadow-[0_30px_60px_-15px_rgba(245,158,11,0.3)]' : 'bg-emerald-500 shadow-[0_30px_60px_-15px_rgba(16,185,129,0.3)]'} text-black`
                }`}
            >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                <div className="relative z-10 flex items-center gap-4">
                    {isSaving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Layers className="w-6 h-6" />}
                    בצע רישום במערכת
                </div>
            </motion.button>

            {!canSubmit && !isLoading && (
                <p className="text-xs text-amber-300/80 text-center leading-6 relative z-10">
                    {blockReason || 'לא ניתן לשמור תמחור אפס. הזן מחיר יחידה או הפעל הערכה מחדש לאחר שיש מקור מחיר מתאים.'}
                </p>
            )}

            <p className="text-[9px] font-mono text-gray-700 text-center uppercase tracking-widest relative z-10">
                מזהה עסקה מאובטח: {transactionDisplayId}
            </p>
        </div>
    );
}

export default React.memo(EstimatorFinancialSummary);
