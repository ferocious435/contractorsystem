import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { motion } from 'framer-motion';
import PendingQueueTable from '@/components/pricing/PendingQueueTable';
import AIEstimatorModal from '@/components/pricing/AIEstimatorModal';
import PricingLedgerHeader from '@/components/pricing/PricingLedgerHeader';
import PricingLedgerTable from '@/components/pricing/PricingLedgerTable';
import PricingStatusBar from '@/components/pricing/PricingStatusBar';
import LetterGeneratorModal from '@/components/pricing/LetterGeneratorModal';
import { VAT_RATE } from '@/utils/constants';
import { LedgerItem, QueueItem, PricingLedgerProps, EstimationData, ContradictionItem } from '@/types';

/** Данные для сохранения в pricing_ledger при одобрении VO */
export interface ApproveEstimationPayload extends EstimationData {
    contradiction_id?: string;
    ai_rationale?: string;
    governing_notes?: string[];
    expert_strategy?: Record<string, unknown> | null;
}

export default function PricingLedgerUI({ projectId, initialParams, onNavigate }: PricingLedgerProps) {
    return (
        <Suspense fallback={<div className="p-8 text-white font-mono uppercase tracking-widest animate-pulse">טוען נתונים פיננסיים...</div>}>
            <PricingLedgerInternal projectId={projectId} initialParams={initialParams} onNavigate={onNavigate} />
        </Suspense>
    );
}

