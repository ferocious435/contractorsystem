"use client";

import { ExternalLink, FileText } from 'lucide-react';
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { StatusChip } from '@/components/ui/titanium/StatusChip';
import { hasIncompleteAiAnalysis } from './documentDisplayStatus';
import type { ProjectDocument } from './types';

export function DocumentSourceView({ document, fullText, previewUrl, previewKind, previewError, sourceUrl, sourceReadError, onRetryRead, retryingRead, onPreview, canValidate, validating, validationDisabledReason, validationError, onValidate }: {
  document: ProjectDocument; fullText?: string | null; previewUrl?: string | null; previewKind?: 'pdf' | 'image' | 'text' | 'office' | 'unsupported'; previewError?: string | null; sourceUrl?: string | null;
  sourceReadError?: string | null; onRetryRead?(): Promise<void>; retryingRead?: boolean;
  onPreview?(): void; canValidate?: boolean; validating?: boolean; validationDisabledReason?: string; validationError?: string | null; onValidate?(): Promise<void>;
}) {
  const readiness = assessDocumentSourceReadiness(document);
  const reading = document.parsed_json?.source_reading as { totalPages?: unknown; readPages?: unknown; unreadablePages?: unknown } | undefined;
  const pdf = /\.pdf(?:$|[?#])/i.test(String(document.title || document.storage_path || document.file_url || ''));
  const pages = typeof reading?.totalPages === 'number' && Number.isInteger(reading.totalPages) && reading.totalPages > 0 ? reading.totalPages : null;
  const readPages = Array.isArray(reading?.readPages) ? [...new Set(reading.readPages.filter((value): value is number => Number.isInteger(value) && Number(value) > 0 && (!pages || Number(value) <= pages)))] : [];
  const unread = Array.isArray(reading?.unreadablePages) ? reading.unreadablePages.filter((value): value is number => Number.isInteger(value) && Number(value) > 0) : [];
  const missing = pages ? Array.from({length: pages}, (_, i) => i + 1).filter(page => !readPages.includes(page) || unread.includes(page)) : unread;
  const marker = readiness.documentStatus === 'DRAFT' || readiness.documentStatus === 'FRAGMENT' ? readiness.documentStatus : undefined;
  const aiIncomplete = hasIncompleteAiAnalysis(document);
  const analysisComplete = document.ai_status === 'SCANNED' && readiness.extractionComplete && !aiIncomplete;
  const textChunks = fullText?.match(/[\s\S]{1,8000}(?:\n|$)|[\s\S]{1,8000}/g) || [];
  return <section className="ti-source-view" data-source-status={readiness.status} data-document-marker={marker} aria-label="מקור המסמך">
    <div className="ti-source-view__header"><FileText size={20} aria-hidden="true" /><h3 className="ti-section-title">מקור המסמך</h3></div>
    <p className="ti-source-name"><BidiText kind="file" value={document.title || 'מסמך ללא שם'} /></p>
    <div className="ti-source-states"><StatusChip tone="neutral">הקובץ נשמר</StatusChip>{document.ai_status === 'VALIDATED' && <StatusChip tone="success">אושר ידנית</StatusChip>}<StatusChip tone={readiness.extractionComplete ? 'info' : 'warning'}>{readiness.extractionComplete ? 'הטקסט נקרא' : 'הקריאה לא הושלמה'}</StatusChip><StatusChip tone={aiIncomplete ? 'warning' : 'neutral'}>{aiIncomplete ? 'ניתוח AI לא הושלם' : analysisComplete ? 'ניתוח הושלם' : 'השלמת ניתוח נבדקת בנפרד'}</StatusChip></div>
    {pdf && <p className="ti-meta">{pages ? <>נקראו <BidiText kind="code" value={`${readPages.length} / ${pages}`} /> עמודים{missing.length > 0 && <> · עמודים שלא נקראו: <BidiText kind="code" value={missing.join(', ')} /></>}</> : 'מספר העמודים לא אומת'}</p>}
    {!readiness.extractionComplete && <Feedback tone="warning">שלמות קריאת המקור טרם אומתה. אישור ידני אינו מעיד שכל העמודים נקראו.</Feedback>}
    {marker && <Feedback tone="warning" title={marker === 'DRAFT' ? 'טיוטה' : 'קטע מתוך מסמך'}>המקור מסומן כך במפורש ואינו הוראה מחייבת מאומתת. יש לבדוק את הגרסה המלאה ואת הקשר המסמך.</Feedback>}
    {previewError && <Feedback tone="warning">{previewError}</Feedback>}
    {previewUrl && (previewKind === 'pdf' || previewKind === 'text') && <iframe className="ti-source-frame" title="תצוגת מסמך מקור" src={previewUrl} />}
    {/* A source image is an original signed file; next/image cannot optimize private links. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {previewUrl && previewKind === 'image' && <img className="ti-source-image" src={previewUrl} alt={document.title || 'מסמך מקור'} />}
    {sourceReadError ? <Feedback tone="warning"><p>{sourceReadError}</p>{onRetryRead && <Button onClick={onRetryRead} pending={retryingRead}>ניסיון נוסף</Button>}</Feedback> : fullText ? <details className="ti-source-text" open={fullText.length <= 32000}><summary>הטקסט המלא שנשמר</summary><pre>{textChunks.map((text,index)=><span className="ti-source-text__chunk" dir="auto" key={index}>{text}</span>)}</pre></details> : <Feedback>אין עדיין טקסט שמור לתצוגה. אפשר לפתוח את קובץ המקור; פתיחה אינה מפעילה ניתוח.</Feedback>}
    {previewKind === 'unsupported' && <p className="ti-meta">לסוג הקובץ הזה אין תצוגה ישירה בדפדפן.</p>}
    <div className="ti-actions">{onPreview && <Button onClick={onPreview}>פתיחת המקור וסקירת הניתוח</Button>}{sourceUrl && <a className="ti-button ti-button--secondary" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />פתיחת קובץ המקור</a>}</div>
    {validationError && <Feedback tone="danger">{validationError}</Feedback>}
    {onValidate && <Button variant="primary" onClick={onValidate} pending={validating} busyLabel="שומר אישור…" disabled={!canValidate} disabledReason={validationDisabledReason}>אישור כמקור</Button>}
  </section>;
}
