"use client";

import { Eye, FileText, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { StatusChip, type StatusTone } from '@/components/ui/titanium/StatusChip';
import { getDocumentDisplayState, hasIncompleteAiAnalysis } from './documentDisplayStatus';
import type { ProjectDocument } from './types';

export const documentStateLabels: Record<ReturnType<typeof getDocumentDisplayState>['key'], { label: string; tone: StatusTone }> = {
  PENDING: { label: 'נשמר · ממתין לניתוח', tone: 'neutral' },
  PROCESSING: { label: 'קריאה וניתוח בתהליך', tone: 'info' },
  TEXT_READ: { label: 'הטקסט נקרא · נדרש ניתוח', tone: 'info' },
  SCANNED: { label: 'ניתוח הושלם · נדרשת סקירה', tone: 'info' },
  VALIDATED: { label: 'אושר ידנית', tone: 'success' },
  VALIDATED_WITH_AI_WARNING: { label: 'אושר ידנית · AI לא הושלם', tone: 'warning' },
  AI_INCOMPLETE: { label: 'ניתוח AI לא הושלם', tone: 'warning' },
  SOURCE_INCOMPLETE: { label: 'קריאת המקור לא הושלמה', tone: 'warning' },
};

export function DocumentListRow({ document, selected, processing, analysisAvailable = true, analysisDisabledReason, onSelect, onAnalyze, onPreview, onDelete }: {
  document: ProjectDocument; selected: boolean; processing: boolean; analysisAvailable?: boolean; analysisDisabledReason?: string;
  onSelect(): void; onAnalyze(): Promise<void>; onPreview(): void; onDelete(): Promise<void>;
}) {
  const state = getDocumentDisplayState(document);
  const status = documentStateLabels[state.key];
  const date = document.created_at && !Number.isNaN(Date.parse(document.created_at)) ? new Intl.DateTimeFormat('he-IL').format(new Date(document.created_at)) : '—';
  const busy = processing || state.key === 'PROCESSING';
  return <article className="ti-document-row" data-selected={selected || undefined} data-document-state={state.key}>
    <button className="ti-document-select" type="button" onClick={onSelect} aria-pressed={selected} aria-label={`בחירת מסמך ${document.title || 'ללא שם'}`}>
      <FileText size={23} aria-hidden="true" />
      <span className="ti-document-identity"><span className="ti-document-name" title={document.title || undefined}><BidiText kind="file" value={document.title || 'מסמך ללא שם'} /></span><span className="ti-meta"><BidiText kind="date" value={date} /> · {document.category === 'CONTRACT' ? 'חוזה' : document.category === 'EXECUTION' ? 'ביצוע ושטח' : document.category === 'PRICELIST' ? 'מחירון' : 'קטגוריה לא צוינה'}</span></span>
    </button>
    <StatusChip tone={status.tone}>{status.label}</StatusChip>
    <div className="ti-document-row__actions">
      <Button onClick={onPreview} aria-label={`פתיחת מקור ${document.title || ''}`}><Eye size={16} aria-hidden="true" />פתיחת מקור</Button>
      {(document.ai_status === 'PENDING' || !document.ai_status || hasIncompleteAiAnalysis(document)) && <Button variant="text" onClick={onAnalyze} pending={busy} busyLabel="בניתוח…" disabled={!analysisAvailable || busy} disabledReason={!analysisAvailable ? analysisDisabledReason || 'שירות הניתוח אינו זמין כרגע' : undefined}><Play size={16} aria-hidden="true" />ניתוח מסמך</Button>}
      {document.ai_status === 'SCANNED' && <Button variant="text" onClick={onPreview}>סקירת הניתוח</Button>}
      <Button variant="text" onClick={onDelete} disabled={busy} aria-label={`מחיקת מסמך ${document.title || ''}`}><Trash2 size={16} aria-hidden="true" /></Button>
    </div>
  </article>;
}
