"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, CheckCircle2, ShieldCheck, FileSearch, AlertTriangle, Info, Layers } from 'lucide-react';

interface ScreenOfTruthModalProps {
    document: any;
    onClose: () => void;
    onValidate: (id: string, updatedJSON: any) => Promise<void>;
}

export default function ScreenOfTruthModal({ document: doc, onClose, onValidate }: ScreenOfTruthModalProps) {
    const [isValidating, setIsValidating] = useState(false);
    const jsonData = doc.parsed_json || {};
    const isStructured = jsonData && !Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData.type;
    const hasFinancialItems = jsonData.financial_data?.items?.length > 0;
    const hasWarnings = jsonData.warnings?.length > 0 && jsonData.warnings[0] !== undefined;
    const isAlreadyValidated = doc.ai_status === 'VALIDATED';

    const rawConfidence = jsonData.confidence ?? jsonData.confidence_score ?? jsonData.document_confidence;
    const parsedConfidence = typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence);
    const confidencePercent = Number.isFinite(parsedConfidence) && parsedConfidence > 0
        ? Math.round(parsedConfidence <= 1 ? parsedConfidence * 100 : parsedConfidence)
        : null;

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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07090C]/95 backdrop-blur-xl p-3 md:p-6"
        >
            <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 20 }}
                className="bg-[#0B0F14] w-full h-full border border-white/10 shadow-[0_50px_100px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden rounded-[2rem]"
            >
                <div className="flex justify-between items-center px-6 md:px-10 py-5 border-b border-white/5 bg-black/40">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                            isAlreadyValidated
                                ? 'border-emerald-500/30 bg-emerald-500/10'
                                : 'border-blue-500/30 bg-blue-500/10'
                        }`}>
                            {isAlreadyValidated ? <ShieldCheck className="w-6 h-6 text-emerald-400" /> : <FileSearch className="w-6 h-6 text-blue-400" />}
                        </div>

                        <div className="min-w-0">
                            <h2 className="text-xl md:text-2xl font-black text-white truncate">{String(doc.title || '').replace(/\.(pdf|docx|doc|xlsx|xls)$/i, '')}</h2>
                            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm">
                                <span className={isAlreadyValidated ? 'text-emerald-400 font-bold' : 'text-blue-400 font-bold'}>
                                    {isAlreadyValidated ? 'המסמך כבר אושר' : 'המסמך מוכן לבדיקה'}
                                </span>
                                <span className="text-gray-500">•</span>
                                <span className="text-gray-400">
                                    {confidencePercent ? `רמת ודאות ${confidencePercent}%` : 'רמת ודאות לא סופית'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-12 h-12 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 rounded-2xl transition-all"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                    <div className="flex-1 flex flex-col border-l border-white/5 bg-black/20 min-h-[320px]">
                        <div className="px-6 py-3 border-b border-white/5 bg-black/30 text-sm font-bold text-gray-300">
                            המסמך המקורי
                        </div>
                        <div className="flex-1 bg-[#07090C] overflow-hidden flex items-center justify-center">
                            {doc.file_url ? (
                                <iframe src={`${doc.file_url}#toolbar=0`} className="w-full h-full border-none bg-white" />
                            ) : (
                                <div className="flex flex-col items-center gap-4 text-center px-6">
                                    <div className="p-6 bg-white/[0.03] border border-white/5 rounded-[2rem]">
                                        <Layers className="text-gray-700" size={56} />
                                    </div>
                                    <span className="text-sm text-gray-500">אין תצוגה ישירה למסמך הזה</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="w-full lg:w-[680px] flex flex-col bg-[#0B0F14]">
                        <div className="px-6 py-3 border-b border-white/5 bg-black/30 text-sm font-bold text-gray-300">
                            מה המערכת הבינה מהמסמך
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8" dir="rtl">
                            {isStructured ? (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="bg-[#151C24]/55 border border-white/5 rounded-2xl p-5">
                                            <div className="text-xs text-gray-500 font-bold mb-2">סוג מסמך</div>
                                            <div className="text-lg font-black text-white">{jsonData.type || 'לא זוהה'}</div>
                                        </div>
                                        <div className="bg-[#151C24]/55 border border-white/5 rounded-2xl p-5">
                                            <div className="text-xs text-gray-500 font-bold mb-2">תאריך</div>
                                            <div className="text-lg font-black text-white">{jsonData.date || 'לא נמצא'}</div>
                                        </div>
                                        <div className="bg-[#151C24]/55 border border-white/5 rounded-2xl p-5">
                                            <div className="text-xs text-gray-500 font-bold mb-2">סכום שזוהה</div>
                                            <div className="text-lg font-black text-emerald-400">
                                                {jsonData.financial_data?.total_amount ? `₪${Number(jsonData.financial_data.total_amount).toLocaleString('he-IL')}` : 'לא זוהה'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-white/[0.02] p-6 rounded-[1.5rem] border border-white/5">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Info className="w-4 h-4 text-blue-400" />
                                            <span className="text-sm font-bold text-gray-300">סיכום קצר</span>
                                        </div>
                                        <p className="text-base text-gray-200 leading-8">{jsonData.summary || 'לא נוצר עדיין סיכום ברור למסמך זה.'}</p>
                                    </div>

                                    {hasWarnings && (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                                                <span className="text-sm font-bold text-amber-300">נקודות שדורשות תשומת לב</span>
                                            </div>
                                            {jsonData.warnings.map((warning: string, idx: number) => (
                                                <div key={idx} className="p-4 bg-amber-500/[0.05] border border-amber-500/15 rounded-2xl text-sm text-gray-200 leading-7">
                                                    {warning}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {hasFinancialItems && (
                                        <div className="space-y-3">
                                            <div className="text-sm font-bold text-gray-300">פריטים שזוהו במסמך</div>
                                            <div className="bg-[#151C24]/35 border border-white/5 rounded-[1.5rem] overflow-hidden">
                                                <table className="w-full text-sm" dir="rtl">
                                                    <thead className="bg-white/[0.03] text-gray-400">
                                                        <tr>
                                                            <th className="px-4 py-3 text-right">קוד</th>
                                                            <th className="px-4 py-3 text-right">תיאור</th>
                                                            <th className="px-4 py-3 text-center">כמות</th>
                                                            <th className="px-4 py-3 text-left">סכום</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-white/5">
                                                        {jsonData.financial_data.items.map((item: any, idx: number) => (
                                                            <tr key={idx}>
                                                                <td className="px-4 py-3 text-gray-400">{item.code || '—'}</td>
                                                                <td className="px-4 py-3 text-gray-100">{item.description}</td>
                                                                <td className="px-4 py-3 text-center text-gray-300">{item.quantity} {item.unit}</td>
                                                                <td className="px-4 py-3 text-left text-emerald-400 font-bold">
                                                                    {item.total_price ? `₪${Number(item.total_price).toLocaleString('he-IL')}` : '—'}
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
                                <div className="h-full flex items-center justify-center text-center px-6">
                                    <div>
                                        <div className="text-lg font-black text-white mb-2">המסמך עדיין לא מוכן לבדיקה מלאה</div>
                                        <div className="text-sm text-gray-500">כדאי להריץ קודם סריקה או פענוח למסמך הזה.</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-6 md:px-10 py-6 bg-black/40 border-t border-white/5">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="text-sm text-gray-400">
                                    {isAlreadyValidated ? 'המסמך כבר אושר במערכת' : 'אשר רק אם הנתונים נראים לך נכונים וברורים'}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={onClose}
                                        className="px-6 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-gray-300 text-sm font-bold hover:text-white hover:bg-white/10 transition-all"
                                    >
                                        סגירה
                                    </button>
                                    {!isAlreadyValidated && (
                                        <button
                                            onClick={handleValidate}
                                            disabled={isValidating}
                                            className="px-8 py-3 bg-emerald-500 text-black rounded-2xl text-sm font-black hover:scale-105 transition-all active:scale-95 shadow-[0_20px_40px_rgba(16,185,129,0.2)] disabled:opacity-50"
                                        >
                                            {isValidating ? 'שומר...' : (
                                                <span className="flex items-center gap-2">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    אישור מסמך
                                                </span>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
