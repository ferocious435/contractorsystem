import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    AlertTriangle, Zap, Activity, CheckCircle2, 
    RefreshCw, ChevronDown, FileText, ArrowRightLeft, 
    Shield, Database, MessageSquare, Info, TrendingUp, 
    Gavel, DollarSign, FileSearch, Copy, ShieldAlert, Trash2 
} from 'lucide-react';
import { ContradictionItem } from '@/types';
import { RichText } from '@/components/ui/RichText';

interface ContradictionRadarFeedItemProps {
    item: ContradictionItem;
    idx: number;
    isExpanded: boolean;
    isItemRescanning: boolean;
    isScanning: boolean;
    onToggleExpand: (id: string) => void;
    onRescanItem: (id: string, executionDocId?: string) => void;
    onUpdateStatus: (id: string, newStatus: string, item?: ContradictionItem) => void;
    onDelete: (id: string) => void;
    onNavigate?: (view: string, params?: Record<string, any>) => void;
    onRadarOpenDocument: (fileUrl?: string | null, pageNum?: number | string | null) => void;
}

export default function ContradictionRadarFeedItem({
    item: c,
    idx,
    isExpanded,
    isItemRescanning,
    isScanning,
    onToggleExpand,
    onRescanItem,
    onUpdateStatus,
    onDelete,
    onNavigate,
    onRadarOpenDocument
}: ContradictionRadarFeedItemProps) {
    const getCategoryStyles = (category: string, severity: string) => {
        const cat = category || '';
        
        if (cat.includes('סתירה') || severity === 'HIGH') {
            return {
                icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
                bg: 'bg-red-500/5',
                border: 'border-red-500/20',
                text: 'text-red-500',
                glow: 'shadow-[0_0_20px_rgba(239,68,68,0.1)]',
                label: 'סתירה (Contradiction)'
            };
        }
        if (cat.includes('שינוי') || cat.includes('הנחיה') || severity === 'MEDIUM') {
            return {
                icon: <Zap className="h-4 w-4 text-blue-500" />,
                bg: 'bg-blue-500/5',
                border: 'border-blue-500/20',
                text: 'text-blue-500',
                glow: 'shadow-none',
                label: 'שינוי / הנחיה'
            };
        }
        return {
            icon: <Activity className="h-4 w-4 text-emerald-500" />,
            bg: 'bg-emerald-500/5',
            border: 'border-emerald-500/20',
            text: 'text-emerald-500',
            glow: 'shadow-none',
            label: 'אירוע שטח'
        };
    };

    const styles = getCategoryStyles(c.category, c.severity);
    const evidenceStatus = c.evidence_data?.evidence_status || (c.evidence_data?.contract_quote && c.evidence_data?.work_quote ? 'VERIFIED' : 'REQUIRES_VERIFICATION');
    const missingEvidence = Array.isArray(c.evidence_data?.missing_evidence) ? c.evidence_data.missing_evidence : [];

    return (
        <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={`group relative bg-[#151C24]/50 border rounded-[2rem] overflow-hidden transition-all duration-300 ${
                isExpanded ? 'border-white/20 bg-white/[0.03] shadow-[0_30px_60px_rgba(0,0,0,0.4)]' : 'border-white/5 hover:border-white/10'
            }`}
        >
            {/* Severity Line */}
            <div className={`absolute top-0 right-0 w-1 h-full opacity-20 group-hover:opacity-100 transition-opacity ${
                (c.category?.includes('סתירה') || c.severity === 'HIGH') ? 'bg-red-500' : (c.category?.includes('שינוי') || c.severity === 'MEDIUM') ? 'bg-blue-500' : 'bg-emerald-500'
            }`} />

            <div className="p-6 cursor-pointer" onClick={() => onToggleExpand(c.id)}>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${styles.bg} ${styles.border}`}>
                                {styles.icon}
                                <span className={`text-xs font-bold uppercase tracking-wide ${styles.text}`}>
                                    {styles.label}
                                </span>
                            </div>
                            <div className="h-4 w-px bg-white/10" />
                            <span className="text-xs font-mono text-gray-500 uppercase tracking-wide">ID: {c.id.substring(0, 8)}</span>
                            {c.status === 'RESOLVED' && (
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-500">
                                    <CheckCircle2 size={14} />
                                    <span className="text-xs font-bold uppercase tracking-wide">נפתר</span>
                                </div>
                            )}
                            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${
                                evidenceStatus === 'VERIFIED'
                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                            }`}>
                                <ShieldAlert size={13} />
                                <span className="text-xs font-bold uppercase tracking-wide">
                                    {evidenceStatus === 'VERIFIED' ? 'ראיות מאומתות' : 'דורש אימות'}
                                </span>
                            </div>
                        </div>

                        <h3 className="text-xl font-bold text-white leading-tight group-hover:text-blue-400 transition-colors">
                            {c.title}
                        </h3>
                    </div>

                    <div className="flex items-center gap-2 self-end lg:self-center">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                onRescanItem(c.id, c.source_execution_doc_id);
                            }}
                            disabled={isItemRescanning || isScanning}
                            className={`p-2.5 rounded-xl border border-white/10 transition-all ${
                                isItemRescanning ? 'bg-blue-500/20 text-blue-400' : 'bg-white/[0.03] text-gray-500 hover:text-white hover:bg-white/10'
                            }`}
                            title="סריקה מחדש"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isItemRescanning ? 'animate-spin' : ''}`} />
                        </button>
                        <div className={`p-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                            <ChevronDown className="w-4 h-4" />
                        </div>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-8 border-t border-white/5 space-y-10 bg-black/20"
                    >
                        {/* Documents Context */}
                        <div className="flex flex-col md:flex-row md:items-center gap-6 p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <div className="flex flex-wrap items-center gap-6">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRadarOpenDocument(c.source_doc?.file_url, c.evidence_data?.work_page);
                                    }}
                                    className="flex items-center gap-3 group/doc transition-all"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center group-hover/doc:border-blue-500/50 group-hover/doc:bg-blue-500/10 transition-colors">
                                        <FileText className="w-5 h-5 text-gray-400 group-hover/doc:text-blue-400" />
                                    </div>
                                    <div className="flex flex-col items-start text-right">
                                        <span className="text-xs text-gray-500 uppercase font-bold">מקור (ביצוע)</span>
                                        <span className="text-sm text-gray-300 font-bold group-hover/doc:text-white transition-colors">{c.source_doc?.title || 'מסמך לא נמצא'}</span>
                                    </div>
                                </button>

                                <ArrowRightLeft className="text-gray-600 w-4 h-4 hidden md:block" />

                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRadarOpenDocument(c.target_doc?.file_url, c.evidence_data?.contract_page);
                                    }}
                                    className="flex items-center gap-3 group/doc transition-all"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center group-hover/doc:border-blue-500/50 group-hover/doc:bg-blue-500/10 transition-colors">
                                        <Shield className="w-5 h-5 text-gray-400 group-hover/doc:text-blue-400" />
                                    </div>
                                    <div className="flex flex-col items-start text-right">
                                        <span className="text-xs text-gray-500 uppercase font-bold">יעד (חוזה)</span>
                                        <span className="text-sm text-gray-300 font-bold group-hover/doc:text-white transition-colors">{c.target_doc?.title || 'מסמך לא נמצא'}</span>
                                    </div>
                                </button>
                            </div>
                            
                            <div className="flex-1" />
                            
                            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onUpdateStatus(c.id, 'MOVED_TO_PRICING', c);
                                        if (onNavigate) onNavigate('pricing', { estimateId: c.id });
                                    }}
                                    className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all active:scale-95 group"
                                >
                                    <Database className="w-4 h-4" />
                                    תמחור השלכות
                                </button>
                                <button 
                                    onClick={() => onNavigate ? onNavigate('letters', { contradictionId: c.id }) : null}
                                    className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm font-bold text-blue-400 hover:bg-blue-500/20 transition-all active:scale-95"
                                >
                                    <MessageSquare className="w-4 h-4" />
                                    מכתב דרישה
                                </button>
                            </div>
                        </div>

                        {/* Simplified Analysis */}
                        <div className="grid grid-cols-1 gap-8">
                            {/* Main Explanation */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <Info className="w-5 h-5 text-blue-400" />
                                    <span className="text-base text-gray-300 font-bold">תיאור והסבר הנדסי</span>
                                </div>
                                <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/5">
                                    <div className="text-base text-gray-300 leading-relaxed font-medium">
                                        <RichText text={c.description || ''} evidence={c.evidence_data} onOpen={onRadarOpenDocument} />
                                    </div>
                                    {evidenceStatus !== 'VERIFIED' && (
                                        <div className="mt-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                                            <div className="flex items-center gap-2 text-amber-400 text-xs font-black mb-2">
                                                <ShieldAlert className="w-4 h-4" />
                                                הממצא אינו מאומת במלואו
                                            </div>
                                            <p className="text-xs text-gray-400 leading-relaxed">
                                                אין מספיק מקור ישיר לכל הטענות. יש לאמת לפני העברה לדרישה כספית או מכתב רשמי.
                                            </p>
                                            {missingEvidence.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {missingEvidence.map((missing: string, missingIdx: number) => (
                                                        <span key={`missing-${missingIdx}`} className="px-2 py-1 bg-black/30 border border-amber-500/10 rounded-lg text-[10px] text-amber-100/70">
                                                            {missing}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Two Column details */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Contractual */}
                                {c.evidence_data?.expert_strategy?.contractual_diagnostic && (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <Gavel className="w-5 h-5 text-emerald-400" />
                                            <span className="text-sm text-gray-400 font-bold">ביסוס חוזי ותקני</span>
                                        </div>
                                        <div className="bg-emerald-500/5 p-6 rounded-2xl border border-emerald-500/10 space-y-4 h-full">
                                            <div>
                                                <span className="text-xs font-bold text-emerald-500 mb-1 block">בסיס משפטי/תקני</span>
                                                <p className="text-sm text-gray-300 leading-relaxed italic">
                                                    {c.evidence_data.expert_strategy.contractual_diagnostic.legal_basis}
                                                </p>
                                            </div>
                                            <div className="p-4 bg-black/20 rounded-xl border border-white/5 mt-4">
                                                <span className="text-xs font-bold text-emerald-400 mb-2 block">טיעון מול המפקח</span>
                                                <p className="text-sm text-emerald-100/90 font-bold leading-relaxed">
                                                    "{c.evidence_data.expert_strategy.contractual_diagnostic.argument_for_supervisor}"
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Commercial / Financial */}
                                {(c.evidence_data?.expert_strategy?.financial_impact_desc || c.evidence_data?.expert_strategy?.commercial_risk) && (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <TrendingUp className="w-5 h-5 text-blue-400" />
                                            <span className="text-sm text-gray-400 font-bold">השלכות מסחריות ופיננסיות</span>
                                        </div>
                                        <div className="bg-blue-500/5 p-6 rounded-2xl border border-blue-500/10 space-y-4 h-full">
                                            {c.evidence_data.expert_strategy.financial_impact_desc && (
                                                <div>
                                                    <span className="text-xs font-bold text-blue-500 mb-1 block">הערכת השפעה כספית</span>
                                                    <p className="text-sm text-gray-300 leading-relaxed font-medium">
                                                        {c.evidence_data.expert_strategy.financial_impact_desc}
                                                    </p>
                                                </div>
                                            )}
                                            {c.evidence_data.expert_strategy.commercial_risk && (
                                                <div className="pt-2">
                                                    <span className="text-xs font-bold text-blue-400 mb-1 block">סיכון מסחרי</span>
                                                    <p className="text-sm text-blue-100/80 leading-relaxed">
                                                        {c.evidence_data.expert_strategy.commercial_risk}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions & Resolution */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-8 border-t border-white/5">
                            <div className="flex items-center gap-4 text-xs text-gray-500 font-medium">
                                <span>נוצר: {new Date(c.created_at).toLocaleDateString('he-IL')}</span>
                                <span className="hidden sm:inline">•</span>
                                <span>סטטוס: {c.status}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                {c.status !== 'RESOLVED' ? (
                                    <button 
                                        onClick={() => onUpdateStatus(c.id, 'RESOLVED')}
                                        className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-black rounded-xl text-sm font-bold transition-all shadow-lg hover:bg-emerald-400"
                                    >
                                        <CheckCircle2 size={18} />
                                        סמן כנפתר
                                    </button>
                                ) : (
                                    <button 
                                        onClick={() => onUpdateStatus(c.id, 'PENDING')}
                                        className="flex items-center gap-2 px-6 py-3 bg-white/[0.03] border border-white/10 text-gray-300 rounded-xl text-sm font-bold hover:bg-white/[0.05] hover:text-white transition-all"
                                    >
                                        פתח מחדש
                                    </button>
                                )}
                                <button 
                                    onClick={() => onDelete(c.id)}
                                    className="p-3 bg-red-500/[0.03] border border-white/5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                    title="מחק"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
