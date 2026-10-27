"use client";

import {useMemo, useRef, useState} from 'react';
import {Database, FileText, Trash2, Upload} from 'lucide-react';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Button} from '@/components/ui/titanium/Button';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Field} from '@/components/ui/titanium/Field';
import {Panel} from '@/components/ui/titanium/Panel';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
import type {PricelistItemRecord, PricelistRecord} from './PricelistsPageClient';

export interface PricelistsCatalogViewProps {
    pricelists: readonly PricelistRecord[];
    selectedPricelist: PricelistRecord | null;
    items: readonly PricelistItemRecord[];
    searchTerm: string;
    hasMore: boolean;
    isLoadingItems: boolean;
    isUploading: boolean;
    uploadProgress: {current: number; total: number; step: string} | null;
    notice: {type: 'success' | 'error'; message: string} | null;
    totalItems?: number;
    catalogLoading?: boolean;
    catalogError?: string | null;
    itemError?: string | null;
    onUpload(files: File[]): Promise<void>;
    onSelect(record: PricelistRecord): void;
    onClose(): void;
    onSearch(value: string): void;
    onLoadMore(): Promise<void>;
    onRetryItems?(): Promise<void>;
    onRetryCatalog?(): Promise<void>;
    onDelete(id: string, name: string): Promise<void>;
}

interface ItemsProps {
    pricelist: PricelistRecord;
    items: readonly PricelistItemRecord[];
    searchTerm: string;
    hasMore: boolean;
    isLoadingItems: boolean;
    totalItems?: number;
    itemError?: string | null;
    onSearch(value: string): void;
    onClose(): void;
    onLoadMore(): Promise<void>;
    onRetryItems?(): Promise<void>;
}

const count = (record: PricelistRecord): number => record.item_count ?? record.pricelist_items?.[0]?.count ?? 0;
const date = (value: string): string => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('he-IL') : '—';
const number = new Intl.NumberFormat('he-IL');

