"use client";
import React, { useRef, useState } from 'react';
import PendingQueueTable from '@/components/pricing/PendingQueueTable';
import type { ContradictionItem } from '@/types';
import { AI_BULK_APPROVE_CONFIDENCE_THRESHOLD } from '../constants';
import { formatConfidencePercent } from '../utils/aiConfidence';
import type { BulkApprovePreviewResult, PricingContradictionItem, PricingLedgerDerivedState } from '../types';
import { Button } from '@/components/ui/titanium/Button';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { BidiText } from '@/components/ui/titanium/BidiText';
interface QueuePanelProps {
    items: PricingContradictionItem[];
    selectedIds: string[];
    scanningItems: string[];
    confidence: Pick<PricingLedgerDerivedState, 'queueConfidencePercentById' | 'queueConfidenceStats' | 'selectedHighConfidenceQueueIds'>;
    onToggleSelection(id: string): void;
    onSelectAll(ids: string[]): void;
    onSelectForEstimation(item: PricingContradictionItem): void;
    onRescan(item: PricingContradictionItem): Promise<void>;
    onBulkRescan(ids: string[]): Promise<void>;
    onBulkDelete(ids: string[]): Promise<void>;
    onBulkApprove(ids?: string[]): Promise<BulkApprovePreviewResult>;
}
interface BulkFeedback {
    tone: 'info' | 'warning' | 'danger';
    message: string;
    stagedCount: number;
    skippedCount: number;
}
export function buildBulkApproveFeedback(result: BulkApprovePreviewResult, thresholdPercent: string): BulkFeedback { const staged = result.stagedIds || result.approvedIds; return { tone: staged.length ? 'info' : 'warning', message: staged.length ? `הוכנו ${staged.length} פריטים לבחירה לאחר Confidence > ${thresholdPercent}. נדרשת בדיקת מחיר ומקורות לפני אישור כספי.` : `לא הוכנו פריטים מהבחירה לאחר Confidence > ${thresholdPercent}.`, stagedCount: staged.length, skippedCount: result.skippedIds.length }; }
function QueuePanel({ items, selectedIds, scanningItems, confidence, onToggleSelection, onSelectAll, onSelectForEstimation, onRescan, onBulkRescan, onBulkDelete, onBulkApprove }: QueuePanelProps) {
    const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<BulkFeedback | null>(null), inFlight = useRef(false), [deleteIds, setDeleteIds] = useState<string[]>([]), [deleting, setDeleting] = useState(false), [error, setError] = useState<string | null>(null);
    const [toolsOpen,setToolsOpen]=useState(false);
    const threshold = formatConfidencePercent(AI_BULK_APPROVE_CONFIDENCE_THRESHOLD), stats = confidence.queueConfidenceStats;
    const getConfidencePercent = React.useCallback((item: ContradictionItem) => confidence.queueConfidencePercentById.get(item.id) ?? null, [confidence.queueConfidencePercentById]);
    const estimate=React.useCallback((item:ContradictionItem)=>onSelectForEstimation(item as unknown as PricingContradictionItem),[onSelectForEstimation]);
    const rescan=React.useCallback((item:ContradictionItem)=>onRescan(item as unknown as PricingContradictionItem),[onRescan]);
    const requestDelete=React.useCallback(async(ids:string[])=>{setError(null);setDeleteIds(ids);},[]);
    const prepare = async () => { if (inFlight.current)
        return; inFlight.current = true; setBusy(true); setFeedback(null); try {
        const result = await onBulkApprove(selectedIds);
        if (!result.superseded)
            setFeedback(buildBulkApproveFeedback(result, threshold));
    }
    catch {
        setFeedback({ tone: 'danger', message: 'בדיקת הוודאות לא הושלמה. לא הוצג אישור כספי.', stagedCount: 0, skippedCount: selectedIds.length });
    }
    finally {
        inFlight.current = false;
        setBusy(false);
    } };
    const summary=<p className="ti-meta">ממוצע Confidence: <BidiText kind="percent" value={formatConfidencePercent(stats.averageScore)}/> · נמדדו {stats.totalWithConfidence} · מעל {threshold}: {stats.highConfidenceCount} · נבחרו {confidence.selectedHighConfidenceQueueIds.length}</p>;
    const prepareButton=<Button onClick={prepare} pending={busy} busyLabel="בודק ודאות בשרת…" disabled={!selectedIds.length} disabledReason={!selectedIds.length ? 'בחר פריטים לבדיקת ודאות' : undefined}>הכנת בחירה לפי Confidence</Button>;
    const feedbackView=feedback && <Feedback tone={feedback.tone} aria-live="polite"><p>{feedback.message}</p><p className="ti-meta">הוכנו: {feedback.stagedCount} · דולגו: {feedback.skippedCount}</p></Feedback>;
    return <section className="ti-pricing-queue" aria-label="תור התמחור"><div className="ti-queue-summary"><div><h2 className="ti-section-title">תור לתמחור ({items.length})</h2>{summary}</div>{prepareButton}</div><div className="ti-queue-desktop-feedback">{feedbackView}</div>
 <PendingQueueTable items={items as unknown as ContradictionItem[]} selectedIds={selectedIds} onToggleSelection={onToggleSelection} onSelectAll={onSelectAll} onSelectForEstimation={estimate} onRescan={rescan} onBulkRescan={onBulkRescan} onBulkDelete={requestDelete} scanningItems={scanningItems} getConfidencePercent={getConfidencePercent} compactTools={<Button onClick={()=>setToolsOpen(true)}>Confidence{feedback?' · תוצאה':''}</Button>}/>
 <Dialog open={toolsOpen} labelledBy="queue-confidence-title" onClose={()=>setToolsOpen(false)}><header className="ti-dialog__header"><h2 id="queue-confidence-title" className="ti-section-title">ודאות ומצב התור</h2><Button onClick={()=>setToolsOpen(false)}>סגירה</Button></header><div className="ti-ledger-tool-list">{summary}{prepareButton}{feedbackView}</div></Dialog>
 <Dialog open={deleteIds.length > 0} labelledBy="queue-delete-title" onClose={() => { if (!deleting)
        setDeleteIds([]); }}><h2 id="queue-delete-title" className="ti-section-title">מחיקת פריטים מהתור</h2><p className="ti-copy">האם למחוק {deleteIds.length} פריטים מהתור?</p>{error && <Feedback tone="danger">{error}</Feedback>}<div className="ti-dialog__footer"><Button onClick={() => setDeleteIds([])} disabled={deleting}>ביטול</Button><Button variant="danger" pending={deleting} busyLabel="מוחק…" onClick={async () => { setDeleting(true); try {
        await onBulkDelete(deleteIds);
        setDeleteIds([]);
    }
    catch {
        setError('מחיקת הפריטים לא הושלמה.');
    }
    finally {
        setDeleting(false);
    } }}>מחיקת הפריטים</Button></div></Dialog></section>;
}
export default React.memo(QueuePanel);
