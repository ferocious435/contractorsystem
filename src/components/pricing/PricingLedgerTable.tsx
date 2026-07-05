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
import { calculateFixedVirtualWindow } from '@/utils/virtual-window.mjs';

export type LedgerFormState = Partial<Omit<LedgerItem, 'evidence_data'>> & {
    evidence_data?: unknown;
};

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

function getDisplayNotes(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(toReactText).filter(Boolean);
    }

    const singleNote = toReactText(value);
    return singleNote ? [singleNote] : [];
}



interface PricingLedgerTableProps {
    ledgerItems: LedgerItem[];
    isLoading: boolean;
    isAddingNew: boolean;
    isEditing: string | null;
    newItemForm: LedgerFormState;
    setNewItemForm: (form: LedgerFormState) => void;
    editForm: LedgerFormState;
    setEditForm: (form: LedgerFormState) => void;
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
];

const VIRTUALIZATION_THRESHOLD = 500;
const VIRTUAL_ROW_HEIGHT = 80;
const VIRTUAL_OVERSCAN = 8;
const LEDGER_ROW_MOTION_THRESHOLD = 200;

const isSelectableVariationOrder = (item: LedgerItem) =>
    item.type === 'PENDING_VO' || item.type === 'APPROVED_VO';

function useLatestCallback<T extends (...args: never[]) => unknown>(callback: T): T {
    const callbackRef = React.useRef(callback);

    React.useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    const stableCallback = React.useCallback((...args: Parameters<T>) => callbackRef.current(...args), []);
    return stableCallback as T;
}

const TypeBadge = React.memo(function TypeBadge({ type }: { type: LedgerItem['type'] }) {
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
});

function TypeSelect({
    value,
    onChange,
}: {
    value?: string;
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

interface LedgerRowShellProps {
    item: LedgerItem;
    itemId: string;
    rowIndex: number;
    shouldAnimateRows: boolean;
    isSelected: boolean;
    isEditingRow: boolean;
    children: React.ReactNode;
}

const LedgerRowShell = React.memo(function LedgerRowShell({
    itemId,
    rowIndex,
    shouldAnimateRows,
    isSelected,
    children,
}: LedgerRowShellProps) {
    const className = `hover:bg-white/[0.02] transition-colors group border-b border-white/5 last:border-0 min-h-16 ${
        isSelected ? 'bg-blue-500/5' : ''
    }`;

    if (!shouldAnimateRows) {
        return (
            <tr key={itemId} className={className}>
                {children}
            </tr>
        );
    }

    return (
        <motion.tr
            key={itemId}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, delay: Math.min(rowIndex, 10) * 0.02 }}
            className={className}
        >
            {children}
        </motion.tr>
    );
}, (prev, next) => {
    if (prev.isEditingRow || next.isEditingRow) {
        return false;
    }

    return prev.item === next.item
        && prev.itemId === next.itemId
        && prev.shouldAnimateRows === next.shouldAnimateRows
        && prev.isSelected === next.isSelected
        && (!next.shouldAnimateRows || prev.rowIndex === next.rowIndex);
});

interface DisplayLedgerRowCellsProps {
    item: LedgerItem;
    approveVO: (id: string) => void;
    handleEditClick: (item: LedgerItem) => void;
    handleDelete: (id: string) => void;
    formatCurrency: (val: number) => string;
}

