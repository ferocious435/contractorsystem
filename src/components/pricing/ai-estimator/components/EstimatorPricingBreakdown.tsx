import React from 'react';
import { Calculator, FileSearch } from 'lucide-react';
import type { AIPricingEvaluationResponse, AIPricingMatchedItem } from '../types';

interface EstimatorPricingBreakdownProps {
    estimateData?: AIPricingEvaluationResponse | null;
}

const SOURCE_LABELS: Record<string, string> = {
    BOQ: 'כתב כמויות',
    HOUSING_MINISTRY: 'מחירון משרד השיכון',
    DEKEL: 'דקל',
    CONTRACTOR: 'הצעת מחיר',
    CUSTOM_ANALYSIS: 'שורת טיוטה',
};

function formatMoney(value: unknown) {
    const numericValue = Number(value || 0);
    return `₪${numericValue.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function EstimatorPricingBreakdown({ estimateData }: EstimatorPricingBreakdownProps) {
    const breakdown = estimateData?.pricing_breakdown || [];
    const matchedContract = estimateData?.matched_items?.contract || [];
    const matchedPricelist = estimateData?.matched_items?.pricelist || [];
    const matchedItems = [...matchedContract, ...matchedPricelist].slice(0, 6);

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3 text-[11px] font-mono font-black text-blue-400 uppercase tracking-[0.35em]">
                <Calculator className="w-4 h-4" />
                הרכב התמחור
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <div className="grid grid-cols-[0.9fr_2fr_0.7fr_0.7fr_0.9fr_0.9fr] gap-3 px-5 py-3 bg-white/[0.04] text-[10px] font-black text-gray-500">
                    <span>מקור</span>
                    <span>תיאור סעיף</span>
                    <span>יח&apos;</span>
                    <span>כמות</span>
                    <span>מחיר יח&apos;</span>
                    <span>סה&quot;כ</span>
                </div>

                {breakdown.length > 0 ? (
                    breakdown.map((row, index) => (
                        <div
                            key={`${row.item_code || 'row'}-${index}`}
                            className="grid grid-cols-[0.9fr_2fr_0.7fr_0.7fr_0.9fr_0.9fr] gap-3 px-5 py-4 border-t border-white/5 text-xs text-gray-300"
                        >
                            <div className="flex flex-col gap-1">
                                <span className="font-black text-white">{SOURCE_LABELS[row.source || ''] || row.source_name || 'מקור'}</span>
                                <span className="text-[10px] text-gray-600">{row.item_code || 'ללא קוד'}</span>
                            </div>
                            <div className="leading-5">
                                <div className="font-bold text-gray-200">{row.description}</div>
                                {row.basis && <div className="mt-1 text-[10px] text-gray-500">{row.basis}</div>}
                                {row.is_inference && <div className="mt-1 text-[10px] text-amber-400">שורת טיוטה לעריכה</div>}
                            </div>
                            <span>{row.unit || '-'}</span>
                            <span>{Number(row.quantity || 0).toLocaleString('he-IL')}</span>
                            <span>{formatMoney(row.unit_price_excl_vat)}</span>
                            <span className="font-black text-emerald-400">{formatMoney(row.amount_excl_vat)}</span>
                        </div>
                    ))
                ) : (
                    <div className="px-5 py-5 text-sm text-amber-300">
                        עדיין לא נבנה פירוט סעיפים. נדרש מקור מחיר או הזנת מחיר ידנית.
                    </div>
                )}
            </div>

            {(estimateData?.source_basis?.length || matchedItems.length > 0) && (
                <div className="rounded-3xl border border-blue-500/15 bg-blue-500/[0.04] p-5 space-y-3">
                    <div className="flex items-center gap-2 text-[10px] font-black text-blue-300 uppercase tracking-widest">
                        <FileSearch className="w-4 h-4" />
                        לפי מה תומחר
                    </div>
                    {estimateData?.source_basis?.map((basis, index) => (
                        <div key={`basis-${index}`} className="text-xs text-gray-300 leading-5">
                            {basis}
                        </div>
                    ))}
                    {matchedItems.map((item: AIPricingMatchedItem, index: number) => (
                        <div key={`matched-${index}`} className="text-xs text-gray-400 leading-5">
                            {item.pricelists?.name || item.source || 'כתב כמויות'} · {item.item_code || 'ללא קוד'} · {item.description}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default React.memo(EstimatorPricingBreakdown);
