"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { 
    TrendingUp, TrendingDown, AlertTriangle, FileCheck, 
    Clock, ArrowUpRight, DollarSign, Target, Activity,
    ShieldAlert, ChevronRight, Zap, Sparkles, Building2, FileText
} from "lucide-react";
import { VAT_RATE, AI_MODEL_BRANDING } from "@/utils/constants";

interface ProjectOverviewProps {
    projectId: string;
    onNavigate: (view: string) => void;
}

export default function ProjectOverview({ projectId, onNavigate }: ProjectOverviewProps) {
    const [stats, setStats] = useState({
        originalBudget: 0,
        approvedVO: 0,
        pendingVO: 0,
        criticalCount: 0,
        totalDiscrepancies: 0,
        documentCount: 0,
        evidenceCoverage: 0,
        clientName: ""
    });
    const [isLoading, setIsLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        fetchProjectStats();
    }, [projectId]);

    const fetchProjectStats = async () => {
        setIsLoading(true);
        try {
            // 1. Project Info
            const { data: project } = await supabase
                .from('projects')
                .select('budget, client_name')
                .eq('id', projectId)
                .single();

            // 2. Ledger Data
            const { data: ledger } = await supabase
                .from('pricing_ledger')
                .select('type, total_price_excl_vat, quantity, unit_price_excl_vat, ai_rationale, governing_notes')
                .eq('project_id', projectId);

            // 3. Contradictions
            const { data: contradictions } = await supabase
                .from('contradictions')
                .select('status, category')
                .eq('project_id', projectId);

            // 4. Documents
            const { count: docCount } = await supabase
                .from('documents')
                .select('id', { count: 'exact', head: true })
                .eq('project_id', projectId);

            if (ledger) {
                const baseBudget = ledger
                    .filter(r => r.type === 'BASE_CONTRACT')
                    .reduce((acc, r) => acc + (r.total_price_excl_vat || (r.quantity || 0) * (r.unit_price_excl_vat || 0)), 0);
                
                const approved = ledger
                    .filter(r => r.type === 'APPROVED_VO' || r.type === 'SENT_VO')
                    .reduce((acc, r) => acc + (r.total_price_excl_vat || (r.quantity || 0) * (r.unit_price_excl_vat || 0)), 0);

                const pending = ledger
                    .filter(r => r.type === 'PENDING_VO')
                    .reduce((acc, r) => acc + (r.total_price_excl_vat || (r.quantity || 0) * (r.unit_price_excl_vat || 0)), 0);

                const withEvidence = ledger.filter(r => r.ai_rationale || r.governing_notes).length;
                const coverage = ledger.length > 0 ? Math.round((withEvidence / ledger.length) * 100) : 0;

                const criticalItems = contradictions?.filter(c => c.status === 'OPEN' && c.category === 'CONTRADICTION').length || 0;

                setStats({
                    originalBudget: project?.budget || baseBudget,
                    approvedVO: approved,
                    pendingVO: pending,
                    criticalCount: criticalItems,
                    totalDiscrepancies: contradictions?.length || 0,
                    documentCount: docCount || 0,
                    evidenceCoverage: coverage,
                    clientName: project?.client_name || "לקוח לא ידוע"
                });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const formatILS = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                >
                    <LoaderIcon className="w-10 h-10 text-blue-500 opacity-50" />
                </motion.div>
            </div>
        );
    }

    const totalProjected = stats.originalBudget + stats.approvedVO + stats.pendingVO;
    const progressPercent = stats.originalBudget > 0 ? Math.min(100, (stats.approvedVO / stats.originalBudget) * 100) : 0;

    return (
        <div className="space-y-8 pb-20" dir="rtl">
            {/* Header / Client Info */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-blue-500" />
                        <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest">{stats.clientName}</span>
                    </div>
                    <h2 className="text-3xl font-black text-white font-mono tracking-tighter uppercase">לוח בקרה פרויקטלי</h2>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[11px] font-bold text-emerald-500 uppercase">מערכת מסונכרנת</span>
                    </div>
                    <div className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center gap-2 text-blue-400">
                        <Sparkles size={14} />
                        <span className="text-[11px] font-bold uppercase">טכנולוגיית {AI_MODEL_BRANDING.split(' ')[0]} 3</span>
                    </div>
                </div>
            </div>

            {/* Financial Status Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Budget Card */}
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="lg:col-span-2 bg-[#151C24]/50 border border-white/5 rounded-[2.5rem] p-8 relative overflow-hidden group"
                >
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />
                    
                    <div className="relative z-10 space-y-10">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500 border border-blue-500/20">
                                    <Target size={24} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-gray-400">ניתוח פיננסי כולל</h3>
                                    <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">חוזה מקורי מול צפי סופי</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest">צפי סופי (כולל חריגים)</p>
                                <p className="text-3xl font-black text-white font-mono">{formatILS(totalProjected)}</p>
                            </div>
                        </div>

                        {/* Progress Bars */}
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <div className="flex justify-between text-[11px] font-bold uppercase tracking-tight">
                                    <span className="text-gray-500">תקציב בסיס</span>
                                    <span className="text-white">{formatILS(stats.originalBudget)}</span>
                                </div>
                                <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                    <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: '100%' }}
                                        className="h-full bg-blue-500/40"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-[11px] font-bold uppercase tracking-tight">
                                    <span className="text-emerald-500">חריגים מאושרים (+{progressPercent.toFixed(1)}%)</span>
                                    <span className="text-emerald-500">{formatILS(stats.approvedVO)}</span>
                                </div>
                                <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                    <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progressPercent}%` }}
                                        className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-6 pt-6 border-t border-white/5">
                            <div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase font-black tracking-widest">חריגים בהמתנה</p>
                                <p className="text-lg font-black text-orange-500 font-mono">{formatILS(stats.pendingVO)}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase font-black tracking-widest">מע"מ ({(VAT_RATE * 100).toFixed(0)}%)</p>
                                <p className="text-lg font-black text-gray-400 font-mono">{formatILS(totalProjected * VAT_RATE)}</p>
                            </div>
                            <div className="text-left">
                                <p className="text-[9px] font-mono text-gray-600 uppercase font-black tracking-widest">סה"כ כולל מע"מ</p>
                                <p className="text-lg font-black text-white font-mono">{formatILS(totalProjected * (1 + VAT_RATE))}</p>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Risk & Coverage Card */}
                <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-[#151C24]/50 border border-white/5 rounded-[2.5rem] p-8 flex flex-col justify-between group"
                >
                    <div className="space-y-6">
                        <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 border border-red-500/20">
                            <ShieldAlert size={24} />
                        </div>
                        <h3 className="text-xl font-black text-white font-mono tracking-tighter uppercase">אבחון הנדסי (בינה מלאכותית)</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            מערכת המכ"ם זיהתה <span className="text-red-500 font-bold">{stats.criticalCount}</span> סתירות מהותיות הדורשות בחינה הנדסית מיידית.
                        </p>
                    </div>

                    <div className="space-y-4 mt-8">
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5 flex items-center justify-between group-hover:border-blue-500/30 transition-all">
                            <div className="flex items-center gap-3">
                                <Sparkles size={16} className="text-blue-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">כיסוי הוכחות</span>
                            </div>
                            <span className="text-xl font-black text-blue-400 font-mono">{stats.evidenceCoverage}%</span>
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FileCheck size={16} className="text-emerald-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">מסמכי פרויקט</span>
                            </div>
                            <span className="text-xl font-black text-white font-mono">{stats.documentCount}</span>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* Quick Actions & Recent Activity Placeholder */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: 'בקרת סתירות', icon: <AlertTriangle size={20} />, value: stats.totalDiscrepancies, sub: 'סתירות מזוהות', color: 'blue', view: 'בקרת סתירות' },
                    { label: 'תמחור חריגים', icon: <Zap size={20} />, value: stats.pendingVO > 0 ? 'פעיל' : 'נקי', sub: 'סטטוס תמחור', color: 'orange', view: 'תמחור' },
                    { label: 'מסמכים', icon: <Clock size={20} />, value: stats.documentCount, sub: 'קבצים במערכת', color: 'purple', view: 'מסמכי חוזה' },
                    { label: 'יועץ בינה מלאכותית', icon: <Activity size={20} />, value: 'אונליין', sub: 'תמיכת Gemini', color: 'emerald', view: 'יועץ בינה מלאכותית' },
                ].map((item, i) => (
                    <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + i * 0.1 }}
                        onClick={() => onNavigate(item.view)}
                        className="bg-[#151C24]/50 border border-white/5 p-6 rounded-3xl hover:bg-white/[0.03] transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className={`p-2 rounded-xl bg-${item.color}-500/10 text-${item.color}-500 border border-${item.color}-500/20`}>
                                {item.icon}
                            </div>
                            <ArrowUpRight size={16} className="text-gray-600 group-hover:text-white transition-colors" />
                        </div>
                        <p className="text-[9px] font-mono text-gray-500 uppercase font-black tracking-widest mb-1">{item.label}</p>
                        <p className="text-xl font-black text-white font-mono uppercase">{item.value}</p>
                        <p className="text-[10px] text-gray-600 mt-1">{item.sub}</p>
                    </motion.div>
                ))}
            </div>

            {/* AI Advisor Snapshot */}
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-[2.5rem] p-10 relative overflow-hidden"
            >
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-white text-black rounded-2xl">
                        <Sparkles size={24} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white font-mono uppercase tracking-tighter">סיכום תובנות בינה מלאכותית</h3>
                        <p className="text-[10px] font-mono text-blue-400 uppercase tracking-widest">Powered by {AI_MODEL_BRANDING}</p>
                    </div>
                </div>
                <div className="space-y-4 text-gray-300 text-sm leading-relaxed max-w-3xl">
                    <p>
                        המערכת זיהתה פוטנциаל להגדלת התקציב בשיעור של <span className="text-emerald-400 font-bold">{(stats.pendingVO / stats.originalBudget * 100 || 0).toFixed(1)}%</span> דרך חריגים הממתינים לאישור.
                    </p>
                    <p>
                        יש להקפיד על כיסוי הוכחות (כרגע {stats.evidenceCoverage}%) עבור סעיפי הבסיס כדי למנוע דחיות עתידיות של דרישות תשלום. <span onClick={() => onNavigate('בקרת סתירות')} className="text-blue-400 underline cursor-pointer">לחץ כאן לצפייה בפירוט.</span>
                    </p>
                </div>
                <div className="flex items-center gap-3 mt-6">
                    <button 
                        onClick={() => window.print()}
                        className="px-6 py-3 bg-white text-black font-black text-xs uppercase tracking-tighter hover:bg-blue-400 transition-all flex items-center gap-2 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    >
                        <FileText size={16} />
                        הפק דוח סטטוס פרויקט (PDF)
                    </button>
                    <div className="h-px flex-1 bg-gradient-to-r from-blue-500/50 to-transparent" />
                </div>
                <div className="absolute top-1/2 left-0 -translate-y-1/2 opacity-20 pointer-events-none">
                    <Zap size={200} className="text-blue-500 blur-3xl" />
                </div>
            </motion.div>
        </div>
    );
}

function LoaderIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 2v4" />
            <path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" />
            <path d="m19.1 14.9 2.9 2.9" />
            <path d="M12 18v4" />
            <path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" />
            <path d="m2.1 7.8 2.9-2.9" />
        </svg>
    )
}
