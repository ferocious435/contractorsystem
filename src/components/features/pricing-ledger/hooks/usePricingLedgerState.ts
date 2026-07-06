'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VAT_RATE } from '@/utils/constants';
import { isDemoProjectId, isLocalProjectId } from '@/utils/local-projects';
import { getLocalDemoProjectProfile } from '@/utils/local-demo-data';
import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids';
import {
    getAmountVat,
    getMoneySum,
    getPreferredProjectAmount,
    getVariationOrderAmount,
    isVisibleLedgerRow,
} from '@/utils/project-financials';
import {
    AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
    BULK_RESCAN_CONCURRENCY,
    DEFAULT_NEW_LEDGER_ITEM,
} from '../constants';
import { formatConfidencePercent, getQueueItemConfidenceScore } from '../utils/aiConfidence';
import {
    archivePendingQueueItems,
    deleteLedgerRow,
    fetchLedgerRows,
    fetchPendingQueue,
    normalizePricingLedgerError,
    previewHighConfidenceQueueItems,
    rescanQueueItem,
    saveLedgerRow,
    syncBoqAndContract,
    updateLedgerRowStatus,
} from '../api/pricingLedgerApi';
import type {
    ApprovePricingEstimationPayload,
    BulkApprovePreviewResult,
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

function isSelectableVariationOrder(item?: Pick<PricingLedgerItem, 'type'> | null): boolean {
    return item?.type === 'PENDING_VO' || item?.type === 'APPROVED_VO';
}

function cloneDefaultNewItemForm(): PricingEstimationData {
    return { ...DEFAULT_NEW_LEDGER_ITEM };
}

function buildLocalDemoLedgerRows(projectId: string): PricingLedgerItem[] {
    const demoProfile = getLocalDemoProjectProfile(projectId);
    if (demoProfile.budget <= 0) return [];

    return [
        {
            id: 'demo-ledger-base',
            project_id: projectId,
            type: 'BASE_CONTRACT',
            source: 'BOQ',
            item_code: '01.001',
            description: 'Demo base contract amount',
            unit: 'ls',
            quantity: 1,
            unit_price_excl_vat: demoProfile.budget,
            total_price_excl_vat: demoProfile.budget,
            markup_percentage: 0,
            ai_rationale: 'Demo row for free trial mode.',
            governing_notes: ['Demo data only - not saved to Supabase.'],
            evidence_data: { source: 'demo' },
            vat_rate: VAT_RATE,
        },
        {
            id: 'demo-ledger-vo-1',
            project_id: projectId,
            type: 'PENDING_VO',
            source: 'CUSTOM_ANALYSIS',
            item_code: 'VO-DEMO-01',
            description: 'Extra site preparation work for mobile demo',
            unit: 'ls',
            quantity: 1,
            unit_price_excl_vat: demoProfile.pendingVO,
            total_price_excl_vat: demoProfile.pendingVO,
            markup_percentage: 0,
            ai_rationale: 'Demo pricing item created so the pricing screen is usable without Supabase.',
            governing_notes: ['Check contract scope before approval.', 'VAT is shown separately.'],
            evidence_data: { source: 'demo' },
            confidence_score: 0.82,
            vat_rate: VAT_RATE,
        },
    ];
}

function buildLocalDemoQueue(projectId: string): PricingContradictionItem[] {
    if (!isDemoProjectId(projectId)) return [];

    return [
        {
            id: 'demo-queue-1',
            project_id: projectId,
            status: 'OPEN',
            pricing_status: 'PENDING',
            title: 'Demo contradiction ready for pricing',
            description: 'Execution document includes an extra preparation step that is missing from the contract BOQ.',
            category: 'CONTRADICTION',
            severity: 'HIGH',
            created_at: new Date().toISOString(),
            source_doc: { title: 'Demo execution note.pdf' },
            target_doc: { title: 'Demo contract BOQ.pdf' },
            source_execution_doc: { title: 'Demo execution note.pdf' },
            target_contract_doc: { title: 'Demo contract BOQ.pdf' },
            evidence_data: { source: 'demo' },
            confidence_score: 0.86,
            ai_metadata: { confidence_score: 0.86, confidence_reason: 'Demo evidence is complete enough for a trial.' },
        },
    ];
}

function buildLocalLedgerItem(projectId: string, data: ApprovePricingEstimationPayload): PricingLedgerItem {
    const quantity = Number(data.quantity || 0);
    const unitPrice = Number(data.unit_price_excl_vat || 0);
    const total = Number(quantity * unitPrice);

    return {
        id: data.contradiction_id ? 'demo-ledger-' + data.contradiction_id : 'demo-ledger-' + Date.now(),
        project_id: projectId,
        type: data.type || 'PENDING_VO',
        source: data.source || 'CUSTOM_ANALYSIS',
        item_code: data.item_code || 'DEMO',
        description: data.description || 'Demo pricing item',
        unit: data.unit || 'ls',
        quantity,
        unit_price_excl_vat: unitPrice,
        total_price_excl_vat: total,
        markup_percentage: normalizeMarkupPercentage(data.markup_percentage),
        ai_rationale: data.ai_rationale || 'Demo item saved locally for this browser session.',
        governing_notes: data.governing_notes || ['Demo mode does not write to Supabase.'],
        expert_strategy: data.expert_strategy,
        evidence_data: data.evidence_data || { source: 'demo' },
        contradiction_id: data.contradiction_id,
        vat_rate: VAT_RATE,
    };
}

function normalizeMarkupPercentage(value?: number | null) {
    const numericValue = Number(value || 0);
    return numericValue > 1 ? numericValue / 100 : numericValue;
}

async function rescanQueueItemsInBatches(projectId: string, items: PricingContradictionItem[]) {
    for (let index = 0; index < items.length; index += BULK_RESCAN_CONCURRENCY) {
        const batch = items.slice(index, index + BULK_RESCAN_CONCURRENCY);
        await Promise.all(batch.map((item) => rescanQueueItem(projectId, item)));
    }
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
    const bulkApproveOperationRef = useRef(0);
    const bulkDeleteInFlightIdSetRef = useRef<Set<string>>(new Set());
    const bulkRescanOperationRef = useRef(0);
    const isLocalPricingProject = isLocalProjectId(projectId);

    const loadPricingLedger = useCallback(async (options: { syncContract?: boolean } = {}) => {
        setLoading(true);
        setError(null);

        try {
            if (isLocalPricingProject) {
                const localRows = buildLocalDemoLedgerRows(projectId);
                const localQueue = buildLocalDemoQueue(projectId);
                setLedgerRows(localRows);
                setPendingQueue(localQueue);
                setProjectBudget(getLocalDemoProjectProfile(projectId).budget);
                return { ledgerRows: localRows, pendingQueue: localQueue, syncedContractBase: null };
            }

            let syncedContractBase: SyncedProjectContractBase | null = null;

            if (options.syncContract === true) {
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
    }, [isLocalPricingProject, projectId]);

    const refreshLedgerRows = useCallback(async () => {
        if (isLocalPricingProject) {
            return ledgerRows;
        }

        const ledgerResult = await fetchLedgerRows(projectId);
        setLedgerRows(ledgerResult.rows);
        setProjectBudget(Number((lastContractSync?.amount ?? ledgerResult.projectBudget) || 0));
        return ledgerResult.rows;
    }, [isLocalPricingProject, lastContractSync?.amount, ledgerRows, projectId]);

    const refreshPendingQueue = useCallback(async () => {
        if (isLocalPricingProject) {
            return pendingQueue;
        }

        const queueRows = await fetchPendingQueue(projectId);
        setPendingQueue(queueRows);
        return queueRows;
    }, [isLocalPricingProject, pendingQueue, projectId]);

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

    const visibleLedgerRowById = useMemo(
        () => new Map(visibleLedgerRows.map((row) => [row.id, row])),
        [visibleLedgerRows]
    );

    const selectedVOIds = useMemo(
        () => selectedLedgerIds.filter((id) => (
            isSelectableVariationOrder(visibleLedgerRowById.get(id))
        )),
        [selectedLedgerIds, visibleLedgerRowById]
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

    const queueConfidenceScoreById = useMemo(
        () => new Map(pendingQueue.map((item) => [item.id, getQueueItemConfidenceScore(item)])),
        [pendingQueue]
    );

    const queueConfidencePercentById = useMemo(
        () => new Map(Array.from(queueConfidenceScoreById.entries()).map(([id, score]) => [
            id,
            score === null ? null : formatConfidencePercent(score),
        ])),
        [queueConfidenceScoreById]
    );

    const highConfidenceQueueIds = useMemo(
        () => pendingQueue
            .filter((item) => {
                const score = queueConfidenceScoreById.get(item.id) ?? null;
                return score !== null && score > AI_BULK_APPROVE_CONFIDENCE_THRESHOLD;
            })
            .map((item) => item.id),
        [pendingQueue, queueConfidenceScoreById]
    );

    const highConfidenceQueueIdSet = useMemo(
        () => new Set(highConfidenceQueueIds),
        [highConfidenceQueueIds]
    );

    const selectedHighConfidenceQueueIds = useMemo(
        () => selectedQueueIds.filter((id) => highConfidenceQueueIdSet.has(id)),
        [highConfidenceQueueIdSet, selectedQueueIds]
    );

    const scanningItemIdSet = useMemo(
        () => new Set(scanningItems),
        [scanningItems]
    );

    const queueConfidenceStats = useMemo(() => {
        const scores = Array.from(queueConfidenceScoreById.values())
            .filter((score): score is number => score !== null);

        if (!scores.length) {
            return {
                averageScore: null,
                highConfidenceCount: 0,
                totalWithConfidence: 0,
            };
        }

        return {
            averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
            highConfidenceCount: highConfidenceQueueIds.length,
            totalWithConfidence: scores.length,
        };
    }, [highConfidenceQueueIds.length, queueConfidenceScoreById]);

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
        if (isLocalPricingProject) {
            setLedgerRows((currentRows) => currentRows.map((row) => (
                row.id === rowId ? { ...row, type: status as PricingLedgerRowType } : row
            )));
            return { success: true };
        }

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
    }, [isLocalPricingProject]);

    const handleDelete = useCallback(async (rowId: string) => {
        if (isLocalPricingProject) {
            setLedgerRows((currentRows) => currentRows.filter((row) => row.id !== rowId));
            setSelectedLedgerIds((currentIds) => currentIds.filter((id) => id !== rowId));
            return { success: true };
        }

        const result = await deleteLedgerRow(projectId, rowId);

        if (!result.success) {
            throw new Error(result.error || 'Failed to delete ledger row');
        }

        setLedgerRows((currentRows) => currentRows.filter((row) => row.id !== rowId));
        setSelectedLedgerIds((currentIds) => currentIds.filter((id) => id !== rowId));

        return result;
    }, [isLocalPricingProject, projectId]);

    const handleApproveEstimation = useCallback(async (ledgerData: ApprovePricingEstimationPayload) => {
        if (isLocalPricingProject) {
            const item = buildLocalLedgerItem(projectId, ledgerData);
            setLedgerRows((currentRows) => [item, ...currentRows]);
            if (ledgerData.contradiction_id) {
                setPendingQueue((currentQueue) => currentQueue.filter((queueItem) => queueItem.id !== ledgerData.contradiction_id));
            }
            setSelectedContradiction(null);
            if (routedEstimateId) setIsFocusedPricingDismissed(true);
            return { success: true, item };
        }

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
    }, [isLocalPricingProject, projectId, refreshLedgerRows, refreshPendingQueue, routedEstimateId]);

    const handleSaveEdit = useCallback(async () => {
        if (!editForm.id) {
            return null;
        }

        if (isLocalPricingProject) {
            setLedgerRows((currentRows) => currentRows.map((row) => (
                row.id === editForm.id ? { ...row, ...editForm } as PricingLedgerItem : row
            )));
            setIsEditing(null);
            setEditForm({});
            return { success: true, item: editForm as PricingLedgerItem };
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
    }, [editForm, isLocalPricingProject, projectId]);

    const handleAddNew = useCallback(async () => {
        if (isLocalPricingProject) {
            const item = buildLocalLedgerItem(projectId, newItemForm);
            setLedgerRows((currentRows) => [...currentRows, item]);
            setIsAddingNew(false);
            setNewItemForm(cloneDefaultNewItemForm());
            return { success: true, item };
        }

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
    }, [isLocalPricingProject, newItemForm, projectId]);

    const approveVO = useCallback((rowId: string) => (
        handleStatusChange(rowId, 'APPROVED_VO')
    ), [handleStatusChange]);

    const handleToggleLedgerSelection = useCallback((rowId: string) => {
        const row = visibleLedgerRowById.get(rowId);

        if (!row || !isSelectableVariationOrder(row)) {
            return;
        }

        setSelectedLedgerIds((currentIds) => (
            currentIds.includes(rowId)
                ? currentIds.filter((id) => id !== rowId)
                : [...currentIds, rowId]
        ));
    }, [visibleLedgerRowById]);

    const handleSelectAllLedger = useCallback(() => {
        const visibleVOIds = visibleLedgerRows
            .filter(isSelectableVariationOrder)
            .map((item) => item.id);

        setSelectedLedgerIds(selectedVOIds.length === visibleVOIds.length ? [] : visibleVOIds);
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
        if (scanningItemIdSet.has(item.id)) {
            return;
        }

        setScanningItems((currentIds) => (
            currentIds.includes(item.id) ? currentIds : [...currentIds, item.id]
        ));

        try {
            if (!isLocalPricingProject) {
                await rescanQueueItem(projectId, item);
                await refreshPendingQueue();
            }
        } finally {
            setScanningItems((currentIds) => currentIds.filter((id) => id !== item.id));
        }
    }, [isLocalPricingProject, projectId, refreshPendingQueue, scanningItemIdSet]);

    const handleBulkRescan = useCallback(async (ids: string[]) => {
        const requestedQueueIds = normalizePricingQueueIds(ids);

        if (!requestedQueueIds.length) {
            return;
        }

        const selectedQueueIdSet = new Set(requestedQueueIds);
        const itemsToScan = pendingQueue.filter((item) => (
            selectedQueueIdSet.has(item.id) && !scanningItemIdSet.has(item.id)
        ));
        const idsToScan = itemsToScan.map((item) => item.id);

        if (!itemsToScan.length) {
            return;
        }

        const operationId = bulkRescanOperationRef.current + 1;
        bulkRescanOperationRef.current = operationId;

        setScanningItems((currentIds) => Array.from(new Set([...currentIds, ...idsToScan])));

        try {
            if (!isLocalPricingProject) {
                await rescanQueueItemsInBatches(projectId, itemsToScan);
            }

            if (bulkRescanOperationRef.current !== operationId) {
                return;
            }

            await refreshPendingQueue();
            const completedScanIdSet = new Set(idsToScan);
            setSelectedQueueIds((currentIds) => currentIds.filter((id) => !completedScanIdSet.has(id)));
        } finally {
            const completedScanIdSet = new Set(idsToScan);
            setScanningItems((currentIds) => currentIds.filter((id) => !completedScanIdSet.has(id)));
        }
    }, [isLocalPricingProject, pendingQueue, projectId, refreshPendingQueue, scanningItemIdSet]);

    const handleBulkDeleteQueue = useCallback(async (ids: string[]) => {
        const requestedQueueIds = normalizePricingQueueIds(ids);

        if (!requestedQueueIds.length) {
            return;
        }

        const inFlightDeleteIdSet = bulkDeleteInFlightIdSetRef.current;
        const idsToArchive = requestedQueueIds.filter((id) => !inFlightDeleteIdSet.has(id));

        if (!idsToArchive.length) {
            return;
        }

        idsToArchive.forEach((id) => inFlightDeleteIdSet.add(id));

        try {
            if (isLocalPricingProject) {
                const archivedQueueIdSet = new Set(idsToArchive);
                setPendingQueue((currentQueue) => currentQueue.filter((item) => !archivedQueueIdSet.has(item.id)));
                setSelectedQueueIds((currentIds) => currentIds.filter((id) => !archivedQueueIdSet.has(id)));
                return;
            }

            const result = await archivePendingQueueItems(projectId, idsToArchive);
            const archivedQueueIdSet = new Set(result.archivedIds || []);
            setPendingQueue((currentQueue) => currentQueue.filter((item) => !archivedQueueIdSet.has(item.id)));
            setSelectedQueueIds((currentIds) => currentIds.filter((id) => !archivedQueueIdSet.has(id)));
        } finally {
            idsToArchive.forEach((id) => inFlightDeleteIdSet.delete(id));
        }
    }, [isLocalPricingProject, projectId]);

    const handleBulkApprove = useCallback(async (ids: string[] = selectedQueueIds): Promise<BulkApprovePreviewResult> => {
        const operationId = bulkApproveOperationRef.current + 1;
        bulkApproveOperationRef.current = operationId;
        const requestedIds = normalizePricingQueueIds(ids);
        const requestedIdSet = new Set(requestedIds);
        const clientEligibleIds = requestedIds.filter((id) => highConfidenceQueueIdSet.has(id));
        const clientSkippedIds = requestedIds.filter((id) => !highConfidenceQueueIdSet.has(id));

        if (!clientEligibleIds.length) {
            if (bulkApproveOperationRef.current === operationId) {
                setSelectedQueueIds((currentIds) => currentIds.filter((id) => !requestedIdSet.has(id)));
            }

            return {
                success: true,
                superseded: bulkApproveOperationRef.current !== operationId,
                stagedIds: [],
                approvedIds: [],
                skippedIds: clientSkippedIds,
                threshold: AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
            };
        }

        const result = isLocalPricingProject
            ? { success: true, stagedIds: clientEligibleIds, approvedIds: clientEligibleIds, skippedIds: [], threshold: AI_BULK_APPROVE_CONFIDENCE_THRESHOLD }
            : await previewHighConfidenceQueueItems(projectId, clientEligibleIds);
        const stagedIds = result.stagedIds || result.approvedIds || [];
        const skippedIds = [
            ...clientSkippedIds,
            ...(result.skippedIds || []),
        ];

        if (bulkApproveOperationRef.current !== operationId) {
            return {
                ...result,
                success: true,
                superseded: true,
                stagedIds: [],
                approvedIds: [],
                skippedIds: requestedIds,
                threshold: result.threshold ?? AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
            };
        }

        const stagedIdSet = new Set(stagedIds);
        setSelectedQueueIds((currentIds) => {
            const unrelatedNewSelection = currentIds.filter((id) => !requestedIdSet.has(id));
            return Array.from(new Set([...unrelatedNewSelection, ...stagedIdSet]));
        });

        return {
            ...result,
            success: true,
            superseded: false,
            stagedIds,
            approvedIds: stagedIds,
            skippedIds,
            threshold: result.threshold ?? AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
        };
    }, [highConfidenceQueueIdSet, isLocalPricingProject, projectId, selectedQueueIds]);

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
        if (isLocalPricingProject) {
            const csvRows = [
                ['item_code', 'description', 'quantity', 'unit_price_excl_vat', 'total_price_excl_vat'],
                ...ledgerRows.map((row) => [row.item_code, row.description, row.quantity, row.unit_price_excl_vat, row.total_price_excl_vat]),
            ];
            const blob = new Blob([csvRows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ledger_${projectId}.csv`;
            link.click();
            URL.revokeObjectURL(url);
            return;
        }

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
    }, [isLocalPricingProject, ledgerRows, projectId]);

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
        queueConfidenceScoreById,
        queueConfidencePercentById,
        highConfidenceQueueIds,
        selectedHighConfidenceQueueIds,
        queueConfidenceStats,
    }), [
        focusedQueueItem,
        highConfidenceQueueIds,
        queueConfidencePercentById,
        queueConfidenceScoreById,
        queueConfidenceStats,
        selectedHighConfidenceQueueIds,
        selectedVOIds,
        visibleLedgerRows,
    ]);

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
        handleBulkApprove,
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
        handleBulkApprove,
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
