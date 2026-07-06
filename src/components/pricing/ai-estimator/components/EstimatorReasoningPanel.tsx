"use client";

import React from 'react';
import { ShieldAlert, Terminal, Zap } from 'lucide-react';
import type { AIPricingEvaluationResponse } from '../types';

interface EstimatorReasoningPanelProps {
    estimateData?: AIPricingEvaluationResponse | null;
    isZeroMatch: boolean;
    confidencePct?: string | number | null;
    source: string;
    hasPricingDraft: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
    BOQ: 'כתב כמויות / סעיף חוזי',
    DEKEL: 'דקל או מחירון רשמי',
    CONTRACTOR: 'הצעת מחיר',
    CUSTOM_ANALYSIS: 'ניתוח תמחור לפי מסמכי הפרויקט',
};

function EstimatorReasoningPanel({
    estimateData,
    isZeroMatch,
    confidencePct,
    source,
    hasPricingDraft,
}: EstimatorReasoningPanelProps) {
    const sourceLabel = !hasPricingDraft && source === 'CUSTOM_ANALYSIS'
        ? 'לא נבנתה טיוטת מחיר - חסר מחיר לחישוב'
        : (SOURCE_LABELS[source] || SOURCE_LABELS.CUSTOM_ANALYSIS);
    const neededDocuments = estimateData?.needed_documents ?? [];
    const questions = estimateData?.questions ?? [];
    return (
        <>
            <div className="p-10 bg-blue-500/[0.03] border border-blue-500/10 rounded-[2.5rem] relative group transition-all duration-500 hover:border-blue-500/30 shadow-2xl">
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Terminal className="w-20 h-20 text-blue-400" />
                </div>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-blue-400" />
                    </div>
                    <h4 className="text-[11px] font-mono font-black text-blue-400 uppercase tracking-[0.4em]">
                        ליבת ניתוח בינה מלאכותית
                    </h4>
                </div>

                <p className="text-xl text-gray-200 leading-relaxed font-sans font-medium" dir="rtl">
                    {estimateData?.ai_rationale}
                </p>
                {estimateData && (
                    <div className="mt-6 flex flex-wrap gap-3">
                        <span className={`px-3 py-1 rounded-lg border text-[10px] font-mono font-black ${
                            isZeroMatch ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                            {isZeroMatch ? 'ללא התאמה ישירה' : 'התאמה נמצאה'} - ודאות {confidencePct || '0'}%
                        </span>
                        <span className="px-3 py-1 rounded-lg border bg-white/5 text-gray-400 border-white/10 text-[10px] font-mono font-black">
                            מקור: {sourceLabel}
                        </span>
                    </div>
                )}
            </div>

            {isZeroMatch && (
                <div className="p-8 bg-amber-500/[0.05] border border-amber-500/20 rounded-[2rem] space-y-6">
                    <div className="flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-amber-400" />
                        <h4 className="text-[11px] font-mono font-black text-amber-400 uppercase tracking-[0.35em]">
                            בדיקת Zero Match
                        </h4>
                    </div>
                    <p className="text-sm text-amber-100/80 leading-relaxed">
                        {estimateData?.zero_match_reason || 'לא נמצאה התאמה ישירה. יש לאמת את הנתונים לפני הפקת מחיר סופי.'}
                    </p>
                    {neededDocuments.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {neededDocuments.map((doc, idx) => (
                                <div key={`needed-${idx}`} className="p-3 bg-black/30 border border-amber-500/10 rounded-xl text-xs text-gray-300">
                                    {doc}
                                </div>
                            ))}
                        </div>
                    )}
                    {questions.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10px] font-mono text-amber-500/70 font-black uppercase">
                                שאלות לפני אישור
                            </div>
                            {questions.map((question, idx) => (
                                <div key={`question-${idx}`} className="text-sm text-gray-300 border-r-2 border-amber-500/30 pr-3">
                                    {question}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

export default React.memo(EstimatorReasoningPanel);
