"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { DocumentSourceView } from './DocumentSourceView';
import { X } from 'lucide-react';
import type { ParsedDocumentJson, ParsedFinancialItem, ParsedSystemError, ProjectDocument } from './types';
import { hasIncompleteAiAnalysis } from './documentDisplayStatus';
import { normalizeDocumentPage } from '@/components/features/contradiction-radar/utils/documentPage';

export interface ScreenOfTruthModalProps {
    document: ProjectDocument;
    projectId: string;
    onClose: () => void;
    onValidate: (id: string, updatedJSON: ParsedDocumentJson) => Promise<void>;
    readOnly?: boolean;
    sourceReadError?: string | null;
    onRetryRead?: () => Promise<void>;
    retryingRead?: boolean;
    onCompleteReading?:()=>Promise<void>;
    completingReading?:boolean;
    sourceContext?: { page?: number | null; quote?: string | null } | null;
}

export function withSourcePage(url: string | null, page: unknown, pdf: boolean): string | null {
    const value = normalizeDocumentPage(typeof page === 'string' || typeof page === 'number' ? page : null);
    return url && pdf && value ? url.split('#')[0] + '#page=' + value : url;
}

const moneyFormatter = new Intl.NumberFormat('he-IL');

type PreviewKind = 'pdf' | 'image' | 'text' | 'office' | 'unsupported';

type PreviewMetadata = {
    signedUrl?: string | null;
    inlineUrl?: string | null;
    contentType?: string | null;
    previewKind?: PreviewKind;
    canPreviewInline?: boolean;
};

