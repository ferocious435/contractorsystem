import React, { useState } from 'react';
import GenerateVOLetterModal from './GenerateVOLetterModal';
import { 
    FileText, Calculator, ChevronDown, CheckCircle2, 
    AlertCircle, FileSearch, Scale, Gavel, Sparkles, 
    Database, Receipt, Percent, Landmark, ArrowLeft,
    TrendingUp, ShieldCheck, Send, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RichText } from '../ui/RichText';
import { VAT_RATE, AI_MODEL_BRANDING } from '@/utils/constants';

export interface LedgerItem {
    id: string;
    item_code: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price_excl_vat: number;
    total_price_incl_vat: number;
    total_price_excl_vat: number;
    vat_amount: number;
    source?: string;
    project_id?: string;
    item_type?: 'CHAPTER' | 'SUBCHAPTER' | 'ITEM' | 'NOTE';
    type?: 'BASE_CONTRACT' | 'APPROVED_VO' | 'PENDING_VO' | 'SENT_VO';
    ai_rationale?: string;
    governing_notes?: any;
}

interface LedgerTableProps {
    items: LedgerItem[];
    vatRate?: number;
    onUpdateStatus?: (itemId: string, newStatus: string) => Promise<void>;
}

export default function LedgerTable({ items, vatRate = VAT_RATE, onUpdateStatus }: LedgerTableProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isGeneratorModalOpen, setIsGeneratorModalOpen] = useState(false);

    const totalExclVat = items
        .filter(i => !i.item_type || i.item_type === 'ITEM')
        .reduce((acc, item) => acc + (item.quantity * item.unit_price_excl_vat), 0);
    
    const selectedItemsList = items.filter(i => selectedIds.has(i.id));
    const selectedTotalExclVat = selectedItemsList.reduce((acc, item) => acc + (item.quantity * item.unit_price_excl_vat), 0);
    const selectedTotalInclVat = selectedTotalExclVat * (1 + vatRate);

    const totalVat = totalExclVat * vatRate;
    const totalInclVat = totalExclVat + totalVat;

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { 
            style: 'currency', 
            currency: 'ILS',
            minimumFractionDigits: 2
        }).format(val);
    };

    const getSourceStyles = (source?: string) => {
        switch (source) {
            case 'BOQ': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
            case 'DEKEL': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'CONTRACTOR': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
            default: return 'bg-white/5 text-gray-500 border-white/10';
        }
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            const itemIds = items
                .filter(i => !i.item_type || i.item_type === 'ITEM')
                .map(item => item.id);
            setSelectedIds(new Set(itemIds));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) next.add(id);
        else next.delete(id);
        setSelectedIds(next);
    };

    return (
        <div className="h-full flex flex-col rounded-[2.5rem] border border-white/10 bg-[#0B0F14] overflow-hidden shadow-2xl relative" dir="rtl">
            {/* Header: System Metrics & Commands */}
            <div className="px-8 py-6 bg-[#151C24]/80 backdrop-blur-2xl border-b border-white/5 flex flex-col sm:flex-row justify-between items-center gap-6 z-20">
                <div className="flex items-center gap-5">
                    <div className="relative group">
                        <div className="absolute -inset-2 bg-blue-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="relative p-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl">
                            <Calculator className="w-6 h-6 text-blue-400" />
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <h2 className="text-xl font-black text-white uppercase tracking-tight font-mono">רישום פיננסי</h2>
                            <span className="text-[10px] font-mono font-black text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 uppercase tracking-widest">{AI_MODEL_BRANDING}</span>
                        </div>
                        <p className="text-[9px] text-gray-500 uppercase font-black tracking-[0.3em]">מערכת בקרת השפעה מסחרית</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-6">
                    {/* Real-time Status */}
                    <div className="hidden lg:flex flex-col items-end px-6 border-l border-white/10">
                        <span className="text-[8px] text-gray-500 uppercase font-black tracking-widest mb-1">סטטוס מערכת</span>
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <span className="text-[10px] text-emerald-400 font-black uppercase tracking-wider">סנכרון פעיל</span>
                        </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex gap-3 bg-black/40 p-1.5 rounded-2xl border border-white/5 shadow-inner">
                        <div className="px-4 py-2 flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-[11px] font-black text-gray-300 uppercase tracking-tight">
                                {selectedIds.size > 0 ? (
                                    <span className="text-blue-400">{selectedIds.size} פריטים נבחרו</span>
                                ) : (
                                    <span>{items.filter(i => !i.item_type || i.item_type === 'ITEM').length} פריטים פעילים</span>
                                )}
                            </span>
                        </div>
                        
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                                if (selectedIds.size === 0) return;
                                setIsGeneratorModalOpen(true);
                            }}
                            disabled={selectedIds.size === 0}
                            className={`flex items-center gap-3 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg ${
                                selectedIds.size > 0
                                ? 'bg-white text-black hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                                : 'bg-white/5 text-gray-600 cursor-not-allowed'
                            }`}
                        >
                            <div className="flex flex-col items-start leading-none gap-0.5">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5" />
                                    צור דרישת תשלום (VO)
                                </div>
                                {selectedIds.size > 0 && (
                                    <span className="text-[8px] opacity-60 ml-5">{formatCurrency(selectedTotalInclVat)} (כולל מע"מ)</span>
                                )}
                            </div>
                        </motion.button>
                    </div>
                </div>
            </div>

            {/* Table Core */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-right border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-[#1A222C] backdrop-blur-md">
                            <th className="px-6 py-4 w-12 border-b border-white/10">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size > 0 && selectedIds.size === items.filter(i => !i.item_type || i.item_type === 'ITEM').length}
                                    onChange={handleSelectAll}
                                    className="w-4 h-4 rounded-md border-white/10 text-blue-500 focus:ring-blue-500/50 bg-[#0B0F14] transition-all"
                                />
                            </th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-white/10">מקור</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-white/10">קוד פריט</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-white/10">תיאור עבודה</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-white/10 text-center">יחידה</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-white/10 text-center">כמות</th>
                            <th className="px-6 py-4 text-[10px] font-black text-blue-400 uppercase tracking-widest border-b border-white/10 text-center">מחיר יחידה</th>
                            <th className="px-6 py-4 text-[10px] font-black text-emerald-400 uppercase tracking-widest border-b border-white/10 text-center">סה"כ ללא מע"מ</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 bg-[#0B0F14]">
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-32 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-30">
                                        <Database className="w-12 h-12" />
                                        <span className="text-xs font-black uppercase tracking-[0.4em]">לא נמצאו נתונים</span>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            items.map((item) => {
                                // CHAPTER STYLING
                                if (item.item_type === 'CHAPTER') {
                                    return (
                                        <tr key={item.id} className="bg-[#151C24] group/chapter">
                                            <td className="px-6 py-5 border-b border-white/5"></td>
                                            <td colSpan={2} className="px-6 py-5 border-b border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-1 h-6 bg-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
                                                    <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">פרק ראשי</span>
                                                </div>
                                            </td>
                                            <td colSpan={5} className="px-6 py-5 border-b border-white/5">
                                                <span className="text-lg font-black text-white uppercase tracking-tight group-hover/chapter:text-emerald-400 transition-colors">
                                                    {item.description}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                }

                                // ITEM STYLING
                                const isSelected = selectedIds.has(item.id);
                                return (
                                    <motion.tr 
                                        key={item.id} 
                                        className={`group/row transition-all hover:bg-white/[0.03] ${isSelected ? 'bg-blue-500/[0.03]' : ''}`}
                                    >
                                        <td className="px-6 py-5">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                                                className="w-4 h-4 rounded-md border-white/10 text-blue-500 focus:ring-blue-500/50 bg-[#0B0F14] transition-all"
                                            />
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className={`inline-flex items-center px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${getSourceStyles(item.source)}`}>
                                                {item.source === 'BOQ' ? 'חוזה' : item.source === 'DEKEL' ? 'דקל' : item.source === 'CONTRACTOR' ? 'קבלן' : 'מערכת'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col gap-2">
                                                <div className="font-mono text-[11px] text-gray-500 tracking-tighter">
                                                    {item.item_code}
                                                </div>
                                                {item.type === 'SENT_VO' && (
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex items-center gap-1 text-[8px] font-black text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 uppercase tracking-widest w-fit">
                                                            <Send className="w-2 h-2" />
                                                            נשלח ב-VO
                                                        </div>
                                                        {onUpdateStatus && (
                                                            <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                                <button 
                                                                    onClick={() => onUpdateStatus(item.id, 'APPROVED_VO')}
                                                                    className="p-1 hover:bg-emerald-500/20 rounded text-emerald-500 transition-colors"
                                                                    title="אשר חריגה"
                                                                >
                                                                    <CheckCircle2 className="w-3 h-3" />
                                                                </button>
                                                                <button 
                                                                    onClick={() => onUpdateStatus(item.id, 'BASE_CONTRACT')}
                                                                    className="p-1 hover:bg-red-500/20 rounded text-red-500 transition-colors"
                                                                    title="דחה/בטל חריגה"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {item.type === 'APPROVED_VO' && (
                                                    <div className="flex items-center gap-1 text-[8px] font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 uppercase tracking-widest w-fit">
                                                        <CheckCircle2 className="w-2 h-2" />
                                                        אושר סופית
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col gap-1">
                                                <div className="text-sm font-black text-gray-200 group-hover/row:text-white transition-colors">
                                                    <RichText text={item.description} evidence={item.governing_notes} />
                                                </div>
                                                {item.ai_rationale && (
                                                    <span className="text-[10px] text-gray-500 line-clamp-1 italic font-medium">ניתוח בינה מלאכותית: {item.ai_rationale}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-center text-[11px] font-black text-gray-500 uppercase tracking-widest">{item.unit}</td>
                                        <td className="px-6 py-5 text-center font-mono text-xs text-gray-300">{item.quantity}</td>
                                        <td className="px-6 py-5 text-center font-mono text-xs text-blue-400/80 bg-blue-500/[0.02] border-x border-white/[0.03]">
                                            {formatCurrency(item.unit_price_excl_vat)}
                                        </td>
                                        <td className="px-6 py-5 text-center font-mono text-xs text-emerald-400 font-black">
                                            {formatCurrency(item.quantity * item.unit_price_excl_vat)}
                                        </td>
                                    </motion.tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Premium Totals Bar */}
            <div className="px-10 py-8 bg-[#0D1218] border-t border-white/10 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 opacity-30" />
                
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-12 relative z-10">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">סה"כ בסיס</span>
                        </div>
                        <span className="text-2xl font-mono font-black text-white">{formatCurrency(totalExclVat)}</span>
                        <span className="text-[9px] text-gray-600 font-black uppercase tracking-widest">עלות ללא מע"מ</span>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Percent className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">מע"מ {(vatRate * 100).toFixed(0)}%</span>
                        </div>
                        <span className="text-2xl font-mono font-black text-blue-400">{formatCurrency(totalVat)}</span>
                        <span className="text-[9px] text-gray-600 font-black uppercase tracking-widest">סכום מע"מ</span>
                    </div>

                    <div className="flex flex-col gap-2 md:col-span-1 lg:col-span-2 text-right">
                        <div className="flex items-center gap-2 mb-1 justify-start">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">סכום סופי</span>
                        </div>
                        <span className="text-5xl font-mono font-black text-emerald-400 text-right tracking-tighter" dir="ltr">{formatCurrency(totalInclVat)}</span>
                        <span className="text-[10px] text-gray-500 font-black uppercase tracking-[0.3em] text-right mt-2">{AI_MODEL_BRANDING}</span>
                    </div>
                </div>
            </div>

            {/* Modals */}
            {isGeneratorModalOpen && (
                <GenerateVOLetterModal
                    onClose={() => setIsGeneratorModalOpen(false)}
                    selectedItems={selectedItemsList}
                    totalAmount={selectedTotalInclVat}
                />
            )}
        </div>
    );
}
