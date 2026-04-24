"use client";

import React, { useState } from 'react';
import { X, CheckCircle, FileText, AlertTriangle, DollarSign, Users, Calendar, ClipboardList, Shield } from 'lucide-react';

interface ScreenOfTruthModalProps {
    document: any;
    onClose: () => void;
    onValidate: (id: string, updatedJSON: any) => Promise<void>;
}

/**
 * Screen of Truth — מסך אימות מסמך
 * 
 * מציג את ה-PDF המקורי (שמאל) לצד המידע שה-AI חילץ (ימין).
 * המשתמש יכול לעיין בנתונים ולאשר קליטה למערכת.
 */
export default function ScreenOfTruthModal({ document, onClose, onValidate }: ScreenOfTruthModalProps) {
    const [isValidating, setIsValidating] = useState(false);
    const jsonData = document.parsed_json || {};
    const isStructured = jsonData && !Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData.type;
    const hasFinancialItems = jsonData.financial_data?.items?.length > 0;
    const hasWarnings = jsonData.warnings?.length > 0 && jsonData.warnings[0] !== undefined;
    const isAlreadyValidated = document.ai_status === 'VALIDATED';

    const handleValidate = async () => {
        setIsValidating(true);
        try {
            await onValidate(document.id, jsonData);
            onClose();
        } catch (err) {
            console.error('Validation error:', err);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-[#11161D] w-full max-w-7xl h-[90vh] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-[#151C24]">
                    <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded flex items-center justify-center font-bold ${isAlreadyValidated ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                            {isAlreadyValidated ? <CheckCircle className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">{document.title}</h2>
                            <p className={`text-xs ${isAlreadyValidated ? 'text-green-400' : 'text-blue-400'}`}>
                                {isAlreadyValidated
                                    ? (jsonData.type ? `${jsonData.type} — מאומת ✓` : 'מסמך מאומת ✓')
                                    : 'מסך אימות — בדוק את הנתונים ולחץ "קלוט למערכת"'
                                }
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content: Doc Viewer + Metadata */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden gap-1 p-1 bg-black/20">
                    {/* LEFT: Original Document */}
                    <div className="bg-[#151C24] rounded-lg border border-white/5 flex flex-col overflow-hidden">
                        <div className="p-2 border-b border-white/5 bg-[#1A222C] text-xs font-semibold text-gray-300">
                            📄 מסמך מקורי
                        </div>
                        <div className="flex-1 relative bg-black/40 p-1 overflow-auto flex items-center justify-center">
                            {document.file_url ? (
                                <iframe src={document.file_url} className="w-full h-full rounded bg-white" />
                            ) : (
                                <span className="text-gray-500">אין תצוגה מקדימה</span>
                            )}
                        </div>
                    </div>

                    {/* RIGHT: Parsed Data */}
                    <div className="bg-[#151C24] rounded-lg border border-white/5 flex flex-col overflow-hidden">
                        <div className="p-2 border-b border-white/5 bg-[#1A222C] text-xs font-semibold text-gray-300 flex justify-between">
                            <span>🤖 נתונים שה-AI חילץ</span>
                            {isAlreadyValidated && (
                                <span className="flex items-center gap-1 text-green-400">
                                    <CheckCircle className="w-3 h-3" /> מאומת
                                </span>
                            )}
                        </div>

                        <div className="flex-1 overflow-auto p-4" dir="rtl">
                            {isStructured ? (
                                <div className="space-y-4">
                                    {/* סוג המסמך */}
                                    <div className="flex items-center gap-2 text-white">
                                        <FileText className="w-4 h-4 text-primary" />
                                        <span className="font-semibold text-lg">{jsonData.type}</span>
                                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                                            {jsonData.category}
                                        </span>
                                    </div>

                                    {/* תקציר */}
                                    {jsonData.summary && (
                                        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                                            <p className="text-sm text-gray-300 leading-relaxed">{jsonData.summary}</p>
                                        </div>
                                    )}

                                    {/* תאריך */}
                                    {jsonData.date && (
                                        <div className="flex items-center gap-2 text-sm text-gray-300">
                                            <Calendar className="w-4 h-4 text-gray-500" />
                                            <span>תאריך:</span>
                                            <span className="font-mono text-white">{jsonData.date}</span>
                                        </div>
                                    )}

                                    {/* צדדים */}
                                    {jsonData.parties?.length > 0 && (
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-sm text-gray-400">
                                                <Users className="w-4 h-4" />
                                                <span>צדדים:</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2 mr-6">
                                                {jsonData.parties.map((p: string, i: number) => (
                                                    <span key={i} className="bg-primary/10 border border-primary/20 text-primary text-xs px-2 py-1 rounded">
                                                        {p}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* תנאים מרכזיים */}
                                    {jsonData.key_terms?.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 text-sm text-gray-400">
                                                <ClipboardList className="w-4 h-4" />
                                                <span>תנאים והתחייבויות מרכזיים:</span>
                                            </div>
                                            <ul className="mr-6 space-y-1">
                                                {jsonData.key_terms.map((term: string, i: number) => (
                                                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                                                        <span className="text-primary mt-1">•</span>
                                                        <span>{term}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {/* נתונים פיננסיים */}
                                    {jsonData.financial_data?.total_amount > 0 && (
                                        <div className="flex items-center gap-2 text-sm">
                                            <DollarSign className="w-4 h-4 text-green-400" />
                                            <span className="text-gray-400">סה"כ:</span>
                                            <span className="text-green-400 font-bold text-lg">
                                                ₪{jsonData.financial_data.total_amount.toLocaleString()}
                                            </span>
                                        </div>
                                    )}

                                    {/* טבלת פריטים */}
                                    {hasFinancialItems && (
                                        <div className="space-y-2">
                                            <div className="text-sm text-gray-400 font-semibold">📊 פריטי כתב כמויות:</div>
                                            <div className="overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
                                                <table className="w-full text-xs border-collapse" dir="rtl">
                                                    <thead className="sticky top-0">
                                                        <tr className="bg-[#1A222C] text-gray-400">
                                                            <th className="p-2 text-right border border-white/5">מס׳</th>
                                                            <th className="p-2 text-right border border-white/5">תיאור</th>
                                                            <th className="p-2 text-center border border-white/5">יחידה</th>
                                                            <th className="p-2 text-center border border-white/5">כמות</th>
                                                            <th className="p-2 text-center border border-white/5">מחיר ליח׳</th>
                                                            <th className="p-2 text-center border border-white/5">סה"כ</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {jsonData.financial_data.items.map((item: any, i: number) => (
                                                            <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                                <td className="p-2 text-gray-400 text-right border border-white/5 font-mono">
                                                                    {item.item_code || i + 1}
                                                                </td>
                                                                <td className="p-2 text-gray-200 text-right border border-white/5 max-w-[200px]">
                                                                    {item.description}
                                                                </td>
                                                                <td className="p-2 text-gray-400 text-center border border-white/5">
                                                                    {item.unit || '-'}
                                                                </td>
                                                                <td className="p-2 text-white text-center border border-white/5 font-mono">
                                                                    {item.quantity || 0}
                                                                </td>
                                                                <td className="p-2 text-white text-center border border-white/5 font-mono">
                                                                    ₪{(item.unit_price_excl_vat || 0).toLocaleString()}
                                                                </td>
                                                                <td className="p-2 text-green-400 text-center border border-white/5 font-mono font-bold">
                                                                    ₪{((item.quantity || 0) * (item.unit_price_excl_vat || 0)).toLocaleString()}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {/* אזהרות */}
                                    {hasWarnings && (
                                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-1">
                                            <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
                                                <AlertTriangle className="w-4 h-4" />
                                                <span>שים לב:</span>
                                            </div>
                                            {jsonData.warnings.map((w: string, i: number) => (
                                                <p key={i} className="text-xs text-amber-300/80 mr-6">⚠ {w}</p>
                                            ))}
                                        </div>
                                    )}

                                    {/* סטטוס סופי */}
                                    {isAlreadyValidated && (
                                        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-sm text-green-300">
                                            ✓ המסמך מאומת ומקושר למערכת.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                    <p>אין מידע זמין — יש להפעיל סריקה תחילה</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-white/10 bg-[#11161D] flex justify-between items-center rounded-b-lg">
                            <button
                                onClick={onClose}
                                className="px-5 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors font-medium text-sm"
                            >
                                סגור
                            </button>

                            {!isAlreadyValidated && isStructured && (
                                <button
                                    onClick={handleValidate}
                                    disabled={isValidating}
                                    className="px-6 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold text-sm shadow-lg shadow-green-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isValidating ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    ) : (
                                        <>
                                            <CheckCircle className="w-4 h-4" />
                                            🟢 קלוט למערכת
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
