import React from 'react';
import { Calculator, Download, Plus, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { VAT_RATE } from '@/utils/constants';

interface PricingLedgerHeaderProps {
    selectedCount: number;
    totalBaseExclVat: number;
    totalVOExclVat: number;
    grandTotalVat: number;
    grandTotalInclVat: number;
    onGenerateLetter: () => void;
    onExportCSV: () => void;
    onAddNew: () => void;
}

export default function PricingLedgerHeader({
    selectedCount,
    totalBaseExclVat,
    totalVOExclVat,
    grandTotalVat,
    grandTotalInclVat,
    onGenerateLetter,
    onExportCSV,
    onAddNew
}: PricingLedgerHeaderProps) {
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { 
            style: 'currency', 
            currency: 'ILS', 
            maximumFractionDigits: 0 
        }).format(val);
    };

    return (
        <>
            <div className="flex flex-col md:flex-row justify-between items-end gap-6 shrink-0 bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
                
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-[0_0_40px_rgba(59,130,246,0.1)]">
                            <Calculator className="h-7 w-7 text-blue-500" />
                        </div>
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-black text-blue-500 uppercase tracking-[0.3em]">מרכז תמחור</span>
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                            </div>
                            <h2 className="text-3xl font-black text-white font-mono uppercase tracking-tighter" dir="rtl">
                                ניהול תמחור פרויקט
                            </h2>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onGenerateLetter}
                        className="group relative px-6 py-4 bg-purple-500 text-black rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 overflow-hidden shadow-[0_10px_30px_rgba(168,85,247,0.2)] hover:bg-white"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        <FileText className="h-4 w-4" />
                        <span>הפקת מכתב ({selectedCount})</span>
                    </button>
                    <button
                        onClick={onExportCSV}
                        className="px-6 py-4 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3"
                    >
                        <Download className="h-4 w-4" />
                        <span>ייצוא נתונים</span>
                    </button>
                    <button
                        onClick={onAddNew}
                        className="px-6 py-4 bg-white text-black hover:bg-blue-500 hover:text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 shadow-xl shadow-black/20"
                    >
                        <Plus className="h-4 w-4" />
                        <span>הוספת שורה</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0" dir="rtl">
                {[
                    { label: 'חוזה בסיס', value: totalBaseExclVat, color: 'gray', sub: 'חוזה מקורי (לפני מע"מ)' },
                    { label: 'שינויים וחריגים', value: totalVOExclVat, color: 'blue', sub: 'פקודות שינויים (V.O)' },
                    { label: `מע"מ (${(VAT_RATE * 100).toFixed(0)}%)`, value: grandTotalVat, color: 'emerald', sub: 'חישוב מע"מ סטטוטורי' },
                    { label: 'סה"כ כולל מע"מ', value: grandTotalInclVat, color: 'primary', sub: 'סה"כ לתשלום סופי', highlight: true }
                ].map((stat, idx) => (
                    <motion.div 
                        key={idx}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className={`bg-[#151C24]/60 border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center relative overflow-hidden group ${stat.highlight ? 'bg-blue-500/5 border-blue-500/20' : ''}`}
                    >
                        {stat.highlight && (
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
                        )}
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{stat.label}</span>
                            <span className="text-[8px] font-mono text-gray-600 uppercase tracking-widest">{stat.sub}</span>
                        </div>
                        <span className={`text-2xl font-black font-mono tracking-tighter ${
                            stat.color === 'blue' ? 'text-blue-400' : 
                            stat.color === 'emerald' ? 'text-emerald-400' : 
                            stat.color === 'primary' ? 'text-white' : 'text-gray-300'
                        }`}>
                            {formatCurrency(stat.value)}
                        </span>
                    </motion.div>
                ))}
            </div>
        </>
    );
}
