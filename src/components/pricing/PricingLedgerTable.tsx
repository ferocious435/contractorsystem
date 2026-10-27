"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Eye, MoreHorizontal, Edit2, Trash2, CheckCircle2 } from 'lucide-react';
import type { LedgerItem } from '@/types';
import { getLedgerRowAmount } from '@/utils/project-financials';
import { calculateFixedVirtualWindow } from '@/utils/virtual-window.mjs';
import { SELECTABLE_VARIATION_ORDER_TYPES, LEDGER_ROW_TYPES } from '@/components/features/pricing-ledger/constants';
import { LedgerSourceDetails } from '@/components/features/pricing-ledger/components/LedgerSourceDetails';
import type { PricingLedgerItem } from '@/components/features/pricing-ledger/types';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Field } from '@/components/ui/titanium/Field';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { StatusChip } from '@/components/ui/titanium/StatusChip';
export type LedgerFormState = Partial<Omit<LedgerItem, 'evidence_data'>> & {
    evidence_data?: unknown;
};
interface PricingLedgerTableProps {
    ledgerItems: LedgerItem[];
    isLoading: boolean;
    isAddingNew: boolean;
    isEditing: string | null;
    newItemForm: LedgerFormState;
    setNewItemForm(form: LedgerFormState): void;
    editForm: LedgerFormState;
    setEditForm(form: LedgerFormState): void;
    selectedLedgerIds: string[];
    toggleSelectItem(id: string): void;
    toggleSelectAll(): void;
    handleAddNew(): unknown;
    setIsAddingNew(value: boolean): void;
    handleSaveEdit(): unknown;
    handleCancelEdit(): void;
    approveVO(id: string): unknown;
    handleEditClick(item: LedgerItem): void;
    handleDelete(id: string): unknown;
    formatCurrency(value: number): string;
    errorMessage?: string | null;
}
export const isLedgerRowSelectable = (item: Pick<LedgerItem, 'type'>) => SELECTABLE_VARIATION_ORDER_TYPES.some(type => type === item.type);
function knownNumber(value: unknown): number | null { if (value === null || value === undefined || value === '')
    return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function totalKnown(item: LedgerFormState) { return knownNumber(item.total_price_excl_vat) !== null || (knownNumber(item.quantity) !== null && knownNumber(item.unit_price_excl_vat) !== null); }
const VIRTUALIZATION_THRESHOLD = 500;
const widths = [48, 136, 136, 320, 72, 104, 144, 168, 128];
const labels = ['בחירה', 'סוג שורה', 'קוד סעיף', 'תיאור העבודה', 'יחידה', 'כמות', 'מחיר יחידה', 'סה״כ ללא מע״מ', 'פעולות'];
export function LedgerActionControls({ item, pending = false, onEdit, onDelete, onApprove }: {
    item: LedgerItem;
    pending?: boolean;
    onEdit(): void;
    onDelete(): void;
    onApprove(): void;
}) {
    const protectedBase = item.type === 'BASE_CONTRACT';
    return <div className="ti-ledger-action-controls">{protectedBase && <Feedback>חוזה הבסיס מוגן מעריכה וממחיקה. עדכונו מתבצע דרך מקורות כתב הכמויות.</Feedback>}{item.type === 'PENDING_VO' && <Button variant="primary" onClick={onApprove} disabled={pending}><CheckCircle2 size={16} aria-hidden="true"/>אישור חריג</Button>}<Button onClick={onEdit} disabled={protectedBase || pending} disabledReason={protectedBase ? 'חוזה הבסיס מוגן' : undefined} aria-label="ערוך"><Edit2 size={16} aria-hidden="true"/>ערוך</Button><Button variant="danger" onClick={onDelete} disabled={protectedBase || pending} disabledReason={protectedBase ? 'חוזה הבסיס מוגן' : undefined} aria-label="מחק"><Trash2 size={16} aria-hidden="true"/>מחק</Button></div>;
}
export function LedgerForm({ form, setForm, onSave, onCancel, formatCurrency, pending, error }: {
    form: LedgerFormState;
    setForm(form: LedgerFormState): void;
    onSave(): void;
    onCancel(): void;
    formatCurrency(value: number): string;
    pending: boolean;
    error?: string | null;
}) {
    const typeId = useId(), update = (field: string, value: unknown) => setForm({ ...form, [field]: value });
    return <div className="ti-ledger-form"><div className="ti-field"><label className="ti-field__label" htmlFor={typeId}>סוג שורה</label><select id={typeId} className="ti-select" value={form.type || 'PENDING_VO'} onChange={event => update('type', event.target.value)}>{form.type === 'SENT_VO' && <option value="SENT_VO" disabled>נשלח לדרישה</option>}<option value="PENDING_VO">חריג לבדיקה</option><option value="APPROVED_VO">חריג מאושר</option></select></div><Field label="קוד סעיף" value={form.item_code ?? ''} onChange={event => update('item_code', event.target.value)} dir="ltr"/><Field label="תיאור העבודה" value={form.description ?? ''} onChange={event => update('description', event.target.value)}/><Field label="יחידה" value={form.unit ?? ''} onChange={event => update('unit', event.target.value)}/><Field label="כמות" type="number" step="any" value={form.quantity ?? ''} onChange={event => update('quantity', parseFloat(event.target.value) || 0)}/><Field label="מחיר יחידה ללא מע״מ" type="number" step="any" value={form.unit_price_excl_vat ?? ''} onChange={event => update('unit_price_excl_vat', parseFloat(event.target.value) || 0)}/><p className="ti-copy">סכום לפי הנתונים בטופס: <BidiText kind="money" value={totalKnown(form) ? formatCurrency(getLedgerRowAmount(form)) : '—'}/></p>{error && <Feedback tone="danger">{error}</Feedback>}<div className="ti-dialog__footer"><Button onClick={onCancel} disabled={pending}>ביטול</Button><Button variant="primary" onClick={onSave} pending={pending} busyLabel="שומר…" disabled={!form.description?.trim()} disabledReason={!form.description?.trim() ? 'נדרש תיאור עבודה' : undefined}>שמירת שורה</Button></div></div>;
}
function useLatestCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
    const latest = useRef(callback);
    useEffect(() => { latest.current = callback; }, [callback]);
    return React.useCallback((...args: Args) => latest.current(...args), []);
}
interface LedgerRowProps {
    item: LedgerItem;
    rowIndex: number;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
    formatCurrency: (value: number) => string;
    onDetails: (item: LedgerItem) => void;
    onAction: (id: string, origin: HTMLElement) => void;
}
const LedgerRowShell = React.memo(function LedgerRowShell({ item, rowIndex, isSelected, onToggleSelect, formatCurrency, onDetails, onAction }: LedgerRowProps) { const definition = LEDGER_ROW_TYPES.find(type => type.value === item.type), base = item.type === 'BASE_CONTRACT', quantity = knownNumber(item.quantity), price = knownNumber(item.unit_price_excl_vat); return <tr key={item.id} aria-rowindex={rowIndex} data-ledger-row={item.id} data-ledger-type={item.type} data-selected={isSelected || undefined} data-base-protected={base || undefined} style={{ height: 80 }}><td><input type="checkbox" aria-label={`בחירת שורה ${item.item_code || item.id}`} checked={isSelected} disabled={!isLedgerRowSelectable(item)} onChange={() => { if (isLedgerRowSelectable(item))
    onToggleSelect(item.id); }}/></td><td><StatusChip tone={base ? 'neutral' : item.type === 'APPROVED_VO' ? 'success' : item.type === 'PENDING_VO' ? 'warning' : 'info'}>{definition?.label || 'סוג לא צוין'}</StatusChip></td><td><BidiText kind="code" value={item.item_code || '—'}/></td><td><span className="ti-ledger-description" title={item.description}>{item.description}</span>{item.ai_rationale && <span className="ti-meta">יש הסבר שמור</span>}</td><td>{item.unit || '—'}</td><td><BidiText kind="code" value={quantity === null ? '—' : String(quantity)}/></td><td><BidiText kind="money" value={price === null ? '—' : formatCurrency(price)}/></td><td><BidiText kind="money" value={totalKnown(item) ? formatCurrency(getLedgerRowAmount(item)) : '—'}/></td><td><div className="ti-ledger-row-actions"><Button variant="text" aria-label={`מקור ופרטים ${item.item_code || item.id}`} onClick={() => { onDetails(item); }}><Eye size={16} aria-hidden="true"/></Button><Button variant="text" aria-label={`פעולות שורה ${item.item_code || item.id}`} onClick={event => { onAction(item.id, event.currentTarget); }}><MoreHorizontal size={16} aria-hidden="true"/></Button></div></td></tr>; });