export function PricelistItemsView({pricelist, items, searchTerm, hasMore, isLoadingItems, totalItems, itemError, onSearch, onClose, onLoadMore, onRetryItems}: ItemsProps): React.JSX.Element {
    const notesByItem = useMemo(() => {
        const seen: PricelistItemRecord[] = [];
        return new Map(items.map(item => {
            if (item.item_type === 'NOTE') seen.unshift(item);
            return [item.id, seen.find(note => item.item_code.startsWith(note.item_code.split('.').slice(0, 2).join('.')))];
        }));
    }, [items]);

    return <section className="ti-pricelist-inspection">
        <header className="ti-dialog__header">
            <div><h2 id="pricelist-title" className="ti-title"><BidiText kind="file" value={pricelist.name}/></h2><p className="ti-subtitle">סעיפי המחיר וההערות שנשמרו במערכת</p></div>
            <Button onClick={onClose}>סגירה</Button>
        </header>
        <Field type="search" label="חיפוש בתיאור או בקוד סעיף" value={searchTerm} onChange={event => onSearch(event.target.value)}/>
        <p className="ti-meta">החיפוש כולל שורות הערה. הערה אינה מחיר; יש לקרוא את התנאים וההקשר לפני שימוש בסעיף.</p>
        {itemError && <Feedback tone="danger">{itemError}</Feedback>}
        <div className="ti-pricelist-scroll" role="region" aria-label="סעיפי המחירון · גלילה אופקית" tabIndex={0} aria-busy={isLoadingItems}>
            <table className="ti-pricelist-items">
                <colgroup>{[136, 320, 80, 160].map(width => <col key={width} style={{width}}/>)}</colgroup>
                <thead><tr>{['קוד סעיף', 'תיאור', 'יחידה', 'מחיר יחידה ללא מע״מ'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{items.map(item => {
                    const kind = item.item_type || 'ITEM';
                    const structural = ['CHAPTER', 'SUBCHAPTER', 'NOTE'].includes(kind);
                    const knownPrice = typeof item.rate === 'number' && Number.isFinite(item.rate);
                    const governingNote = notesByItem.get(item.id);
                    return <tr key={item.id} data-item-id={item.id} data-item-type={kind}>
                        <td><BidiText kind="code" value={item.item_code || '—'}/>{structural && <StatusChip tone={kind === 'NOTE' ? 'warning' : 'neutral'}>{kind === 'CHAPTER' ? 'פרק' : kind === 'SUBCHAPTER' ? 'תת־פרק' : 'הערה'}</StatusChip>}</td>
                        <td colSpan={structural ? 3 : undefined}>
                            <p className="ti-preserve-lines">{item.description}</p>
                            {!structural && governingNote && <details className="ti-pricelist-note"><summary>הערה סמוכה בפרק · <BidiText kind="code" value={governingNote.item_code}/></summary><blockquote className="ti-preserve-lines">{governingNote.description}</blockquote></details>}
                        </td>
                        {!structural && <><td><BidiText kind="file" value={item.unit || '—'}/></td><td className="ti-pricelist-rate"><BidiText kind="money" value={knownPrice ? number.format(item.rate) + ' ₪' : '—'}/>{item.rate === 0 && <p className="ti-meta">אפס שמור; יש לבדוק במקור</p>}</td></>}
                    </tr>;
                })}</tbody>
            </table>
        </div>
        {isLoadingItems && <Feedback aria-live="polite"><span className="ti-spinner" aria-hidden="true"/>טוען סעיפים…</Feedback>}
        {!isLoadingItems && !itemError && items.length === 0 && <Feedback title="לא נמצאו סעיפים">{searchTerm ? 'אפשר לשנות את החיפוש ולנסות שוב.' : 'אין עדיין סעיפים שמורים במחירון הזה.'}</Feedback>}
        <footer className="ti-pricelist-inspection__footer"><p className="ti-meta">נטענו <BidiText kind="code" value={number.format(items.length)}/> מתוך <BidiText kind="code" value={number.format(totalItems ?? count(pricelist))}/> שורות · מחירים ללא מע״מ</p>{(hasMore || itemError) && <Button onClick={() => void (itemError && onRetryItems ? onRetryItems() : onLoadMore())} pending={isLoadingItems} busyLabel="טוען סעיפים…">{itemError ? 'ניסיון נוסף לטעינת הסעיפים' : 'טעינת סעיפים נוספים'}</Button>}</footer>
    </section>;
}

export function PricelistsCatalogView(props: PricelistsCatalogViewProps): React.JSX.Element {
    const {pricelists, selectedPricelist, items, searchTerm, hasMore, isLoadingItems, isUploading, uploadProgress, notice, catalogLoading, catalogError, itemError, totalItems, onUpload, onSelect, onClose, onSearch, onLoadMore, onRetryItems, onRetryCatalog, onDelete} = props;
    const fileInput = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<PricelistRecord | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const hasRowProgress = Boolean(uploadProgress && uploadProgress.total > 0 && /מכין נתונים|שומר נתונים/.test(uploadProgress.step));
    const upload = async (files: File[]): Promise<void> => {
        if (isUploading || !files.length) return;
        setLocalError(null);
        try { await onUpload(files); }
        catch { setLocalError('הייבוא לא הושלם. אפשר לבדוק את הקובץ ולנסות שוב.'); }
        finally { if (fileInput.current) fileInput.current.value = ''; }
    };
    const remove = async (): Promise<void> => {
        if (!deleteTarget || deleting) return;
        setDeleting(true); setLocalError(null);
        try { await onDelete(deleteTarget.id, deleteTarget.name); setDeleteTarget(null); }
        catch { setLocalError('מחיקת המחירון לא הושלמה. הנתונים נשארו לתצוגה.'); }
        finally { setDeleting(false); }
    };

    return <div className="ti-page ti-pricelists" dir="rtl">
        <header className="ti-page-heading"><div><p className="ti-eyebrow">מקורות מחיר</p><h1 className="ti-title">מחירונים</h1><p className="ti-subtitle">סעיפים, יחידות והערות מתוך המחירונים השמורים</p></div><StatusChip tone="neutral">{catalogLoading ? 'טוען…' : catalogError && !pricelists.length ? 'לא נטען' : `${pricelists.length} מחירונים`}</StatusChip></header>
        <Panel className={`ti-pricelists-upload ${dragging ? 'ti-pricelists-upload--dragging' : ''}`}>
            <div onDragOver={event => {event.preventDefault(); if (!isUploading) setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={event => {event.preventDefault();setDragging(false);void upload(Array.from(event.dataTransfer.files));}}>
                <Upload size={24} aria-hidden="true"/><h2 className="ti-section-title">הוספת מחירון</h2><p className="ti-copy">גררו קובץ לכאן או בחרו קובץ. אפשר להעלות Excel, PDF או תמונה.</p>
                <input hidden type="file" ref={fileInput} accept=".xls,.xlsx,.pdf,image/*" disabled={isUploading} onChange={event => void upload(Array.from(event.target.files || []))}/>
                <Button variant="primary" pending={isUploading} busyLabel="מעלה מחירון…" onClick={() => fileInput.current?.click()}>בחירת קובץ מחירון</Button>
                {isUploading && <div role="status" className="ti-pricelists-upload__progress"><p>{uploadProgress?.step.replace(/\s*\(Gemini\)/g, '') || 'העלאת המחירון מתבצעת…'}</p>{uploadProgress && hasRowProgress && <><progress aria-label="התקדמות העלאת מחירון" max={uploadProgress.total} value={uploadProgress.current}/><p className="ti-meta">{uploadProgress.current} מתוך {uploadProgress.total} שורות</p></>}</div>}
            </div>
        </Panel>
        {notice && <Feedback tone={notice.type === 'error' ? 'danger' : 'success'}>{notice.message}</Feedback>}
        {localError && !deleteTarget && <Feedback tone="danger">{localError}</Feedback>}
        {catalogError && <Feedback tone="danger"><span>{catalogError}</span>{onRetryCatalog && <Button onClick={() => void onRetryCatalog()}>ניסיון נוסף</Button>}</Feedback>}
        <section className="ti-pricelists-catalog" aria-label="מחירונים שמורים" aria-busy={catalogLoading}>
            <h2 className="ti-section-title">המחירונים השמורים</h2>
            {catalogLoading && <Feedback aria-live="polite">טוען מחירונים…</Feedback>}
            {!catalogLoading && !catalogError && pricelists.length === 0 && <Feedback title="אין עדיין מחירונים">אפשר להוסיף מחירון ולבדוק את הסעיפים שנקראו ממנו.</Feedback>}
            {pricelists.map(record => <Panel key={record.id} className="ti-pricelist-card">
                <Database size={24} aria-hidden="true"/><div className="ti-pricelist-card__name"><h3 className="ti-section-title"><BidiText kind="file" value={record.name}/></h3><p className="ti-meta"><BidiText kind="date" value={date(record.created_at)}/>{record.is_global ? ' · מחירון כללי' : ' · מחירון הפרויקט'}</p></div>
                <div className="ti-pricelist-card__counts"><strong><BidiText kind="code" value={number.format(count(record))}/></strong><span className="ti-meta"> שורות במקור</span>{record.item_row_count !== undefined && <p className="ti-meta">{number.format(record.item_row_count)} סעיפי מחיר · {number.format(record.structural_row_count ?? 0)} כותרות והערות</p>}</div>
                <div className="ti-actions"><Button onClick={() => onSelect(record)} aria-label={`פתיחת מחירון ${record.name}`}><FileText size={16} aria-hidden="true"/>צפייה בסעיפים</Button>{!record.is_global && <Button variant="danger" aria-label={`מחיקת מחירון ${record.name}`} disabled={isUploading} onClick={() => {setLocalError(null);setDeleteTarget(record);}}><Trash2 size={16} aria-hidden="true"/>מחיקה</Button>}</div>
            </Panel>)}
        </section>
        <Dialog open={Boolean(selectedPricelist)} labelledBy="pricelist-title" className="ti-dialog--wide ti-pricelist-dialog" onClose={onClose}>
            {selectedPricelist && <PricelistItemsView pricelist={selectedPricelist} items={items} searchTerm={searchTerm} hasMore={hasMore} isLoadingItems={isLoadingItems} totalItems={totalItems} itemError={itemError} onSearch={onSearch} onLoadMore={onLoadMore} onRetryItems={onRetryItems} onClose={onClose}/>}
        </Dialog>
        <Dialog open={Boolean(deleteTarget)} labelledBy="pricelist-delete-title" className="ti-dialog--compact" onClose={() => {if (!deleting) setDeleteTarget(null);}}>
            {deleteTarget && <><header className="ti-dialog__header"><h2 id="pricelist-delete-title" className="ti-section-title">מחיקת מחירון</h2></header><p className="ti-copy">המחירון <BidiText kind="file" value={deleteTarget.name}/> וכל סעיפיו יימחקו מהמערכת.</p>{localError && <Feedback tone="danger">{localError}</Feedback>}<div className="ti-actions"><Button disabled={deleting} onClick={() => setDeleteTarget(null)}>ביטול</Button><Button variant="danger" pending={deleting} busyLabel="מוחק מחירון…" onClick={() => void remove()}>מחיקת המחירון וסעיפיו</Button></div></>}
        </Dialog>
    </div>;
}
