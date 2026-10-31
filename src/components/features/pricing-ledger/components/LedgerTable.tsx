"use client";
import React, { useState } from 'react';
import PricingLedgerTable, { type LedgerFormState } from '@/components/pricing/PricingLedgerTable';
import type { LedgerItem } from '@/types';
import type { PricingEstimationData, PricingLedgerItem } from '../types';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { Button } from '@/components/ui/titanium/Button';
import { Feedback } from '@/components/ui/titanium/Feedback';
interface LedgerTableProps {
    rows: PricingLedgerItem[];
    isLoading: boolean;
    isAddingNew: boolean;
    isEditing: string | null;
    newItemForm: PricingEstimationData;
    setNewItemForm(form: PricingEstimationData): void;
    editForm: Partial<PricingLedgerItem>;
    setEditForm(form: Partial<PricingLedgerItem>): void;
    selectedLedgerIds: string[];
    toggleSelectItem(id: string): void;
    toggleSelectAll(): void;
    handleAddNew(): Promise<unknown>;
    setIsAddingNew(value: boolean): void;
    handleSaveEdit(): Promise<unknown>;
    handleCancelEdit(): void;
    approveVO(id: string): Promise<unknown>;
    handleEditClick(item: PricingLedgerItem): void;
    handleDelete(id: string): Promise<unknown>;
    errorMessage?: string | null;
}
const formatCurrency = (value: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits:2,maximumFractionDigits:2 }).format(value);
function LedgerTable(props: LedgerTableProps) { const [deleteId, setDeleteId] = useState<string | null>(null), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState<string | null>(null); return <><PricingLedgerTable ledgerItems={props.rows as LedgerItem[]} isLoading={props.isLoading} isAddingNew={props.isAddingNew} isEditing={props.isEditing} newItemForm={props.newItemForm} setNewItemForm={props.setNewItemForm as (form: LedgerFormState) => void} editForm={props.editForm} setEditForm={props.setEditForm as (form: LedgerFormState) => void} selectedLedgerIds={props.selectedLedgerIds} toggleSelectItem={props.toggleSelectItem} toggleSelectAll={props.toggleSelectAll} handleAddNew={props.handleAddNew} setIsAddingNew={props.setIsAddingNew} handleSaveEdit={props.handleSaveEdit} handleCancelEdit={props.handleCancelEdit} approveVO={props.approveVO} handleEditClick={item => props.handleEditClick(item as PricingLedgerItem)} handleDelete={id => { setDeleteError(null); setDeleteId(id); }} formatCurrency={formatCurrency} errorMessage={props.errorMessage}/><Dialog open={Boolean(deleteId)} labelledBy="ledger-delete-title" onClose={() => { if (!deleting)
    setDeleteId(null); }}><h2 id="ledger-delete-title" className="ti-section-title">מחיקת שורה</h2><p className="ti-copy">האם למחוק את השורה שנבחרה?</p>{(deleteError || props.errorMessage) && <Feedback tone="danger">{deleteError || props.errorMessage}</Feedback>}<div className="ti-dialog__footer"><Button onClick={() => setDeleteId(null)} disabled={deleting}>ביטול</Button><Button variant="danger" pending={deleting} busyLabel="מוחק…" onClick={async () => { if (!deleteId)
    return; setDeleting(true); try {
    await props.handleDelete(deleteId);
    setDeleteId(null);
}
catch {
    setDeleteError('המחיקה לא הושלמה. השורה נשמרה.');
}
finally {
    setDeleting(false);
} }}>מחיקת השורה</Button></div></Dialog></>; }
export default React.memo(LedgerTable);