function PricingLedgerInternal({ projectId, initialParams, onNavigate }: PricingLedgerProps) {
    const supabase = createClient();
    const searchParams = useSearchParams();
    const [ledgerItems, setLedgerItems] = useState<LedgerItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<LedgerItem>>({});
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [queueItems, setQueueItems] = useState<ContradictionItem[]>([]);
    const [selectedContradiction, setSelectedContradiction] = useState<ContradictionItem | null>(null);
    const [newItemForm, setNewItemForm] = useState<EstimationData>({
        type: 'BASE_CONTRACT',
        source: 'CUSTOM_ANALYSIS',
        item_code: '',
        description: '',
        unit: 'יח\'',
        quantity: 1,
        unit_price_excl_vat: 0,
        markup_percentage: 0
    });
    const [selectedLedgerIds, setSelectedLedgerIds] = useState<string[]>([]);
    const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
    const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
    const [scanningItems, setScanningItems] = useState<string[]>([]);

    const normalizeMarkupPercentage = (value?: number | null) => {
        const numericValue = Number(value || 0);
        return numericValue > 1 ? numericValue / 100 : numericValue;
    };

    useEffect(() => {
        fetchLedgerItems();
        fetchPendingQueue();
    }, [projectId]);

    useEffect(() => {
        const estimateId = initialParams?.estimateId || initialParams?.contradictionId || searchParams.get('estimate_id');
        if (estimateId && queueItems.length > 0) {
            const item = queueItems.find(q => q.id === estimateId);
            if (item) {
                setSelectedContradiction(item);
                if (onNavigate) {
                    onNavigate('pricing', undefined);
                }
                if (searchParams.get('estimate_id')) {
                    window.history.replaceState({}, '', window.location.pathname);
                }
            }
        }
    }, [searchParams, queueItems, initialParams]);

    // ─── Data Fetching ───────────────────────────────────

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
                .in('status', ['OPEN', 'MOVED_TO_PRICING', 'PENDING'])
                .order('created_at', { ascending: false });

            if (error) throw error;
            setQueueItems((data || []).map((item: Record<string, unknown>) => ({
                ...item,
                pricing_status: (item.pricing_status as string) || 'PENDING',
                source_execution_doc: item.source_doc,
                target_contract_doc: item.target_doc
            })) as ContradictionItem[]);
        } catch (err) {
            console.error('Error fetching pending queue:', err);
        }
    };

    // ─── Queue Handlers ──────────────────────────────────

    const handleSelectForEstimation = (item: ContradictionItem) => {
        setSelectedContradiction(item);
    };

    const handleToggleQueueSelection = (id: string) => {
        setSelectedQueueIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSelectAllQueue = (ids: string[]) => {
        setSelectedQueueIds(ids);
    };

    const handleRescan = async (item: ContradictionItem) => {
        if (scanningItems.includes(item.id)) return;
        
        setScanningItems(prev => [...prev, item.id]);
        try {
            const response = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    workDocId: item.source_execution_doc_id
                })
            });

            if (!response.ok) throw new Error('Scan failed');
            
            await fetchPendingQueue();
        } catch (err) {
            console.error('Error rescanning item:', err);
        } finally {
            setScanningItems(prev => prev.filter(id => id !== item.id));
        }
    };

    const handleBulkRescan = async (ids: string[]) => {
        const itemsToScan = queueItems.filter(item => ids.includes(item.id));
        await Promise.all(itemsToScan.map(item => handleRescan(item)));
        setSelectedQueueIds([]);
    };

    const handleBulkDeleteQueue = async (ids: string[]) => {
        if (!confirm(`האם למחוק ${ids.length} פריטים מהתור?`)) return;
        
        try {
            const { error } = await supabase
                .from('contradictions')
                .update({ status: 'ARCHIVED' }) 
                .in('id', ids);

            if (error) throw error;
            setQueueItems(prev => prev.filter(q => !ids.includes(q.id)));
            setSelectedQueueIds([]);
        } catch (err) {
            console.error('Error bulk deleting queue items:', err);
            alert('שגיאה במחיקת פריטים');
        }
    };

    // ─── Ledger Handlers ─────────────────────────────────

    const handleApproveEstimation = async (ledgerData: ApproveEstimationPayload) => {
        try {
            let existingLedgerItem: LedgerItem | null = null;

            if (ledgerData.contradiction_id) {
                const { data: existing } = await supabase
                    .from('pricing_ledger')
                    .select('*')
                    .eq('project_id', projectId)
                    .eq('contradiction_id', ledgerData.contradiction_id)
                    .maybeSingle();

                existingLedgerItem = existing;
            }

            const payload = {
                project_id: projectId,
                type: ledgerData.type || 'PENDING_VO',
                source: ledgerData.source || 'CUSTOM_ANALYSIS',
                item_code: ledgerData.item_code || '',
                description: ledgerData.description,
                unit: ledgerData.unit,
                quantity: ledgerData.quantity,
                unit_price_excl_vat: ledgerData.unit_price_excl_vat,
                markup_percentage: normalizeMarkupPercentage(ledgerData.markup_percentage),
                ai_rationale: ledgerData.ai_rationale,
                governing_notes: ledgerData.governing_notes,
                contradiction_id: ledgerData.contradiction_id,
                vat_rate: VAT_RATE
            };

            const query = existingLedgerItem
                ? supabase
                    .from('pricing_ledger')
                    .update(payload)
                    .eq('id', existingLedgerItem.id)
                : supabase
                    .from('pricing_ledger')
                    .insert(payload);

            const { data: savedItem, error: saveError } = await query
                .select()
                .single();

            if (saveError) throw saveError;

            if (ledgerData.contradiction_id) {
                await supabase
                    .from('contradictions')
                    .update({ pricing_status: 'ESTIMATED', status: 'MOVED_TO_PRICING' })
                    .eq('id', ledgerData.contradiction_id);
            }

            setLedgerItems(prev => existingLedgerItem
                ? prev.map(item => item.id === existingLedgerItem?.id ? savedItem : item)
                : [savedItem, ...prev]
            );
            setQueueItems(prev => prev.filter(q => q.id !== ledgerData.contradiction_id));
            setSelectedContradiction(null);
        } catch (err) {
            console.error('Error approving estimation:', err);
            alert('׳©׳’׳™׳׳” ׳‘׳©׳׳™׳¨׳× ׳”׳¢׳¨׳›׳”');
        }
    };

    const handleToggleLedgerSelection = (id: string) => {
        setSelectedLedgerIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSelectAllLedger = () => {
        if (selectedLedgerIds.length === ledgerItems.length) {
            setSelectedLedgerIds([]);
        } else {
            setSelectedLedgerIds(ledgerItems.map(item => item.id));
        }
    };

    const handleEditClick = (item: LedgerItem) => {
        setIsEditing(item.id);
        setEditForm({ ...item });
    };

    const handleCancelEdit = () => {
        setIsEditing(null);
        setEditForm({});
    };

    const handleSaveEdit = async () => {
        if (!editForm.id) return;
        try {
            const { data, error } = await supabase
                .from('pricing_ledger')
                .update({
                    item_code: editForm.item_code,
                    description: editForm.description,
                    unit: editForm.unit,
                    quantity: editForm.quantity,
                    unit_price_excl_vat: editForm.unit_price_excl_vat,
                    markup_percentage: normalizeMarkupPercentage(editForm.markup_percentage),
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
                    ...newItemForm,
                    markup_percentage: normalizeMarkupPercentage(newItemForm.markup_percentage),
                    vat_rate: VAT_RATE
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

    // ─── Computed Values ─────────────────────────────────

    const totalBaseExclVat = ledgerItems.filter(i => i.type === 'BASE_CONTRACT').reduce((sum, i) => sum + Number(i.total_price_excl_vat || 0), 0);
    const totalVOExclVat = ledgerItems.filter(i => i.type !== 'BASE_CONTRACT').reduce((sum, i) => sum + Number(i.total_price_excl_vat || 0), 0);
    const grandTotalExclVat = totalBaseExclVat + totalVOExclVat;
    const grandTotalVat = grandTotalExclVat * VAT_RATE;
    const grandTotalInclVat = grandTotalExclVat + grandTotalVat;

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { 
            style: 'currency', 
            currency: 'ILS', 
            maximumFractionDigits: 0 
        }).format(val);
    };

    // ─── Render ──────────────────────────────────────────

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col h-full bg-[#0B0F14]"
        >
            <div className="flex gap-8 flex-1 overflow-hidden p-8 pb-0">
                {/* Left Sidebar - Pending Queue (25%) */}
                <div className="w-1/4 min-w-[320px] h-full flex flex-col shrink-0 space-y-4">
                    <div className="bg-[#151C24]/60 border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 blur-[60px] group-hover:bg-orange-500/10 transition-all" />
                        <div className="flex items-center justify-between relative z-10">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono font-black text-orange-500 uppercase tracking-[0.3em]">תור פעולות ממתינות</span>
                                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shadow-[0_0_8px_#f59e0b]" />
                                </div>
                                <h2 className="text-xl font-black text-white font-mono uppercase tracking-tighter" dir="rtl">
                                    תור הממתינים
                                </h2>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden rounded-[2.5rem] border border-white/5 bg-[#0B0F14]/30 backdrop-blur-xl">
                        <PendingQueueTable 
                            items={queueItems} 
                            selectedIds={selectedQueueIds}
                            onToggleSelection={handleToggleQueueSelection}
                            onSelectAll={handleSelectAllQueue}
                            onSelectForEstimation={handleSelectForEstimation} 
                            onRescan={handleRescan}
                            onBulkRescan={handleBulkRescan}
                            onBulkDelete={handleBulkDeleteQueue}
                            scanningItems={scanningItems}
                        />
                    </div>
                </div>

                {/* Right Side - Ledger (75%) */}
                <div className="flex-1 min-w-0 flex flex-col gap-8">
                    <PricingLedgerHeader
                        selectedCount={selectedLedgerIds.length}
                        totalBaseExclVat={totalBaseExclVat}
                        totalVOExclVat={totalVOExclVat}
                        grandTotalVat={grandTotalVat}
                        grandTotalInclVat={grandTotalInclVat}
                        onGenerateLetter={() => setIsGeneratingLetter(true)}
                        onExportCSV={handleExportCSV}
                        onAddNew={() => setIsAddingNew(true)}
                    />

                    <PricingLedgerTable
                        ledgerItems={ledgerItems}
                        isLoading={isLoading}
                        isAddingNew={isAddingNew}
                        isEditing={isEditing}
                        newItemForm={newItemForm}
                        setNewItemForm={setNewItemForm}
                        editForm={editForm}
                        setEditForm={setEditForm}
                        selectedLedgerIds={selectedLedgerIds}
                        toggleSelectItem={handleToggleLedgerSelection}
                        toggleSelectAll={handleSelectAllLedger}
                        handleAddNew={handleAddNew}
                        setIsAddingNew={setIsAddingNew}
                        handleSaveEdit={handleSaveEdit}
                        handleCancelEdit={handleCancelEdit}
                        approveVO={approveVO}
                        handleEditClick={handleEditClick}
                        handleDelete={handleDelete}
                        formatCurrency={formatCurrency}
                    />
                </div>
            </div>

            <PricingStatusBar projectId={projectId} />

            {selectedContradiction && (
                <AIEstimatorModal
                    contradiction={selectedContradiction}
                    onClose={() => setSelectedContradiction(null)}
                    onApprove={handleApproveEstimation}
                />
            )}

            {isGeneratingLetter && (
                <LetterGeneratorModal
                    projectId={projectId}
                    initialSelectedItems={selectedLedgerIds}
                    onClose={() => {
                        setIsGeneratingLetter(false);
                        fetchLedgerItems();
                        fetchPendingQueue();
                        setSelectedLedgerIds([]);
                    }}
                />
            )}
        </motion.div>
    );
}
