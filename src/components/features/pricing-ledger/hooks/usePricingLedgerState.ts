'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { VAT_RATE } from '@/utils/constants';
import {
    getAmountVat,
    getMoneySum,
    getPreferredProjectAmount,
    getVariationOrderAmount,
    isVisibleLedgerRow,
} from '@/utils/project-financials';
import {
    DEFAULT_NEW_LEDGER_ITEM,
} from '../constants';
import {
    archivePendingQueueItems,
    deleteLedgerRow,
    fetchLedgerRows,
    fetchPendingQueue,
    normalizePricingLedgerError,
    rescanQueueItem,
    saveLedgerRow,
    syncBoqAndContract,
    updateLedgerRowStatus,
} from '../api/pricingLedgerApi';
import type {
    ApprovePricingEstimationPayload,
    PricingContradictionItem,
    PricingEstimationData,
    PricingLedgerActiveTab,
    PricingLedgerDerivedState,
    PricingLedgerItem,
    PricingLedgerRowType,
    PricingLedgerState,
    PricingLedgerStatusUpdate,
    PricingLedgerTotals,
    SyncedProjectContractBase,
} from '../types';

type FinancialLedgerRow = Parameters<typeof isVisibleLedgerRow>[0];

interface UsePricingLedgerStateOptions {
    routedEstimateId?: string | null;
    onClearRoutedEstimate?: () => void;
}

function isSelectableVariationOrder(item: Pick<PricingLedgerItem, 'type'>): boolean {
    return item.type === 'PENDING_VO' || item.type === 'APPROVED_VO';
}

function cloneDefaultNewItemForm(): PricingEstimationData {
    return { ...DEFAULT_NEW_LEDGER_ITEM };
}

function normalizeMarkupPercentage(value?: number | null) {
    const numericValue = Number(value || 0);
    return numericValue > 1 ? numericValue / 100 : numericValue;
}

