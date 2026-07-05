import React from 'react';
import type { ChangeEvent } from 'react';
import { Plus, Tag } from 'lucide-react';
import type { AIEstimatorFormState } from '../types';

interface EstimatorPricingFormProps {
    formState: AIEstimatorFormState;
    onFormChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
    onMarkupPreset: (markup: number) => void;
    hasPricingDraft: boolean;
}

const MARKUP_PRESETS = [0, 10, 15, 20, 25];

const SOURCE_LABELS: Record<string, string> = {
    BOQ: 'כתב כמויות / סעיף חוזי',
    DEKEL: 'דקל או מחירון רשמי שנמצא במערכת',
    CONTRACTOR: 'הצעת מחיר',
    CUSTOM_ANALYSIS: 'טיוטת תמחור לעריכה לפי מסמכי הפרויקט',
};

function EstimatorPricingForm({
    formState,
    onFormChange,
    onMarkupPreset,
    hasPricingDraft,
}: EstimatorPricingFormProps) {
    const pricingBasisLabel = !hasPricingDraft && formState.source === 'CUSTOM_ANALYSIS'
        ? 'לא נבנה מחיר אוטומטי - יש להזין מחיר יחידה'
        : (SOURCE_LABELS[formState.source] || SOURCE_LABELS.CUSTOM_ANALYSIS);

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-10">
            <div className="space-y-4 sm:col-span-2">
                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest flex items-center gap-3">
                    <Tag className="w-4 h-4" /> תיאור עבודה
                </label>
                <textarea
                    name="description"
                    value={formState.description}
                    onChange={onFormChange}
                    className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] p-4 sm:p-6 text-base text-white focus:border-blue-500/50 outline-none transition-all resize-none h-32 font-sans font-bold shadow-inner"
                />
            </div>

            <div className="space-y-4">
                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest">בסיס תמחור אוטומטי</label>
                <div className="w-full min-h-[58px] bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white font-black flex items-center">
                    {pricingBasisLabel}
                </div>
            </div>

            <div className="space-y-4">
                <label className="text-[11px] font-mono font-black text-gray-500 uppercase tracking-widest">יחידה</label>
                <input
                    type="text"
                    name="unit"
                    value={formState.unit}
                    onChange={onFormChange}
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
                        onChange={onFormChange}
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
                        onChange={onFormChange}
                        className="w-full bg-blue-500/[0.05] border border-blue-500/20 rounded-2xl px-6 py-4 text-lg text-blue-400 font-mono font-black focus:border-blue-500/50 outline-none shadow-[0_0_20px_rgba(59,130,246,0.05)]"
                    />
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-blue-500/50 font-mono text-sm font-bold">₪</span>
                </div>
            </div>

            <div className="space-y-4 sm:col-span-2">
                <label className="text-[11px] font-mono font-black text-amber-500 uppercase tracking-widest">% תקורה ורווח (אופציונלי)</label>
                <div className="relative group">
                    <input
                        type="number"
                        name="markup"
                        value={formState.markup}
                        onChange={onFormChange}
                        className="w-full bg-amber-500/[0.05] border border-amber-500/20 rounded-2xl px-6 py-4 text-lg text-amber-500 font-mono font-black focus:border-amber-500/50 outline-none"
                    />
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-amber-500/50 font-mono text-sm font-bold">%</span>

                    <div className="mt-4 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                        {MARKUP_PRESETS.map((value) => (
                            <button
                                key={value}
                                onClick={() => onMarkupPreset(value)}
                                className={`px-4 py-1.5 rounded-lg border text-[10px] font-black transition-all ${
                                    formState.markup === value
                                        ? 'bg-amber-500 text-black border-amber-500'
                                        : 'bg-white/5 text-amber-500/60 border-white/5 hover:border-amber-500/30'
                                }`}
                            >
                                {value === 0 ? '0%' : `+${value}%`}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-amber-300/60 leading-5">
                        אם לא מאשרים רווח קבלני, השאר 0%. המע&quot;מ נשאר מחושב בנפרד.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default React.memo(EstimatorPricingForm);