function cleanTitle(title?: string | null) {
    return String(title || '')
        .replace(/\.(pdf|docx|doc|xlsx|xls|pptx|ppt|rtf|txt|text|csv|tsv|md|markdown|html|htm|odt|ods|odp|ifc|dxf|dwg|dwf|dwfx|rvt|rfa|dgn|skp|mpp|tlv|skn|boq|bq|qty|reg|gdoc|gsheet|gslides|webp|png|jpg|jpeg)$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim();
}

function looksCorruptText(value: string) {
    if (!value.trim()) return false;
    if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return true;
    if (/ג[€”‚]|׳.{0,2}׳|׀/.test(value)) return true;

    const suspicious = (value.match(/[׳״`~^]/g) || []).length;
    return suspicious > 3 && suspicious / Math.max(value.length, 1) > 0.12;
}

function inferDocumentType(title?: string | null, category?: string | null) {
    const clean = cleanTitle(title).toLowerCase();
    if (/לוז|לוח|schedule/.test(clean)) return 'לוח זמנים';
    if (/סיכום|ישיבה|פרוטוקול/.test(clean)) return 'סיכום ישיבה';
    if (/מכתב|התכתבות|mail|fw_|re_/.test(clean)) return 'מכתב / התכתבות';
    if (/חשבון|מחיר|כמות|boq|כתב כמויות/.test(clean)) return 'מסמך כספי';
    if (category === 'CONTRACT') return 'מסמך חוזה';
    if (category === 'PRICELIST') return 'מחירון';
    return 'מסמך ביצוע';
}

function safeStructuredText(value: unknown, fallback = '') {
    const text = String(value || '').trim();
    if (!text || looksCorruptText(text)) return fallback;
    return text;
}

function getRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function normalizeParsedJson(value: unknown): ParsedDocumentJson {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return getRecord(parsed) ? parsed as ParsedDocumentJson : {};
        } catch {
            return {};
        }
    }

    return getRecord(value) ? value as ParsedDocumentJson : {};
}

function nestedValue(root: Record<string, unknown>, path: string) {
    return path.split('.').reduce<unknown>((current, key) => {
        const record = getRecord(current);
        return record ? record[key] : undefined;
    }, root);
}

function normalizeReadableText(value: unknown) {
    const text = safeStructuredText(value, '')
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
    return text;
}

function excerptText(value: string, limit: number) {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit).trim()}...`;
}

function isPlaceholderSummary(value: string) {
    return [
        'סיווג לפי שם הקובץ',
        'ניתוח AI מלא ממתין להרצה',
        'מסמך שנקלט למערכת',
    ].some((placeholder) => value.includes(placeholder));
}

function getReadableDocumentText(jsonData: ParsedDocumentJson, doc: ProjectDocument, limit = Number.POSITIVE_INFINITY) {
    const candidates: unknown[] = [
        doc.extracted_text,
        jsonData.full_markdown,
        jsonData.extracted_text,
        jsonData.markdown,
        jsonData.text,
        nestedValue(jsonData, 'ocr.text'),
        nestedValue(jsonData, 'analysis.text'),
        nestedValue(jsonData, 'content.text'),
    ];

    for (const candidate of candidates) {
        const text = normalizeReadableText(candidate);
        if (text) return excerptText(text, limit);
    }

    return '';
}

function getUsefulSummary(jsonData: ParsedDocumentJson, doc: ProjectDocument) {
    const summaryPaths = [
        'summary',
        'document_summary',
        'short_summary',
        'analysis_summary',
        'overview',
        'description',
        'analysis.summary',
        'classification.summary',
        'result.summary',
        'data.summary',
    ];
    const placeholderSummaries: string[] = [];

    for (const path of summaryPaths) {
        const text = normalizeReadableText(nestedValue(jsonData, path));
        if (!text) continue;
        if (!isPlaceholderSummary(text)) return text;
        placeholderSummaries.push(text);
    }

    const extractedText = getReadableDocumentText(jsonData, doc, 700);
    if (extractedText) {
        return `הטקסט של המסמך שמור במערכת. התחלה מתוך הטקסט שנקרא: ${extractedText}`;
    }

    return placeholderSummaries[0] || '';
}

function getSystemErrorText(errors: ParsedSystemError[], fallback?: string | null) {
    const code = errors[0]?.code || fallback;
    const messages: Record<string, string> = {
        AI_RATE_LIMIT: 'יש עומס AI. המתן 30 שניות ונסה שוב.',
        UNSUPPORTED_DOCUMENT_TYPE: 'סוג הקובץ עדיין לא נתמך. נתמכים: PDF, תמונות, Office חדש, Google אחרי ייצוא, טקסט, DXF/IFC ו-TLV/SKN טקסטואלי.',
        GOOGLE_NATIVE_EXPORT_REQUIRED: 'קובץ Google מקורי הוא רק קישור. ייצא ל-DOCX/XLSX/PPTX/PDF ואז העלה.',
        CAD_CONVERTER_REQUIRED: 'לקובץ CAD צריך המרה. ייצא ל-PDF או DXF ואז נסה שוב.',
        BIM_CONVERTER_REQUIRED: 'לקובץ BIM/Revit צריך המרה. ייצא ל-IFC או PDF.',
        PROJECT_FILE_CONVERTER_REQUIRED: 'לקובץ לוח זמנים צריך ייצוא ל-XLSX/CSV/PDF/XML.',
        BOQ_CONVERTER_REQUIRED: 'קובץ כתב הכמויות הזה נראה סגור או בינארי. ייצא ל-XLSX/CSV/XML/PDF או TLV/SKN טקסטואלי.',
        LEGACY_SPREADSHEET_CONVERSION_REQUIRED: 'קובץ XLS ישן צריך ייצוא ל-XLSX/CSV/PDF/XML.',
        LEGACY_PRESENTATION_CONVERSION_REQUIRED: 'קובץ PPT ישן צריך ייצוא ל-PPTX/PDF.',
        DOCUMENT_TEXT_EXTRACTION_EMPTY: 'הקובץ נפתח, אבל לא נמצא בו טקסט קריא.',
        DOCUMENT_TEXT_EXTRACTION_FAILED: 'לא הצלחנו לקרוא טקסט מהקובץ. נסה לייצא ל-PDF או לפורמט Office חדש.',
        DOCUMENT_HAS_NO_PAGES: 'הקובץ לא נקרא כמסמך. המר אותו ל-PDF ונסה שוב.',
        AI_INVALID_JSON: 'AI החזיר תשובה לא תקינה. נסה שוב.',
        GEMINI_API_KEY_MISSING: 'חיבור ה-AI לא מוגדר בשרת.',
        GEMINI_KEY_REPORTED_LEAKED: 'מפתח ה-AI נדחה. צריך להחליף אותו.',
        AI_ANALYSIS_FAILED: 'הניתוח לא הושלם. נסה שוב או בדוק את הקובץ.',
    };

    return messages[String(code || '')] || 'אין תוצאה תקינה. אין לאשר את המסמך עדיין.';
}

function isDocumentWarning(warning: string) {
    return !/GoogleGenerativeAI|Gemini|API key|Forbidden|fetching from|AI processing warning|reported as leaked|generateContent|quota|rate.?limit|429|RESOURCE_EXHAUSTED/i.test(warning);
}

export default function ScreenOfTruthModal({ document: doc, projectId, onClose, onValidate, readOnly = false, sourceContext, sourceReadError, onRetryRead, retryingRead, onCompleteReading, completingReading }: ScreenOfTruthModalProps) {
    const [isValidating, setIsValidating] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewMeta, setPreviewMeta] = useState<PreviewMetadata | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const jsonData: ParsedDocumentJson = normalizeParsedJson(doc.parsed_json);
    const documentType = safeStructuredText(jsonData.document_type || jsonData.type, inferDocumentType(doc.title, doc.category));
    const summary = getUsefulSummary(jsonData, doc);
    const readablePreviewText = doc.extracted_text || getReadableDocumentText(jsonData, doc);
    const warningSystemErrors = Array.isArray(jsonData.warnings)
        ? jsonData.warnings
            .map((warning) => getRecord(warning))
            .filter((warning): warning is ParsedSystemError => Boolean(warning?.code))
        : [];
    const systemErrors = [
        ...(Array.isArray(jsonData.system_errors) ? jsonData.system_errors : []),
        ...warningSystemErrors,
    ];
    const hasSystemError = hasIncompleteAiAnalysis({ ...doc, parsed_json: jsonData });
    const financialItems = Array.isArray(jsonData.financial_data?.items) ? jsonData.financial_data.items : [];
    const totalAmount = jsonData.financial_data?.total_amount;
    const hasFinancialItems = financialItems.length > 0;
    const shouldShowFinancial = hasFinancialItems || (totalAmount !== null && totalAmount !== undefined);
    const shouldShowDate = Boolean(jsonData.date);
    const warnings = useMemo(
        () => (jsonData.warnings ?? []).filter((warning): warning is string => typeof warning === 'string' && isDocumentWarning(warning)),
        [jsonData.warnings]
    );
    const hasWarnings = warnings.length > 0;
    const isAlreadyValidated = doc.ai_status === 'VALIDATED';
    const isStructured = Boolean(documentType || summary || hasFinancialItems || totalAmount || jsonData.date);
    const canValidate = !isAlreadyValidated && !hasSystemError && isStructured && !readOnly;

    useEffect(() => {
        let cancelled = false;

        const loadPreviewUrl = async () => {
            setPreviewUrl(null);
            setPreviewMeta(null);
            setPreviewError(null);

            try {
                const params = new URLSearchParams({ projectId, documentId: doc.id });
                const res = await fetch(`/api/documents/signed-url?${params.toString()}`);
                const data = await res.json();

                if (!res.ok || !data?.signedUrl) {
                    throw new Error(data?.error || 'Failed to load document preview');
                }

                if (!cancelled) {
                    const metadata: PreviewMetadata = {
                        signedUrl: data.signedUrl,
                        inlineUrl: data.inlineUrl,
                        contentType: data.contentType,
                        previewKind: data.previewKind,
                        canPreviewInline: Boolean(data.canPreviewInline),
                    };
                    setPreviewMeta(metadata);
                    setPreviewUrl(metadata.canPreviewInline ? (metadata.inlineUrl || metadata.signedUrl || null) : null);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load document preview';
                if (!cancelled) setPreviewError(message);
            }
        };

        if (doc?.id && projectId) {
            void loadPreviewUrl();
        }

        return () => {
            cancelled = true;
        };
    }, [doc.id, projectId]);

    const rawConfidence = jsonData.confidence ?? jsonData.confidence_score ?? jsonData.document_confidence;
    const parsedConfidence = typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence);
    const confidencePercent = Number.isFinite(parsedConfidence) && parsedConfidence > 0
        ? Math.round(parsedConfidence <= 1 ? parsedConfidence * 100 : parsedConfidence)
        : null;
    const previewKind = previewMeta?.previewKind || 'unsupported';
    const sourceUrl = previewMeta?.inlineUrl || previewMeta?.signedUrl || null;
    const contextPage = normalizeDocumentPage(sourceContext?.page);
    const pdfSource = previewKind === 'pdf' || /\.pdf$/i.test(doc.title || '');

    const handleValidate = async () => {
        if (!canValidate) return;
        setValidationError(null);
        setIsValidating(true);
        try {
            await onValidate(doc.id, jsonData);
            onClose();
        } catch (err) {
            console.error('Validation error:', err);
            setValidationError('האישור לא נשמר. אפשר לנסות שוב; המסמך נשאר ללא שינוי.');
        } finally {
            setIsValidating(false);
        }
    };

    return <Dialog open labelledBy="source-dialog-title" onClose={onClose} className="ti-source-dialog">
        <header className="ti-dialog__header"><div><h2 id="source-dialog-title" className="ti-section-title"><BidiText kind="file" value={doc.title || 'מסמך ללא שם'} /></h2><p className="ti-meta">סקירת המקור והנתונים שנשמרו</p></div><Button aria-label="סגירה" onClick={onClose}><X size={18} aria-hidden="true" /></Button></header>
        {sourceContext && <section className="ti-source-reference" aria-label="ההפניה למקור"><p className="ti-meta">{contextPage ? <>עמוד בהפניה: <BidiText kind="code" value={String(contextPage)}/></> : 'לא צוין עמוד בהפניה.'}</p>{sourceContext.quote && <details><summary>ציטוט שהועבר מההערכה</summary><blockquote>{sourceContext.quote}</blockquote></details>}</section>}
        <div className="ti-source-dialog__columns">
            <DocumentSourceView document={doc} fullText={readablePreviewText} sourceReadError={sourceReadError} onRetryRead={onRetryRead} retryingRead={retryingRead} onCompleteReading={onCompleteReading} completingReading={completingReading} previewUrl={withSourcePage(previewUrl, contextPage, pdfSource)} previewKind={previewKind} previewError={previewError ? 'לא הצלחנו לטעון את קובץ המקור בתצוגה מקדימה.' : null} sourceUrl={withSourcePage(sourceUrl, contextPage, pdfSource)} />
            <section className="ti-source-analysis" aria-label="תוצאת הניתוח"><h3 className="ti-section-title">מה המערכת הבינה מהמסמך</h3>
                {hasSystemError && <Feedback tone="warning" title={isAlreadyValidated ? 'האישור הידני נשמר; ניתוח AI לא הושלם' : 'ניתוח AI לא הושלם'}>{getSystemErrorText(systemErrors, jsonData.system_error)}</Feedback>}
                {isStructured && !hasSystemError && <>
                    <dl className="ti-source-metadata"><div><dt>סוג שזוהה</dt><dd>{safeStructuredText(jsonData.document_type || jsonData.type, 'לא זוהה')}</dd></div>{shouldShowDate && <div><dt>תאריך שזוהה</dt><dd><BidiText kind="date" value={String(jsonData.date)} /></dd></div>}{confidencePercent !== null && <div><dt>רמת ודאות בניתוח</dt><dd><BidiText kind="percent" value={confidencePercent + '%'} /></dd></div>}{shouldShowFinancial && <div><dt>סכום שזוהה</dt><dd><BidiText kind="money" value={totalAmount !== null && totalAmount !== undefined ? '₪' + moneyFormatter.format(Number(totalAmount)) : 'לא צוין סכום כולל'} /></dd></div>}</dl>
                    <div><h4 className="ti-section-title">סיכום שימושי</h4><p className="ti-copy">{summary || 'לא נוצר עדיין סיכום ברור למסמך הזה.'}</p></div>
                    {hasWarnings && <div><h4 className="ti-section-title">נקודות שדורשות תשומת לב</h4>{warnings.map((warning,index) => <Feedback key={index} tone="warning">{warning}</Feedback>)}</div>}
                    {hasFinancialItems && <div className="ti-table-scroll"><table className="ti-table ti-source-financial"><caption>פריטים כספיים שנמצאו</caption><thead><tr><th>קוד</th><th>תיאור</th><th>כמות</th><th>סכום</th></tr></thead><tbody>{financialItems.map((item: ParsedFinancialItem,index:number) => <tr key={index}><td><BidiText kind="code" value={item.code || '—'} /></td><td>{item.description || '—'}</td><td><BidiText kind="code" value={item.quantity === null || item.quantity === undefined ? '—' : String(item.quantity)} /> {item.unit || ''}</td><td><BidiText kind="money" value={item.total_price === null || item.total_price === undefined ? '—' : '₪' + moneyFormatter.format(Number(item.total_price))} /></td></tr>)}</tbody></table></div>}
                </>}
                {!isStructured && !hasSystemError && <Feedback title="אין עדיין תוצאה שאפשר לבדוק">נדרש ניתוח מסמך לפני אישורו כמקור עבודה.</Feedback>}
                {validationError && <Feedback tone="danger">{validationError}</Feedback>}
                <footer className="ti-source-validation"><p className="ti-copy">{readOnly ? 'תצוגת מקור בלבד. סגירה אינה מאשרת מסמך או סכום.' : isAlreadyValidated ? 'האישור הידני נשמר. שלמות הקריאה ומצב הניתוח מוצגים בנפרד.' : 'בדוק את המקור ואת תוצאת הניתוח לפני אישור.'}</p><div className="ti-actions"><Button onClick={onClose}>סגירה</Button>{!readOnly && !isAlreadyValidated && <Button variant="primary" onClick={handleValidate} pending={isValidating} busyLabel="שומר…" disabled={!canValidate} disabledReason={!canValidate ? 'אי אפשר לאשר עד שיש ניתוח תקין וברור.' : undefined}>אישור כמקור</Button>}</div></footer>
            </section>
        </div>
    </Dialog>;
}
