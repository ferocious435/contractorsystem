import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { DollarSign, Plus, Calculator, Settings, Trash2, Edit2, Check, X, Tag, Download, CheckCircle, Clock } from 'lucide-react';
import PendingQueue from '@/components/pricing/PendingQueue';
import AIEstimatorModal from '@/components/pricing/AIEstimatorModal';

interface PricingLedgerProps {
    projectId: string;
}

export default function PricingLedgerUI({ projectId }: PricingLedgerProps) {
    const supabase = createClient();
    const [ledgerItems, setLedgerItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<any>({});
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [queueItems, setQueueItems] = useState<any[]>([]);
    const [selectedContradiction, setSelectedContradiction] = useState<any | null>(null);
    const [newItemForm, setNewItemForm] = useState<any>({
        type: 'BASE_CONTRACT',
        source: 'CUSTOM_ANALYSIS',
        item_code: '',
        description: '',
        unit: 'יח\'',
        quantity: 1,
        unit_price_excl_vat: 0,
        markup_percentage: 0
    });

    useEffect(() => {
        fetchLedgerItems();
        fetchPendingQueue();
    }, [projectId]);

    const fetchLedgerItems = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('pricing_ledger')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setLedgerItems(data || []);
        } catch (err) {
            console.error('Error fetching ledger items:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchPendingQueue = async () => {
        try {
            const { data, error } = await supabase
                .from('contradictions')
                .select(`
                    *,
                    source_doc:documents!contradictions_source_execution_doc_id_fkey(title),
                    target_doc:documents!contradictions_target_contract_doc_id_fkey(title)
                `)
                .eq('project_id', projectId)
                .in('status', ['OPEN', 'MOVED_TO_PRICING'])
                .order('created_at', { ascending: false });

            if (error) throw error;
            setQueueItems((data || []).map(item => ({
                ...item,
                pricing_status: item.pricing_status || 'PENDING',
                source_execution_doc: item.source_doc,
                target_contract_doc: item.target_doc
            })));
        } catch (err) {
            console.error('Error fetching pending queue:', err);
        }
    };

    const handleSelectForEstimation = (item: any) => {
        setSelectedContradiction(item);
    };

    const handleApproveEstimation = async (ledgerData: any) => {
        try {
            const { data: newItem, error: insertError } = await supabase
                .from('pricing_ledger')
                .insert({
                    project_id: projectId,
                    type: ledgerData.type || 'PENDING_VO',
                    source: ledgerData.source || 'CUSTOM_ANALYSIS',
                    item_code: ledgerData.item_code || '',
                    description: ledgerData.description,
                    unit: ledgerData.unit,
                    quantity: ledgerData.quantity,
                    unit_price_excl_vat: ledgerData.unit_price_excl_vat,
                    markup_percentage: ledgerData.markup_percentage || 0
                })
                .select()
                .single();

            if (insertError) throw insertError;

            if (ledgerData.contradiction_id) {
                await supabase
                    .from('contradictions')
                    .update({ pricing_status: 'ESTIMATED' })
                    .eq('id', ledgerData.contradiction_id);
            }

            setLedgerItems(prev => [newItem, ...prev]);
            setQueueItems(prev => prev.filter(q => q.id !== ledgerData.contradiction_id));
            setSelectedContradiction(null);
        } catch (err) {
            console.error('Error approving estimation:', err);
            alert('שגיאה בשמירת הערכה');
        }
    };

    const handleEditClick = (item: any) => {
        setIsEditing(item.id);
        setEditForm({ ...item });
    };

    const handleCancelEdit = () => {
        setIsEditing(null);
        setEditForm({});
    };

    const handleSaveEdit = async () => {
        try {
            const { data, error } = await supabase
                .from('pricing_ledger')
                .update({
                    item_code: editForm.item_code,
                    description: editForm.description,
                    unit: editForm.unit,
                    quantity: editForm.quantity,
                    unit_price_excl_vat: editForm.unit_price_excl_vat,
                    markup_percentage: editForm.markup_percentage,
                    type: editForm.type
                })
                .eq('id', editForm.id)
                .select()
                .single();

            if (error) throw error;

            setLedgerItems(prev => prev.map(item => item.id === editForm.id ? data : item));
            setIsEditing(null);
        } catch (err) {
            console.error('Error updating ledger item:', err);
            alert('שגיאה בשמירת הפריט');
        }
    };

    const handleAddNew = async () => {
        try {
            const { data, error } = await supabase
                .from('pricing_ledger')
                .insert({
                    project_id: projectId,
                    ...newItemForm
                })
                .select()
                .single();

            if (error) throw error;

            setLedgerItems([...ledgerItems, data]);
            setIsAddingNew(false);
            setNewItemForm({
                type: 'BASE_CONTRACT',
                source: 'CUSTOM_ANALYSIS',
                item_code: '',
                description: '',
                unit: 'יח\'',
                quantity: 1,
                unit_price_excl_vat: 0,
                markup_percentage: 0
            });
        } catch (err) {
            console.error('Error adding new ledger item:', err);
            alert('שגיאה בהוספת שורה חדשה');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('האם אתה בטוח שברצונך למחוק שורה זו?')) return;

        try {
            const { error } = await supabase
                .from('pricing_ledger')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setLedgerItems(prev => prev.filter(item => item.id !== id));
        } catch (err) {
            console.error('Error deleting ledger item:', err);
            alert('שגיאה במחיקת השורה');
        }
    };

    const approveVO = async (id: string) => {
        try {
            const { data, error } = await supabase
                .from('pricing_ledger')
                .update({ type: 'APPROVED_VO' })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            setLedgerItems(prev => prev.map(item => item.id === id ? data : item));
        } catch (err) {
            console.error('Error approving VO:', err);
            alert('שגיאה באישור');
        }
    };

    const handleExportCSV = async () => {
        try {
            const res = await fetch(`/api/export?projectId=${projectId}&format=csv`);
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ledger_${projectId}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export error:', err);
            alert('שגיאה בייצוא');
        }
    };

    const totalBaseExclVat = ledgerItems.filter(i => i.type === 'BASE_CONTRACT').reduce((sum, i) => sum + Number(i.total_price_excl_vat), 0);
    const totalVOExclVat = ledgerItems.filter(i => i.type !== 'BASE_CONTRACT').reduce((sum, i) => sum + Number(i.total_price_excl_vat), 0);
    const grandTotalExclVat = totalBaseExclVat + totalVOExclVat;
    const grandTotalVat = ledgerItems.reduce((sum, i) => sum + Number(i.vat_amount), 0);
    const grandTotalInclVat = ledgerItems.reduce((sum, i) => sum + Number(i.total_price_incl_vat), 0);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
    };

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'BASE_CONTRACT': return 'חוזה בסיס';
            case 'APPROVED_VO': return 'חריג מאושר';
            case 'PENDING_VO': return 'חריג בהמתנה';
            default: return type;
        }
    };

    return (
        <div className="flex gap-6 h-full">
            {/* Left Sidebar - Pending Queue (25%) */}
            <div className="w-1/4 min-w-[280px] h-full flex flex-col shrink-0">
                <div className="bg-[#151C24] border border-white/10 rounded-xl p-4 mb-4 shadow-sm shrink-0">
                    <h2 className="font-semibold text-white flex items-center gap-2 justify-between" dir="rtl">
                        <span className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-orange-400" />
                            תור המתנה
                        </span>
                        <span className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs border border-orange-500/30">
                            {queueItems.length}
                        </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-1" dir="rtl">חריגים מהרדאר שממתינים להערכת שווי</p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                    <PendingQueue items={queueItems} onSelectForEstimation={handleSelectForEstimation} />
                </div>
            </div>

            {/* Right Side - Ledger (75%) */}
            <div className="flex-1 min-w-0 space-y-6">
                {/* Header and Summary Cards */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2" dir="rtl">
                        <Calculator className="h-6 w-6 text-primary" />
                        תמחור וחשבונות
                    </h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleExportCSV}
                            className="flex items-center gap-2 px-4 py-2 bg-workspace hover:bg-white/5 text-gray-300 hover:text-white border border-border-subtle rounded-lg transition-all font-medium"
                        >
                            <Download className="h-4 w-4" />
                            ייצוא CSV
                        </button>
                        <button
                            onClick={() => setIsAddingNew(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg shadow-blue transition-all font-medium"
                        >
                            <Plus className="h-4 w-4" />
                            הוסף שורה
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4" dir="rtl">
                    <div className="bg-workspace border border-border-subtle rounded-xl p-4 flex flex-col justify-center">
                        <span className="text-sm text-gray-400 mb-1">חוזה בסיס (ללא מע"מ)</span>
                        <span className="text-xl font-bold text-gray-100">{formatCurrency(totalBaseExclVat)}</span>
                    </div>
                    <div className="bg-workspace border border-border-subtle rounded-xl p-4 flex flex-col justify-center">
                        <span className="text-sm text-gray-400 mb-1">שינויים וחריגים</span>
                        <span className="text-xl font-bold text-blue-400">{formatCurrency(totalVOExclVat)}</span>
                    </div>
                    <div className="bg-workspace border border-border-subtle rounded-xl p-4 flex flex-col justify-center">
                        <span className="text-sm text-gray-400 mb-1">מע"מ (18%)</span>
                        <span className="text-xl font-bold text-gray-300">{formatCurrency(grandTotalVat)}</span>
                    </div>
                    <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 flex flex-col justify-center">
                        <span className="text-sm text-primary-light mb-1">סה"כ כולל מע"מ</span>
                        <span className="text-2xl font-bold text-primary">{formatCurrency(grandTotalInclVat)}</span>
                    </div>
                </div>

                {/* Ledger Table */}
                <div className="bg-workspace border border-border-subtle rounded-xl overflow-hidden shadow-lg">
                    <div className="overflow-x-auto">
                        <table className="w-full text-right" dir="rtl">
                            <thead className="bg-[#1e2333] border-b border-border-subtle">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">סוג</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">סעיף</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/3">תיאור</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">יח'</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">כמות</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-left">מחיר יחידה</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-left">סה"כ ללא מע"מ</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">פעולות</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                                {isAddingNew && (
                                    <tr className="bg-primary/5">
                                        <td className="px-4 py-3 text-sm">
                                            <select
                                                value={newItemForm.type}
                                                onChange={(e) => setNewItemForm({ ...newItemForm, type: e.target.value })}
                                                className="w-full bg-background border border-border-subtle rounded px-2 py-1 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none text-right"
                                                dir="rtl"
                                            >
                                                <option value="BASE_CONTRACT">חוזה בסיס</option>
                                                <option value="APPROVED_VO">חריג מאושר</option>
                                                <option value="PENDING_VO">חריג בהמתנה</option>
                                            </select>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <input
                                                type="text"
                                                value={newItemForm.item_code}
                                                onChange={(e) => setNewItemForm({ ...newItemForm, item_code: e.target.value })}
                                                placeholder="קוד סעיף"
                                                className="w-full bg-background border border-border-subtle rounded px-2 py-1 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none text-right"
                                                dir="rtl"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <input
                                                type="text"
                                                value={newItemForm.description}
                                                onChange={(e) => setNewItemForm({ ...newItemForm, description: e.target.value })}
                                                placeholder="תיאור העבודה..."
                                                className="w-full bg-background border border-border-subtle rounded px-2 py-1 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none text-right"
                                                dir="rtl"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm text-center">
                                            <input
                                                type="text"
                                                value={newItemForm.unit}
                                                onChange={(e) => setNewItemForm({ ...newItemForm, unit: e.target.value })}
                                                className="w-16 mx-auto bg-background border border-border-subtle rounded px-2 py-1 text-sm text-center focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm text-center">
                                            <input
                                                type="number"
                                                value={newItemForm.quantity}
                                                onChange={(e) => setNewItemForm({ ...newItemForm, quantity: parseFloat(e.target.value) || 0 })}
                                                className="w-20 mx-auto bg-background border border-border-subtle rounded px-2 py-1 text-sm text-center focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm text-left">
                                            <div className="relative">
                                                <span className="absolute left-2 top-1 text-gray-500 text-xs">₪</span>
                                                <input
                                                    type="number"
                                                    value={newItemForm.unit_price_excl_vat}
                                                    onChange={(e) => setNewItemForm({ ...newItemForm, unit_price_excl_vat: parseFloat(e.target.value) || 0 })}
                                                    className="w-24 pl-6 pr-2 py-1 bg-background border border-border-subtle rounded text-sm text-left focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-left font-medium text-gray-300">
                                            {formatCurrency(newItemForm.quantity * newItemForm.unit_price_excl_vat)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-center">
                                            <div className="flex justify-center gap-2">
                                                <button onClick={handleAddNew} className="p-1 text-green-400 hover:bg-green-400/10 rounded" title="שמור">
                                                    <Check className="h-4 w-4" />
                                                </button>
                                                <button onClick={() => setIsAddingNew(false)} className="p-1 text-gray-400 hover:bg-gray-400/10 rounded" title="ביטול">
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                {isLoading ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-12 text-center">
                                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                        </td>
                                    </tr>
                                ) : ledgerItems.length === 0 && !isAddingNew ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                                            אין נתונים להצגה. לחץ על "הוסף שורה" כדי להתחיל.
                                        </td>
                                    </tr>
                                ) : (
                                    ledgerItems.map((item) => (
                                        <tr key={item.id} className="hover:bg-white/5 transition-colors group">
                                            {isEditing === item.id ? (
                                                <>
                                                    <td className="px-4 py-3 text-sm">
                                                        <select
                                                            value={editForm.type}
                                                            onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                                                            className="w-full bg-background border border-border-subtle rounded px-2 py-1 text-sm focus:border-primary outline-none text-right"
                                                            dir="rtl"
                                                        >
                                                            <option value="BASE_CONTRACT">חוזה בסיס</option>
                                                            <option value="APPROVED_VO">חריג מאושר</option>
                                                            <option value="PENDING_VO">חריג בהמתנה</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        <input
                                                            type="text"
                                                            value={editForm.item_code}
                                                            onChange={(e) => setEditForm({ ...editForm, item_code: e.target.value })}
                                                            className="w-20 bg-background border border-border-subtle rounded px-2 py-1 text-sm focus:border-primary outline-none text-right"
                                                            dir="rtl"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        <input
                                                            type="text"
                                                            value={editForm.description}
                                                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                                            className="w-full bg-background border border-border-subtle rounded px-2 py-1 text-sm focus:border-primary outline-none text-right"
                                                            dir="rtl"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-center">
                                                        <input
                                                            type="text"
                                                            value={editForm.unit}
                                                            onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                                                            className="w-16 mx-auto bg-background border border-border-subtle rounded px-2 py-1 text-sm text-center focus:border-primary outline-none"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-center">
                                                        <input
                                                            type="number"
                                                            value={editForm.quantity}
                                                            onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) || 0 })}
                                                            className="w-16 mx-auto bg-background border border-border-subtle rounded px-2 py-1 text-sm text-center focus:border-primary outline-none"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-left">
                                                        <input
                                                            type="number"
                                                            value={editForm.unit_price_excl_vat}
                                                            onChange={(e) => setEditForm({ ...editForm, unit_price_excl_vat: parseFloat(e.target.value) || 0 })}
                                                            className="w-24 bg-background border border-border-subtle rounded px-2 py-1 text-sm text-left focus:border-primary outline-none"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-left text-gray-400">
                                                        {formatCurrency(editForm.quantity * editForm.unit_price_excl_vat)}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-center">
                                                        <div className="flex justify-center gap-2">
                                                            <button onClick={handleSaveEdit} className="p-1 text-green-400 hover:bg-green-400/10 rounded" title="שמור">
                                                                <Check className="h-4 w-4" />
                                                            </button>
                                                            <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:bg-gray-400/10 rounded" title="ביטול">
                                                                <X className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="px-4 py-3 text-sm">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${item.type === 'BASE_CONTRACT' ? 'bg-gray-800 text-gray-300' :
                                                            item.type === 'APPROVED_VO' ? 'bg-blue-500/10 text-blue-400' :
                                                                'bg-orange-500/10 text-orange-400'
                                                            }`}>
                                                            {getTypeLabel(item.type)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm font-mono text-gray-400">{item.item_code}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-200">{item.description}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-400 text-center">{item.unit}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-300 text-center">{item.quantity}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-300 text-left">{formatCurrency(item.unit_price_excl_vat)}</td>
                                                    <td className="px-4 py-3 text-sm font-medium text-gray-100 text-left">{formatCurrency(item.total_price_excl_vat)}</td>
                                                    <td className="px-4 py-3 text-sm text-center">
                                                        <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {item.type === 'PENDING_VO' && (
                                                                <button onClick={() => approveVO(item.id)} className="p-1 text-green-400 hover:bg-green-400/10 rounded" title="אשר חריג">
                                                                    <CheckCircle className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                            <button onClick={() => handleEditClick(item)} className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded" title="ערוך">
                                                                <Edit2 className="h-4 w-4" />
                                                            </button>
                                                            <button onClick={() => handleDelete(item.id)} className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded" title="מחק">
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedContradiction && (
                <AIEstimatorModal
                    contradiction={selectedContradiction}
                    onClose={() => setSelectedContradiction(null)}
                    onApprove={handleApproveEstimation}
                />
            )}
        </div>
    );
}