function PricingLedgerTable(props: PricingLedgerTableProps) {
    const { ledgerItems, isLoading, isAddingNew, isEditing, newItemForm, setNewItemForm, editForm, setEditForm, selectedLedgerIds, toggleSelectItem, toggleSelectAll, handleAddNew, setIsAddingNew, handleSaveEdit, handleCancelEdit, approveVO, handleEditClick, handleDelete, formatCurrency, errorMessage } = props;
    const scroll = useRef<HTMLDivElement>(null), frame = useRef<number | null>(null), [scrollTop, setScrollTop] = useState(0), [height, setHeight] = useState(0), [actionId, setActionId] = useState<string | null>(null), [detailItem, setDetailItem] = useState<LedgerItem | null>(null), [pending, setPending] = useState(false), [actionError, setActionError] = useState<string | null>(null), [sourceError, setSourceError] = useState<string | null>(null);
    const actionOrigin = useRef<HTMLElement | null>(null), wasEditing = useRef(false);
    useEffect(() => { if (wasEditing.current && !isEditing) {
        const origin = actionOrigin.current;
        requestAnimationFrame(() => { if (origin?.isConnected)
            origin.focus();
        else
            scroll.current?.focus(); });
    } wasEditing.current = Boolean(isEditing); }, [isEditing]);
    const stableToggleSelectItem = useLatestCallback(toggleSelectItem), stableFormatCurrency = useLatestCallback(formatCurrency);
    const showDetails = useLatestCallback((item: LedgerItem) => { setSourceError(null); setDetailItem(item); });
    const showActions = useLatestCallback((id: string, origin: HTMLElement) => { actionOrigin.current = origin; setActionError(null); setActionId(id); });
    const selected = useMemo(() => new Set(selectedLedgerIds), [selectedLedgerIds]), selectable = useMemo(() => ledgerItems.filter(isLedgerRowSelectable), [ledgerItems]);
    const allSelected = selectable.length > 0 && selectable.every(item => selected.has(item.id)), virtualized = ledgerItems.length > VIRTUALIZATION_THRESHOLD;
    useEffect(() => { const node = scroll.current; if (!node)
        return; const update = () => setHeight(node.clientHeight || 960); update(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update); observer?.observe(node); return () => { observer?.disconnect(); if (frame.current !== null)
        cancelAnimationFrame(frame.current); }; }, []);
    useEffect(() => { if (scroll.current)
        setScrollTop(scroll.current.scrollTop); }, [ledgerItems.length]);
    const windowMetrics = useMemo(() => virtualized ? calculateFixedVirtualWindow({ itemCount: ledgerItems.length, scrollTop, viewportHeight: height, rowHeight: 80, overscan: 8, fallbackVisibleRows: 12 }) : { startIndex: 0, endIndex: ledgerItems.length, topPadding: 0, bottomPadding: 0 }, [ledgerItems.length, scrollTop, height, virtualized]);
    const visible = ledgerItems.slice(windowMetrics.startIndex, windowMetrics.endIndex), actionItem = ledgerItems.find(item => item.id === actionId), editingItem = ledgerItems.find(item => item.id === isEditing), canEdit = Boolean(isEditing && editingItem && editingItem.type !== 'BASE_CONTRACT');
    const execute = async (operation: () => unknown) => { setPending(true); setActionError(null); try {
        await operation();
    }
    catch {
        setActionError('הפעולה לא הושלמה. בדוק את הנתונים ונסה שוב.');
    }
    finally {
        setPending(false);
    } };
    const openSource = async (documentId: string, page: number | null) => { if (!detailItem?.project_id) {
        setSourceError('לא נמצא פרויקט משויך למקור הזה.');
        return;
    } setSourceError(null); try {
        const params = new URLSearchParams({ projectId: detailItem.project_id, documentId });
        const response = await fetch('/api/documents/signed-url?' + params.toString()), data = await response.json();
        if (!response.ok || !data.signedUrl)
            throw Error('SOURCE_UNAVAILABLE');
        const suffix = page ? (data.previewKind === 'reference' ? '&page=' : '#page=') + page : '';
        window.open(data.signedUrl + suffix, '_blank', 'noopener,noreferrer');
    }
    catch {
        setSourceError('לא ניתן לפתוח את המקור כרגע. הרישום הכספי לא השתנה.');
    } };
    return <div className="ti-ledger-table-frame" data-virtualized={String(virtualized)}><div ref={scroll} className="ti-ledger-scroll" tabIndex={0} role="region" aria-label="טבלת התמחור · גלילה אופקית ואנכית" onScroll={event => { if (!virtualized)
        return; const top = event.currentTarget.scrollTop; if (frame.current !== null)
        cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => { setScrollTop(top); frame.current = null; }); }}><table className="ti-table ti-ledger-table" aria-rowcount={ledgerItems.length + 1} dir="rtl" style={{ minWidth: 1256 }}><colgroup>{widths.map((width, index) => <col key={index} style={{ width }}/>)}</colgroup><thead><tr>{labels.map((label, index) => <th key={label}>{index === 0 ? <input type="checkbox" aria-label="בחירת השורות המוצגות המותרות לבחירה" checked={allSelected} disabled={!selectable.length} onChange={toggleSelectAll}/> : label}</th>)}</tr></thead><tbody>{isLoading ? <tr><td colSpan={9}><p role="status">טוען נתוני תמחור…</p></td></tr> : !ledgerItems.length ? <tr><td colSpan={9}><p className="ti-copy">אין שורות בסינון הנוכחי. אפשר לשנות סינון או להוסיף שורה.</p></td></tr> : <>{windowMetrics.topPadding > 0 && <tr aria-hidden="true"><td colSpan={9} style={{ height: windowMetrics.topPadding, padding: 0 }}/></tr>}{visible.map((item, index) => <LedgerRowShell key={item.id} item={item} rowIndex={windowMetrics.startIndex + index + 2} isSelected={selected.has(item.id)} onToggleSelect={stableToggleSelectItem} formatCurrency={stableFormatCurrency} onDetails={showDetails} onAction={showActions}/>)}{windowMetrics.bottomPadding > 0 && <tr aria-hidden="true"><td colSpan={9} style={{ height: windowMetrics.bottomPadding, padding: 0 }}/></tr>}</>}</tbody></table></div>
 <Dialog open={Boolean(actionItem)} labelledBy="ledger-actions-title" onClose={() => { if (!pending)
        setActionId(null); }}><h2 id="ledger-actions-title" className="ti-section-title">פעולות שורה <BidiText kind="code" value={actionItem?.item_code || '—'}/></h2><p className="ti-copy">{actionItem?.description}</p>{(actionError || errorMessage) && <Feedback tone="danger">{actionError || errorMessage}</Feedback>}{actionItem && <LedgerActionControls item={actionItem} pending={pending} onEdit={() => { if (actionItem.type === 'BASE_CONTRACT')
        return; setActionId(null); handleEditClick(actionItem); }} onDelete={() => { if (actionItem.type === 'BASE_CONTRACT')
        return; void execute(() => handleDelete(actionItem.id)); }} onApprove={() => { if (actionItem.type !== 'PENDING_VO')
        return; void execute(() => approveVO(actionItem.id)); }}/>}<div className="ti-dialog__footer"><Button onClick={() => setActionId(null)} disabled={pending}>סגירה</Button></div></Dialog>
 <Dialog open={isAddingNew || Boolean(canEdit)} labelledBy="ledger-form-title" onClose={() => { if (pending)
        return; if (isAddingNew)
        setIsAddingNew(false);
    else
        handleCancelEdit(); }}><h2 id="ledger-form-title" className="ti-section-title">{isAddingNew ? 'הוספת שורה' : 'עריכת שורה'}</h2><LedgerForm form={isAddingNew ? newItemForm : editForm} setForm={isAddingNew ? setNewItemForm : setEditForm} onSave={() => void execute(isAddingNew ? handleAddNew : handleSaveEdit)} onCancel={() => { if (isAddingNew)
        setIsAddingNew(false);
    else
        handleCancelEdit(); }} formatCurrency={formatCurrency} pending={pending} error={actionError || errorMessage}/></Dialog>
 <Dialog open={Boolean(detailItem)} labelledBy="ledger-source-title" onClose={() => setDetailItem(null)}><header className="ti-dialog__header"><h2 id="ledger-source-title" className="ti-section-title">מקורות ופרטי השורה</h2><Button onClick={() => setDetailItem(null)}>סגירה</Button></header>{sourceError && <Feedback tone="warning">{sourceError}</Feedback>}{detailItem && <LedgerSourceDetails item={detailItem as PricingLedgerItem} onOpenSource={openSource}/>}</Dialog>
 </div>;
}
export default React.memo(PricingLedgerTable);
