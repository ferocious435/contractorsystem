"use client";

import React from 'react';
import { X, CheckCircle, FileText } from 'lucide-react';

interface ScreenOfTruthModalProps {
    document: any;
    onClose: () => void;
    onValidate: (id: string, updatedJSON: any) => Promise<void>;
}

/**
 * Screen of Truth — מסך צפייה בנתוני המסמך שנקלטו
 * 
 * אין כפתור "אמת" — כל המסמכים נקלטים אוטומטית.
 * המסך מציג את המידע שה-AI חילץ לצורך עיון בלבד.
 */
export default function ScreenOfTruthModal({ document, onClose }: ScreenOfTruthModalProps) {
    const jsonData = document.parsed_json || {};
    const isStructured = jsonData && !Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData.type;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#11161D] w-full max-w-7xl h-[90vh] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-[#151C24]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded flex items-center justify-center font-bold bg-green-500/20 text-green-400">
                            <CheckCircle className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">{document.title}</h2>
                            <p className="text-xs text-green-400">
                                {jsonData.type ? `${jsonData.type} — נקלט בהצלחה ✓` : 'מסמך נקלט בהצלחה ✓'}
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
                            מקור (Original Document)
                        </div>
                        <div className="flex-1 relative bg-black/40 p-4 overflow-auto flex items-center justify-center">
                            {document.file_url ? (
                                <iframe src={document.file_url} className="w-full h-full rounded bg-white" />
                            ) : (
                                <span className="text-gray-500">אין תצוגה מקדימה</span>
                            )}
                        </div>
                    </div>

                    {/* RIGHT: Parsed Metadata */}
                    <div className="bg-[#151C24] rounded-lg border border-white/5 flex flex-col overflow-hidden">
                        <div className="p-2 border-b border-white/5 bg-[#1A222C] text-xs font-semibold text-gray-300 flex justify-between">
                            <span>מידע שנקלט</span>
                            <span className="flex items-center gap-1 text-green-400">
                                <CheckCircle className="w-3 h-3" /> נקלט אוטומטית
                            </span>
                        </div>

                        <div className="flex-1 overflow-auto p-4" dir="rtl">
                            {isStructured ? (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-white mb-3">
                                        <FileText className="w-4 h-4 text-primary" />
                                        <span className="font-semibold text-lg">{jsonData.type}</span>
                                    </div>

                                    {jsonData.summary && (
                                        <p className="text-sm text-gray-400 mb-4">{jsonData.summary}</p>
                                    )}

                                    {jsonData.date && (
                                        <div className="text-sm text-gray-300 mb-4">
                                            📅 תאריך: <span className="font-mono text-white">{jsonData.date}</span>
                                        </div>
                                    )}

                                    <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-sm text-green-300">
                                        ✓ המסמך נסרק ונקלט אוטומטית למערכת. אין צורך בפעולה נוספת.
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                    <p>אין מידע זמין — יש להפעיל סריקה</p>
                                </div>
                            )}
                        </div>

                        {/* Footer: Only Close button */}
                        <div className="p-4 border-t border-white/10 bg-[#11161D] flex justify-end rounded-b-lg">
                            <button onClick={onClose} className="px-6 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors font-medium text-sm">
                                סגור
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
