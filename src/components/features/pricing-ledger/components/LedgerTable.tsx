import React, { useCallback } from 'react';
import PricingLedgerTable from '@/components/pricing/PricingLedgerTable';
import type { LedgerItem } from '@/types';
import type { PricingEstimationData, PricingLedgerItem } from '../types';

interface LedgerTableProps {
    rows: PricingLedgerItem[];
    isLoading: boolean;
    isAddingNew: boolean;
    isEditing: string | null;
    newItemForm: PricingEstimationData;
    setNewItemForm: (form: PricingEstimationData) => void;
    editForm: Partial<PricingLedgerItem>;
    setEditForm: (form: Partial<PricingLedgerItem>) => void;
    selectedLedgerIds: string[];
    toggleSelectItem: (id: string) => void;
    toggleSelectAll: () => void;
    handleAddNew: () => Promise<unknown>;
    setIsAddingNew: (value: boolean) => void;
    handleSaveEdit: () => Promise<unknown>;
    handleCancelEdit: () => void;
    approveVO: (id: string) => Promise<unknown>;
    handleEditClick: (item: PricingLedgerItem) => void;
    handleDelete: (id: string) => Promise<unknown>;
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('he-IL', {
        style: 'currency',
        currency: 'ILS',
        maximumFractionDigits: 0,
    }).format(value);
}

function LedgerTable({
    rows,
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
}: LedgerTableProps) {
    const handleDeleteWithConfirm = useCallback(async (id: string) => {
        if (!confirm('האם אתה בטוח שברצונך למחוק שורה זו?')) {
            return;
        }

        await handleDelete(id);
    }, [handleDelete]);

    const handleAddNewClick = useCallback(() => {
        void handleAddNew();
    }, [handleAddNew]);

    const handleSaveEditClick = useCallback(() => {
        void handleSaveEdit();
    }, [handleSaveEdit]);

    const handleApproveVO = useCallback((id: string) => {
        void approveVO(id);
    }, [approveVO]);

    const handleEditRow = useCallback((item: LedgerItem) => {
        handleEditClick(item as unknown as PricingLedgerItem);
    }, [handleEditClick]);

    const handleDeleteRow = useCallback((id: string) => {
        void handleDeleteWithConfirm(id);
    }, [handleDeleteWithConfirm]);

    return (
        <PricingLedgerTable
            ledgerItems={rows as unknown as LedgerItem[]}
            isLoading={isLoading}
            isAddingNew={isAddingNew}
            isEditing={isEditing}
            newItemForm={newItemForm}
            setNewItemForm={setNewItemForm as (form: unknown) => void}
            editForm={editForm}
            setEditForm={setEditForm as (form: unknown) => void}
            selectedLedgerIds={selectedLedgerIds}
            toggleSelectItem={toggleSelectItem}
            toggleSelectAll={toggleSelectAll}
            handleAddNew={handleAddNewClick}
            setIsAddingNew={setIsAddingNew}
            handleSaveEdit={handleSaveEditClick}
            handleCancelEdit={handleCancelEdit}
            approveVO={handleApproveVO}
            handleEditClick={handleEditRow}
            handleDelete={handleDeleteRow}
            formatCurrency={formatCurrency}
        />
    );
}

export default React.memo(LedgerTable);
