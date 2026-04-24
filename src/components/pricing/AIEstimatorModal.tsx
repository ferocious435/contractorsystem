"use client";

import React, { useState, useEffect } from 'react';
import { X, Bot, AlertTriangle, Calculator, Check, ArrowRightLeft, FileSpreadsheet, Loader2 } from 'lucide-react';

interface AIEstimatorModalProps {
    contradiction: any;
    onClose: () => void;
    onApprove: (data: any) => Promise<void>;
}

export default function AIEstimatorModal({ contradiction, onClose, onApprove }: AIEstimatorModalProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [estimateData, setEstimateData] = useState<any>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Form State for Overrides
    const [formState, setFormState] = useState({
        description: '',
        unit: '',
        quantity: 0,
        unitPrice: 0,
        markup: 0,
        source: 'CUSTOM_ANALYSIS'
    });

    useEffect(() => {
        // Run the AI Estimation Mock automatically when modal opens
        const runEstimation = async () => {
            try {
                const res = await fetch('/api/pricing/evaluate-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contradictionId: contradiction.id,
                        projectId: contradiction.project_id || contradiction.projectId, // Убедимся, что передаем projectId
                    })
                });

                const data = await res.json();
                setEstimateData(data);

                // Pre-fill form
                setFormState({
                    description: data.suggested_description || contradiction.description,
                    unit: data.suggested_unit || 'מ"ר',
                    quantity: data.suggested_quantity || 1,
                    unitPrice: data.suggested_unit_price_excl_vat || 0,
                    markup: 15, // Default 15% markup
                    source: data.item_code === 'NEW' ? 'CUSTOM_ANALYSIS' : 'BOQ'
                });

            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        };

        runEstimation();
    }, [contradiction]);

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({
            ...prev,
            [name]: (name === 'description' || name === 'unit' || name === 'source') ? value : Number(value)
        }));
    };

    const handleSubmit = async () => {
        setIsSaving(true);
        try {
            await onApprove({
                contradiction_id: contradiction.id,
                type: 'PENDING_VO',
                source: formState.source,
                item_code: estimateData?.item_code || '',
                description: formState.description,
                unit: formState.unit,
                quantity: formState.quantity,
                unit_price_excl_vat: formState.unitPrice,
                markup_percentage: formState.markup / 100 // convert to decimal
            });
            onClose();
        } catch (e) {
            console.error(e);
            // Handle error, show toast
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm rtl">
            <div className="bg-[#11161D] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#151C24]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/20 text-primary rounded-lg border border-primary/30">
                            <Calculator className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">אומדן בינה מלאכותית: תמחור חריג</h2>
                            <p className="text-xs text-gray-500 font-mono">מזהה: {contradiction.id}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6 flex flex-col gap-6" dir="rtl">
                    {/* Contradiction Context */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-orange-400" />
                            <h3 className="font-semibold text-gray-200">הקשר מהרדאר</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-2">{contradiction.title}</p>
                        <p className="text-sm text-gray-500 bg-black/20 p-3 rounded-lg border border-white/5">{contradiction.description}</p>
                    </div>

                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-blue-400 bg-blue-500/5 rounded-xl border border-blue-500/10">
                            <Bot className="w-12 h-12 mb-4 animate-pulse" />
                            <p className="font-medium">ה-AI מנתח את החריג ומחפש במחירונים (הסכם {'->'} דקל {'->'} קבלן)...</p>
                            <Loader2 className="w-6 h-6 mt-4 animate-spin" />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            {/* AI Hierarchy & Rationale */}
                            <div className="flex gap-4">
                                <div className="flex-1 bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-4">
                                    <h4 className="flex items-center gap-2 font-semibold text-blue-300 mb-3 text-sm">
                                        <Bot className="w-4 h-4" /> מסקנת ה-AI
                                    </h4>
                                    <p className="text-sm text-gray-300 mb-4">{estimateData?.ai_rationale}</p>

                                    <div className="flex items-center gap-2 text-xs text-gray-400 opacity-70">
                                        <span className={`px-2 py-1 rounded ${estimateData?.match_found && estimateData?.source === 'BOQ' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 border border-white/10'}`}>הסכם (BOQ)</span>
                                        <ArrowRightLeft className="w-3 h-3" />
                                        <span className={`px-2 py-1 rounded ${estimateData?.match_found && estimateData?.source === 'DEKEL' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 border border-white/10'}`}>מחירון דקל</span>
                                        <ArrowRightLeft className="w-3 h-3" />
                                        <span className={`px-2 py-1 rounded ${!estimateData?.match_found ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 border border-white/10'}`}>ניתוח מחיר</span>
                                    </div>
                                </div>

                                {estimateData?.questions?.length > 0 && (
                                    <div className="flex-1 bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
                                        <h4 className="font-semibold text-orange-300 mb-2 text-sm">ה-AI זקוק להבהרות:</h4>
                                        <ul className="list-disc list-inside text-sm text-gray-400 pl-4 space-y-1">
                                            {estimateData.questions.map((q: string, i: number) => (
                                                <li key={i}>{q}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            {/* Manual Edit Form "ניתוח מחיר" */}
                            <div className="bg-[#151C24] border border-white/10 rounded-xl p-6">
                                <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                                    טופס תמחור לאישור (לפני מע"מ)
                                </h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-xs text-gray-400 mb-1 flex items-center justify-between">
                                            מקור תמחור (ניתן לשינוי)
                                            {formState.source === 'CUSTOM_ANALYSIS' && <span className="text-orange-400 text-[10px]">מצב ניתוח מחיר חדש פעיל</span>}
                                        </label>
                                        <select
                                            name="source"
                                            value={formState.source}
                                            onChange={handleFormChange}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all font-sans"
                                            dir="rtl"
                                        >
                                            <option value="BOQ">הסכם (BOQ)</option>
                                            <option value="DEKEL">מחירון דקל</option>
                                            <option value="CONTRACTOR">מחירון קבלן</option>
                                            <option value="CUSTOM_ANALYSIS">ניתוח מחיר חדש</option>
                                        </select>
                                    </div>

                                    <div className="col-span-2">
                                        <label className="block text-xs text-gray-400 mb-1">תיאור העבודה/חומר</label>
                                        <input
                                            type="text"
                                            name="description"
                                            value={formState.description}
                                            onChange={handleFormChange}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all font-sans"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">יחידת מידה</label>
                                        <input
                                            type="text"
                                            name="unit"
                                            value={formState.unit}
                                            onChange={handleFormChange}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary transition-all text-center"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">כמות</label>
                                        <input
                                            type="number"
                                            name="quantity"
                                            value={formState.quantity}
                                            onChange={handleFormChange}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-primary transition-all text-center font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">מחיר יחידה (לפני מע"מ)</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₪</span>
                                            <input
                                                type="number"
                                                name="unitPrice"
                                                value={formState.unitPrice}
                                                onChange={handleFormChange}
                                                className="w-full bg-black/40 border border-blue-500/30 rounded-lg pl-8 pr-3 py-2 text-blue-100 outline-none focus:border-blue-400 transition-all text-left font-mono"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">רווח קבלני (%)</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                                            <input
                                                type="number"
                                                name="markup"
                                                value={formState.markup}
                                                onChange={handleFormChange}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-white outline-none focus:border-primary transition-all text-left font-mono"
                                            />
                                        </div>
                                    </div>

                                    <div className="col-span-2 mt-4 pt-4 border-t border-white/5 flex justify-between items-center bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/10">
                                        <div className="text-gray-400 text-sm">
                                            סה"כ שווי חריג (לפני מע"מ):
                                        </div>
                                        <div className="text-2xl font-bold text-emerald-400 font-mono">
                                            ₪{((formState.quantity * formState.unitPrice) * (1 + (formState.markup / 100))).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 border-t border-white/10 bg-[#151C24] flex justify-between items-center">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-medium text-sm"
                        disabled={isSaving}
                    >
                        ביטול
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isLoading || isSaving}
                        className="flex items-center gap-2 px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors font-medium disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                        קלוט ועדכן מטריצה
                    </button>
                </div>
            </div>
        </div>
    );
}
