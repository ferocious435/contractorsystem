import React from 'react';
import { CheckCircle2, FileSpreadsheet, FileText, Landmark, ReceiptText } from 'lucide-react';

interface EstimatorSourceSelectorProps {
    source: string;
    themeColor: string;
    hasPricingDraft: boolean;
}

const SOURCE_STEPS = [
    { id: 'BOQ', label: 'כתב כמויות', icon: FileSpreadsheet, desc: 'מקור חוזי ראשון' },
    { id: 'HOUSING_MINISTRY', label: 'מחירון משרד השיכון', icon: Landmark, desc: 'אם מצוין בחוזה' },
    { id: 'DEKEL', label: 'דקל', icon: FileText, desc: 'מחירון רשמי נוסף' },
    { id: 'CONTRACTOR', label: 'הצעות מחיר', icon: ReceiptText, desc: 'אסמכתאות ספקים/קבלנים' },
];

const SOURCE_LABELS: Record<string, string> = {
    BOQ: 'נמצא סעיף בכתב הכמויות',
    DEKEL: 'נמצא בסיס במחירון דקל / מחירון רשמי',
    CONTRACTOR: 'מבוסס על הצעת מחיר או מקור קבלני',
    CUSTOM_ANALYSIS: 'טיוטת תמחור לעריכה לפי מסמכי הפרויקט',
};

function EstimatorSourceSelector({
    source,
    themeColor,
    hasPricingDraft,
}: EstimatorSourceSelectorProps) {
    const activeIndex = source === 'BOQ'
        ? 0
        : source === 'DEKEL'
            ? 2
            : source === 'CONTRACTOR'
                ? 3
                : -1;
    const currentSourceLabel = !hasPricingDraft && source === 'CUSTOM_ANALYSIS'
        ? 'לא נבנתה טיוטת מחיר - חסר מחיר לחישוב'
        : (SOURCE_LABELS[source] || SOURCE_LABELS.CUSTOM_ANALYSIS);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
                {SOURCE_STEPS.map((step, index) => {
                    const isActive = index === activeIndex;
                    const wasChecked = activeIndex === -1 || index <= activeIndex;

                    return (
                        <div
                            key={step.id}
                            className={`flex flex-col items-center gap-3 p-4 border transition-all duration-300 rounded-3xl ${
                                isActive
                                    ? `border-${themeColor}-500 bg-${themeColor}-500/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]`
                                    : wasChecked
                                        ? 'border-white/10 bg-white/[0.03]'
                                        : 'border-white/5 bg-white/[0.01] opacity-55'
                            }`}
                        >
                            <div className="relative">
                                <step.icon className={`w-5 h-5 transition-colors ${isActive ? `text-${themeColor}-400` : 'text-gray-500'}`} />
                                {wasChecked && (
                                    <CheckCircle2 className={`absolute -top-2 -right-2 w-3.5 h-3.5 ${isActive ? `text-${themeColor}-400` : 'text-gray-500'}`} />
                                )}
                            </div>
                            <div className="text-center">
                                <div className={`text-[13px] font-black leading-tight ${isActive ? 'text-white' : 'text-gray-400'}`}>
                                    {step.label}
                                </div>
                                <div className="text-[8px] font-mono uppercase tracking-widest opacity-40 mt-1">{step.desc}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-300 leading-7">
                המערכת מחפשת מחיר לפי סדר החוזה. אין צורך לבחור ידנית מקור מחיר.
                <span className={`block mt-1 font-bold text-${themeColor}-300`}>
                    בסיס התמחור הנוכחי: {currentSourceLabel}
                </span>
            </div>
        </div>
    );
}

export default React.memo(EstimatorSourceSelector);
