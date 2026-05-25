"use client";

import React from 'react';
import { 
    AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight, 
    CheckCircle2, XCircle, ArrowRightLeft, Search, RefreshCw, 
    Check, Download, FileText, Trash2, ShieldAlert, FileSearch, 
    Scale, Gavel, Quote, ExternalLink, Sparkles, Database, Loader2,
    Link as LinkIcon, Brain, Bot, Play, X, Clock, Zap, Activity, Shield,
    CheckCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { ContradictionItem } from '@/types';

interface PendingQueueTableProps {
    items: ContradictionItem[];
    selectedIds?: string[];
    onToggleSelection?: (id: string) => void;
    onSelectAll?: (ids: string[]) => void;
    onSelectForEstimation: (item: ContradictionItem) => void;
    onRescan?: (item: ContradictionItem) => Promise<void>;
    onBulkRescan?: (ids: string[]) => Promise<void>;
    onBulkDelete?: (ids: string[]) => Promise<void>;
    scanningItems?: string[];
}

export default function PendingQueueTable({ 
    items, 
    selectedIds = [], 
    onToggleSelection, 
    onSelectAll,
    onSelectForEstimation, 
    onRescan, 
    onBulkRescan,
    onBulkDelete,
    scanningItems = [] 
}: PendingQueueTableProps) {
    const [collapsedGroups, setCollapsedGroups] = React.useState<string[]>([]);
    const allSelected = items.length > 0 && selectedIds.length === items.length;

    const getEvidenceSummary = (evidenceData: any) => {
        if (Array.isArray(evidenceData)) {
            return {
                hasEvidence: evidenceData.length > 0,
                verified: evidenceData.length > 0,
                label: `הוכחות: ${evidenceData.length}`,
                detail: 'נמצאו קישורי מקור לפריט הזה.'
            };
        }

        const hasQuoteEvidence = Boolean(evidenceData?.contract_quote || evidenceData?.work_quote);
        const missingCount = Array.isArray(evidenceData?.missing_evidence) ? evidenceData.missing_evidence.length : 0;
        const pricingEvaluation = evidenceData?.pricing_evaluation;
        const hasPricingTrace = Boolean(pricingEvaluation?.match_quality || pricingEvaluation?.source);
        const isVerified = evidenceData?.evidence_status === 'VERIFIED' || Boolean(evidenceData?.contract_quote && evidenceData?.work_quote);

        return {
            hasEvidence: hasQuoteEvidence || missingCount > 0 || hasPricingTrace || Boolean(evidenceData?.linked_ids?.length),
            verified: isVerified,
            label: isVerified ? 'ראיות מאומתות' : 'דורש אימות',
            detail: pricingEvaluation?.match_quality === 'ZERO_MATCH'
                ? 'לא נמצא סעיף ישיר. נדרש אימות לפני דרישה.'
                : missingCount > 0
                    ? `חסרים מקורות/בדיקות: ${missingCount}`
                    : 'קיים קישור למקור או לתמחור.'
        };
    };

    const toggleGroup = (title: string) => {
        setCollapsedGroups(prev => 
            prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
        );
    };

    const groupedItems = items.reduce((acc, item) => {
        const sourceTitle = item.source_execution_doc?.title || 'מסמכים כלליים';
        if (!acc[sourceTitle]) {
            acc[sourceTitle] = [];
        }
        acc[sourceTitle].push(item);
        return acc;
    }, {} as Record<string, ContradictionItem[]>);

    if (items.length === 0) {
        return (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center p-20 text-center bg-[#0B0F14]/50 rounded-[2.5rem] border border-white/5" 
                dir="rtl"
            >
                <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(16,185,129,0.1)]">
                    <CheckCircle className="w-10 h-10 text-emerald-500" />
                </div>
                <h3 className="text-xl font-black text-white font-mono uppercase tracking-widest">התור נקי</h3>
                <p className="mt-2 text-gray-500 text-sm font-medium max-w-xs">אין חריגים פתוחים שממתינים לתמחור כרגע. אם נוספו מסמכים חדשים, יש להריץ סנכרון חכם לפני מסקנה סופית.</p>
            </motion.div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0B0F14] rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl relative" dir="rtl">
            {/* Table Header Section */}
            <div className="overflow-x-auto overflow-y-auto custom-scrollbar flex-1 relative">
                <table className="w-full text-right border-collapse table-fixed">
                    <thead className="sticky top-0 bg-[#151C24] z-20 border-b border-white/5">
                        <tr className="h-14">
                            <th className="px-4 w-12 text-center">
                                <input 
                                    type="checkbox" 
                                    className="w-4 h-4 rounded border-white/10 bg-white/5 checked:bg-blue-500 transition-all cursor-pointer"
                                    checked={allSelected}
                                    onChange={() => onSelectAll?.(allSelected ? [] : items.map(i => i.id))}
                                />
                            </th>
                            <th className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono w-20 text-center">מזהה_צומת</th>
                            <th className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono w-28">עדיפות</th>
                            <th className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono">ניתוח_חריגה</th>
                            <th className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono w-24 text-center">קישורים_למקור</th>
                            <th className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono w-40 text-center">פעולת בינה מלאכותית</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {Object.entries(groupedItems).map(([sourceTitle, groupItems], groupIdx) => (
                            <React.Fragment key={sourceTitle}>
                                <tr 
                                    className="bg-[#1A222C]/30 h-10 border-y border-white/5 cursor-pointer hover:bg-[#1A222C]/50 transition-colors group/header"
                                    onClick={() => toggleGroup(sourceTitle)}
                                >
                                    <td colSpan={6} className="px-6">
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-4">
                                                <motion.div
                                                    animate={{ rotate: collapsedGroups.includes(sourceTitle) ? -90 : 0 }}
                                                    transition={{ duration: 0.2 }}
                                                >
                                                    <ChevronDown className="w-4 h-4 text-gray-500" />
                                                </motion.div>
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                                                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest font-mono flex items-center gap-3">
                                                    <FileText className="w-3.5 h-3.5 text-blue-500" /> 
                                                    {sourceTitle}
                                                    <span className="text-gray-600 font-mono text-[9px] bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                                                        פריטים: {groupItems.length}
                                                    </span>
                                                </span>
                                            </div>
                                            <div className="opacity-0 group-hover/header:opacity-100 transition-opacity">
                                                <span className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em]">
                                                    {collapsedGroups.includes(sourceTitle) ? 'הרחב מקור' : 'צמצם מקור'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                </tr>

                                {!collapsedGroups.includes(sourceTitle) && groupItems.map((item, itemIdx) => {
                                    const isScanning = scanningItems.includes(item.id);
                                    const isSelected = selectedIds.includes(item.id);
                                    const evidenceSummary = getEvidenceSummary(item.evidence_data);
                                    
                                    return (
                                        <motion.tr 
                                            key={item.id}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: itemIdx * 0.03 }}
                                            className={`group h-20 cursor-pointer transition-all relative overflow-hidden
                                                ${isScanning ? 'bg-blue-500/5' : ''} 
                                                ${isSelected ? 'bg-emerald-500/10 shadow-[inset_0_0_40px_rgba(16,185,129,0.05)] border-r-2 border-emerald-500' : 'hover:bg-white/[0.03]'}`}
                                            onClick={() => onSelectForEstimation(item)}
                                        >
                                            {isScanning && (
                                                <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                                                    <div className="w-full h-full bg-gradient-to-r from-transparent via-blue-500/10 to-transparent animate-scan" />
                                                </div>
                                            )}
                                            
                                            <td className="px-4 text-center z-10" onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="checkbox" 
                                                    className="w-4 h-4 rounded border-white/10 bg-white/5 checked:bg-blue-500 transition-all cursor-pointer"
                                                    checked={isSelected}
                                                    onChange={() => onToggleSelection?.(item.id)}
                                                />
                                            </td>

                                            <td className="px-4 text-center z-10">
                                                <span className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-widest group-hover:text-blue-500 transition-colors">
                                                    #{groupIdx + 1}-{itemIdx + 1}
                                                </span>
                                            </td>

                                            <td className="px-4 z-10">
                                                <div className="flex flex-col gap-1.5">
                                                    {item.severity === 'HIGH' ? (
                                                        <div className="flex items-center gap-2 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg w-fit shadow-[0_0_15px_rgba(239,68,68,0.05)]">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]" />
                                                            <span className="text-[9px] font-black text-red-500 uppercase tracking-widest font-mono">סיכון קריטי</span>
                                                        </div>
                                                    ) : item.severity === 'MEDIUM' ? (
                                                        <div className="flex items-center gap-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg w-fit">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />
                                                            <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest font-mono">השפעה בינונית</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/5 border border-white/5 rounded-lg w-fit">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                                                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest font-mono">תיעוד סטנדרטי</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="px-4 py-4 z-10">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-xs font-bold text-white line-clamp-1">{item.title}</span>
                                                    <span className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">
                                                        {item.description}
                                                    </span>
                                                </div>
                                            </td>


                                            <td className="px-4 text-center z-10">
                                                <div className="flex items-center justify-center gap-2">
                                                    {(item.evidence_data?.linked_ids?.length ?? 0) > 0 && (
                                                        <div className="inline-flex items-center justify-center w-8 h-8 bg-purple-500/10 border border-purple-500/20 rounded-xl hover:bg-purple-500/20 transition-all group/links relative">
                                                            <Brain className="w-4 h-4 text-purple-400" />
                                                            <div className="absolute bottom-full right-0 mb-3 w-56 p-4 bg-[#151C24] border border-purple-500/30 rounded-2xl shadow-2xl opacity-0 invisible group-hover/links:opacity-100 group-hover/links:visible transition-all z-[60] backdrop-blur-2xl">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="text-[10px] font-mono font-black text-purple-400 uppercase tracking-widest">סנכרון חכם</span>
                                                                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                                                </div>
                                                                <p className="text-[10px] text-gray-400 leading-relaxed text-right">
                                                                    קונפליקטים מקושרים: <span className="text-white font-mono">{item.evidence_data?.linked_ids?.length ?? 0}</span>
                                                                    <br />
                                                                    השפעה: <span className="text-purple-300 font-bold">תמחור רוחבי משולב</span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {evidenceSummary.hasEvidence && (
                                                        <div className="inline-flex items-center justify-center w-8 h-8 bg-blue-500/10 border border-blue-500/20 rounded-xl hover:bg-blue-500/20 transition-all group/evidence relative">
                                                            <Shield className="w-4 h-4 text-blue-400" />
                                                            <div className="absolute bottom-full right-0 mb-3 w-56 p-4 bg-[#151C24] border border-blue-500/30 rounded-2xl shadow-2xl opacity-0 invisible group-hover/evidence:opacity-100 group-hover/evidence:visible transition-all z-[60] backdrop-blur-2xl">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="text-[10px] font-mono font-black text-blue-400 uppercase tracking-widest">פרוטוקול הוכחות</span>
                                                                    <Shield className="w-3 h-3 text-blue-400" />
                                                                </div>
                                                                <p className="text-[10px] text-gray-400 leading-relaxed text-right">
                                                                    {evidenceSummary.detail}
                                                                    <br />
                                                                    <span className="text-blue-300 font-bold">{evidenceSummary.verified ? 'מוכן לתמחור עם סימוכין.' : 'לא להציג כדרישה ודאית לפני בדיקה.'}</span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {!evidenceSummary.hasEvidence && (
                                                        <span className="text-gray-800 font-mono text-[10px]">--</span>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="px-4 z-10">
                                                <div className="flex items-center justify-end gap-3 opacity-50 group-hover:opacity-100 transition-all">
                                                    <button 
                                                        className={`p-2 rounded-xl transition-all ${isScanning ? 'text-blue-400 bg-blue-400/10' : 'text-gray-600 hover:text-white hover:bg-white/10'}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (onRescan && !isScanning) onRescan(item);
                                                        }}
                                                        disabled={isScanning}
                                                    >
                                                        <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onSelectForEstimation(item);
                                                        }}
                                                        className={`flex items-center gap-3 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-black/20 group/btn
                                                        ${item.severity === 'HIGH' 
                                                            ? 'bg-amber-500 text-black hover:bg-white' 
                                                            : 'bg-emerald-500 text-black hover:bg-white'
                                                        }`}>
                                                        <span>{item.severity === 'HIGH' ? 'מצב הגנה משפטית' : 'תמחור חריג AI'}</span>
                                                        <Zap size={12} className="fill-current group-hover/btn:animate-bounce" />
                                                    </button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            
            {/* Bulk Actions Floating Bar */}
            <AnimatePresence>
                {selectedIds.length > 0 && (
                    <motion.div 
                        initial={{ opacity: 0, y: 100, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 100, x: '-50%' }}
                        className="fixed bottom-10 left-1/2 flex items-center gap-6 px-10 py-5 bg-[#151C24]/90 backdrop-blur-3xl border border-blue-500/20 rounded-[2rem] shadow-[0_30px_100px_rgba(0,0,0,0.8)] z-[100]"
                    >
                        <div className="flex items-center gap-4 border-l border-white/5 pl-6">
                            <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                <Zap className="w-5 h-5 text-blue-500" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-white font-mono text-lg font-black leading-none">{selectedIds.length}</span>
                                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-black">פריטים נבחרו</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                             <motion.button 
                                 whileHover={{ scale: 1.05 }}
                                 whileTap={{ scale: 0.95 }}
                                 onClick={() => onBulkRescan?.(selectedIds)}
                                 className="flex items-center gap-3 px-6 py-3 bg-blue-500 text-black rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_10px_20px_rgba(59,130,246,0.3)] hover:bg-white"
                             >
                                 <Play className="w-4 h-4 fill-current" />
                                 סנכרון סריקה חכם
                             </motion.button>
                                                        <motion.button 
                                 whileHover={{ scale: 1.05 }}
                                 whileTap={{ scale: 0.95 }}
                                 onClick={() => onBulkDelete?.(selectedIds)}
                                 className="flex items-center gap-3 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
                             >
                                 <Trash2 className="w-4 h-4" />
                                 ניקוי בחירה
                             </motion.button>

                            <button 
                                onClick={() => onSelectAll?.([])}
                                className="p-2 text-gray-500 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            
            {/* System Bar Integration - Terminal Style */}
            <div className="px-6 py-2 bg-[#151C24] border-t border-white/5 flex items-center justify-between z-30">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Activity size={12} className="text-emerald-500" />
                        <span className="text-[9px] font-mono text-emerald-500 font-black uppercase tracking-[0.2em]">מערכת תמחור פעילה</span>
                    </div>
                    <div className="w-[1px] h-3 bg-white/5" />
                    <div className="flex items-center gap-2">
                        <Shield size={12} className="text-gray-500" />
                        <span className="text-[9px] font-mono text-gray-600 font-black uppercase tracking-widest">הגנה פיננסית פעילה</span>
                    </div>
                </div>
                <div className="flex items-center gap-6 text-[9px] font-mono font-black uppercase tracking-widest">
                    <div className="flex items-center gap-2 text-gray-600">
                        <span>פריטים:</span>
                        <span className="text-blue-500">{selectedIds.length}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <span>מעבד:</span>
                        <span className="text-white">Powered by Gemini 3.5 Flash</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <span>מע"מ:</span>
                        <span className="text-emerald-500">18.00%</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
