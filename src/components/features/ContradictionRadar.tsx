import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { 
    AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight, 
    CheckCircle2, XCircle, ArrowRightLeft, Search, RefreshCw, 
    Check, Download, FileText, Trash2, ShieldAlert, FileSearch, 
    Scale, Gavel, Quote, ExternalLink, Sparkles, Database, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ContradictionRadarProps {
    projectId: string;
}

const RichText = ({ text, evidence }: { text: string; evidence?: any }) => {
    if (!text) return null;
    
    const parts = text.split(/(\[[12]\])/);
    
    return (
        <span dir="rtl" className="leading-relaxed">
            {parts.map((part, i) => {
                const isMarker1 = part === '[1]';
                const isMarker2 = part === '[2]';
                
                if (isMarker1 || isMarker2) {
                    const quote = isMarker1 ? evidence?.contract_quote : evidence?.work_quote;
                    const title = isMarker1 ? evidence?.contract_title : evidence?.work_title;
                    
                    if (!quote) return <span key={i} className="text-primary/50 font-mono mx-0.5">{part}</span>;
                    
                    return (
                        <span key={i} className="group relative inline-block mx-1">
                            <motion.span 
                                whileHover={{ scale: 1.1 }}
                                className={`cursor-help px-2 py-0.5 rounded-md text-[10px] font-black border transition-all shadow-sm ${
                                    isMarker1 
                                    ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20' 
                                    : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                                }`}
                            >
                                {part}
                            </motion.span>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-72 p-4 bg-workspace/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-300 z-50 translate-y-2 group-hover:translate-y-0">
                                <span className="block font-black text-[10px] uppercase tracking-widest text-gray-500 mb-2 border-b border-white/5 pb-2 flex items-center justify-between">
                                    <span className="flex items-center gap-1.5">
                                        <Quote className="w-3 h-3 text-primary" />
                                        {isMarker1 ? 'ציטוט מהחוזה' : 'ציטוט מהביצוע'}
                                    </span>
                                    <span className="text-white/20 font-mono">{part}</span>
                                </span>
                                <p className="text-xs text-gray-200 leading-relaxed italic font-medium">
                                    "{quote}"
                                </p>
                                <div className="mt-3 pt-2 border-t border-white/5 flex items-center gap-2 text-[9px] text-gray-500 font-bold truncate">
                                    <FileText className="w-2.5 h-2.5" />
                                    {title}
                                </div>
                            </span>
                        </span>
                    );
                }
                return part;
            })}
        </span>
    );
};

export default function ContradictionRadar({ projectId }: ContradictionRadarProps) {
    const supabase = createClient();
    const [contradictions, setContradictions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [scanResult, setScanResult] = useState<string | null>(null);
    const [isFromCache, setIsFromCache] = useState(false);
    const [scanningItems, setScanningItems] = useState<string[]>([]);
    const [movingItems, setMovingItems] = useState<string[]>([]);

    useEffect(() => {
        fetchContradictions();
    }, [projectId]);

    const fetchContradictions = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('contradictions')
                .select('*, source_doc: documents!contradictions_source_execution_doc_id_fkey(title), target_doc: documents!contradictions_target_contract_doc_id_fkey(title)')
                .eq('project_id', projectId)
                .order('severity', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            setContradictions(data || []);
        } catch (err: any) {
            console.error('Error fetching contradictions:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const getSeverityStyles = (severity: string) => {
        switch (severity) {
            case 'HIGH': return {
                icon: <ShieldAlert className="h-5 w-5 text-red-500" />,
                bg: 'bg-red-500/10',
                border: 'border-red-500/20',
                text: 'text-red-400',
                glow: 'shadow-[0_0_30px_rgba(239,68,68,0.15)]'
            };
            case 'MEDIUM': return {
                icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
                bg: 'bg-orange-500/10',
                border: 'border-orange-500/20',
                text: 'text-orange-400',
                glow: 'shadow-none'
            };
            case 'LOW': return {
                icon: <Info className="h-5 w-5 text-blue-500" />,
                bg: 'bg-blue-500/10',
                border: 'border-blue-500/20',
                text: 'text-blue-400',
                glow: 'shadow-none'
            };
            default: return {
                icon: <Info className="h-5 w-5 text-gray-400" />,
                bg: 'bg-gray-500/10',
                border: 'border-gray-500/20',
                text: 'text-gray-400',
                glow: 'shadow-none'
            };
        }
    };

    const getSeverityLabel = (severity: string) => {
        switch (severity) {
            case 'HIGH': return 'קריטי (V.O)';
            case 'MEDIUM': return 'בינוני';
            case 'LOW': return 'נמוך';
            default: return severity;
        }
    };

    const updateStatus = async (id: string, newStatus: string) => {
        try {
            const { error } = await supabase
                .from('contradictions')
                .update({ status: newStatus })
                .eq('id', id);

            if (error) throw error;

            setContradictions(prev =>
                prev.map(c => c.id === id ? { ...c, status: newStatus } : c)
            );
        } catch (err) {
            console.error('Error updating status:', err);
        }
    };

    const scanProject = async (force = false, documentIds: string[] = []) => {
        setIsScanning(true);
        setScanResult(force ? 'מפעיל סריקה מלאה...' : 'בודק נתונים קיימים...');
        setIsFromCache(false);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); 

        try {
            const res = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, force, documentIds }),
                signal: controller.signal
            });
            
            const data = await res.json();
            clearTimeout(timeoutId);

            if (data.success) {
                setIsFromCache(!!data.cached);
                setScanResult(data.cached ? 'נתונים נשלפו מהזיכרון' : `נמצאו ${data.found} סתירות חדשות`);
                await fetchContradictions();
            } else {
                setScanResult(data.message || 'לא נמצאו סתירות');
            }
        } catch (err: any) {
            clearTimeout(timeoutId);
            setScanResult(err.name === 'AbortError' ? 'חריגת זמן (Timeout)' : 'שגיאת מערכת');
            console.error('Scan error:', err);
        } finally {
            setIsScanning(false);
            setTimeout(() => setScanResult(null), 5000);
        }
    };

    const rescanSingleItem = async (contradiction: any) => {
        if (!contradiction.source_execution_doc_id) return;
        setScanningItems(prev => [...prev, contradiction.id]);
        try {
            await scanProject(true, [contradiction.source_execution_doc_id]);
        } finally {
            setScanningItems(prev => prev.filter(id => id !== contradiction.id));
        }
    };

    const moveToPricing = async (contradiction: any) => {
        setMovingItems(prev => [...prev, contradiction.id]);
        try {
            // 1. Получаем AI оценку стоимости
            const evalRes = await fetch('/api/pricing/evaluate-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contradictionId: contradiction.id, 
                    projectId 
                })
            });

            const evaluation = await evalRes.json();
            
            // 2. Создаем запись в леджере с данными от AI
            const { error: ledgerError } = await supabase
                .from('pricing_ledger')
                .insert({
                    project_id: projectId,
                    type: 'PENDING_VO',
                    source: evaluation.source || 'CUSTOM_ANALYSIS',
                    item_code: evaluation.item_code || '',
                    description: evaluation.suggested_description || `[סתירה] ${contradiction.title}`,
                    unit: evaluation.suggested_unit || 'יח\'',
                    quantity: evaluation.suggested_quantity || 1,
                    unit_price_excl_vat: evaluation.suggested_unit_price_excl_vat || 0,
                    contradiction_id: contradiction.id,
                });

            if (ledgerError) throw ledgerError;
            await updateStatus(contradiction.id, 'MOVED_TO_PRICING');
        } catch (err) {
            console.error('Error moving to pricing:', err);
            alert('שגיאה בחישוב מחיר AI. הועבר עם מחיר 0.');
            
            // Fallback: создаем пустую запись если AI упал
            await supabase.from('pricing_ledger').insert({
                project_id: projectId,
                type: 'PENDING_VO',
                source: 'CUSTOM_ANALYSIS',
                description: `[סתירה] ${contradiction.title}`,
                quantity: 1,
                unit_price_excl_vat: 0,
                contradiction_id: contradiction.id,
            });
            await updateStatus(contradiction.id, 'MOVED_TO_PRICING');
        } finally {
            setMovingItems(prev => prev.filter(id => id !== contradiction.id));
        }
    };

    const clearContradictions = async () => {
        if (!confirm("האם למחוק את כל הסתירות?")) return;
        setIsClearing(true);
        try {
            await fetch(`/api/scan/clear?projectId=${projectId}`, { method: 'DELETE' });
            await fetchContradictions();
        } catch (error) {
            console.error("Error clearing:", error);
        } finally {
            setIsClearing(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header with Glass Effects */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-8 bg-workspace/30 backdrop-blur-3xl border border-white/5 rounded-[2rem] shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/5 blur-[100px] -mr-32 -mt-32 group-hover:bg-red-600/10 transition-all duration-1000" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/5 blur-[100px] -ml-32 -mb-32 group-hover:bg-primary/10 transition-all duration-1000" />
                
                <div className="flex flex-col gap-2 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20 shadow-inner">
                            <ShieldAlert className="w-7 h-7 text-red-500" />
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-white tracking-tight">
                                רדאר סתירות
                            </h2>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-[9px] font-black uppercase tracking-widest text-red-500">
                                    <Gavel className="w-2.5 h-2.5" />
                                    Lawyer Mode v3.1
                                </span>
                                <span className="text-[9px] font-bold text-gray-600 uppercase tracking-tighter">Powered by Gemini 2.5 Flash</span>
                                {isFromCache && (
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[9px] font-black uppercase tracking-widest text-blue-400">
                                        <Database className="w-2.5 h-2.5" />
                                        בזיכרון (Cached)
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    {scanResult && (
                        <motion.div 
                            initial={{ opacity: 0, x: -10 }} 
                            animate={{ opacity: 1, x: 0 }}
                            className="text-xs font-bold text-primary mt-2 flex items-center gap-2"
                        >
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            {scanResult}
                        </motion.div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-4 relative z-10">
                    <motion.button
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => scanProject(false)}
                        disabled={isScanning}
                        className="relative group px-8 py-3.5 rounded-2xl bg-white text-black font-black text-sm transition-all shadow-[0_20px_40px_rgba(255,255,255,0.1)] flex items-center gap-3 overflow-hidden disabled:opacity-50"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 to-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        <Sparkles className={`w-4 h-4 relative z-10 ${isScanning ? 'animate-spin' : ''}`} />
                        <span className="relative z-10">{isScanning ? "מנתח..." : "סריקה חכמה (Smart Scan)"}</span>
                    </motion.button>

                    <div className="flex gap-2">
                         <button
                            onClick={() => scanProject(true)}
                            disabled={isScanning}
                            className="p-3.5 rounded-2xl bg-white/5 border border-white/5 text-gray-500 hover:text-primary hover:bg-primary/10 hover:border-primary/20 transition-all shadow-xl"
                            title="סריקה מלאה מחדש (Force Refresh)"
                        >
                            <RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-spin' : ''}`} />
                        </button>

                        <button
                            onClick={clearContradictions}
                            disabled={isClearing}
                            className="p-3.5 rounded-2xl bg-white/5 border border-white/5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/20 transition-all shadow-xl"
                            title="נקה הכל"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {[
                    { label: 'קריטי (V.O)', count: contradictions.filter(c => c.severity === 'HIGH').length, icon: ShieldAlert, color: 'text-red-500', bg: 'bg-red-500/5' },
                    { label: 'בינוני', count: contradictions.filter(c => c.severity === 'MEDIUM').length, icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-500/5' },
                    { label: 'נמוך', count: contradictions.filter(c => c.severity === 'LOW').length, icon: Info, color: 'text-blue-500', bg: 'bg-blue-500/5' },
                    { label: 'טופלו', count: contradictions.filter(c => c.status !== 'OPEN').length, icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/5' }
                ].map((stat, idx) => (
                    <motion.div 
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="p-5 bg-workspace/20 backdrop-blur-xl border border-white/5 rounded-3xl flex items-center gap-5 shadow-xl group hover:border-white/10 transition-all"
                    >
                        <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform`}>
                            <stat.icon className={`w-6 h-6 ${stat.color}`} />
                        </div>
                        <div>
                            <div className="text-2xl font-black text-white">{stat.count}</div>
                            <div className="text-[9px] text-gray-500 uppercase tracking-widest font-black">{stat.label}</div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Main Feed */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full border-2 border-white/10 border-t-red-500 animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-red-500/50" />
                        </div>
                    </div>
                    <p className="text-gray-400 animate-pulse font-medium">המערכת מעבדת נתונים...</p>
                </div>
            ) : contradictions.length === 0 ? (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="text-center py-24 bg-workspace/10 border border-white/5 rounded-2xl border-dashed"
                >
                    <CheckCircle2 className="h-16 w-16 text-green-500/30 mx-auto mb-6" />
                    <h3 className="text-xl font-bold text-gray-300 mb-2">מסמכים מסונכרנים</h3>
                    <p className="text-gray-500 max-w-sm mx-auto">לא נמצאו סתירות מהותיות בפרויקט הנוכחי. המשיכו בעבודה!</p>
                </motion.div>
            ) : (
                <div className="space-y-4">
                    <AnimatePresence mode="popLayout">
                        {contradictions.map((c, i) => {
                            const styles = getSeverityStyles(c.severity);
                            const isExpanded = expandedId === c.id;
                            
                            return (
                                <motion.div
                                    key={c.id}
                                    layout
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.3, delay: i * 0.05 }}
                                    className={`relative group border border-white/10 bg-workspace/40 backdrop-blur-xl rounded-2xl overflow-hidden transition-all hover:border-white/20 ${styles.glow} ${isExpanded ? 'ring-1 ring-white/20 shadow-2xl' : ''}`}
                                >
                                    <div 
                                        className="flex items-center gap-4 p-5 cursor-pointer"
                                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                    >
                                        <div className={`w-12 h-12 rounded-xl ${styles.bg} ${styles.border} flex items-center justify-center shrink-0`}>
                                            {styles.icon}
                                        </div>
                                        
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-1">
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${styles.bg} ${styles.border} ${styles.text}`}>
                                                    {getSeverityLabel(c.severity)}
                                                </span>
                                                <h3 className="text-lg font-bold text-gray-100 truncate" dir="rtl">{c.title}</h3>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                                                <span className="truncate max-w-[150px]">{c.source_doc?.title || 'ביצוע'}</span>
                                                <ArrowRightLeft className="w-3 h-3 text-white/10" />
                                                <span className="truncate max-w-[150px]">{c.target_doc?.title || 'חוזה'}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="flex flex-col items-end opacity-60 group-hover:opacity-100 transition-opacity">
                                                <span className="text-[10px] uppercase text-gray-500 font-bold mb-1 tracking-tighter">סטטוס</span>
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-300">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${c.status === 'OPEN' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                                                    {c.status}
                                                </div>
                                            </div>
                                            {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-600" /> : <ChevronRight className="w-5 h-5 text-gray-600" />}
                                        </div>
                                    </div>

                                    {/* Expanded Content with Luxury Minimal Design */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="border-t border-white/5 bg-black/20"
                                            >
                                                <div className="p-6 space-y-6">
                                                    {/* Strategy - Lawyer Mode */}
                                                    <div className="relative p-5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]">
                                                        <div className="absolute top-4 left-4 flex gap-2">
                                                            <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                                                                <Gavel className="w-4 h-4 text-indigo-400" />
                                                            </div>
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); rescanSingleItem(c); }}
                                                                disabled={isScanning}
                                                                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-gray-500 hover:text-primary transition-all"
                                                                title="סרוק מסמך זה מחדש"
                                                            >
                                                                <RefreshCw className={`w-4 h-4 ${scanningItems.includes(c.id) ? 'animate-spin text-primary' : ''}`} />
                                                            </button>
                                                        </div>
                                                        <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2" dir="rtl">
                                                            אסטרטגיה מומלצת (LAWYER MODE)
                                                        </h4>
                                                        <p className="text-sm text-gray-200 leading-relaxed font-medium" dir="rtl">
                                                            {c.strategy_advice || 'לא צוינה אסטרטגיה ספציפית.'}
                                                        </p>
                                                        
                                                        {c.evidence_data?.business_value && (
                                                            <div className="mt-4 pt-4 border-t border-indigo-500/10">
                                                                <h5 className="text-[10px] font-black text-primary uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                                                    <Sparkles className="w-2.5 h-2.5" />
                                                                    ערך מסחרי
                                                                </h5>
                                                                <p className="text-xs text-gray-300" dir="rtl">{c.evidence_data.business_value}</p>
                                                            </div>
                                                        )}

                                                        {c.evidence_data?.justification && (
                                                            <div className="mt-3 pt-3 border-t border-indigo-500/10">
                                                                <h5 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                                                    <Scale className="w-2.5 h-2.5" />
                                                                    הצדקה הנדסית
                                                                </h5>
                                                                <p className="text-xs text-gray-400 leading-tight" dir="rtl">{c.evidence_data.justification}</p>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Fact & Description */}
                                                    <div>
                                                        <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3" dir="rtl">תיאור הממצא</h4>
                                                        <div className="text-sm text-gray-300 leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">
                                                            <RichText text={c.description} evidence={c.evidence_data} />
                                                        </div>
                                                    </div>

                                                    {/* Evidence / Quotes */}
                                                    {c.evidence_data && (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                                                                <div className="text-[10px] font-bold text-primary mb-2 flex items-center gap-1">
                                                                    <Quote className="w-3 h-3" />
                                                                    מתוך החוזה [1]
                                                                </div>
                                                                <p className="text-xs text-gray-400 italic" dir="rtl">"{c.evidence_data.contract_quote}"</p>
                                                            </div>
                                                            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                                                                <div className="text-[10px] font-bold text-red-400 mb-2 flex items-center gap-1">
                                                                    <Quote className="w-3 h-3" />
                                                                    מתוך מסמך ביצוע [2]
                                                                </div>
                                                                <p className="text-xs text-gray-400 italic" dir="rtl">"{c.evidence_data.work_quote}"</p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Actions */}
                                                    <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                                        <div className="flex gap-2">
                                                            <button 
                                                                onClick={() => updateStatus(c.id, 'IGNORED')}
                                                                className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white transition-colors"
                                                            >
                                                                התעלם
                                                            </button>
                                                            <button 
                                                                onClick={() => updateStatus(c.id, 'AUTO_RESOLVED')}
                                                                className="px-4 py-2 text-xs font-bold text-green-500 hover:bg-green-500/10 rounded-lg transition-all"
                                                            >
                                                                נפתר
                                                            </button>
                                                        </div>
                                                        
                                                        <motion.button
                                                            whileHover={{ scale: 1.05 }}
                                                            whileTap={{ scale: 0.95 }}
                                                            onClick={() => moveToPricing(c)}
                                                            className="px-6 py-2 rounded-xl bg-white text-black font-bold text-xs flex items-center gap-2 shadow-xl hover:bg-gray-100 transition-all"
                                                        >
                                                            <ArrowRightLeft className="w-3 h-3" />
                                                            העבר לתמחור (V.O.)
                                                        </motion.button>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}

