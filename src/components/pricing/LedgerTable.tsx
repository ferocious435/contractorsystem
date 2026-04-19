import React, { useState } from 'react';
import GenerateVOLetterModal from './GenerateVOLetterModal';

export interface LedgerItem {
    id: string;
    item_code: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price_excl_vat: number;
    total_price_incl_vat: number;
    total_price_excl_vat: number;
    vat_amount: number;
    source?: string;
    project_id?: string;
}

interface LedgerTableProps {
    items: LedgerItem[];
    vatRate?: number;
}

export default function LedgerTable({ items, vatRate = 0.18 }: LedgerTableProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isGeneratorModalOpen, setIsGeneratorModalOpen] = useState(false);

    // Calculate Totals Before VAT for all items
    const totalExclVat = items.reduce((acc, item) => acc + (item.quantity * item.unit_price_excl_vat), 0);
    const totalVat = totalExclVat * vatRate;
    const totalInclVat = totalExclVat + totalVat;

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(val);
    };

    const getSourceDisplayName = (source?: string) => {
        switch (source) {
            case 'BOQ': return 'חוזה';
            case 'DEKEL': return 'דקל';
            case 'CONTRACTOR': return 'קבלן';
            case 'CUSTOM_ANALYSIS': return 'ניתוח מחיר';
            default: return source || '---';
        }
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedIds(new Set(items.map(item => item.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) {
            next.add(id);
        } else {
            next.delete(id);
        }
        setSelectedIds(next);
    };

    const selectedItems = items.filter(item => selectedIds.has(item.id));

    return (
        <div className="h-full flex flex-col rounded-xl border border-white/10 bg-[#11161d] overflow-hidden">
            <div className="px-6 py-4 bg-[#151C24] border-b border-white/10 flex justify-between items-center z-10">
                <h2 className="text-lg font-semibold text-white">מטריצת ביצוע (The Ledger)</h2>
                <div className="flex gap-2">
                    <span className="text-xs bg-white/5 text-gray-400 px-3 py-1 rounded-full border border-white/10">
                        {selectedIds.size > 0 ? `${selectedIds.size} נבחרו מתוך ` : ''}{items.length} סעיפים
                    </span>
                    <button
                        onClick={() => {
                            if (selectedIds.size === 0) {
                                alert('נא לבחור לפחות סעיף אחד להפקת המסמך.');
                                return;
                            }
                            setIsGeneratorModalOpen(true);
                        }}
                        className={`text-xs px-3 py-1 rounded-full transition-colors border ${selectedIds.size > 0
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                            : 'bg-gray-500/10 text-gray-500 border-gray-500/20 cursor-not-allowed'
                            }`}
                    >
                        ייצא ל-PDF הצעת מחיר
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto">
                <table className="w-full text-right" dir="rtl">
                    <thead className="bg-[#1A222C] sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-4 py-3 w-10">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === items.length && items.length > 0}
                                    onChange={handleSelectAll}
                                    className="rounded border-gray-500 text-emerald-500 focus:ring-emerald-500/50 bg-[#151C24]"
                                />
                            </th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-24">מקור</th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-24">קוד סעיף</th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-400">תיאור העבודה/חומר</th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-20 text-center">יח"מ</th>
                            <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-24 text-center">כמות</th>
                            <th className="px-6 py-3 text-xs font-semibold text-blue-400 w-32 border-r border-white/5 border-l">מחיר יחידה (לפני מע"מ)</th>
                            <th className="px-6 py-3 text-xs font-semibold text-emerald-400 w-32">סה"כ (לפני מע"מ)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                                    אין נתונים לחשבון זה. העבר חריגים מתור ההמתנה.
                                </td>
                            </tr>
                        ) : (
                            items.map((item) => (
                                <tr key={item.id} className={`hover:bg-white/5 transition-colors group ${selectedIds.has(item.id) ? 'bg-emerald-500/5' : ''}`}>
                                    <td className="px-4 py-3">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(item.id)}
                                            onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                                            className="rounded border-gray-500 text-emerald-500 focus:ring-emerald-500/50 bg-[#151C24]"
                                        />
                                    </td>
                                    <td className="px-6 py-3 text-xs font-medium text-gray-400">
                                        <span className="bg-white/5 px-2 py-1 rounded border border-white/10">
                                            {getSourceDisplayName(item.source)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-sm font-mono text-gray-400">{item.item_code || '---'}</td>
                                    <td className="px-6 py-3 text-sm font-medium text-gray-200">{item.description}</td>
                                    <td className="px-6 py-3 text-sm text-gray-400 text-center">{item.unit}</td>
                                    <td className="px-6 py-3 text-sm text-gray-300 text-center font-mono">{item.quantity}</td>
                                    <td className="px-6 py-3 text-sm text-blue-300 font-mono border-r border-white/5 border-l bg-blue-500/5">
                                        {formatCurrency(item.unit_price_excl_vat || 0)}
                                    </td>
                                    <td className="px-6 py-3 text-sm text-emerald-300 font-mono font-medium">
                                        {formatCurrency(item.quantity * item.unit_price_excl_vat)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer / Summary Aggregation */}
            <div className="bg-[#151C24] border-t border-white/10 px-6 py-4 mt-auto">
                <div className="flex flex-col items-end gap-2 text-right rtl">
                    <div className="flex justify-between w-64 text-sm text-gray-400">
                        <span>סה"כ ביניים (ללא מע"מ):</span>
                        <span className="font-mono">{formatCurrency(totalExclVat)}</span>
                    </div>
                    <div className="flex justify-between w-64 text-sm text-gray-500">
                        <span>מע"מ (18%):</span>
                        <span className="font-mono">{formatCurrency(totalVat)}</span>
                    </div>
                    <div className="flex justify-between w-64 text-lg font-bold text-white mt-2 pt-2 border-t border-white/10">
                        <span>סה"כ לתשלום:</span>
                        <span className="font-mono text-emerald-400">{formatCurrency(totalInclVat)}</span>
                    </div>
                </div>
            </div>

            {isGeneratorModalOpen && (
                <GenerateVOLetterModal
                    selectedItems={selectedItems}
                    onClose={() => setIsGeneratorModalOpen(false)}
                />
            )}
        </div>
    );
}
