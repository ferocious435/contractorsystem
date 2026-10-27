"use client";
import React from 'react';
import { ChevronDown, FileText, RefreshCw, Trash2, Eye } from 'lucide-react';
import { getEvidenceDisplayStatus } from '@/utils/radar-evidence-status';
import type { ContradictionItem } from '@/types';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { StatusChip } from '@/components/ui/titanium/StatusChip';
const WorkChangeReviewPanel = React.lazy(() => import('./WorkChangeReviewPanel'));
interface PendingQueueTableProps {
    compactTools?: React.ReactNode;
    items: ContradictionItem[];
    selectedIds?: string[];
    onToggleSelection?: (id: string) => void;
    onSelectAll?: (ids: string[]) => void;
    onSelectForEstimation: (item: ContradictionItem) => void;
    onRescan?: (item: ContradictionItem) => Promise<void>;
    onBulkRescan?: (ids: string[]) => Promise<void>;
    onBulkDelete?: (ids: string[]) => Promise<void>;
    scanningItems?: string[];
    getConfidencePercent?: (item: ContradictionItem) => string | null;
}
const QUEUE_ROW_VIRTUALIZATION_THRESHOLD = 500;
const QUEUE_ITEM_ROW_HEIGHT = 80;
const QUEUE_GROUP_ROW_HEIGHT = 44;
const QUEUE_VIRTUAL_OVERSCAN = 8;
type EvidenceRecord = Record<string, unknown>;
function isEvidenceRecord(value: unknown): value is EvidenceRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function getEvidenceRecord(value: unknown): EvidenceRecord | undefined {
    return isEvidenceRecord(value) ? value : undefined;
}
type PendingQueueRenderRow = {
    kind: 'group';
    sourceTitle: string;
    groupItems: ContradictionItem[];
    groupIdx: number;
    height: number;
} | {
    kind: 'item';
    item: ContradictionItem;
    groupIdx: number;
    itemIdx: number;
    height: number;
};
interface PendingQueueVirtualMetric {
    row: PendingQueueRenderRow;
    offset: number;
    height: number;
}
function findFirstVirtualRowIndex(metrics: PendingQueueVirtualMetric[], targetOffset: number) {
    let low = 0;
    let high = metrics.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const rowBottom = metrics[mid].offset + metrics[mid].height;
        if (rowBottom < targetOffset) {
            low = mid + 1;
        }
        else {
            high = mid;
        }
    }
    return low;
}
function findFirstVirtualRowAfterOffset(metrics: PendingQueueVirtualMetric[], targetOffset: number) {
    let low = 0;
    let high = metrics.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (metrics[mid].offset <= targetOffset) {
            low = mid + 1;
        }
        else {
            high = mid;
        }
    }
    return low;
}
function getEvidenceSummary(evidenceData: unknown) {
    if (Array.isArray(evidenceData)) {
        return {
            hasEvidence: evidenceData.length > 0,
            verified: false,
            label: `קישורי מקור: ${evidenceData.length}`,
            detail: 'נמצאו קישורי מקור לפריט הזה.'
        };
    }
    const evidenceRecord = getEvidenceRecord(evidenceData);
    const pricingEvaluation = getEvidenceRecord(evidenceRecord?.pricing_evaluation);
    const linkedIds = Array.isArray(evidenceRecord?.linked_ids) ? evidenceRecord.linked_ids : [];
    const hasQuoteEvidence = Boolean(evidenceRecord?.contract_quote || evidenceRecord?.work_quote);
    const missingCount = Array.isArray(evidenceRecord?.missing_evidence) ? evidenceRecord.missing_evidence.length : 0;
    const hasPricingTrace = Boolean(pricingEvaluation?.match_quality || pricingEvaluation?.source);
    const isVerified = getEvidenceDisplayStatus(evidenceRecord) === 'SOURCE_VERIFIED';
    return {
        hasEvidence: hasQuoteEvidence || missingCount > 0 || hasPricingTrace || linkedIds.length > 0,
        verified: isVerified,
        label: isVerified ? 'ראיות מאומתות' : 'דורש אימות',
        detail: pricingEvaluation?.match_quality === 'ZERO_MATCH'
            ? 'לא נמצא סעיף ישיר. נדרש אימות לפני דרישה.'
            : missingCount > 0
                ? `חסרים מקורות/בדיקות: ${missingCount}`
                : 'קיים קישור למקור או לתמחור.'
    };
}
const PendingQueueGroupHeader = React.memo(function PendingQueueGroupHeader({ sourceTitle, itemCount, isCollapsed, onToggle }: {
    sourceTitle: string;
    itemCount: number;
    isCollapsed: boolean;
    onToggle: (title: string) => void;
}) {
    return <tr className="ti-queue-group"><td colSpan={6}><button type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(sourceTitle)}><ChevronDown size={16} aria-hidden="true" style={{ transform: isCollapsed ? 'rotate(-90deg)' : undefined }}/><FileText size={16} aria-hidden="true"/><BidiText kind="file" value={sourceTitle}/><span className="ti-meta">({itemCount})</span><span className="ti-sr-only">{isCollapsed ? 'הרחב מקור' : 'צמצם מקור'}</span></button></td></tr>;
});
interface QueueRowProps {
    item: ContradictionItem;
    groupIdx: number;
    itemIdx: number;
    isSelected: boolean;
    isScanning: boolean;
    confidencePercent: string | null;
    onToggleSelection?: (id: string) => void;
    onSelectForEstimation: (item: ContradictionItem) => void;
    onRescan?: (item: ContradictionItem) => void;
    onDetails: (item: ContradictionItem) => void;
    onReview: (item: ContradictionItem) => void;
}
const PendingQueueRow = React.memo(function PendingQueueRow({ item, groupIdx, itemIdx, isSelected, isScanning, confidencePercent, onToggleSelection, onSelectForEstimation, onRescan, onDetails, onReview }: QueueRowProps) {
    const summary = getEvidenceSummary(item.evidence_data);
    return <tr data-queue-row={item.id} data-selected={isSelected || undefined} aria-busy={isScanning || undefined}>
  <td><input type="checkbox" aria-label={'בחירת פריט: ' + item.title} checked={isSelected} disabled={!onToggleSelection} onChange={() => onToggleSelection?.(item.id)}/></td>
  <td><BidiText kind="code" value={(groupIdx + 1) + '-' + (itemIdx + 1)}/></td>
  <td><div className="ti-queue-priority"><StatusChip tone={item.severity === 'HIGH' ? 'danger' : item.severity === 'MEDIUM' ? 'warning' : 'neutral'}>{item.severity === 'HIGH' ? 'עדיפות גבוהה' : item.severity === 'MEDIUM' ? 'עדיפות בינונית' : 'עדיפות רגילה'}</StatusChip>{confidencePercent && <span className="ti-meta">Confidence <BidiText kind="percent" value={confidencePercent}/></span>}</div></td>
  <td><button type="button" className="ti-queue-description" aria-label={'פרטי פריט: ' + item.title} onClick={() => onDetails(item)}><strong>{item.title}</strong><span>{item.description}</span></button></td>
  <td><Button variant="text" aria-label={'מקורות: ' + item.title} onClick={() => onDetails(item)}><Eye size={16} aria-hidden="true"/>{summary.verified ? 'מקור מאומת' : summary.hasEvidence ? 'לבדיקה' : 'אין מקור'}</Button></td>
  <td><div className="ti-queue-row-actions"><Button aria-label={'בדיקת מסמכי השינוי: ' + item.title} onClick={() => onReview(item)}>בדיקת שינוי</Button><Button variant="text" aria-label={'סריקה חוזרת: ' + item.title} pending={isScanning} busyLabel="סורק…" disabled={!onRescan} onClick={() => onRescan?.(item)}><RefreshCw size={16} aria-hidden="true"/></Button><Button variant="primary" aria-label={'תמחור: ' + item.title} onClick={() => onSelectForEstimation(item)}>תמחור</Button></div></td>
 </tr>;
});
function QueueSourceDetails({ item }: {
    item: ContradictionItem;
}) {
    const evidence = getEvidenceRecord(item.evidence_data), summary = getEvidenceSummary(item.evidence_data), linkedIds = Array.isArray(evidence?.linked_ids) ? evidence.linked_ids : [], missing = Array.isArray(evidence?.missing_evidence) ? evidence.missing_evidence : [];
    return <div className="ti-ledger-source"><h3 className="ti-section-title">{item.title}</h3><p className="ti-copy ti-preserve-lines">{item.description}</p><p className="ti-copy">מסמך מקור: <BidiText kind="file" value={item.source_execution_doc?.title || 'לא צוין'}/></p><Feedback tone={summary.verified ? 'info' : 'warning'}>{summary.label} · {summary.detail}</Feedback><p className="ti-meta">קונפליקטים מקושרים: {linkedIds.length}</p>{linkedIds.length > 0 && <p className="ti-copy">{linkedIds.map(String).join(' · ')}</p>}{missing.length > 0 && <div><h4 className="ti-section-title">בדיקות ומקורות חסרים</h4>{missing.map((value, index) => <p className="ti-copy" key={index}>{typeof value === 'string' ? value : JSON.stringify(value)}</p>)}</div>}{[['contract_quote', 'ציטוט חוזה'], ['work_quote', 'ציטוט ביצוע']].map(([key, label]) => typeof evidence?.[key] === 'string' && evidence[key] ? <div key={key} className="ti-ledger-quote"><h4>{label}</h4><blockquote>{String(evidence[key])}</blockquote></div> : null)}{!summary.verified && <p className="ti-copy">קישור למקור אינו אישור כספי. יש לבדוק את המקורות ואת המחיר לפני דרישה.</p>}</div>;
}
function PendingQueueTable({ items, selectedIds = [], onToggleSelection, onSelectAll, onSelectForEstimation, onRescan, onBulkRescan, onBulkDelete, scanningItems = [], getConfidencePercent,compactTools }: PendingQueueTableProps) {
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const scrollFrameRef = React.useRef<number | null>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(0);
    const [collapsedGroups, setCollapsedGroups] = React.useState<string[]>([]);
    const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
    const scanningItemIdSet = React.useMemo(() => new Set(scanningItems), [scanningItems]);
    const collapsedGroupSet = React.useMemo(() => new Set(collapsedGroups), [collapsedGroups]);
    const shouldVirtualizeRows = items.length > QUEUE_ROW_VIRTUALIZATION_THRESHOLD;
    const toggleGroup = React.useCallback((title: string) => {
        setCollapsedGroups(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);
    }, []);
    const groupedItems = React.useMemo(() => items.reduce((acc, item) => {
        const sourceTitle = item.source_execution_doc?.title || 'מסמכים כלליים';
        if (!acc[sourceTitle]) {
            acc[sourceTitle] = [];
        }
        acc[sourceTitle].push(item);
        return acc;
    }, {} as Record<string, ContradictionItem[]>), [items]);
    const groupedEntries = React.useMemo(() => Object.entries(groupedItems), [groupedItems]);
    const queueRenderRows = React.useMemo<PendingQueueRenderRow[]>(() => (groupedEntries.flatMap(([sourceTitle, groupItems], groupIdx) => {
        const rows: PendingQueueRenderRow[] = [{
                kind: 'group',
                sourceTitle,
                groupItems,
                groupIdx,
                height: QUEUE_GROUP_ROW_HEIGHT,
            }];
        if (collapsedGroupSet.has(sourceTitle)) {
            return rows;
        }
        groupItems.forEach((item, itemIdx) => {
            rows.push({
                kind: 'item',
                item,
                groupIdx,
                itemIdx,
                height: QUEUE_ITEM_ROW_HEIGHT,
            });
        });
        return rows;
    })), [collapsedGroupSet, groupedEntries]);
    const queueVirtualRowMetrics = React.useMemo<PendingQueueVirtualMetric[]>(() => {
        let offset = 0;
        return queueRenderRows.map((row) => {
            const metric = {
                row,
                offset,
                height: row.height,
            };
            offset += row.height;
            return metric;
        });
    }, [queueRenderRows]);
    const totalVirtualHeight = React.useMemo(() => {
        const lastMetric = queueVirtualRowMetrics[queueVirtualRowMetrics.length - 1];
        return lastMetric ? lastMetric.offset + lastMetric.height : 0;
    }, [queueVirtualRowMetrics]);
    const virtualWindow = React.useMemo(() => {
        if (!shouldVirtualizeRows) {
            return {
                visibleRows: queueRenderRows,
                topPadding: 0,
                bottomPadding: 0,
            };
        }
        const effectiveViewportHeight = viewportHeight || QUEUE_ITEM_ROW_HEIGHT * 10;
        const minVisibleOffset = Math.max(0, scrollTop - QUEUE_ITEM_ROW_HEIGHT * QUEUE_VIRTUAL_OVERSCAN);
        const maxVisibleOffset = scrollTop + effectiveViewportHeight + QUEUE_ITEM_ROW_HEIGHT * QUEUE_VIRTUAL_OVERSCAN;
        const startIndex = findFirstVirtualRowIndex(queueVirtualRowMetrics, minVisibleOffset);
        const endIndex = findFirstVirtualRowAfterOffset(queueVirtualRowMetrics, maxVisibleOffset);
        const visibleMetrics = queueVirtualRowMetrics.slice(startIndex, endIndex);
        const firstVisibleMetric = visibleMetrics[0] || null;
        const lastVisibleMetric = visibleMetrics[visibleMetrics.length - 1] || null;
        return {
            visibleRows: visibleMetrics.map((metric) => metric.row),
            topPadding: firstVisibleMetric?.offset || 0,
            bottomPadding: lastVisibleMetric
                ? Math.max(0, totalVirtualHeight - (lastVisibleMetric.offset + lastVisibleMetric.height))
                : 0,
        };
    }, [
        queueRenderRows,
        queueVirtualRowMetrics,
        scrollTop,
        shouldVirtualizeRows,
        totalVirtualHeight,
        viewportHeight,
    ]);
    const confidencePercentById = React.useMemo(() => {
        if (!getConfidencePercent) {
            return new Map<string, string | null>();
        }
        return new Map(items.map((item) => [item.id, getConfidencePercent(item)]));
    }, [getConfidencePercent, items]);
    const [selectionToolsOpen,setSelectionToolsOpen]=React.useState(false);
    const [detailItem, setDetailItem] = React.useState<ContradictionItem | null>(null);
    const [reviewItem, setReviewItem] = React.useState<ContradictionItem | null>(null);
    const [operationError, setOperationError] = React.useState<string | null>(null);
    const [bulkScanning, setBulkScanning] = React.useState(false);
    const reviewOrigin = React.useRef<HTMLElement | null>(null), wasReviewOpen = React.useRef(false);
    React.useEffect(() => { if (wasReviewOpen.current && !reviewItem) {
        const origin = reviewOrigin.current;
        requestAnimationFrame(() => { if (origin?.isConnected)
            origin.focus();
        else
            scrollContainerRef.current?.focus(); });
    } wasReviewOpen.current = Boolean(reviewItem); }, [reviewItem]);
    const closeReview = React.useCallback(() => setReviewItem(null), []);
    const openReview = React.useCallback((item: ContradictionItem) => { reviewOrigin.current = document.activeElement as HTMLElement; setReviewItem(item); }, []);
    const openDetails = React.useCallback((item: ContradictionItem) => setDetailItem(item), []);
    const rescan = React.useCallback((item: ContradictionItem) => { setOperationError(null); void onRescan?.(item).catch(() => setOperationError('הסריקה לא הושלמה. אפשר לנסות שוב.')); }, [onRescan]);
    const queueRowsContent = React.useMemo(() => <>
  {virtualWindow.topPadding > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: virtualWindow.topPadding, padding: 0 }}/></tr>}
  {virtualWindow.visibleRows.map(row => row.kind === 'group' ? <PendingQueueGroupHeader key={'group-' + row.sourceTitle} sourceTitle={row.sourceTitle} itemCount={row.groupItems.length} isCollapsed={collapsedGroupSet.has(row.sourceTitle)} onToggle={toggleGroup}/> : <PendingQueueRow key={row.item.id} item={row.item} groupIdx={row.groupIdx} itemIdx={row.itemIdx} isSelected={selectedIdSet.has(row.item.id)} isScanning={scanningItemIdSet.has(row.item.id)} confidencePercent={confidencePercentById.get(row.item.id) ?? null} onToggleSelection={onToggleSelection} onSelectForEstimation={onSelectForEstimation} onRescan={onRescan ? rescan : undefined} onDetails={openDetails} onReview={openReview}/>)}
  {virtualWindow.bottomPadding > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: virtualWindow.bottomPadding, padding: 0 }}/></tr>}
 </>, [virtualWindow, collapsedGroupSet, toggleGroup, selectedIdSet, scanningItemIdSet, confidencePercentById, onToggleSelection, onSelectForEstimation, onRescan, rescan, openDetails, openReview]);
    const allItemIds = React.useMemo(() => items.map((item) => item.id), [items]);
    const allSelected = React.useMemo(() => allItemIds.length > 0 && allItemIds.every((id) => selectedIdSet.has(id)), [allItemIds, selectedIdSet]);
    const handleSelectAllChange = React.useCallback(() => {
        onSelectAll?.(allSelected ? [] : allItemIds);
    }, [allItemIds, allSelected, onSelectAll]);
    React.useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) {
            return;
        }
        const updateViewportHeight = () => {
            setViewportHeight(container.clientHeight || QUEUE_ITEM_ROW_HEIGHT * 10);
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
        if (!shouldVirtualizeRows) {
            return;
        }
        const nextScrollTop = event.currentTarget.scrollTop;
        if (scrollFrameRef.current !== null) {
            cancelAnimationFrame(scrollFrameRef.current);
        }
        scrollFrameRef.current = requestAnimationFrame(() => {
            setScrollTop(nextScrollTop);
            scrollFrameRef.current = null;
        });
    }, [shouldVirtualizeRows]);
    const bulkActions=<><Button pending={bulkScanning} busyLabel="סורק…" disabled={!onBulkRescan} onClick={async () => { setBulkScanning(true); setOperationError(null); try {
        await onBulkRescan?.(selectedIds);
    }
    catch {
        setOperationError('הסריקה המרוכזת לא הושלמה.');
    }
    finally {
        setBulkScanning(false);
    } }}>סריקה חוזרת לבחירה</Button><Button variant="danger" disabled={!onBulkDelete} onClick={() => { void onBulkDelete?.(selectedIds); }}><Trash2 size={16} aria-hidden="true"/>מחיקת הבחירה</Button><Button variant="text" onClick={() => onSelectAll?.([])}>ביטול בחירה</Button></>;
    return <div className="ti-queue-table-frame" dir="rtl" data-virtualized={String(shouldVirtualizeRows)}>
  <div className="ti-queue-tools-compact">{compactTools}{selectedIds.length>0&&<Button onClick={()=>setSelectionToolsOpen(true)}>בחירה ({selectedIds.length})</Button>}</div>
  {operationError && <Feedback tone="danger">{operationError}</Feedback>}
  {selectedIds.length > 0 && <div className="ti-queue-bulk ti-queue-bulk--wide" aria-label="פעולות בבחירה"><span className="ti-meta">נבחרו {selectedIds.length}</span>{bulkActions}</div>}
  <div ref={scrollContainerRef} className="ti-ledger-scroll" onScroll={handleScroll} role="region" tabIndex={0} aria-label="תור התמחור · גלילה אופקית ואנכית">
   <table className="ti-table ti-queue-table" style={{ minWidth: 1152 }}><colgroup>{[48, 72, 160, 320, 200, 352].map((width, index) => <col key={index} style={{ width }}/>)}</colgroup><thead><tr><th><input type="checkbox" aria-label="בחירת כל הפריטים בתור" checked={allSelected} disabled={!onSelectAll || !items.length} onChange={handleSelectAllChange}/></th><th>פריט</th><th>עדיפות</th><th>תיאור השינוי</th><th>מקורות</th><th>פעולות</th></tr></thead><tbody>{items.length ? queueRowsContent : <tr><td colSpan={6}><p className="ti-copy">אין פריטים שממתינים לתמחור כרגע. אם נוספו מסמכים, יש לבצע סנכרון לפני מסקנה סופית.</p></td></tr>}</tbody></table>
  </div>
  <Dialog open={selectionToolsOpen} labelledBy="queue-selection-title" onClose={()=>setSelectionToolsOpen(false)}><header className="ti-dialog__header"><h2 id="queue-selection-title" className="ti-section-title">פעולות בבחירה ({selectedIds.length})</h2><Button onClick={()=>setSelectionToolsOpen(false)}>סגירה</Button></header><div className="ti-ledger-tool-list">{bulkActions}</div></Dialog>
  <Dialog open={Boolean(detailItem)} labelledBy="queue-source-title" onClose={() => setDetailItem(null)}><header className="ti-dialog__header"><h2 id="queue-source-title" className="ti-section-title">פרטי השינוי והמקורות</h2><Button onClick={() => setDetailItem(null)}>סגירה</Button></header>{detailItem && <QueueSourceDetails item={detailItem}/>}</Dialog>
  {reviewItem && <React.Suspense fallback={<Feedback>טוען בדיקת מקורות…</Feedback>}><WorkChangeReviewPanel findingId={reviewItem.id} projectId={reviewItem.project_id} onClose={closeReview}/></React.Suspense>}
 </div>;
}
export default React.memo(PendingQueueTable);
