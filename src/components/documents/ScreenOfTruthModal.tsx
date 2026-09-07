"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, CheckCircle2, ShieldCheck, FileSearch, AlertTriangle, Info, Layers, ExternalLink } from 'lucide-react';
import type { ParsedDocumentJson, ParsedFinancialItem, ParsedSystemError, ProjectDocument } from './types';
import { hasIncompleteAiAnalysis } from './documentDisplayStatus';

interface ScreenOfTruthModalProps {
    document: ProjectDocument;
    projectId: string;
    onClose: () => void;
    onValidate: (id: string, updatedJSON: ParsedDocumentJson) => Promise<void>;
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
    if (/[�\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return true;
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

function getReadableDocumentText(jsonData: ParsedDocumentJson, doc: ProjectDocument, limit = 16000) {
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

export default function ScreenOfTruthModal({ document: doc, projectId, onClose, onValidate }: ScreenOfTruthModalProps) {
    const [isValidating, setIsValidating] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewMeta, setPreviewMeta] = useState<PreviewMetadata | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const jsonData: ParsedDocumentJson = normalizeParsedJson(doc.parsed_json);
    const documentType = safeStructuredText(jsonData.document_type || jsonData.type, inferDocumentType(doc.title, doc.category));
    const summary = getUsefulSummary(jsonData, doc);
    const readablePreviewText = getReadableDocumentText(jsonData, doc);
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
    const shouldShowFinancial = hasFinancialItems || Boolean(totalAmount);
    const shouldShowDate = Boolean(jsonData.date);
    const warnings = useMemo(
        () => (jsonData.warnings ?? []).filter((warning): warning is string => typeof warning === 'string' && isDocumentWarning(warning)),
        [jsonData.warnings]
    );
    const hasWarnings = warnings.length > 0;
    const isAlreadyValidated = doc.ai_status === 'VALIDATED';
    const isStructured = Boolean(documentType || summary || hasFinancialItems || totalAmount || jsonData.date);
    const canValidate = !isAlreadyValidated && !hasSystemError && isStructured;

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

    const handleValidate = async () => {
        if (!canValidate) return;
        setIsValidating(true);
        try {
            await onValidate(doc.id, jsonData);
            onClose();
        } catch (err) {
            console.error('Validation error:', err);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07090C]/95 backdrop-blur-xl p-3 md:p-6"
            dir="rtl"
        >
            <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 20 }}
                className="bg-[#0B0F14] w-full h-full border border-white/10 shadow-[0_50px_100px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden rounded-2xl"
            >
                <div className="flex justify-between items-center gap-4 px-5 md:px-8 py-4 border-b border-white/5 bg-black/40">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                            hasSystemError
                                ? 'border-amber-500/30 bg-amber-500/10'
                                : isAlreadyValidated
                                    ? 'border-emerald-500/30 bg-emerald-500/10'
                                    : 'border-blue-500/30 bg-blue-500/10'
                        }`}>
                            {hasSystemError ? (
                                <AlertTriangle className="w-6 h-6 text-amber-400" />
                            ) : isAlreadyValidated ? (
                                <ShieldCheck className="w-6 h-6 text-emerald-400" />
                            ) : (
                                <FileSearch className="w-6 h-6 text-blue-400" />
                            )}
                        </div>

                        <div className="min-w-0">
                            <h2 className="text-lg md:text-2xl font-black text-white truncate">{cleanTitle(doc.title)}</h2>
                            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm">
                                <span className={hasSystemError ? 'text-amber-300 font-bold' : isAlreadyValidated ? 'text-emerald-400 font-bold' : 'text-blue-400 font-bold'}>
                                    {hasSystemError && isAlreadyValidated
                                        ? 'אושר ידנית · ניתוח AI לא הושלם'
                                        : hasSystemError
                                            ? 'ניתוח AI לא הושלם'
                                            : isAlreadyValidated
                                                ? 'המסמך אושר ידנית'
                                                : 'מוכן לסקירה לפני אישור'}
                                </span>
                                {confidencePercent && !hasSystemError ? (
                                    <span className="text-gray-400">רמת ודאות: {confidencePercent}%</span>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-11 h-11 shrink-0 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                        aria-label="סגירה"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                    <div className="flex-1 flex flex-col border-l border-white/5 bg-black/20 min-h-[280px] lg:min-h-0">
                        <div className="px-5 py-3 border-b border-white/5 bg-black/30 text-sm font-bold text-gray-300">
                            המסמך המקורי
                        </div>
                        <div className="flex-1 bg-[#07090C] overflow-hidden flex items-center justify-center">
                            {previewUrl && previewKind === 'pdf' ? (
                                <iframe title="תצוגת מסמך" src={`${previewUrl}#toolbar=0`} className="w-full h-full border-none bg-white" />
                            ) : previewUrl && previewKind === 'image' ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={previewUrl} alt={cleanTitle(doc.title) || 'Document preview'} className="h-full w-full object-contain bg-black" />
                            ) : previewUrl && previewKind === 'text' ? (
                                <iframe title="תצוגת טקסט" src={previewUrl} className="w-full h-full border-none bg-white" />
                            ) : readablePreviewText ? (
                                <div className="h-full w-full overflow-y-auto p-6 text-right" dir="rtl">
                                    <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/5 pb-3">
                                        <div>
                                            <div className="text-sm font-black text-gray-200">טקסט שמור מהמסמך</div>
                                            <div className="mt-1 text-xs text-gray-500">מוצג מתוך הניתוח שנשמר במערכת.</div>
                                        </div>
                                        {sourceUrl ? (
                                            <a
                                                href={sourceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-black transition-transform hover:scale-105 active:scale-95"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                                פתח מקור
                                            </a>
                                        ) : null}
                                    </div>
                                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-gray-200">{readablePreviewText}</pre>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-4 text-center px-6 max-w-md">
                                    <div className="p-5 bg-white/[0.03] border border-white/5 rounded-2xl">
                                        <Layers className="text-gray-700" size={52} />
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-gray-300">
                                            {previewError ? 'לא הצלחנו לפתוח תצוגה מקדימה' : previewKind === 'office' ? 'אין תצוגה ישירה למסמך Office' : 'אין תצוגה ישירה לסוג הקובץ הזה'}
                                        </div>
                                        <div className="mt-2 text-xs leading-6 text-gray-500" title={previewError || undefined}>
                                            {previewError
                                                ? 'הקובץ עדיין יכול להיות שמור במערכת. נסה לפתוח את קובץ המקור.'
                                                : previewKind === 'office'
                                                ? 'המסמך שמור במערכת וניתן לפתוח אותו כקובץ מקור.'
                                                : 'המסמך שמור, אך אין לו תצוגה ישירה בתוך הדפדפן.'}
                                        </div>
                                        {sourceUrl ? (
                                            <a
                                                href={sourceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-black transition-transform hover:scale-105 active:scale-95"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                                פתח קובץ מקור
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="w-full lg:w-[680px] flex flex-col bg-[#0B0F14]">
                        <div className="px-5 py-3 border-b border-white/5 bg-black/30 text-sm font-bold text-gray-300">
                            מה המערכת הבינה מהמסמך
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 md:p-7 space-y-6">
                            {hasSystemError ? (
                                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-amber-100 leading-7">
                                    <div className="flex items-center gap-2 text-base font-black text-amber-200">
                                        <AlertTriangle className="w-5 h-5" />
                                        {isAlreadyValidated
                                            ? 'האישור הידני נשמר, אך ניתוח ה-AI לא הושלם'
                                            : 'ניתוח ה-AI לא הושלם'}
                                    </div>
                                    <p className="mt-3 text-sm text-amber-100/90">הקובץ נשמר במערכת. {getSystemErrorText(systemErrors, jsonData.system_error)}</p>
                                </div>
                            ) : null}

                            {isStructured && !hasSystemError ? (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {documentType ? (
                                            <div className="bg-[#151C24]/55 border border-white/5 rounded-xl p-5">
                                                <div className="text-xs text-gray-500 font-bold mb-2">סוג מסמך</div>
                                                <div className="text-lg font-black text-white">{documentType}</div>
                                            </div>
                                        ) : null}

                                        {shouldShowDate ? (
                                            <div className="bg-[#151C24]/55 border border-white/5 rounded-xl p-5">
                                                <div className="text-xs text-gray-500 font-bold mb-2">תאריך שזוהה</div>
                                                <div className="text-lg font-black text-white">{jsonData.date}</div>
                                            </div>
                                        ) : null}

                                        {shouldShowFinancial ? (
                                            <div className="bg-[#151C24]/55 border border-white/5 rounded-xl p-5">
                                                <div className="text-xs text-gray-500 font-bold mb-2">סכום שזוהה</div>
                                                <div className="text-lg font-black text-emerald-400">
                                                    {totalAmount ? `₪${moneyFormatter.format(Number(totalAmount))}` : 'יש פריטים ללא סכום כולל'}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Info className="w-4 h-4 text-blue-400" />
                                            <span className="text-sm font-bold text-gray-300">סיכום שימושי</span>
                                        </div>
                                        <p className="text-base text-gray-200 leading-8">{summary || 'לא נוצר עדיין סיכום ברור למסמך הזה.'}</p>
                                    </div>

                                    {hasWarnings ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                                                <span className="text-sm font-bold text-amber-300">נקודות במסמך שדורשות תשומת לב</span>
                                            </div>
                                            {warnings.map((warning, idx) => (
                                                <div key={idx} className="p-4 bg-amber-500/[0.05] border border-amber-500/15 rounded-xl text-sm text-gray-200 leading-7">
                                                    {warning}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}

                                    {hasFinancialItems ? (
                                        <div className="space-y-3">
                                            <div className="text-sm font-bold text-gray-300">פריטים כספיים שנמצאו</div>
                                            <div className="bg-[#151C24]/35 border border-white/5 rounded-2xl overflow-x-auto">
                                                <table className="w-full min-w-[560px] text-sm" dir="rtl">
                                                    <thead className="bg-white/[0.03] text-gray-400">
                                                        <tr>
                                                            <th className="px-4 py-3 text-right">קוד</th>
                                                            <th className="px-4 py-3 text-right">תיאור</th>
                                                            <th className="px-4 py-3 text-center">כמות</th>
                                                            <th className="px-4 py-3 text-left">סכום</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-white/5">
                                                        {financialItems.map((item: ParsedFinancialItem, idx: number) => (
                                                            <tr key={idx}>
                                                                <td className="px-4 py-3 text-gray-400">{item.code || '-'}</td>
                                                                <td className="px-4 py-3 text-gray-100">{item.description || '-'}</td>
                                                                <td className="px-4 py-3 text-center text-gray-300">{item.quantity || '-'} {item.unit || ''}</td>
                                                                <td className="px-4 py-3 text-left text-emerald-400 font-bold">
                                                                    {item.total_price ? `₪${moneyFormatter.format(Number(item.total_price))}` : '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : null}
                                </>
                            ) : null}

                            {!isStructured && !hasSystemError ? (
                                <div className="h-full flex items-center justify-center text-center px-6">
                                    <div>
                                        <div className="text-lg font-black text-white mb-2">אין עדיין תוצאה שאפשר לבדוק</div>
                                        <div className="text-sm text-gray-500 leading-6">צריך להריץ ניתוח מסמך לפני שאפשר לאשר אותו כמקור עבודה.</div>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="px-5 md:px-8 py-5 bg-black/40 border-t border-white/5">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="text-sm text-gray-400 leading-6 max-w-xl">
                                    {isAlreadyValidated && hasSystemError
                                        ? 'האישור הידני נשמר, אבל אין כרגע ניתוח AI מלא שאפשר להסתמך עליו.'
                                        : isAlreadyValidated
                                            ? 'המסמך אושר ידנית לאחר ניתוח AI מלא.'
                                        : canValidate
                                            ? 'אישור הופך את המסמך למקור מאומת להמשך עבודה במערכת.'
                                            : 'אי אפשר לאשר עד שיש ניתוח תקין וברור.'}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={onClose}
                                        className="px-6 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-gray-300 text-sm font-bold hover:text-white hover:bg-white/10 transition-all"
                                    >
                                        סגירה
                                    </button>
                                    {!isAlreadyValidated ? (
                                        <button
                                            onClick={handleValidate}
                                            disabled={isValidating || !canValidate}
                                            className="px-7 py-3 bg-emerald-500 text-black rounded-xl text-sm font-black hover:scale-105 transition-all active:scale-95 shadow-[0_20px_40px_rgba(16,185,129,0.2)] disabled:opacity-40 disabled:hover:scale-100"
                                        >
                                            {isValidating ? 'שומר...' : (
                                                <span className="flex items-center gap-2">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    אישור כמקור
                                                </span>
                                            )}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
