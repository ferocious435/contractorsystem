"use client";

import React, { useState, useEffect } from 'react';
import { X, Bot, AlertTriangle, Calculator, Check, ArrowRightLeft, FileSpreadsheet, Loader2, Tag, ChevronLeft, Brain, Terminal, ShieldAlert, Zap, Layers, Gavel, Scale, Shield, Plus, DollarSign, Activity, Cpu, ShieldCheck, Briefcase } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScreenOfTruthModal from '@/components/documents/ScreenOfTruthModal';
import { createClient } from '@/utils/supabase/client';
import { VAT_RATE } from '@/utils/constants';
import { ContradictionItem } from '@/types';
import { ApproveEstimationPayload } from '@/components/features/PricingLedgerUI';

interface AIEstimatorModalProps {
    contradiction: ContradictionItem;
    onClose: () => void;
    onApprove: (data: ApproveEstimationPayload) => Promise<void>;
}

/**
 * מסוף אבחון בינה מלאכותית
 * מסוף פיננסי לניתוח סתירות והערכת השפעתן.
 * תומך ב-"מצב מומחה" ליצירת אסטרטגיות הנדסיות-מסחריות.
 */
export default function AIEstimatorModal({ contradiction, onClose, onApprove }: AIEstimatorModalProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [estimateData, setEstimateData] = useState<any>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isExpertMode, setIsExpertMode] = useState(false);
    const [formState, setFormState] = useState({
        description: '',
        unit: '',
        quantity: 0,
        unitPrice: 0,
        markup: 0,
        source: 'CUSTOM_ANALYSIS'
    });

    const [viewerDoc, setViewerDoc] = useState<any | null>(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    const supabase = createClient();
    const normalizeConfidence = (value: unknown) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
        if (numericValue <= 1) return numericValue;
        if (numericValue <= 100) return numericValue / 100;
        return 1;
    };

    const runEstimation = async (withExpert: boolean = false) => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/pricing/evaluate-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contradictionId: contradiction.id,
                    projectId: contradiction.project_id || contradiction.projectId,
                    expertMode: withExpert
                })
            });

            const data = await res.json();
            setEstimateData(data);

            // עדכון אוטומטי של הטופס
            setFormState(prev => ({
                description: data.suggested_description || contradiction.description || prev.description,
                unit: data.suggested_unit || 'מ"ר',
                quantity: data.suggested_quantity || 1,
                unitPrice: data.suggested_unit_price_excl_vat || 0,
                markup: data.match_quality === 'ZERO_MATCH' ? (prev.markup || 15) : 0,
                source: data.source || (data.item_code === 'NEW' ? 'CUSTOM_ANALYSIS' : 'BOQ')
            }));

        } catch (e) {
            console.error('[AI_TERMINAL_ERROR]:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        runEstimation(isExpertMode);
    }, [contradiction.id, isExpertMode]);

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({
            ...prev,
            [name]: (name === 'description' || name === 'unit' || name === 'source') ? value : Number(value)
        }));
    };

    const handleSubmit = async () => {
        setIsSaving(true);
        try {
            const effectiveUnitPriceExclVat = formState.unitPrice * (1 + (formState.markup / 100));
            const pricingNotes = [
                ...(estimateData?.governing_notes || []),
                ...(estimateData?.quantity_review_required ? [
                    'הכמות בתמחור הזה עדיין דורשת אימות סופי לפני אישור סופי של הסכום.'
                ] : []),
                ...(estimateData?.ancillary_notes || []),
                ...(estimateData?.match_quality === 'ZERO_MATCH' ? [
                    estimateData.zero_match_reason,
                    ...(estimateData.needed_documents || []).map((doc: string) => `לדיוק סופי כדאי לבדוק: ${doc}`)
                ].filter(Boolean) : [])
            ];
            const linkedEvidence = {
                ...(contradiction.evidence_data || {}),
                pricing_evaluation: {
                    match_found: estimateData?.match_found,
                    source: estimateData?.source,
                    confidence: estimateData?.confidence,
                    match_quality: estimateData?.match_quality,
                    quantity_basis: estimateData?.quantity_basis || null,
                    quantity_review_required: Boolean(estimateData?.quantity_review_required),
                    ancillary_scope: estimateData?.ancillary_scope || null,
                    source_trace: estimateData?.source_trace,
                    needed_documents: estimateData?.needed_documents || [],
                    questions: estimateData?.questions || [],
                    ancillary_notes: estimateData?.ancillary_notes || [],
                    zero_match_reason: estimateData?.zero_match_reason || null
                }
            };

            await onApprove({
                contradiction_id: contradiction.id,
                type: 'PENDING_VO',
                source: formState.source,
                item_code: estimateData?.item_code || '',
                description: formState.description,
                unit: formState.unit,
                quantity: formState.quantity,
                unit_price_excl_vat: effectiveUnitPriceExclVat,
                markup_percentage: formState.markup / 100,
                ai_rationale: estimateData?.ai_rationale || '',
                governing_notes: pricingNotes,
                expert_strategy: estimateData?.expert_strategy || null,
                evidence_data: linkedEvidence
            });
            onClose();
        } catch (e) {
            console.error('[COMMIT_ERROR]:', e);
        } finally {
            setIsSaving(false);
        }
    };
    const handleViewSource = async (ev: any) => {
        try {
            let query = supabase.from('documents').select('*');
            
            if (ev.document_id) {
                query = query.eq('id', ev.document_id);
            } else if (ev.document_title) {
                query = query.eq('title', ev.document_title).eq('project_id', contradiction.project_id);
            } else {
                return;
            }

            const { data, error } = await query.single();
            if (error || !data) throw error || new Error('Document not found');

            setViewerDoc(data);
            setIsViewerOpen(true);
        } catch (err) {
            console.error('Error viewing source:', err);
            alert('לא ניתן היה לטעון את המסמך המקורי');
        }
    };

    const themeColor = isExpertMode ? 'amber' : 'emerald';
    const themeHex = isExpertMode ? '#f59e0b' : '#10b981';
    const totalExclVat = formState.quantity * formState.unitPrice * (1 + (formState.markup / 100));
    const vatAmount = totalExclVat * VAT_RATE;
    const totalInclVat = totalExclVat + vatAmount;
    const confidencePct = Math.round(normalizeConfidence(estimateData?.confidence) * 100);
    const isZeroMatch = estimateData?.match_quality === 'ZERO_MATCH' || estimateData?.match_found === false;
    const expert = estimateData?.expert_strategy;
    const expertTechnical = expert?.technical_foundation || expert?.ripple_effect?.technical_analysis;
    const expertArgument = expert?.professional_argument || expert?.contractual_diagnostic?.argument_for_supervisor;
    const expertDiary = expert?.site_diary_instruction || expert?.operational_instructions?.site_diary_draft;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl overflow-y-auto" dir="rtl">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className={`bg-[#0B0F14] border border-white/10 rounded-[3rem] w-full max-w-7xl min-h-[85vh] flex flex-col shadow-[0_0_150px_rgba(0,0,0,1)] overflow-hidden relative transition-colors duration-700`}
            >
                {/* Scanner Line */}
                <div className={`absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent ${isExpertMode ? 'via-amber-500/50' : 'via-emerald-500/50'} to-transparent shadow-[0_0_20px_${themeHex}] animate-scan z-50 pointer-events-none opacity-30`} />

                {/* Background Decor */}
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
                    <div className={`absolute -top-24 -left-24 w-96 h-96 ${isExpertMode ? 'bg-amber-500/5' : 'bg-emerald-500/5'} rounded-full blur-[120px] transition-colors duration-1000`} />
                    <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] transition-colors duration-1000" />
                </div>

                {/* Header Section */}
                <div className="flex items-center justify-between px-12 py-8 border-b border-white/5 bg-white/[0.02] relative z-10">
                    <div className="flex items-center gap-8">
                        <div className="flex flex-col">
                            <div className="flex items-center gap-3 mb-2">
                                <motion.div 
                                    animate={{ 
                                        scale: [1, 1.2, 1],
                                        boxShadow: [`0 0 10px ${themeHex}44`, `0 0 25px ${themeHex}88`, `0 0 10px ${themeHex}44`]
                                    }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    className={`w-3 h-3 ${isExpertMode ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full shadow-[0_0_15px_${themeHex}]`} 
                                />
                                <span className={`text-[11px] font-mono font-black ${isExpertMode ? 'text-amber-500' : 'text-emerald-500'} uppercase tracking-[0.4em]`}>
                                    {isExpertMode ? 'ניתוח הנדסי-מסחרי' : 'ניתוח פיננסי חכם'}
                                </span>
                            </div>
                            <h2 className="text-3xl font-black text-white uppercase tracking-tighter font-mono flex items-center gap-4">
                                מסוף הערכה 
                                <span className="text-gray-600 font-light font-sans text-xl">/ {isExpertMode ? 'אסטרטגיה הנדסית' : 'חישוב עלות חכם'}</span>
                            </h2>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        {/* Lawyer Mode Toggle */}
                        <motion.button 
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setIsExpertMode(!isExpertMode)}
                            className={`flex items-center gap-4 px-8 py-3.5 rounded-[1.5rem] border transition-all duration-700 font-mono text-xs font-black uppercase tracking-tight shadow-lg ${
                                isExpertMode 
                                ? 'border-amber-500 bg-amber-500/10 text-amber-500 shadow-[0_0_40px_rgba(245,158,11,0.15)]' 
                                : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white'
                            }`}
                        >
                            <ShieldCheck className={`w-5 h-5 ${isExpertMode ? 'animate-bounce' : ''}`} />
                            {isExpertMode ? 'אסטרטגיה הנדסית פעילה' : 'הפעל ניתוח מומחה'}
                        </motion.button>


                        <div className="h-12 w-[1px] bg-white/10 mx-2" />
                        
                        <button 
                            onClick={onClose} 
                            className="w-14 h-14 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 transition-all rounded-2xl border border-transparent hover:border-white/10"
                        >
                            <X className="w-8 h-8" />
                        </button>
                    </div>
                </div>

                <div className="px-12 py-6 border-b border-white/5 bg-emerald-500/[0.04] relative z-10">
                    <div className="flex flex-col gap-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold w-fit">
                            <Briefcase className="w-4 h-4" />
                            אתה מתמחר עכשיו סתירה ספציפית
                        </div>
                        <h3 className="text-2xl font-black text-white">{contradiction.title}</h3>
                        <p className="text-sm text-gray-300 leading-7 max-w-5xl">{contradiction.description}</p>
                        <div className="flex flex-col md:flex-row gap-3 md:gap-6 text-sm text-gray-400">
                            {contradiction.target_doc?.title && (
                                <span>מסמך חוזה: {contradiction.target_doc.title}</span>
                            )}
                            {contradiction.source_doc?.title && (
                                <span>מסמך ביצוע: {contradiction.source_doc.title}</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden flex relative z-10">
                    {/* Left Panel: Intelligence & Rationale */}
                    <div className="w-[55%] border-l border-white/5 p-12 bg-black/20 flex flex-col gap-10 overflow-y-auto custom-scrollbar">
                        
                        {/* Source Indicators */}
                        <div className="space-y-6">
                            <div className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                                <div className="w-8 h-[1px] bg-gray-800" />
                                מקורות נתונים
                                <div className="flex-1 h-[1px] bg-gray-800" />
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                {[
                                    { id: 'BOQ', label: 'חוזה', icon: FileSpreadsheet, desc: 'ניתוח חוזי' },
                                    { id: 'DEKEL', label: 'מדד', icon: Calculator, desc: 'מחירון דקל' },
                                    { id: 'CONTRACTOR', label: 'שוק', icon: Activity, desc: 'מחירי שוק' },
                                    { id: 'CUSTOM_ANALYSIS', label: 'סינתזה', icon: Cpu, desc: 'ניתוח מערכת' }
                                ].map((step) => {

                                    const isActive = formState.source === step.id;
                                    return (
                                        <button 
                                            key={step.id}
                                            onClick={() => setFormState(prev => ({ ...prev, source: step.id }))}
                                            className={`flex flex-col items-center gap-3 p-4 border transition-all duration-300 rounded-3xl group/step ${
                                                isActive 
                                                ? `border-${themeColor}-500 bg-${themeColor}-500/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]` 
                                                : 'border-white/5 bg-white/[0.01] hover:border-white/20 hover:bg-white/[0.03]'
                                            }`}
                                        >
                                            <step.icon className={`w-5 h-5 transition-colors ${isActive ? `text-${themeColor}-400` : 'text-gray-600 group-hover/step:text-gray-400'}`} />
                                            <div className="text-center">
                                                <div className={`text-[13px] font-black leading-tight ${isActive ? 'text-white' : 'text-gray-600 group-hover/step:text-gray-400'}`}>
                                                    {step.label}
                                                </div>
                                                <div className="text-[8px] font-mono uppercase tracking-widest opacity-40 mt-1">{step.desc}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <AnimatePresence mode="wait">
                            {isLoading ? (
                                <motion.div 
                                    key="loading"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex-1 flex flex-col items-center justify-center py-24"
                                >
                                    <div className="relative w-32 h-32 mb-12">
                                        <div className={`absolute inset-0 border-[3px] ${isExpertMode ? 'border-amber-500/10' : 'border-emerald-500/10'} rounded-full`} />
                                        <div className={`absolute inset-0 border-t-[3px] ${isExpertMode ? 'border-amber-500' : 'border-emerald-500'} rounded-full animate-spin shadow-[0_0_20px_${themeHex}]`} />
                                        <Brain className={`absolute inset-0 m-auto w-10 h-10 ${isExpertMode ? 'text-amber-500' : 'text-emerald-500'} animate-pulse`} />
                                    </div>
                                    <div className="flex flex-col items-center gap-4">
                                        <span className={`text-sm font-mono font-black ${isExpertMode ? 'text-amber-500' : 'text-emerald-500'} uppercase tracking-[0.5em] animate-pulse`}>מבצע ניתוח מעמיק</span>
                                    </div>

                                </motion.div>
                            ) : (
                                <motion.div 
                                    key="content"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex flex-col gap-10"
                                >
                                    {/* Reasoning Block */}
                                    <div className={`p-10 bg-blue-500/[0.03] border border-blue-500/10 rounded-[2.5rem] relative group transition-all duration-500 hover:border-blue-500/30 shadow-2xl`}>
                                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                                            <Terminal className="w-20 h-20 text-blue-400" />
                                        </div>
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                                                <Zap className="w-4 h-4 text-blue-400" />
                                            </div>
                                            <h4 className="text-[11px] font-mono font-black text-blue-400 uppercase tracking-[0.4em]">ליבת ניתוח בינה מלאכותית</h4>
                                        </div>

                                        <p className="text-xl text-gray-200 leading-relaxed font-sans font-medium" dir="rtl">
                                            {estimateData?.ai_rationale}
                                        </p>
                                        {estimateData && (
                                            <div className="mt-6 flex flex-wrap gap-3">
                                                <span className={`px-3 py-1 rounded-lg border text-[10px] font-mono font-black ${
                                                    isZeroMatch ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                }`}>
                                                    {isZeroMatch ? 'ללא התאמה ישירה' : 'התאמה נמצאה'} · ודאות {confidencePct || '—'}%
                                                </span>
                                                <span className="px-3 py-1 rounded-lg border bg-white/5 text-gray-400 border-white/10 text-[10px] font-mono font-black">
                                                    מקור: {formState.source}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {isZeroMatch && (
                                        <div className="p-8 bg-amber-500/[0.05] border border-amber-500/20 rounded-[2rem] space-y-6">
                                            <div className="flex items-center gap-3">
                                                <ShieldAlert className="w-5 h-5 text-amber-400" />
                                                <h4 className="text-[11px] font-mono font-black text-amber-400 uppercase tracking-[0.35em]">בדיקת Zero Match</h4>
                                            </div>
                                            <p className="text-sm text-amber-100/80 leading-relaxed">
                                                {estimateData?.zero_match_reason || 'לא נמצאה התאמה ישירה. יש לאמת את הנתונים לפני הפקת דרישה כספית.'}
                                            </p>
                                            {estimateData?.needed_documents?.length > 0 && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {estimateData.needed_documents.map((doc: string, idx: number) => (
                                                        <div key={`needed-${idx}`} className="p-3 bg-black/30 border border-amber-500/10 rounded-xl text-xs text-gray-300">
                                                            {doc}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {estimateData?.questions?.length > 0 && (
                                                <div className="space-y-2">
                                                    <div className="text-[10px] font-mono text-amber-500/70 font-black uppercase">שאלות לפני אישור</div>
                                                    {estimateData.questions.map((q: string, idx: number) => (
                                                        <div key={`question-${idx}`} className="text-sm text-gray-300 border-r-2 border-amber-500/30 pr-3">
                                                            {q}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Expert Strategy */}
                                    {isExpertMode && estimateData?.expert_strategy && (
                                        <motion.div 
                                            initial={{ opacity: 0, x: -30 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="p-10 bg-amber-500/[0.07] border border-amber-500/30 rounded-[3rem] relative shadow-[0_20px_60px_rgba(245,158,11,0.1)] overflow-hidden"
                                        >
                                            <div className="absolute top-0 right-0 w-full h-1 bg-gradient-to-l from-amber-500/50 to-transparent" />
                                            <div className="flex items-center gap-4 mb-8">
                                                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 flex items-center justify-center">
                                                    <Briefcase className="w-5 h-5 text-amber-500" />
                                                </div>
                                                <h4 className="text-[11px] font-mono font-black text-amber-500 uppercase tracking-[0.4em]">ביסוס הנדסי-מסחרי</h4>
                                            </div>
                                            
                                            <div className="space-y-6">
                                                <div className="p-6 bg-black/40 rounded-2xl border border-amber-500/10">
                                                    <div className="text-[10px] font-mono text-amber-500/60 uppercase mb-2">ביסוס מקצועי:</div>
                                                    <p className="text-lg font-bold text-amber-100 leading-relaxed pr-4 border-r-4 border-amber-500/40" dir="rtl">
                                                        {expertTechnical}
                                                    </p>
                                                </div>

                                                <div className="grid grid-cols-1 gap-4">
                                                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                                        <div className="text-[9px] font-mono text-gray-500 uppercase mb-1">טיעון מקצועי:</div>
                                                        <p className="text-sm text-gray-300">{expertArgument}</p>
                                                    </div>
                                                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                                        <div className="text-[9px] font-mono text-gray-500 uppercase mb-1">הנחיה ליומן עבודה:</div>
                                                        <p className="text-sm text-gray-300 font-mono italic">"{expertDiary}"</p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <div className="flex -space-x-2">
                                                        <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center border-2 border-[#0B0F14] z-10">
                                                            <Activity className="w-4 h-4 text-black" />
                                                        </div>
                                                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center border-2 border-[#0B0F14]">
                                                            <Shield className="w-4 h-4 text-white" />
                                                        </div>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-amber-500/60 font-black uppercase tracking-widest">
                                                        ניתוח מבוסס עובדות הנדסיות
                                                    </span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* Evidence Trace & Links */}
                                    <div className="space-y-6">
                                        <div className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                                            <div className="w-8 h-[1px] bg-gray-800" />
                                            יומן ראיות
                                        </div>

                                        <div className="grid grid-cols-1 gap-4">
                                            {/* 1. Governing Notes from AI */}
                                            {estimateData?.governing_notes?.map((note: any, idx: number) => (
                                                <motion.div 
                                                    key={`note-${idx}`}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: idx * 0.1 }}
                                                    className="flex gap-6 p-6 bg-white/[0.02] border border-white/5 rounded-3xl hover:bg-white/[0.04] hover:border-white/10 transition-all group"
                                                >
                                                    <div className="w-10 h-10 rounded-2xl bg-gray-900 border border-white/5 flex items-center justify-center shrink-0 group-hover:border-blue-500/30 transition-colors">
                                                        <span className="text-[11px] font-mono font-black text-gray-500 group-hover:text-blue-400">{String(idx + 1).padStart(2, '0')}</span>
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="text-[10px] font-mono text-gray-600 mb-1">הערת מערכת</div>
                                                        <p className="text-sm text-gray-400 leading-relaxed font-medium">
                                                            {typeof note === 'string' ? note : (
                                                                Object.entries(note).map(([k, v]: [string, any]) => (
                                                                    <div key={k} className="mb-1">
                                                                        <span className="text-blue-400 font-bold ml-1">
                                                                            {k === 'Digital_Twin_Evidence' ? 'ראיות דיגיטליות' : 
                                                                             k === 'REGULATORY_NOTE' ? 'הערה רגולטורית' : 
                                                                             k === 'CONTRACTUAL_BASIS' ? 'בסיס חוזי' : 
                                                                             k === 'MARKET_ANALYSIS' ? 'ניתוח שוק' : k}:
                                                                        </span>
                                                                        <span>{v}</span>
                                                                    </div>
                                                                ))
                                                            )}
                                                        </p>
                                                    </div>
                                                </motion.div>
                                            ))}

                                            {/* 2. Direct Evidence from Contradiction */}
                                            {contradiction.evidence_data && (
                                                <div className="mt-4 p-6 bg-blue-500/5 border border-blue-500/20 rounded-3xl space-y-4">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <Shield className="w-4 h-4 text-blue-400" />
                                                        <span className="text-[11px] font-mono font-black text-blue-400 uppercase tracking-widest">ראיות דיגיטליות</span>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-3">
                                                        {Array.isArray(contradiction.evidence_data) ? contradiction.evidence_data.map((ev: any, idx: number) => (
                                                            <div key={idx} className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-2xl hover:border-white/20 transition-all">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-black text-gray-500">
                                                                        מסמך
                                                                    </div>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-bold text-gray-300">{ev.document_title || 'מסמך מקור'}</span>
                                                                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-tight">עמוד: {ev.page || 'לא זמין'} | סימוכין: {ev.reference || 'סימוכין מערכת'}</span>
                                                                    </div>
                                                                </div>
                                                                 <button 
                                                                    onClick={() => handleViewSource(ev)}
                                                                    className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl text-[10px] font-black transition-all"
                                                                >
                                                                    הצג מקור
                                                                </button>

                                                            </div>
                                                        )) : contradiction.evidence_data?.contract_quote || contradiction.evidence_data?.work_quote ? (
                                                            [
                                                                {
                                                                    document_title: contradiction.evidence_data.contract_title,
                                                                    page: contradiction.evidence_data.contract_page,
                                                                    reference: '[1]',
                                                                    document_id: contradiction.target_contract_doc_id,
                                                                    quote: contradiction.evidence_data.contract_quote
                                                                },
                                                                {
                                                                    document_title: contradiction.evidence_data.work_title,
                                                                    page: contradiction.evidence_data.work_page,
                                                                    reference: '[2]',
                                                                    document_id: contradiction.source_execution_doc_id,
                                                                    quote: contradiction.evidence_data.work_quote
                                                                }
                                                            ].filter(ev => ev.quote).map((ev, idx) => (
                                                                <div key={`direct-${idx}`} className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-2xl hover:border-white/20 transition-all">
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-bold text-gray-300">{ev.document_title || 'מסמך מקור'}</span>
                                                                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-tight">עמוד: {ev.page || 'לא זמין'} | סימוכין: {ev.reference}</span>
                                                                        <span className="mt-2 text-xs text-gray-500 line-clamp-2">{ev.quote}</span>
                                                                    </div>
                                                                    <button 
                                                                        onClick={() => handleViewSource(ev)}
                                                                        className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl text-[10px] font-black transition-all shrink-0"
                                                                    >
                                                                        הצג מקור
                                                                    </button>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="text-xs text-amber-400 italic px-4">אין מקור ישיר מאומת לפריט זה. נדרש אימות לפני דרישה כספית.</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Right Panel: Value Matrix & Control */}
                    <div className="w-[45%] p-12 bg-white/[0.01] flex flex-col gap-12 overflow-y-auto custom-scrollbar">
                        <div className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                            <div className="w-8 h-[1px] bg-gray-800" />
                            הערכת שווי
                        </div>

                        <div className="grid grid-cols-2 gap-10">
                            <div className="space-y-4 col-span-2">
                                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest flex items-center gap-3">
                                    <Tag className="w-4 h-4" /> תיאור עבודה
                                </label>
                                <textarea 
                                    name="description"
                                    value={formState.description}
                                    onChange={handleFormChange}
                                    className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] p-6 text-base text-white focus:border-blue-500/50 outline-none transition-all resize-none h-32 font-sans font-bold shadow-inner"
                                />
                            </div>

                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest">בסיס תמחור</label>
                                <div className="relative group">
                                    <select 
                                        name="source"
                                        value={formState.source}
                                        onChange={handleFormChange}
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500/50 outline-none appearance-none font-black cursor-pointer group-hover:border-white/20 transition-all"
                                    >
                                        <option value="BOQ">חוזה</option>
                                        <option value="DEKEL">מדד דקל</option>
                                        <option value="CONTRACTOR">מחירון קבלן</option>
                                        <option value="CUSTOM_ANALYSIS">ניתוח סינתטי</option>
                                    </select>
                                    <ChevronLeft className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 rotate-270 pointer-events-none" />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest">יחידה</label>
                                <input 
                                    type="text" 
                                    name="unit"
                                    value={formState.unit}
                                    onChange={handleFormChange}
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white font-mono font-black focus:border-blue-500/50 outline-none"
                                />
                            </div>

                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest">כמות</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        name="quantity"
                                        value={formState.quantity}
                                        onChange={handleFormChange}
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white font-mono font-black focus:border-blue-500/50 outline-none"
                                    />
                                    <Plus className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-blue-500 uppercase tracking-widest">מחיר יחידה</label>
                                <div className="relative group">
                                    <input 
                                        type="number" 
                                        name="unitPrice"
                                        value={formState.unitPrice}
                                        onChange={handleFormChange}
                                        className="w-full bg-blue-500/[0.05] border border-blue-500/20 rounded-2xl px-6 py-4 text-lg text-blue-400 font-mono font-black focus:border-blue-500/50 outline-none shadow-[0_0_20px_rgba(59,130,246,0.05)]"
                                    />
                                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-blue-500/50 font-mono text-sm font-bold">₪</span>
                                </div>
                            </div>

                            <div className="space-y-4 col-span-2">
                                <label className="text-[11px] font-mono font-black text-amber-500 uppercase tracking-widest">% תקורה ורווח</label>
                                <div className="relative group">
                                    <input 
                                        type="number" 
                                        name="markup"
                                        value={formState.markup}
                                        onChange={handleFormChange}
                                        className="w-full bg-amber-500/[0.05] border border-amber-500/20 rounded-2xl px-6 py-4 text-lg text-amber-500 font-mono font-black focus:border-amber-500/50 outline-none"
                                    />
                                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-amber-500/50 font-mono text-sm font-bold">%</span>
                                    
                                    <div className="mt-4 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                                        {[10, 15, 20, 25].map(val => (
                                            <button 
                                                key={val}
                                                onClick={() => setFormState(p => ({ ...p, markup: val }))}
                                                className={`px-4 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                                                    formState.markup === val 
                                                    ? 'bg-amber-500 text-black border-amber-500' 
                                                    : 'bg-white/5 text-amber-500/60 border-white/5 hover:border-amber-500/30'
                                                }`}
                                            >
                                                +{val}%
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Financial Ledger Summary */}
                        <div className="mt-auto bg-black/60 rounded-[3.5rem] p-12 border border-white/5 space-y-10 relative overflow-hidden group shadow-2xl">
                            <div className={`absolute inset-0 bg-gradient-to-br from-${themeColor}-500/[0.03] to-transparent pointer-events-none`} />
                            
                            <div className="grid grid-cols-2 gap-10 relative z-10 border-b border-white/5 pb-8">
                                <div className="flex flex-col gap-2">
                                    <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-[0.2em]">ערך נטו (ללא מע"מ)</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-xs text-gray-600 font-mono">₪</span>
                                        <span className="text-3xl font-mono font-black text-gray-200">{totalExclVat.toLocaleString()}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <span className="text-[10px] font-mono font-black text-blue-500/60 uppercase tracking-[0.2em]">מע"מ {(VAT_RATE * 100).toFixed(0)}%</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-mono font-black text-blue-500/80">{vatAmount.toLocaleString()}</span>
                                        <span className="text-xs text-blue-500/40 font-mono">₪</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-4 relative z-10">
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full bg-${themeColor}-500 shadow-[0_0_10px_${themeHex}]`} />
                                    <span className={`text-[11px] font-mono font-black text-${themeColor}-400 uppercase tracking-[0.5em]`}>סה"כ כולל מע"מ</span>
                                </div>
                                <div className="flex items-baseline gap-4">
                                    <span className={`text-7xl font-mono font-black text-${themeColor}-400 tracking-tighter drop-shadow-[0_0_30px_rgba(16,185,129,0.2)]`}>
                                        ₪{totalInclVat.toLocaleString()}
                                    </span>
                                </div>
                            </div>

                            <motion.button 
                                whileHover={{ scale: 1.02, y: -5 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleSubmit}
                                disabled={isSaving || isLoading}
                                className={`w-full py-8 rounded-[2rem] text-sm font-black uppercase tracking-[0.6em] transition-all flex items-center justify-center gap-6 shadow-2xl relative overflow-hidden group ${
                                    isSaving || isLoading 
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
                            
                            <p className="text-[9px] font-mono text-gray-700 text-center uppercase tracking-widest relative z-10">
                                מזהה עסקה מאובטח: {Math.random().toString(36).substring(7).toUpperCase()}
                            </p>
                        </div>
                    </div>
                </div>
            </motion.div>

            <AnimatePresence>
                {isViewerOpen && viewerDoc && (
                    <ScreenOfTruthModal 
                        document={viewerDoc}
                        onClose={() => setIsViewerOpen(false)}
                        onValidate={async () => {
                            setIsViewerOpen(false);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
