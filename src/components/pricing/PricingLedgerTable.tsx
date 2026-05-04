import React from 'react';
import { Check, X, Shield, Cpu, FileText, CheckCircle, Edit2, Trash2, Brain, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LedgerItem } from '@/types';

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
    formatCurrency
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
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono w-32">סוג שורה</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono w-28">קוד סעיף</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono">תיאור העבודה</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono text-center w-16">יחידה</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono text-center w-20">כמות</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono text-left w-32">מחיר יח'</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono text-left w-40">סה"כ (₪)</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] font-mono text-center w-32">פעולות</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {isAddingNew && (
                            <tr className="bg-primary/5 animate-in slide-in-from-top-1">
                                <td className="px-3 py-2 text-center"></td>
                                <td className="px-3 py-2 text-xs">
                                    <select
                                        value={newItemForm.type}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, type: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[11px] focus:border-primary outline-none text-right text-gray-200"
                                        dir="rtl"
                                    >
                                        <option value="BASE_CONTRACT">חוזה בסיס</option>
                                        <option value="APPROVED_VO">חריג מאושר</option>
                                        <option value="PENDING_VO">חריג בהמתנה</option>
                                    </select>
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        type="text"
                                        value={newItemForm.item_code}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, item_code: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[11px] focus:border-primary outline-none text-right text-gray-200 font-mono"
                                        dir="rtl"
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        type="text"
                                        value={newItemForm.description}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, description: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[11px] focus:border-primary outline-none text-right text-gray-200 font-sans"
                                        dir="rtl"
                                    />
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <input
                                        type="text"
                                        value={newItemForm.unit}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, unit: e.target.value })}
                                        className="w-10 mx-auto bg-black/40 border border-white/10 rounded px-1 py-1 text-[11px] text-center focus:border-primary outline-none text-gray-200"
                                    />
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <input
                                        type="number"
                                        value={newItemForm.quantity}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, quantity: parseFloat(e.target.value) || 0 })}
                                        className="w-14 mx-auto bg-black/40 border border-white/10 rounded px-1 py-1 text-[11px] text-center focus:border-primary outline-none text-gray-200 font-mono"
                                    />
                                </td>
                                <td className="px-3 py-2 text-left">
                                    <input
                                        type="number"
                                        value={newItemForm.unit_price_excl_vat}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, unit_price_excl_vat: parseFloat(e.target.value) || 0 })}
                                        className="w-20 pl-2 pr-1 py-1 bg-black/40 border border-white/10 rounded text-[11px] text-left focus:border-primary outline-none text-gray-200 font-mono"
                                    />
                                </td>
                                <td className="px-3 py-2 text-left text-[11px] font-mono text-emerald-400">
                                    {formatCurrency(newItemForm.quantity * newItemForm.unit_price_excl_vat)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <div className="flex justify-center gap-1.5">
                                        <button onClick={handleAddNew} className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors">
                                            <Check className="h-3.5 w-3.5" />
                                        </button>
                                        <button onClick={() => setIsAddingNew(false)} className="p-1 text-gray-500 hover:bg-white/10 rounded transition-colors">
                                            <X className="h-3.5 w-3.5" />
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
                                            <span className="text-[10px] font-mono font-black text-blue-500 uppercase tracking-[0.4em] animate-pulse">מאתחל_צומת_מסחרית...</span>
                                            <span className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">מסנכרן יומן v6.1</span>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : ledgerItems.length === 0 && !isAddingNew ? (
                            <tr>
                                <td colSpan={9} className="px-6 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-40">
                                        <Layers size={48} className="text-gray-700" />
                                        <p className="text-sm font-medium text-gray-500" dir="rtl">אין נתונים ביומן המסחרי. הוסף נתון חדש כדי להתחיל.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            <AnimatePresence mode="popLayout">
                                {ledgerItems.map((item, idx) => (
                                    <motion.tr 
                                        key={item.id}
                                        layout
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        transition={{ duration: 0.2, delay: idx * 0.02 }}
                                        className={`hover:bg-white/[0.02] transition-colors group border-b border-white/5 last:border-0 h-16 ${selectedLedgerIds.includes(item.id) ? 'bg-blue-500/5' : ''}`}
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
                                                <td className="px-4 py-2">
                                                    <select
                                                        value={editForm.type}
                                                        onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[11px] focus:border-blue-500 outline-none text-right text-gray-200"
                                                        dir="rtl"
                                                    >
                                                        <option value="BASE_CONTRACT">חוזה בסיס</option>
                                                        <option value="APPROVED_VO">חריג מאושר</option>
                                                        <option value="PENDING_VO">חריג בהמתנה</option>
                                                    </select>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <input
                                                        type="text"
                                                        value={editForm.item_code}
                                                        onChange={(e) => setEditForm({ ...editForm, item_code: e.target.value })}
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[11px] focus:border-blue-500 outline-none text-right text-gray-200 font-mono"
                                                        dir="rtl"
                                                    />
                                                </td>
                                                <td className="px-4 py-2">
                                                    <input
                                                        type="text"
                                                        value={editForm.description}
                                                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[11px] focus:border-blue-500 outline-none text-right text-gray-200"
                                                        dir="rtl"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <input
                                                        type="text"
                                                        value={editForm.unit}
                                                        onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                                                        className="w-12 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-[11px] text-center focus:border-blue-500 outline-none text-gray-200"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <input
                                                        type="number"
                                                        value={editForm.quantity}
                                                        onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-[11px] text-center focus:border-blue-500 outline-none text-gray-200 font-mono"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-left">
                                                    <input
                                                        type="number"
                                                        value={editForm.unit_price_excl_vat}
                                                        onChange={(e) => setEditForm({ ...editForm, unit_price_excl_vat: parseFloat(e.target.value) || 0 })}
                                                        className="w-24 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-[11px] text-left focus:border-blue-500 outline-none text-gray-200 font-mono"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-left text-[11px] font-mono text-gray-400">
                                                    {formatCurrency(editForm.quantity * editForm.unit_price_excl_vat)}
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <div className="flex justify-center gap-2">
                                                        <button onClick={handleSaveEdit} className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all">
                                                            <Check size={14} />
                                                        </button>
                                                        <button onClick={handleCancelEdit} className="p-2 text-gray-500 hover:bg-white/10 rounded-xl transition-all">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        {item.type === 'BASE_CONTRACT' ? (
                                                            <div className="px-2 py-1 rounded-md bg-gray-500/10 border border-gray-500/20 flex items-center gap-1.5">
                                                                <div className="w-1 h-1 rounded-full bg-gray-400" />
                                                                <span className="text-[9px] font-mono font-black text-gray-400 uppercase tracking-widest">חוזה_בסיס</span>
                                                            </div>
                                                        ) : item.type === 'APPROVED_VO' ? (
                                                            <div className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                                                <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_5px_#10b981]" />
                                                                <span className="text-[9px] font-mono font-black text-emerald-400 uppercase tracking-widest">חריג_מאושר</span>
                                                            </div>
                                                        ) : (
                                                            <div className="px-2 py-1 rounded-md bg-orange-500/10 border border-orange-500/20 flex items-center gap-1.5 shadow-[0_0_10px_rgba(245,158,11,0.1)]">
                                                                <div className="w-1 h-1 rounded-full bg-orange-500 shadow-[0_0_5px_#f59e0b]" />
                                                                <span className="text-[9px] font-mono font-black text-orange-400 uppercase tracking-widest">חריג_בהמתנה</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-xs font-mono text-gray-500 tracking-wider">{item.item_code || '---'}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-2 group/desc">
                                                            <span className="text-sm font-medium text-gray-200 truncate max-w-md" dir="rtl">{item.description}</span>
                                                            {item.ai_rationale && (
                                                                <div className="relative group/rationale">
                                                                    <Brain className="h-4 w-4 text-blue-400 opacity-40 group-hover/desc:opacity-100 transition-opacity cursor-help" />
                                                                    <div className="absolute bottom-full right-0 mb-4 w-80 opacity-0 group-hover/rationale:opacity-100 pointer-events-none transition-all z-50 translate-y-2 group-hover/rationale:translate-y-0">
                                                                        <div className="bg-[#1A222C] border border-blue-500/30 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl relative">
                                                                            <div className="flex items-center gap-2 mb-3">
                                                                                <div className="w-6 h-6 bg-blue-500/10 rounded-lg flex items-center justify-center border border-blue-500/20">
                                                                                    <Cpu className="h-3.5 w-3.5 text-blue-400" />
                                                                                </div>
                                                                                <span className="text-[9px] font-mono font-black text-blue-400 uppercase tracking-[0.2em]">לוגיקה_עצבית</span>
                                                                            </div>
                                                                            <p className="text-[11px] leading-relaxed text-gray-300 font-medium mb-3" dir="rtl">{item.ai_rationale}</p>
                                                                            {item.governing_notes && Array.isArray(item.governing_notes) && item.governing_notes.length > 0 && (
                                                                                <div className="pt-3 border-t border-white/5 space-y-2">
                                                                                    <span className="text-[8px] font-mono font-black text-gray-600 uppercase tracking-widest">רישום_הוכחות_מבוצר:</span>
                                                                                    <div className="flex flex-col gap-1.5">
                                                                                        {item.governing_notes.map((note: string, i: number) => (
                                                                                            <div key={i} className="flex items-start gap-2 text-[10px] text-gray-400" dir="rtl">
                                                                                                <Shield size={10} className="text-blue-500 shrink-0 mt-0.5" />
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
                                                            <div className="flex items-center gap-1.5">
                                                                <FileText size={10} className="text-gray-600" />
                                                                <span className="text-[9px] font-mono text-gray-600 font-black uppercase tracking-widest overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">סימוכין: {item.source_execution_doc}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-[11px] text-gray-500 text-center font-mono uppercase tracking-widest">{item.unit}</td>
                                                <td className="px-6 py-4 text-[11px] text-gray-300 text-center font-mono">{item.quantity}</td>
                                                <td className="px-6 py-4 text-[11px] text-gray-300 text-left font-mono">{formatCurrency(item.unit_price_excl_vat)}</td>
                                                <td className="px-6 py-4 text-sm font-black text-white text-left font-mono tracking-tighter">{formatCurrency(item.total_price_excl_vat)}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100">
                                                        {item.type === 'PENDING_VO' && (
                                                            <button onClick={() => approveVO(item.id)} className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all border border-transparent hover:border-emerald-500/20" title="אשר חריג">
                                                                <CheckCircle size={16} />
                                                            </button>
                                                        )}
                                                        <button onClick={() => handleEditClick(item)} className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all border border-transparent hover:border-white/10" title="ערוך">
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button onClick={() => handleDelete(item.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all border border-transparent hover:border-red-500/20" title="מחק">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                    </motion.tr>
                                ))}
                            </AnimatePresence>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