export function usePricingLedgerState(
    projectId: string,
    options: UsePricingLedgerStateOptions = {}
) {
    const routedEstimateId = options.routedEstimateId || null;
    const onClearRoutedEstimate = options.onClearRoutedEstimate;
    const [ledgerRows, setLedgerRows] = useState<PricingLedgerItem[]>([]);
    const [pendingQueue, setPendingQueue] = useState<PricingContradictionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<PricingLedgerActiveTab>('ledger');
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<PricingLedgerItem>>({});
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [selectedContradiction, setSelectedContradiction] = useState<PricingContradictionItem | null>(null);
    const [newItemForm, setNewItemForm] = useState<PricingEstimationData>(cloneDefaultNewItemForm);
    const [selectedLedgerIds, setSelectedLedgerIds] = useState<string[]>([]);
    const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
    const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
    const [scanningItems, setScanningItems] = useState<string[]>([]);
    const [isFocusedPricingDismissed, setIsFocusedPricingDismissed] = useState(false);
    const [projectBudget, setProjectBudget] = useState(0);
    const [lastContractSync, setLastContractSync] = useState<SyncedProjectContractBase | null>(null);

    const loadPricingLedger = useCallback(async (options: { syncContract?: boolean } = {}) => {
        setLoading(true);
        setError(null);

        try {
            let syncedContractBase: SyncedProjectContractBase | null = null;

            if (options.syncContract ?? true) {
                const syncResult = await syncBoqAndContract(projectId);
                syncedContractBase = syncResult.syncedContractBase;
                setLastContractSync(syncedContractBase);
            }

            const [ledgerResult, queueRows] = await Promise.all([
                fetchLedgerRows(projectId),
                fetchPendingQueue(projectId),
            ]);

            setLedgerRows(ledgerResult.rows);
            setPendingQueue(queueRows);
            setProjectBudget(Number((syncedContractBase?.amount ?? ledgerResult.projectBudget) || 0));

            return {
                ledgerRows: ledgerResult.rows,
                pendingQueue: queueRows,
                syncedContractBase,
            };
        } catch (loadError) {
            const message = normalizePricingLedgerError(loadError);
            setError(message);
            throw loadError;
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    const refreshLedgerRows = useCallback(async () => {
        const ledgerResult = await fetchLedgerRows(projectId);
        setLedgerRows(ledgerResult.rows);
        setProjectBudget(Number((lastContractSync?.amount ?? ledgerResult.projectBudget) || 0));
        return ledgerResult.rows;
    }, [lastContractSync?.amount, projectId]);

    const refreshPendingQueue = useCallback(async () => {
        const queueRows = await fetchPendingQueue(projectId);
        setPendingQueue(queueRows);
        return queueRows;
    }, [projectId]);

    useEffect(() => {
        void loadPricingLedger();
    }, [loadPricingLedger]);

    useEffect(() => {
        const estimateId = routedEstimateId;

        if (!estimateId || pendingQueue.length === 0) {
            return;
        }

        const item = pendingQueue.find((queueItem) => queueItem.id === estimateId);

        if (item && selectedContradiction?.id !== item.id) {
            setSelectedContradiction(item);
            onClearRoutedEstimate?.();
        }
    }, [onClearRoutedEstimate, pendingQueue, routedEstimateId, selectedContradiction?.id]);

    const visibleLedgerRows = useMemo(
        () => ledgerRows.filter((row) => isVisibleLedgerRow(row as FinancialLedgerRow)),
        [ledgerRows]
    );

    const selectedVOIds = useMemo(
        () => selectedLedgerIds.filter((id) => (
            visibleLedgerRows.some((row) => row.id === id && isSelectableVariationOrder(row))
        )),
        [selectedLedgerIds, visibleLedgerRows]
    );

    const totals = useMemo<PricingLedgerTotals>(() => {
        const financialRows = ledgerRows as FinancialLedgerRow[];
        const visibleFinancialRows = visibleLedgerRows as FinancialLedgerRow[];
        const totalBaseExclVat = getPreferredProjectAmount(projectBudget, financialRows);
        const totalVOExclVat = getVariationOrderAmount(visibleFinancialRows);
        const grandTotalExclVat = getMoneySum([totalBaseExclVat, totalVOExclVat]);
        const grandTotalVat = getAmountVat(grandTotalExclVat, VAT_RATE);
        const grandTotalInclVat = getMoneySum([grandTotalExclVat, grandTotalVat]);

        return {
            totalBaseExclVat,
            totalVOExclVat,
            grandTotalExclVat,
            grandTotalVat,
            grandTotalInclVat,
        };
    }, [ledgerRows, projectBudget, visibleLedgerRows]);

    const focusedQueueItem = useMemo(
        () => (
            pendingQueue.find((item) => item.id === routedEstimateId)
            || selectedContradiction
            || null
        ),
        [routedEstimateId, pendingQueue, selectedContradiction]
    );

    const handleSync = useCallback(async () => {
        setIsSyncing(true);
        setError(null);

        try {
            return await loadPricingLedger({ syncContract: true });
        } catch (syncError) {
            setError(normalizePricingLedgerError(syncError));
            throw syncError;
        } finally {
            setIsSyncing(false);
        }
    }, [loadPricingLedger]);

    const handleStatusChange = useCallback(async (
        rowId: string,
        status: PricingLedgerStatusUpdate
    ) => {
        const result = await updateLedgerRowStatus(rowId, status);

        if (!result.success) {
            throw new Error(result.error || 'Failed to update ledger row status');
        }

        setLedgerRows((currentRows) => (
            currentRows.map((row) => (
                row.id === rowId ? { ...row, type: status as PricingLedgerRowType } : row
            ))
        ));

        return result;
    }, []);

    const handleDelete = useCallback(async (rowId: string) => {
        const result = await deleteLedgerRow(rowId);

        if (!result.success) {
            throw new Error(result.error || 'Failed to delete ledger row');
        }

        setLedgerRows((currentRows) => currentRows.filter((row) => row.id !== rowId));
        setSelectedLedgerIds((currentIds) => currentIds.filter((id) => id !== rowId));

        return result;
    }, []);

    const handleApproveEstimation = useCallback(async (ledgerData: ApprovePricingEstimationPayload) => {
        const result = await saveLedgerRow({
            project_id: projectId,
            ...ledgerData,
            type: ledgerData.type || 'PENDING_VO',
            source: ledgerData.source || 'CUSTOM_ANALYSIS',
            item_code: ledgerData.item_code || '',
            markup_percentage: normalizeMarkupPercentage(ledgerData.markup_percentage),
            expert_strategy: ledgerData.expert_strategy,
            evidence_data: ledgerData.evidence_data || {},
            vat_rate: VAT_RATE,
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to save pricing estimate');
        }

        await Promise.all([
            refreshLedgerRows(),
            refreshPendingQueue(),
        ]);

        if (ledgerData.contradiction_id) {
            setPendingQueue((currentQueue) => (
                currentQueue.filter((queueItem) => queueItem.id !== ledgerData.contradiction_id)
            ));
        }

        setSelectedContradiction(null);

        if (routedEstimateId) {
            setIsFocusedPricingDismissed(true);
        }

        return result;
    }, [projectId, refreshLedgerRows, refreshPendingQueue, routedEstimateId]);

    const handleSaveEdit = useCallback(async () => {
        if (!editForm.id) {
            return null;
        }

        const result = await saveLedgerRow({
            item_id: editForm.id,
            project_id: projectId,
            item_code: editForm.item_code,
            description: editForm.description,
            unit: editForm.unit,
            quantity: editForm.quantity,
            unit_price_excl_vat: editForm.unit_price_excl_vat,
            markup_percentage: normalizeMarkupPercentage(editForm.markup_percentage),
            type: editForm.type,
            source: editForm.source || 'CUSTOM_ANALYSIS',
            ai_rationale: editForm.ai_rationale,
            governing_notes: editForm.governing_notes,
            expert_strategy: editForm.expert_strategy,
            evidence_data: (editForm.evidence_data as Record<string, unknown> | unknown[] | null | undefined) || {},
            vat_rate: VAT_RATE,
        });

        if (!result.success || !result.item) {
            throw new Error(result.error || 'Failed to update ledger item');
        }

        setLedgerRows((currentRows) => (
            currentRows.map((row) => (row.id === editForm.id ? result.item as PricingLedgerItem : row))
        ));
        setIsEditing(null);
        setEditForm({});

        return result;
    }, [editForm, projectId]);

    const handleAddNew = useCallback(async () => {
        const result = await saveLedgerRow({
            project_id: projectId,
            ...newItemForm,
            markup_percentage: normalizeMarkupPercentage(newItemForm.markup_percentage),
            vat_rate: VAT_RATE,
        });

        if (!result.success || !result.item) {
            throw new Error(result.error || 'Failed to add ledger item');
        }

        setLedgerRows((currentRows) => [...currentRows, result.item as PricingLedgerItem]);
        setIsAddingNew(false);
        setNewItemForm(cloneDefaultNewItemForm());

        return result;
    }, [newItemForm, projectId]);

    const approveVO = useCallback((rowId: string) => (
        handleStatusChange(rowId, 'APPROVED_VO')
    ), [handleStatusChange]);

    const handleToggleLedgerSelection = useCallback((rowId: string) => {
        const row = visibleLedgerRows.find((item) => item.id === rowId);

        if (!row || !isSelectableVariationOrder(row)) {
            return;
        }

        setSelectedLedgerIds((currentIds) => (
            currentIds.includes(rowId)
                ? currentIds.filter((id) => id !== rowId)
                : [...currentIds, rowId]
        ));
    }, [visibleLedgerRows]);

    const handleSelectAllLedger = useCallback(() => {
        const visibleVOIds = visibleLedgerRows
            .filter(isSelectableVariationOrder)
            .map((item) => item.id);

        setSelectedLedgerIds((currentIds) => (
            selectedVOIds.length === visibleVOIds.length ? [] : visibleVOIds
        ));
    }, [selectedVOIds.length, visibleLedgerRows]);

    const handleToggleQueueSelection = useCallback((queueId: string) => {
        setSelectedQueueIds((currentIds) => (
            currentIds.includes(queueId)
                ? currentIds.filter((id) => id !== queueId)
                : [...currentIds, queueId]
        ));
    }, []);

    const handleSelectAllQueue = useCallback((queueIds: string[]) => {
        setSelectedQueueIds(queueIds);
    }, []);

    const handleSelectForEstimation = useCallback((item: PricingContradictionItem) => {
        setSelectedContradiction(item);
        setActiveTab('ledger');
    }, []);

    const handleRescan = useCallback(async (item: PricingContradictionItem) => {
        if (scanningItems.includes(item.id)) {
            return;
        }

        setScanningItems((currentIds) => [...currentIds, item.id]);

        try {
            await rescanQueueItem(projectId, item);
            await refreshPendingQueue();
        } finally {
            setScanningItems((currentIds) => currentIds.filter((id) => id !== item.id));
        }
    }, [projectId, refreshPendingQueue, scanningItems]);

    const handleBulkRescan = useCallback(async (ids: string[]) => {
        const itemsToScan = pendingQueue.filter((item) => ids.includes(item.id));
        await Promise.all(itemsToScan.map((item) => handleRescan(item)));
        setSelectedQueueIds([]);
    }, [handleRescan, pendingQueue]);

    const handleBulkDeleteQueue = useCallback(async (ids: string[]) => {
        if (!ids.length) {
            return;
        }

        await archivePendingQueueItems(ids);
        setPendingQueue((currentQueue) => currentQueue.filter((item) => !ids.includes(item.id)));
        setSelectedQueueIds([]);
    }, []);

    const handleEditClick = useCallback((item: PricingLedgerItem) => {
        setIsEditing(item.id);
        setEditForm({ ...item });
    }, []);

    const handleCancelEdit = useCallback(() => {
        setIsEditing(null);
        setEditForm({});
    }, []);

    const handleResetNewItemForm = useCallback(() => {
        setNewItemForm(cloneDefaultNewItemForm());
    }, []);

    const handleExportCSV = useCallback(async () => {
        const response = await fetch(`/api/export?projectId=${projectId}&format=csv`);

        if (!response.ok) {
            throw new Error('Export failed');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ledger_${projectId}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }, [projectId]);

    const handleCloseLetterModal = useCallback(async () => {
        setIsGeneratingLetter(false);
        await Promise.all([
            refreshLedgerRows(),
            refreshPendingQueue(),
        ]);
        setSelectedLedgerIds([]);
    }, [refreshLedgerRows, refreshPendingQueue]);

    const state = useMemo<PricingLedgerState & { lastContractSync: SyncedProjectContractBase | null }>(() => ({
        ledgerRows,
        pendingQueue,
        selectedContradiction,
        newItemForm,
        editForm,
        selectedLedgerIds,
        selectedQueueIds,
        scanningItems,
        loading,
        isLoading: loading,
        isSyncing,
        error,
        activeTab,
        isAddingNew,
        isEditing,
        isGeneratingLetter,
        isFocusedPricingDismissed,
        projectBudget,
        lastContractSync,
    }), [
        activeTab,
        editForm,
        error,
        isAddingNew,
        isEditing,
        isFocusedPricingDismissed,
        isGeneratingLetter,
        isSyncing,
        lastContractSync,
        ledgerRows,
        loading,
        newItemForm,
        pendingQueue,
        projectBudget,
        scanningItems,
        selectedContradiction,
        selectedLedgerIds,
        selectedQueueIds,
    ]);

    const derived = useMemo<PricingLedgerDerivedState>(() => ({
        visibleLedgerRows,
        selectedVOIds,
        focusedQueueItem,
    }), [focusedQueueItem, selectedVOIds, visibleLedgerRows]);

    const setters = useMemo(() => ({
        setActiveTab,
        setEditForm,
        setIsAddingNew,
        setIsEditing,
        setIsFocusedPricingDismissed,
        setIsGeneratingLetter,
        setNewItemForm,
        setSelectedContradiction,
        setSelectedLedgerIds,
        setSelectedQueueIds,
    }), []);

    const actions = useMemo(() => ({
        handleCancelEdit,
        handleAddNew,
        handleApproveEstimation,
        handleBulkDeleteQueue,
        handleBulkRescan,
        handleCloseLetterModal,
        handleDelete,
        handleEditClick,
        handleExportCSV,
        handleResetNewItemForm,
        handleRescan,
        handleSaveEdit,
        handleSelectAllLedger,
        handleSelectAllQueue,
        handleSelectForEstimation,
        handleStatusChange,
        handleSync,
        handleToggleLedgerSelection,
        handleToggleQueueSelection,
        approveVO,
        loadPricingLedger,
        refreshLedgerRows,
        refreshPendingQueue,
    }), [
        approveVO,
        handleAddNew,
        handleApproveEstimation,
        handleBulkDeleteQueue,
        handleBulkRescan,
        handleCancelEdit,
        handleCloseLetterModal,
        handleDelete,
        handleEditClick,
        handleExportCSV,
        handleResetNewItemForm,
        handleRescan,
        handleSaveEdit,
        handleSelectAllLedger,
        handleSelectAllQueue,
        handleSelectForEstimation,
        handleStatusChange,
        handleSync,
        handleToggleLedgerSelection,
        handleToggleQueueSelection,
        loadPricingLedger,
        refreshLedgerRows,
        refreshPendingQueue,
    ]);

    return {
        state,
        totals,
        derived,
        setters,
        actions,
    };
}
