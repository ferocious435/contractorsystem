'use client';

import React from 'react';
import type { LedgerItem } from '@/types';
import { VAT_RATE, AI_MODEL_BRANDING } from '@/utils/constants';
import { getAmountVat, getLedgerRowAmount, getMoneySum } from '@/utils/project-financials';

interface PrintableLetterProps {
    projectName: string;
    recipient: string;
    subject: string;
    legalText: string;
    items: LedgerItem[];
    vatRate?: number;
    onClose?: () => void;
}

function toReactText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function getDisplayNotes(value: LedgerItem['governing_notes']): string[] {
    if (Array.isArray(value)) {
        return value.map(toReactText).filter(Boolean);
    }

    const singleNote = toReactText(value);
    return singleNote ? [singleNote] : [];
}
/**
 * Component for generating professional, printable Variation Order letters.
 * Optimized for Hebrew (RTL) and browser-based printing.
 */
export const PrintableLetter: React.FC<PrintableLetterProps> = ({
    projectName,
    recipient,
    subject,
    legalText,
    items,
    vatRate = VAT_RATE,
    onClose
}) => {
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(val);
    };

    const letterItems = items.filter((item) => item.type !== 'BASE_CONTRACT');
    const calculationItems = letterItems.filter(i => !i.item_type || i.item_type === 'ITEM');
    const totalExclVat = calculationItems.reduce((sum, i) => getMoneySum([sum, getLedgerRowAmount(i)]), 0);
    const totalVat = getAmountVat(totalExclVat, vatRate);
    const totalInclVat = getMoneySum([totalExclVat, totalVat]);

    return (
        <div className="fixed inset-0 z-[9999] bg-white overflow-y-auto print:static print:bg-transparent" dir="rtl">
            {/* Header controls (hidden on print) */}
            <div className="sticky top-0 bg-gray-100 p-4 flex justify-between items-center border-b print:hidden shadow-sm">
                <div className="flex gap-4">
                    <button 
                        onClick={() => window.print()}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors shadow-md"
                    >
                        <span>הדפס מכתב דרישה</span>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                    </button>
                    <button 
                        onClick={onClose}
                        className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-6 py-2 rounded-lg font-medium transition-colors"
                    >
                        ביטול וחזרה
                    </button>
                </div>
                <div className="text-sm text-gray-500 font-medium italic">
                    תצוגה מקדימה להדפסה - {AI_MODEL_BRANDING}
                </div>
            </div>

            {/* A4 Paper Container */}
            <div className="max-w-[210mm] mx-auto my-8 p-[20mm] bg-white shadow-2xl print:shadow-none print:my-0 print:p-0 min-h-[297mm] text-slate-900 leading-relaxed font-sans">
                
                {/* Letterhead Header */}
                <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-2">מכתב דרישה חריגים</h1>
                        <p className="text-lg font-bold text-slate-600">סימוכין: {new Date().getTime().toString().slice(-6)}</p>
                    </div>
                    <div className="text-left text-sm font-medium text-slate-500">
                        <p>{new Date().toLocaleDateString('he-IL')}</p>
                        <p>עמוד 1 מתוך 1</p>
                    </div>
                </div>

                {/* Recipient and Project Info */}
                <div className="mb-10 grid grid-cols-2 gap-8 bg-slate-50 p-6 rounded-xl border border-slate-100">
                    <div className="space-y-2">
                        <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">לכבוד:</p>
                        <p className="text-xl font-black text-slate-800">{recipient || 'גורם מאשר'}</p>
                    </div>
                    <div className="space-y-2">
                        <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">פרויקט:</p>
                        <p className="text-xl font-black text-slate-800">{projectName || '---'}</p>
                    </div>
                </div>

                {/* Subject Line */}
                <div className="mb-8">
                    <h2 className="text-2xl font-black border-r-4 border-blue-600 pr-4 py-1 text-slate-900">
                        הנדון: {subject || 'הצעת מחיר עבור עבודות חריגות ושינויים'}
                    </h2>
                </div>

                {/* AI Generated Professional Text */}
                <div className="mb-10 text-lg text-slate-700 whitespace-pre-wrap leading-relaxed indent-8 text-justify">
                    {legalText || 'מצ"ב הצעתנו לביצוע העבודות המפורטות מטה, אשר אינן נכללות בהסכם המקורי ומהוות תוספות/שינויים לבקשתכם.'}
                </div>

                {/* Financial Table */}
                <div className="mb-10 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                    <table className="w-full text-sm text-right border-collapse">
                        <thead className="bg-slate-900 text-white font-bold">
                            <tr>
                                <th className="px-4 py-4 border-l border-slate-700">#</th>
                                <th className="px-4 py-4 border-l border-slate-700">קוד/תיאור</th>
                                <th className="px-4 py-4 border-l border-slate-700 text-center">יח&quot;מ</th>
                                <th className="px-4 py-4 border-l border-slate-700 text-center">כמות</th>
                                <th className="px-4 py-4 border-l border-slate-700 text-left">מחיר יחידה</th>
                                <th className="px-4 py-4 text-left">סה&quot;כ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {letterItems.map((item, idx) => {
                                const governingNotes = getDisplayNotes(item.governing_notes);

                                if (item.item_type === 'CHAPTER') {
                                    return (
                                        <tr key={idx} className="bg-slate-100 font-black text-slate-800">
                                            <td colSpan={6} className="px-4 py-3">{item.description}</td>
                                        </tr>
                                    );
                                }
                                if (item.item_type === 'SUBCHAPTER') {
                                    return (
                                        <tr key={idx} className="bg-slate-50 font-bold text-blue-800">
                                            <td colSpan={6} className="px-4 py-3 pr-8">{item.description}</td>
                                        </tr>
                                    );
                                }
                                if (item.item_type === 'NOTE') {
                                    return (
                                        <tr key={idx} className="bg-white italic text-slate-500 italic">
                                            <td colSpan={6} className="px-4 py-2 pr-12 text-xs">הערה: {item.description}</td>
                                        </tr>
                                    );
                                }

                                return (
                                    <React.Fragment key={idx}>
                                        <tr className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-4 text-slate-400 font-mono">{idx + 1}</td>
                                            <td className="px-4 py-4 font-bold text-slate-800">
                                                {item.item_code && <span className="text-slate-400 text-xs ml-2">[{item.item_code}]</span>}
                                                {item.description}
                                            </td>
                                            <td className="px-4 py-4 text-center text-slate-600">{item.unit || '-'}</td>
                                            <td className="px-4 py-4 text-center font-bold text-slate-900">{item.quantity}</td>
                                            <td className="px-4 py-4 text-left text-slate-600 font-mono">{formatCurrency(item.unit_price_excl_vat)}</td>
                                            <td className="px-4 py-4 text-left font-black text-slate-900 font-mono">
                                                {formatCurrency(getLedgerRowAmount(item))}
                                            </td>
                                        </tr>
                                        {governingNotes.length > 0 && (
                                            <tr className="bg-emerald-50/30 print:bg-transparent">
                                                <td colSpan={6} className="px-4 py-2 pr-12 text-[11px] font-bold text-emerald-700 border-r-2 border-emerald-500">
                                                    <span className="ml-1 opacity-70">סימוכין חוזי:</span>
                                                    {governingNotes.join(', ')}
                                                </td>
                                            </tr>
                                        )}
                                        {item.ai_rationale && (
                                            <tr className="bg-blue-50/30 print:bg-transparent">
                                                <td colSpan={6} className="px-4 py-2 pr-12 text-[11px] italic text-blue-600 border-r-2 border-blue-400">
                                                    <span className="ml-1 opacity-70 italic">נימוק מקצועי:</span> {item.ai_rationale}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Summary Section */}
                <div className="flex justify-end mb-16">
                    <div className="w-1/2 space-y-3 bg-slate-900 text-white p-8 rounded-2xl shadow-xl">
                        <div className="flex justify-between text-sm opacity-80 border-b border-slate-700 pb-2">
                            <span>סה&quot;כ לפני מע&quot;מ:</span>
                            <span className="font-mono">{formatCurrency(totalExclVat)}</span>
                        </div>
                        <div className="flex justify-between text-sm opacity-80 border-b border-slate-700 pb-2">
                            <span>מע&quot;מ ({(vatRate * 100).toFixed(0)}%):</span>
                            <span className="font-mono">{formatCurrency(totalVat)}</span>
                        </div>
                        <div className="flex justify-between text-xl font-black pt-2">
                            <span>סה&quot;כ לתשלום:</span>
                            <span className="font-mono text-2xl tracking-tight underline decoration-blue-500 underline-offset-8">
                                {formatCurrency(totalInclVat)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Footer / Signatures */}
                <div className="grid grid-cols-2 gap-20 pt-20 border-t border-slate-200 mb-20">
                    <div className="text-center space-y-8">
                        <div className="h-16 border-b border-slate-300"></div>
                        <p className="font-black text-slate-800">חתימת וחותמת הקבלן</p>
                    </div>
                    <div className="text-center space-y-8">
                        <div className="h-16 border-b border-slate-300"></div>
                        <p className="font-black text-slate-800">אישור המזמין / מפקח</p>
                    </div>
                </div>

                {/* Evidence Appendix (New Page/Section) */}
                <div className="break-before-page pt-12 border-t-4 border-slate-900">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="bg-blue-600 text-white px-4 py-2 rounded-lg font-black text-xl">נספח א&apos;</div>
                        <h2 className="text-2xl font-black text-slate-900">נספח הוכחות וסימוכין (Evidence Appendix)</h2>
                    </div>

                    <div className="space-y-8">
                        {letterItems.filter(i => getDisplayNotes(i.governing_notes).length > 0 || i.ai_rationale).map((item, idx) => {
                            const governingNotes = getDisplayNotes(item.governing_notes);

                            return (
                            <div key={idx} className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                                <div className="flex justify-between items-start mb-4 border-b border-slate-200 pb-3">
                                    <div className="font-black text-slate-800">
                                        {item.item_code && <span className="text-blue-600 ml-2">[{item.item_code}]</span>}
                                        {item.description}
                                    </div>
                                    <div className="text-[10px] font-black uppercase text-slate-400 bg-white px-3 py-1 rounded-full border border-slate-200">
                                        סימוכין #{idx + 1}
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-black uppercase text-emerald-600 tracking-widest">מקורות חוזיים / טכניים</h4>
                                        <div className="text-sm text-slate-600 leading-relaxed">
                                            {governingNotes.length > 0 ? (
                                                <ul className="list-disc pr-5 space-y-1">
                                                    {governingNotes.map((note, i) => (
                                                        <li key={i}>{note}</li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p>לא צוינו מקורות ספציפיים</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-black uppercase text-blue-600 tracking-widest">ניתוח בינה מלאכותית</h4>
                                        <div className="text-sm text-slate-600 leading-relaxed italic border-r-2 border-blue-200 pr-4">
                                            {item.ai_rationale || 'ניתוח אוטומטי של מערכת Gemini'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                        })}
                        
                        {letterItems.every(i => getDisplayNotes(i.governing_notes).length === 0 && !i.ai_rationale) && (
                            <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                                <p className="text-slate-400 font-medium">לא נמצאו סימוכין מפורטים עבור פריטים אלו.</p>
                            </div>
                        )}
                    </div>

                    <div className="mt-12 p-6 bg-amber-50 rounded-xl border border-amber-200">
                        <p className="text-xs text-amber-800 leading-relaxed">
                            <strong>הערה משפטית:</strong> כל הנתונים המפורטים בנספח זה הופקו על ידי מערכת {AI_MODEL_BRANDING} על בסיס הצלבת נתוני החוזה, מחירוני דקל וניתוח הנדסי. יש לוודא את הנתונים אל מול יומני עבודה ופרוטוקולים מהשטח לפני חתימה סופית.
                        </p>
                    </div>
                </div>

                <div className="mt-20 text-center text-[10px] text-slate-400 font-medium tracking-widest uppercase">
                    Generated by {AI_MODEL_BRANDING} - Internal Document Verification Required
                </div>
            </div>
        </div>
    );
};