const DisplayLedgerRowCells = React.memo(function DisplayLedgerRowCells({
    item,
    approveVO,
    handleEditClick,
    handleDelete,
    formatCurrency,
}: DisplayLedgerRowCellsProps) {
    const rowTotal = getLedgerRowAmount(item);
    const governingNotes = getDisplayNotes(item.governing_notes);
    const isBaseContract = item.type === 'BASE_CONTRACT';

    return (
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
                                        {governingNotes.length > 0 && (
                                            <div className="pt-3 mt-3 border-t border-white/5 space-y-2">
                                                <span className="text-xs font-bold text-gray-400">הערות והסתמכויות</span>
                                                <div className="flex flex-col gap-2">
                                                    {governingNotes.map((note, i) => (
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
                        onClick={() => !isBaseContract && handleEditClick(item)}
                        disabled={isBaseContract}
                        className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all border border-transparent hover:border-white/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-gray-500 disabled:hover:bg-transparent"
                        title="ערוך"
                    >
                        <Edit2 size={16} />
                    </button>
                    <button
                        onClick={() => !isBaseContract && handleDelete(item.id)}
                        disabled={isBaseContract}
                        className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all border border-transparent hover:border-red-500/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-gray-500 disabled:hover:bg-transparent"
                        title="מחק"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </td>
        </>
    );
}, (prev, next) => (
    prev.item === next.item
    && prev.approveVO === next.approveVO
    && prev.handleEditClick === next.handleEditClick
    && prev.handleDelete === next.handleDelete
    && prev.formatCurrency === next.formatCurrency
));

interface EditableLedgerFormProps {
    form: LedgerFormState;
    setForm: (form: LedgerFormState) => void;
    formatCurrency: (val: number) => string;
}

interface NewLedgerRowProps extends EditableLedgerFormProps {
    onSave: () => void;
    onCancel: () => void;
}

const NewLedgerRow = React.memo(function NewLedgerRow({
    form,
    setForm,
    onSave,
    onCancel,
    formatCurrency,
}: NewLedgerRowProps) {
    const updateField = React.useCallback(
        (field: string, value: unknown) => setForm({ ...form, [field]: value }),
        [form, setForm]
    );

    return (
        <tr className="bg-primary/5 animate-in slide-in-from-top-1">
            <td className="px-4 py-3 text-center" />
            <td className="px-4 py-3">
                <TypeSelect
                    value={form.type}
                    onChange={(value) => updateField('type', value)}
                />
            </td>
            <td className="px-4 py-3">
                <input
                    type="text"
                    value={form.item_code}
                    onChange={(e) => updateField('item_code', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-primary outline-none text-right text-gray-200"
                    dir="rtl"
                />
            </td>
            <td className="px-4 py-3">
                <input
                    type="text"
                    value={form.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-primary outline-none text-right text-gray-200"
                    dir="rtl"
                />
            </td>
            <td className="px-4 py-3 text-center">
                <input
                    type="text"
                    value={form.unit}
                    onChange={(e) => updateField('unit', e.target.value)}
                    className="w-16 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-primary outline-none text-gray-200"
                />
            </td>
            <td className="px-4 py-3 text-center">
                <input
                    type="number"
                    value={form.quantity}
                    onChange={(e) => updateField('quantity', parseFloat(e.target.value) || 0)}
                    className="w-20 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-primary outline-none text-gray-200"
                />
            </td>
            <td className="px-4 py-3 text-left">
                <input
                    type="number"
                    value={form.unit_price_excl_vat}
                    onChange={(e) => updateField('unit_price_excl_vat', parseFloat(e.target.value) || 0)}
                    className="w-28 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-left focus:border-primary outline-none text-gray-200"
                />
            </td>
            <td className="px-4 py-3 text-left text-sm font-bold text-emerald-300">
                {formatCurrency(getLedgerRowAmount(form))}
            </td>
            <td className="px-4 py-3 text-center">
                <div className="flex justify-center gap-2">
                    <button
                        onClick={onSave}
                        className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-colors"
                    >
                        <Check className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onCancel}
                        className="p-2 text-gray-500 hover:bg-white/10 rounded-xl transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
});

interface EditLedgerRowCellsProps extends EditableLedgerFormProps {
    onSave: () => void;
    onCancel: () => void;
}

const EditLedgerRowCells = React.memo(function EditLedgerRowCells({
    form,
    setForm,
    onSave,
    onCancel,
    formatCurrency,
}: EditLedgerRowCellsProps) {
    const updateField = React.useCallback(
        (field: string, value: unknown) => setForm({ ...form, [field]: value }),
        [form, setForm]
    );

    return (
        <>
            <td className="px-4 py-3">
                <TypeSelect
                    value={form.type}
                    onChange={(value) => updateField('type', value)}
                />
            </td>
            <td className="px-4 py-3">
                <input
                    type="text"
                    value={form.item_code}
                    onChange={(e) => updateField('item_code', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none text-right text-gray-200"
                    dir="rtl"
                />
            </td>
            <td className="px-4 py-3">
                <input
                    type="text"
                    value={form.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none text-right text-gray-200"
                    dir="rtl"
                />
            </td>
            <td className="px-4 py-3 text-center">
                <input
                    type="text"
                    value={form.unit}
                    onChange={(e) => updateField('unit', e.target.value)}
                    className="w-16 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-blue-500 outline-none text-gray-200"
                />
            </td>
            <td className="px-4 py-3 text-center">
                <input
                    type="number"
                    value={form.quantity}
                    onChange={(e) => updateField('quantity', parseFloat(e.target.value) || 0)}
                    className="w-20 mx-auto bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-sm text-center focus:border-blue-500 outline-none text-gray-200"
                />
            </td>
            <td className="px-4 py-3 text-left">
                <input
                    type="number"
                    value={form.unit_price_excl_vat}
                    onChange={(e) => updateField('unit_price_excl_vat', parseFloat(e.target.value) || 0)}
                    className="w-28 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-left focus:border-blue-500 outline-none text-gray-200"
                />
            </td>
            <td className="px-4 py-3 text-left text-sm font-bold text-gray-300">
                {formatCurrency(getLedgerRowAmount(form))}
            </td>
            <td className="px-4 py-3 text-center">
                <div className="flex justify-center gap-2">
                    <button
                        onClick={onSave}
                        className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all"
                    >
                        <Check size={14} />
                    </button>
                    <button
                        onClick={onCancel}
                        className="p-2 text-gray-500 hover:bg-white/10 rounded-xl transition-all"
                    >
                        <X size={14} />
                    </button>
                </div>
            </td>
        </>
    );
});

function PricingLedgerTable({
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
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const scrollFrameRef = React.useRef<number | null>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(0);
    const stableToggleSelectItem = useLatestCallback(toggleSelectItem);
    const stableToggleSelectAll = useLatestCallback(toggleSelectAll);
    const stableHandleAddNew = useLatestCallback(handleAddNew);
    const stableSetIsAddingNew = useLatestCallback(setIsAddingNew);
    const stableHandleSaveEdit = useLatestCallback(handleSaveEdit);
    const stableHandleCancelEdit = useLatestCallback(handleCancelEdit);
    const stableApproveVO = useLatestCallback(approveVO);
    const stableHandleEditClick = useLatestCallback(handleEditClick);
    const stableHandleDelete = useLatestCallback(handleDelete);

    const selectedLedgerIdSet = React.useMemo(() => new Set(selectedLedgerIds), [selectedLedgerIds]);
    const selectableItems = React.useMemo(
        () => ledgerItems.filter(isSelectableVariationOrder),
        [ledgerItems]
    );
    const allSelectableSelected = React.useMemo(
        () => selectableItems.length > 0
            && selectableItems.every(item => selectedLedgerIdSet.has(item.id)),
        [selectableItems, selectedLedgerIdSet]
    );
    const shouldVirtualize = ledgerItems.length > VIRTUALIZATION_THRESHOLD;
    const shouldAnimateRows = ledgerItems.length <= LEDGER_ROW_MOTION_THRESHOLD;

    React.useEffect(() => {
        const container = scrollContainerRef.current;

        if (!container) {
            return;
        }

        const updateViewportHeight = () => {
            setViewportHeight(container.clientHeight || VIRTUAL_ROW_HEIGHT * 12);
        };

        updateViewportHeight();

        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updateViewportHeight);
        resizeObserver?.observe(container);

        return () => {
            resizeObserver?.disconnect();
            if (scrollFrameRef.current !== null) {
                cancelAnimationFrame(scrollFrameRef.current);
            }
        };
    }, []);

    const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const nextScrollTop = event.currentTarget.scrollTop;

        if (scrollFrameRef.current !== null) {
            cancelAnimationFrame(scrollFrameRef.current);
        }

        scrollFrameRef.current = requestAnimationFrame(() => {
            setScrollTop(nextScrollTop);
            scrollFrameRef.current = null;
        });
    }, []);

    const virtualWindow = React.useMemo(() => {
        if (!shouldVirtualize) {
            return {
                visibleRows: ledgerItems.map((item, index) => ({ item, index })),
                topPadding: 0,
                bottomPadding: 0,
            };
        }

        const windowMetrics = calculateFixedVirtualWindow({
            itemCount: ledgerItems.length,
            scrollTop,
            viewportHeight,
            rowHeight: VIRTUAL_ROW_HEIGHT,
            overscan: VIRTUAL_OVERSCAN,
            fallbackVisibleRows: 12,
        });

        return {
            visibleRows: ledgerItems
                .slice(windowMetrics.startIndex, windowMetrics.endIndex)
                .map((item, index) => ({ item, index: windowMetrics.startIndex + index })),
            topPadding: windowMetrics.topPadding,
            bottomPadding: windowMetrics.bottomPadding,
        };
    }, [ledgerItems, scrollTop, shouldVirtualize, viewportHeight]);

    const ledgerRowsContent = React.useMemo(() => (
        <>
            {shouldVirtualize && virtualWindow.topPadding > 0 && (
                <tr key="virtual-top-spacer" aria-hidden="true">
                    <td colSpan={9} style={{ height: virtualWindow.topPadding, padding: 0 }} />
                </tr>
            )}

            {virtualWindow.visibleRows.map(({ item, index }, visibleIndex) => {
                const isSelectable = isSelectableVariationOrder(item);

                return (
                    <LedgerRowShell
                        key={item.id}
                        item={item}
                        itemId={item.id}
                        rowIndex={shouldVirtualize ? visibleIndex : index}
                        shouldAnimateRows={shouldAnimateRows}
                        isEditingRow={isEditing === item.id}
                        isSelected={selectedLedgerIdSet.has(item.id)}
                    >
                        <td className="px-6 py-4 text-center">
                            <input
                                type="checkbox"
                                checked={selectedLedgerIdSet.has(item.id)}
                                onChange={() => isSelectable && stableToggleSelectItem(item.id)}
                                disabled={!isSelectable}
                                title={isSelectable ? undefined : 'חוזה בסיס אינו נכנס לדרישת חריג'}
                                className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-500 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                            />
                        </td>

                        {isEditing === item.id ? (
                            <EditLedgerRowCells
                                form={editForm}
                                setForm={setEditForm}
                                onSave={stableHandleSaveEdit}
                                onCancel={stableHandleCancelEdit}
                                formatCurrency={formatCurrency}
                            />
                        ) : (
                            <DisplayLedgerRowCells
                                item={item}
                                approveVO={stableApproveVO}
                                handleEditClick={stableHandleEditClick}
                                handleDelete={stableHandleDelete}
                                formatCurrency={formatCurrency}
                            />
                        )}
                    </LedgerRowShell>
                );
            })}

            {shouldVirtualize && virtualWindow.bottomPadding > 0 && (
                <tr key="virtual-bottom-spacer" aria-hidden="true">
                    <td colSpan={9} style={{ height: virtualWindow.bottomPadding, padding: 0 }} />
                </tr>
            )}
        </>
    ), [
        editForm,
        formatCurrency,
        isEditing,
        selectedLedgerIdSet,
        setEditForm,
        shouldAnimateRows,
        shouldVirtualize,
        stableApproveVO,
        stableHandleCancelEdit,
        stableHandleDelete,
        stableHandleEditClick,
        stableHandleSaveEdit,
        stableToggleSelectItem,
        virtualWindow,
    ]);

    return (
        <div className="flex-1 min-h-[420px] bg-[#151C24]/40 border border-white/5 rounded-[2rem] lg:rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl relative">
            <div className="absolute top-0 right-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

            <div
                ref={scrollContainerRef}
                onScroll={shouldVirtualize ? handleScroll : undefined}
                className="flex-1 overflow-auto custom-scrollbar"
            >
                <table className="min-w-[920px] w-full text-right border-collapse" dir="rtl">
                    <thead className="sticky top-0 bg-[#1A222C] z-30 border-b border-white/5">
                        <tr className="h-16">
                            <th className="px-6 py-4 text-center w-16">
                                <input
                                    type="checkbox"
                                    checked={allSelectableSelected}
                                    onChange={stableToggleSelectAll}
                                    disabled={selectableItems.length === 0}
                                    className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-500 focus:ring-blue-500 cursor-pointer"
                                />
                            </th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 w-36">סוג שורה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 w-28">קוד סעיף</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400">תיאור העבודה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-center w-20">יחידה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-center w-24">כמות</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-left w-32">מחיר יחידה</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-left w-40">סה&quot;כ ללא מע&quot;מ</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 text-center w-36">פעולות</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {isAddingNew && (
                            <NewLedgerRow
                                form={newItemForm}
                                setForm={setNewItemForm}
                                onSave={stableHandleAddNew}
                                onCancel={() => stableSetIsAddingNew(false)}
                                formatCurrency={formatCurrency}
                            />
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
                        ) : shouldAnimateRows ? (
                            <AnimatePresence mode="popLayout">
                                {ledgerRowsContent}
                            </AnimatePresence>
                        ) : (
                            ledgerRowsContent
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default React.memo(PricingLedgerTable);
