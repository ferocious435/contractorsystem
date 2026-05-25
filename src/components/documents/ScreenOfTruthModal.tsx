"use client";

import React, { useState } from 'react';
import { X, CheckCircle, FileText, AlertTriangle, Shield, Cpu, Activity, Zap, Layers, Maximize2, CheckCircle2, ShieldCheck, FileSearch, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScreenOfTruthModalProps {
    document: any;
    onClose: () => void;
    onValidate: (id: string, updatedJSON: any) => Promise<void>;
}

/**
 * Screen of Truth — מסך אימות [Terminal of Truth]
 * 
 * מציג את ה-PDF המקורי (שמאל) לצד המידע שה-AI חילץ (ימין).
 * עיצוב Loki Mode: מינימליזם יוקרתי, פונטים מונוספייס, אסתטיקה של "מסוף".
 */
export default function ScreenOfTruthModal({ document: doc, onClose, onValidate }: ScreenOfTruthModalProps) {
    const [isValidating, setIsValidating] = useState(false);
    const jsonData = doc.parsed_json || {};
    const isStructured = jsonData && !Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData.type;
    const hasFinancialItems = jsonData.financial_data?.items?.length > 0;
    const hasWarnings = jsonData.warnings?.length > 0 && jsonData.warnings[0] !== undefined;
    const isAlreadyValidated = doc.ai_status === 'VALIDATED';

    const handleValidate = async () => {
        setIsValidating(true);
        try {
            await onValidate(doc.id, jsonData);
            onClose();
        } catch (err) {
            console.error('Validation error:', err);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07090C]/98 backdrop-blur-2xl p-0 md:p-6 lg:p-10"
        >
            <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-[#0B0F14] w-full h-full border border-white/10 shadow-[0_50px_100px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden relative rounded-[2.5rem]"
            >
                
                {/* Background Grid Pattern */}
                <div className="absolute inset-0 opacity-[0.02] pointer-events-none" 
                     style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

                {/* Header: System Terminal Bar */}
                <div className="flex justify-between items-center px-10 py-6 border-b border-white/5 bg-black/40 relative z-10 backdrop-blur-md">
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-500 ${
                                    isAlreadyValidated 
                                        ? 'border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.2)]' 
                                        : 'border-blue-500/30 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                                }`}>
                                    {isAlreadyValidated ? <ShieldCheck className="w-6 h-6 text-emerald-400" /> : <Cpu className="w-6 h-6 text-blue-400" />}
                                </div>
                                {!isAlreadyValidated && (
                                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-500 rounded-full animate-pulse border-2 border-[#0B0F14] shadow-[0_0_15px_rgba(59,130,246,0.8)]"></div>
                                )}
                            </div>
                            <div className="flex flex-col">
                                <div className="flex items-center gap-3 mb-1">
                                    <h2 className="text-lg font-black text-white uppercase tracking-tight leading-none font-mono">{doc.title}</h2>
                                    <span className="text-[10px] font-mono text-gray-500 px-3 py-1 border border-white/5 bg-white/5 rounded-lg">מזהה: {doc.id.slice(0, 8)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${isAlreadyValidated ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'}`} />
                                    <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-black">
                                        <span className={isAlreadyValidated ? 'text-emerald-500' : 'text-blue-500'}>סטטוס:</span> {isAlreadyValidated ? 'מאומת_בכספת' : 'ביקורת_מודיעין_בביצוע'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="hidden xl:flex items-center gap-10 border-l border-white/10 pr-10">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-1 font-black">מודל_עצבי</span>
                                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Powered by Gemini 3.5 Flash</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-1 font-black">רמת_ביטחון_חילוץ</span>
                                <div className="flex items-center gap-2">
                                    <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 w-[98%]" />
                                    </div>
                                    <span className="text-[11px] font-mono text-emerald-500 font-black">98.4%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <button 
                        onClick={onClose} 
                        className="w-12 h-12 flex items-center justify-center text-gray-500 hover:text-white hover:bg-red-500/10 rounded-2xl border border-white/5 hover:border-red-500/20 transition-all group"
                    >
                        <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative z-10">
                    
                    {/* LEFT: Source Material [SCANNER] */}
                    <div className="flex-1 flex flex-col border-l border-white/5 bg-black/20">
                        <div className="px-6 py-3 bg-black/40 border-b border-white/5 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <FileSearch size={14} className="text-blue-400" />
                                <span className="text-[11px] font-mono text-gray-400 uppercase tracking-widest font-black">מטריצת_מקור_גולמית [PDF]</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">היפוך_צבעים: כבוי</span>
                                <div className="flex gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                                    <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 relative bg-[#07090C] overflow-hidden flex items-center justify-center group">
                            {doc.file_url ? (
                                <iframe src={`${doc.file_url}#toolbar=0`} className="w-full h-full border-none brightness-90 contrast-[1.05]" />
                            ) : (
                                <div className="flex flex-col items-center gap-6">
                                    <div className="p-8 bg-white/[0.02] border border-white/5 rounded-[2.5rem]">
                                        <Layers className="text-gray-800" size={64} />
                                    </div>
                                    <span className="text-[11px] font-mono text-gray-700 uppercase tracking-[0.3em] font-black">זרם_ויזואלי_לא_זמין</span>
                                </div>
                            )}
                            
                            {/* Scanning Overlay Effect */}
                            {!isAlreadyValidated && (
                                <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10">
                                    <div className="h-4 w-full bg-blue-500 shadow-[0_0_50px_rgba(59,130,246,1)] absolute left-0 top-0 animate-[scan_6s_linear_infinite]"></div>
                                </div>
                            )}
                            
                            <div className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                                <button className="p-4 bg-white text-black rounded-2xl shadow-2xl hover:scale-110 transition-transform active:scale-95">
                                    <Maximize2 size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: Extracted Intelligence [JSON_DASHBOARD] */}
                    <div className="w-full md:w-[600px] lg:w-[750px] flex flex-col bg-[#0B0F14] relative shadow-[-20px_0_50px_rgba(0,0,0,0.5)]">
                        <div className="px-6 py-3 bg-black/40 border-b border-white/5 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <Zap size={14} className="text-emerald-400 fill-emerald-400/20" />
                                <span className="text-[11px] font-mono text-gray-400 uppercase tracking-widest font-black">זרם_מודיעין [מפוענח]</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[8px] font-mono text-emerald-500 font-black tracking-widest">סנכרון_חי</div>
                                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-10 space-y-12" dir="rtl">
                            {isStructured ? (
                                <>
                                    {/* Entity Header */}
                                    <div className="relative">
                                        <div className="absolute top-0 right-0 w-1 h-full bg-emerald-500 rounded-full" />
                                        <div className="pr-8">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[10px] font-mono text-gray-500 font-black uppercase tracking-widest">
                                                    {jsonData.category || 'סיווג_נכס'}
                                                </span>
                                                <div className="h-px w-8 bg-white/10" />
                                                <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">מזהה_מאומת</span>
                                            </div>
                                            <h3 className="text-3xl font-black text-white tracking-tighter uppercase leading-tight font-mono">
                                                {jsonData.type || 'ישות_מסמך'}
                                            </h3>
                                        </div>
                                    </div>

                                    {/* Primary Grid Metrics */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-[#151C24]/50 border border-white/5 rounded-3xl p-6 flex flex-col gap-2 group hover:border-white/10 transition-colors">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Activity size={12} className="text-gray-600" />
                                                <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest font-black">תאריך_הנפקה</span>
                                            </div>
                                            <span className="text-lg font-black text-gray-300 font-mono tracking-tight uppercase">
                                                {jsonData.date || 'לא_נמצא'}
                                            </span>
                                        </div>
                                        <div className="bg-[#151C24]/50 border border-white/5 rounded-3xl p-6 flex flex-col gap-2 group hover:border-emerald-500/20 transition-colors">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Zap size={12} className="text-emerald-500/50" />
                                                <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest font-black">השפעה_כלכלית</span>
                                            </div>
                                            <span className="text-lg font-black text-emerald-400 font-mono tracking-tight">
                                                ₪{jsonData.financial_data?.total_amount?.toLocaleString() || '0.00'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Executive Summary */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-4">
                                            <span className="text-[11px] font-mono text-gray-500 uppercase tracking-[0.3em] font-black whitespace-nowrap">דו"ח_מודיעין</span>
                                            <div className="flex-1 h-[1px] bg-gradient-to-l from-white/5 to-transparent"></div>
                                        </div>
                                        <div className="bg-white/[0.02] p-8 rounded-[2rem] border border-white/5 relative group">
                                            <div className="absolute -top-2 -right-2 p-2 bg-[#0B0F14] border border-white/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Info size={14} className="text-blue-500" />
                                            </div>
                                            <p className="text-base text-gray-400 leading-relaxed font-medium text-right">
                                                {jsonData.summary}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Warnings / Discrepancies */}
                                    {hasWarnings && (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-4">
                                                <span className="text-[11px] font-mono text-red-500/70 uppercase tracking-[0.3em] font-black whitespace-nowrap">זוהו_חריגות</span>
                                                <div className="flex-1 h-[1px] bg-gradient-to-l from-red-500/10 to-transparent"></div>
                                            </div>
                                            <div className="space-y-3">
                                                {jsonData.warnings.map((w: string, i: number) => (
                                                    <div key={i} className="flex items-start gap-4 p-4 bg-red-500/[0.03] border border-red-500/10 rounded-2xl">
                                                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                                        <span className="text-sm text-red-400/80 font-medium">{w}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Items Table - High Tech Style */}
                                    {hasFinancialItems && (
                                        <div className="space-y-6">
                                            <div className="flex justify-between items-end">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[11px] font-mono text-gray-500 uppercase tracking-[0.3em] font-black">מטריצת_ביקורת [כתב כמויות]</span>
                                                    <div className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-mono text-gray-600 font-bold">
                                                        {jsonData.financial_data.items.length}_נקודות_נתונים
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bg-[#151C24]/30 rounded-[2rem] border border-white/5 overflow-hidden">
                                                <table className="w-full text-sm border-collapse" dir="rtl">
                                                    <thead>
                                                        <tr className="bg-white/[0.03] text-gray-500 font-mono text-[10px] uppercase tracking-widest">
                                                            <th className="px-6 py-4 text-right font-black">קוד_סעיף</th>
                                                            <th className="px-6 py-4 text-right font-black">תיאור_עבודה</th>
                                                            <th className="px-6 py-4 text-center font-black">כמות</th>
                                                            <th className="px-6 py-4 text-left font-black">סה"כ_בפועל</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-white/[0.03]">
                                                        {jsonData.financial_data.items.map((item: any, i: number) => (
                                                            <tr key={i} className="hover:bg-white/[0.02] transition-colors group/row">
                                                                <td className="px-6 py-4 font-mono text-[11px] text-gray-600 font-black">{item.code || '---'}</td>
                                                                <td className="px-6 py-4 text-gray-300 font-medium">{item.description}</td>
                                                                <td className="px-6 py-4 text-center font-mono text-gray-500">{item.quantity} {item.unit}</td>
                                                                <td className="px-6 py-4 text-left font-mono font-black text-emerald-500/80">
                                                                    ₪{item.total_price?.toLocaleString()}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full gap-6 opacity-20">
                                    <div className="p-10 border-2 border-dashed border-white/10 rounded-[3rem]">
                                        <Activity size={64} className="text-white" />
                                    </div>
                                    <span className="text-[12px] font-mono uppercase tracking-[0.5em] font-black">נדרש_פענוח</span>
                                </div>
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="px-10 py-8 bg-black/40 border-t border-white/5 backdrop-blur-xl relative z-20">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-black">פרוטוקול_אימות_אנושי</span>
                                </div>
                                <div className="flex gap-4">
                                    <button 
                                        onClick={onClose}
                                        className="px-8 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-gray-400 text-[11px] font-black uppercase tracking-widest hover:text-white hover:bg-white/10 transition-all active:scale-95"
                                    >
                                        ביטול
                                    </button>
                                    {!isAlreadyValidated && (
                                        <button 
                                            onClick={handleValidate}
                                            disabled={isValidating}
                                            className="relative overflow-hidden px-10 py-3 bg-emerald-500 text-black rounded-2xl text-[11px] font-black uppercase tracking-widest hover:scale-105 transition-all active:scale-95 shadow-[0_20px_40px_rgba(16,185,129,0.2)] disabled:opacity-50 group"
                                        >
                                            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                                            {isValidating ? (
                                                <div className="flex items-center gap-2">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    מסנכרן...
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    שמירה_לכספת
                                                </div>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
            <style jsx global>{`
                @keyframes scan {
                    0% { top: 0%; }
                    100% { top: 100%; }
                }
            `}</style>
        </motion.div>
    );
}

function Loader2(props: any) {
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
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    )
}
