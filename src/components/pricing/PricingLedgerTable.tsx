import React from 'react';
import {
    Brain,
    Check,
    CheckCircle,
    Cpu,
    Edit2,
    FileText,
    Layers,
    Shield,
    Trash2,
    X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { LedgerItem } from '@/types';
import { getLedgerRowAmount } from '@/utils/project-financials';

interface PricingLedgerTableProps {
    ledgerItems: LedgerItem[];
    isLoading: boolean;
    isAddingNew: boolean;
    isEditing: string | null;
    newItemForm: any;
    setNewItemForm: (form: any) => void;
    editForm: any;
    setEditForm: (form: any) => void;
    selectedLedgerIds: string[];
    toggleSelectItem: (id: string) => void;
    toggleSelectAll: () => void;
    handleAddNew: () => void;
    setIsAddingNew: (val: boolean) => void;
    handleSaveEdit: () => void;
    handleCancelEdit: () => void;
    approveVO: (id: string) => void;
    handleEditClick: (item: LedgerItem) => void;
    handleDelete: (id: string) => void;
    formatCurrency: (val: number) => string;
}

const EDITABLE_TYPES: Array<{ value: LedgerItem['type']; label: string }> = [
    { value: 'PENDING_VO', label: 'חריג לבדיקה' },
    { value: 'APPROVED_VO', label: 'חריג מאושר' },
    { value: 'SENT_VO', label: 'נשלח לדרישה' },
];

function TypeBadge({ type }: { type: LedgerItem['type'] }) {
    if (type === 'BASE_CONTRACT') {
        return (
            <div className="px-3 py-1 rounded-full bg-slate-500/10 border border-slate-400/20 text-slate-300 text-xs font-bold">
                חוזה בסיס
            </div>
        );
    }

    if (type === 'APPROVED_VO') {
        return (
            <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold">
                חריג מאושר
            </div>
        );
    }

    if (type === 'SENT_VO') {
        return (
            <div className="px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs font-bold">
                נשלח לדרישה
            </div>
        );
    }

    return (
        <div className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold">
            חריג לבדיקה
        </div>
    );
}

function TypeSelect({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none text-right text-gray-200"
            dir="rtl"
        >
            {EDITABLE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}

export default function PricingLedgerTable({
    ledgerItems,
    isLoading,
    isAddingNew,
    isEditing,
    newItemForm,
    setNewItemForm,
    editForm,
    setEditForm,
    selectedLedgerIds,
    toggleSelectItem,
    toggleSelectAll,
    handleAddNew,
    setIsAddingNew,
    handleSaveEdit,
    handleCancelEdit,
    approveVO,
    handleEditClick,
    handleDelete,
    formatCurrency,
}: PricingLedgerTableProps) {
    return (
        <div className="flex-1 bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl relative">
            <div className="absolute top-0 right-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-right border-collapse" dir="rtl">
                    <thead className="sticky top-0 bg-[#1A222C] z-30 border-b border-white/5">
                        <tr className="h-16">
                            <th className="px-6 py-4 text-center w-16">
                                <input
                                    type="checkbox"
                                    checked={ledgerItems.length > 0 && selectedLedgerIds.length === ledgerItems.length}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-500 focus:ring-blue-500 cursor-pointer"
                                />
                            </th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 w-36">סוג שורה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 w-28">קוד סעיף</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400">תיאור העבודה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-center w-20">יחידה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-center w-24">כמות</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-left w-32">מחיר יחידה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-left w-40">סה"כ ללא מע"מ</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-center w-36">פעולות</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {isAddingNew && (
                            <tr className="bg-primary/5 animate-in slide-in-from-top-1">
                                <td className="px-4 py-3 text-center" />
                                <td className="px-4 py-3">
                                    <TypeSelect
                                        value={newItemForm.type}
                                        onChange={(value) => setNewItemForm({ ...newItemForm, type: value })}
                                    />
                                </td>
                                <td className="px-4 py-3">
                                    <input
                                        type="text"
                                        value={newItemForm.item_code}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, item_code: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-primary outline-none text-right text-gray-200"
                                        dir="rtl"
                                    />
                                </td>
                                <td className="px-4 py-3">
                                    <input
                                        type="text"
                                        value={newItemForm.description}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, description: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-primary outline-none text-right text-gray-200"
                                        dir="rtl"
                                    />
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <input
                                        type="text"
                                        value={newItemForm.unit}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, unit: e.target.value })}
                                        className="w-16 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-primary outline-none text-gray-200"
                                    />
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <input
                                        type="number"
                                        value={newItemForm.quantity}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, quantity: parseFloat(e.target.value) || 0 })}
                                        className="w-20 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-primary outline-none text-gray-200"
                                    />
                                </td>
                                <td className="px-4 py-3 text-left">
                                    <input
                                        type="number"
                                        value={newItemForm.unit_price_excl_vat}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, unit_price_excl_vat: parseFloat(e.target.value) || 0 })}
                                        className="w-28 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-left focus:border-primary outline-none text-gray-200"
                                    />
                                </td>
                                <td className="px-4 py-3 text-left text-sm font-bold text-emerald-300">
                                    {formatCurrency((Number(newItemForm.quantity) || 0) * (Number(newItemForm.unit_price_excl_vat) || 0))}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-2">
                                        <button
                                            onClick={handleAddNew}
                                            className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-colors"
                                            title="שמור"
                                        >
                                            <Check className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => setIsAddingNew(false)}
                                            className="p-2 text-gray-500 hover:bg-white/10 rounded-xl transition-colors"
                                            title="בטל"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {isLoading ? (
                            <tr>
                                <td colSpan={9} className="px-6 py-24 text-center">
                                    <div className="flex flex-col items-center gap-6">
                                        <div className="relative">
                                            <div className="w-16 h-16 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin" />
                                            <Cpu size={24} className="absolute inset-0 m-auto text-blue-500 animate-pulse" />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <span className="text-sm font-bold text-blue-400">טוען נתוני תמחור...</span>
                                            <span className="text-xs text-gray-500">המערכת מרכזת את הנתונים הכספיים לפרויקט</span>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : ledgerItems.length === 0 && !isAddingNew ? (
                            <tr>
                                <td colSpan={9} className="px-6 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-50">
                                        <Layers size={48} className="text-gray-700" />
                                        <p className="text-sm font-medium text-gray-400" dir="rtl">
                                            עדיין אין סעיפים מתומחרים. אפשר להוסיף סעיף חדש או לתמחר סתירה קיימת.
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            <AnimatePresence mode="popLayout">
                                {ledgerItems.map((item, idx) => {
                                    const rowTotal = getLedgerRowAmount(item);

                                    return (
                                        <motion.tr
                                            key={item.id}
                                            layout
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ duration: 0.2, delay: idx * 0.02 }}
                                            className={`hover:bg-white/[0.02] transition-colors group border-b border-white/5 last:border-0 min-h-16 ${
                                                selectedLedgerIds.includes(item.id) ? 'bg-blue-500/5' : ''
                                            }`}
                                        >
                                            <td className="px-6 py-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLedgerIds.includes(item.id)}
                                                    onChange={() => toggleSelectItem(item.id)}
                                                    className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-500 focus:ring-blue-500 cursor-pointer"
                                                />
                                            </td>

                                            {isEditing === item.id ? (
                                                <>
                                                    <td className="px-4 py-3">
                                                        <TypeSelect
                                                            value={editForm.type}
                                                            onChange={(value) => setEditForm({ ...editForm, type: value })}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input
                                                            type="text"
                                                            value={editForm.item_code}
                                                            onChange={(e) => setEditForm({ ...editForm, item_code: e.target.value })}
                                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none text-right text-gray-200"
                                                            dir="rtl"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input
                                                            type="text"
                                                            value={editForm.description}
                                                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none text-right text-gray-200"
                                                            dir="rtl"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <input
                                                            type="text"
                                                            value={editForm.unit}
                                                            onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                                                            className="w-16 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-blue-500 outline-none text-gray-200"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <input
                                                            type="number"
                                                            value={editForm.quantity}
                                                            onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) || 0 })}
                                                            className="w-20 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-blue-500 outline-none text-gray-200"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-left">
                                                        <input
                                                            type="number"
                                                            value={editForm.unit_price_excl_vat}
                                                            onChange={(e) => setEditForm({ ...editForm, unit_price_excl_vat: parseFloat(e.target.value) || 0 })}
                                                            className="w-28 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-left focus:border-blue-500 outline-none text-gray-200"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-left text-sm font-bold text-gray-300">
                                                        {formatCurrency((Number(editForm.quantity) || 0) * (Number(editForm.unit_price_excl_vat) || 0))}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex justify-center gap-2">
                                                            <button
                                                                onClick={handleSaveEdit}
                                                                className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all"
                                                                title="שמור"
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                            <button
                                                                onClick={handleCancelEdit}
                                                                className="p-2 text-gray-500 hover:bg-white/10 rounded-xl transition-all"
                                                                title="בטל"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="px-6 py-4">
                                                        <TypeBadge type={item.type} />
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-400">{item.item_code || '---'}</td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col gap-2">
                                                            <div className="flex items-start gap-2">
                                                                <span className="text-sm font-medium text-gray-100 leading-6" dir="rtl">
                                                                    {item.description}
                                                                </span>
                                                                {item.ai_rationale && (
                                                                    <div className="relative group/rationale shrink-0 mt-0.5">
                                                                        <Brain className="h-4 w-4 text-blue-400 opacity-50 group-hover/rationale:opacity-100 transition-opacity cursor-help" />
                                                                        <div className="absolute bottom-full right-0 mb-4 w-80 opacity-0 group-hover/rationale:opacity-100 pointer-events-none transition-all z-50 translate-y-2 group-hover/rationale:translate-y-0">
                                                                            <div className="bg-[#1A222C] border border-blue-500/30 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl relative">
                                                                                <div className="flex items-center gap-2 mb-3">
                                                                                    <div className="w-6 h-6 bg-blue-500/10 rounded-lg flex items-center justify-center border border-blue-500/20">
                                                                                        <Cpu className="h-3.5 w-3.5 text-blue-400" />
                                                                                    </div>
                                                                                    <span className="text-xs font-bold text-blue-300">איך המערכת בנתה את הסעיף</span>
                                                                                </div>
                                                                                <p className="text-sm leading-6 text-gray-300" dir="rtl">
                                                                                    {item.ai_rationale}
                                                                                </p>
                                                                                {item.governing_notes && Array.isArray(item.governing_notes) && item.governing_notes.length > 0 && (
                                                                                    <div className="pt-3 mt-3 border-t border-white/5 space-y-2">
                                                                                        <span className="text-xs font-bold text-gray-400">הערות והסתמכויות</span>
                                                                                        <div className="flex flex-col gap-2">
                                                                                            {item.governing_notes.map((note: string, i: number) => (
                                                                                                <div key={i} className="flex items-start gap-2 text-xs text-gray-400" dir="rtl">
                                                                                                    <Shield size={12} className="text-blue-500 shrink-0 mt-0.5" />
                                                                                                    <span>{note}</span>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                <div className="absolute -bottom-2 right-6 w-4 h-4 bg-[#1A222C] border-r border-b border-blue-500/30 rotate-45" />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {item.source_execution_doc && (
                                                                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                                    <FileText size={12} className="text-gray-600" />
                                                                    <span className="truncate max-w-[240px]">מסמך מקור: {item.source_execution_doc}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-300 text-center">{item.unit || '---'}</td>
                                                    <td className="px-6 py-4 text-sm text-gray-300 text-center">{item.quantity || 0}</td>
                                                    <td className="px-6 py-4 text-sm text-gray-300 text-left">{formatCurrency(item.unit_price_excl_vat || 0)}</td>
                                                    <td className="px-6 py-4 text-base font-bold text-white text-left">{formatCurrency(rowTotal)}</td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100">
                                                            {item.type === 'PENDING_VO' && (
                                                                <button
                                                                    onClick={() => approveVO(item.id)}
                                                                    className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all border border-transparent hover:border-emerald-500/20"
                                                                    title="אשר חריג"
                                                                >
                                                                    <CheckCircle size={16} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleEditClick(item)}
                                                                className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all border border-transparent hover:border-white/10"
                                                                title="ערוך"
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(item.id)}
                                                                className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                                                                title="מחק"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </>
                                            )}
                                        </motion.tr>
                                    );
                                })}
                            </AnimatePresence>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
