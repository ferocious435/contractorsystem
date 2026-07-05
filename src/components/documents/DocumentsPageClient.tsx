"use client";

import React, { useRef, useState } from 'react';
import {
    Upload,
    FileText,
    ShieldCheck,
    AlertTriangle,
    Eye,
    Loader2,
    Play,
    Trash2,
    Cpu,
    Scan,
    Layers,
    CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScreenOfTruthModal from './ScreenOfTruthModal';
import { isDemoProjectId, isLocalProjectId } from '@/utils/local-projects';
import type { DocumentCategory, ParsedDocumentJson, ProjectDocument } from './types';

interface DocumentsPageClientProps {
    projectId: string;
    initialDocuments?: ProjectDocument[];
    category?: DocumentCategory;
}

const isPdfDocumentTitle = (title?: string | null) => {
    const normalized = String(title || '').trim().toLowerCase().split(/[?#]/)[0] || '';
    return normalized.endsWith('.pdf');
};

function buildDemoDocuments(projectId: string, category?: DocumentCategory): ProjectDocument[] {
    if (!isDemoProjectId(projectId)) return [];
    const docs: ProjectDocument[] = [
        { id: 'demo-contract-doc', project_id: projectId, title: 'Demo contract BOQ.pdf', category: 'CONTRACT', ai_status: 'SCANNED', created_at: new Date().toISOString(), parsed_json: { document_type: 'BOQ', confidence: 0.91 } },
        { id: 'demo-execution-doc', project_id: projectId, title: 'Demo execution note.pdf', category: 'EXECUTION', ai_status: 'SCANNED', created_at: new Date().toISOString(), parsed_json: { document_type: 'Execution note', confidence: 0.88 } },
    ];
    return category ? docs.filter((doc) => doc.category === category) : docs;
}

export default function DocumentsPageClient({ projectId, initialDocuments = [], category }: DocumentsPageClientProps) {
    const normalizeDocument = (doc: ProjectDocument): ProjectDocument => {
        if (doc.ai_status === 'VALIDATED') return doc;
        if (doc.ai_status === 'DONE' && doc.parsed_json && !doc.parsed_json.system_error) {
            return { ...doc, ai_status: 'SCANNED' };
        }

        return doc;
    };

    const isLocalProject = isLocalProjectId(projectId);
    const isDemoProject = isDemoProjectId(projectId);
    const [documents, setDocuments] = useState<ProjectDocument[]>(
        (initialDocuments.length ? initialDocuments : buildDemoDocuments(projectId, category)).map(normalizeDocument)
    );
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocForVerification, setSelectedDocForVerification] = useState<ProjectDocument | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [activeFilter, setActiveFilter] = useState<'ACTION' | 'ALL' | 'ERROR' | 'PENDING' | 'VALIDATED'>('ALL');

    const fileInputRef = useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        const fetchDocs = async () => {
            if (isLocalProject) return;
            if (initialDocuments.length > 0) return;

            const params = new URLSearchParams({ projectId });
            if (category) params.set('category', category);

            const res = await fetch('/api/documents?' + params.toString());
            const data = await res.json();
            if (data.success && Array.isArray(data.documents)) {
                setDocuments((prev) => {
                    const nextDocuments = data.documents.map(normalizeDocument);
                    if (nextDocuments.length === 0 && prev.length > 0) return prev;
                    return nextDocuments;
                });
            }
        };

        void fetchDocs();
    }, [projectId, category, initialDocuments.length, isLocalProject]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => setIsDragging(false);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await handleFiles(Array.from(e.dataTransfer.files));
        }
    };

    const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await handleFiles(Array.from(e.target.files));
        }
    };

    const handleFiles = async (files: File[]) => {
        if (isLocalProject) {
            const insertedDocs = files.map((file) => normalizeDocument({
                id: 'demo-doc-' + Date.now() + '-' + file.name,
                project_id: projectId,
                title: file.name,
                category: category || 'EXECUTION',
                ai_status: 'PENDING',
                created_at: new Date().toISOString(),
            } as ProjectDocument));
            setDocuments((prev) => [...insertedDocs, ...prev]);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setIsUploading(true);

        for (const file of files) {
            try {
                const formData = new FormData();
                formData.set('projectId', projectId);
                formData.set('category', category || 'EXECUTION');
                formData.set('file', file);

                const uploadRes = await fetch('/api/documents', {
                    method: 'POST',
                    body: formData,
                });
                const uploadData = await uploadRes.json();

                if (!uploadRes.ok || !uploadData.success) {
                    throw new Error(uploadData.error || 'Failed upload');
                }

                const insertedDoc = uploadData.document as ProjectDocument;
                setDocuments(prev => [insertedDoc, ...prev]);

                const isPDF = isPdfDocumentTitle(file.name);
                if (isPDF && insertedDoc?.id) {
                    setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

                    try {
                        const extractRes = await fetch('/api/documents/extract-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId, documentId: insertedDoc.id }),
                        });
                        const extractData = await extractRes.json();

                        if (extractData.success) {
                            setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? {
                                ...d,
                                ai_status: 'PENDING',
                                extracted_text: `[${extractData.textLength} תווים]`,
                            } : d));
                        } else {
                            setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                        }
                    } catch {
                        setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                    }
                }
            } catch (err) {
                console.error('Upload error for file:', file.name, err);
            }
        }

        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const runAIParsing = async (doc: ProjectDocument) => {
        if (processingId) return;
        setProcessingId(doc.id);

        if (isLocalProject) {
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'SCANNED', parsed_json: { document_type: 'Demo document', confidence: 0.8 } } : d));
            setProcessingId(null);
            return;
        }

        try {
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

            let extractedTextStr = doc.extracted_text;
            if (isPdfDocumentTitle(doc.title)) {
                try {
                    const extractRes = await fetch('/api/documents/extract-text', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId, documentId: doc.id }),
                    });
                    const extractData = await extractRes.json();
                    if (extractData.success) {
                    extractedTextStr = `[${extractData.textLength} תווים]`;
                    }
                } catch (err) {
                    console.warn('Failed to extract text:', err);
                }
            }

            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'PROCESSING' } : d));

            const res = await fetch('/api/documents/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, documentId: doc.id }),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                setDocuments(prev => prev.map(d => d.id === doc.id ? {
                    ...d,
                    ai_status: data.ai_status || 'ERROR',
                    parsed_json: data.parsed_json || d.parsed_json,
                    extracted_text: extractedTextStr,
                    category: data.parsed_json?.category || d.category,
                } : d));
                return;
            }

            setDocuments(prev => prev.map(d => d.id === doc.id ? {
                ...d,
                ai_status: 'SCANNED',
                parsed_json: data.parsed_json,
                extracted_text: extractedTextStr,
                category: data.parsed_json?.category || d.category,
            } : d));
        } catch (e) {
            console.error(e);
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'ERROR' } : d));
        } finally {
            setProcessingId(null);
        }
    };

    const handleValidate = async (id: string, updatedJSON: ParsedDocumentJson) => {
        try {
            if (isLocalProject) {
                setDocuments(prev => prev.map(d => d.id === id ? { ...d, ai_status: 'VALIDATED', parsed_json: updatedJSON } : d));
                return;
            }

            const res = await fetch('/api/documents/validate', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, documentId: id, validatedData: updatedJSON }),
            });
            const validateData = await res.json().catch(() => null);

            if (!res.ok || validateData?.success === false) {
                throw new Error(validateData?.error || 'Failed validation');
            }

            setDocuments(prev => prev.map(d => d.id === id ? { ...d, ai_status: 'VALIDATED', parsed_json: updatedJSON } : d));

            const params = new URLSearchParams({ projectId });
            if (category) params.set('category', category);
            const refreshRes = await fetch('/api/documents?' + params.toString(), { cache: 'no-store' });
            const refreshData = await refreshRes.json().catch(() => null);
            if (refreshRes.ok && refreshData?.success && Array.isArray(refreshData.documents)) {
                setDocuments(refreshData.documents.map(normalizeDocument));
            }
        } catch (e) {
            console.error('Validation error:', e);
            throw e;
        }
    };

    const handleDelete = async (id: string, fileName: string) => {
        if (!confirm(`האם למחוק את המסמך "${fileName}"?`)) return;

        const previousDocs = [...documents];
        setDocuments(prev => prev.filter(d => d.id !== id));

        if (isLocalProject) return;

        try {
            const res = await fetch(`/api/documents/delete?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed delete');
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            alert(`שגיאה במחיקה: ${message}`);
            setDocuments(previousDocs);
        }
    };

    const getStatusIcon = (status?: string | null) => {
        switch (status) {
            case 'VALIDATED':
                return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
            case 'SCANNED':
                return <Scan className="w-4 h-4 text-blue-400" />;
            case 'PROCESSING':
            case 'EXTRACTING':
                return <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />;
            case 'ERROR':
                return <AlertTriangle className="w-4 h-4 text-red-500" />;
            default:
                return <Clock className="w-4 h-4 text-gray-500" />;
        }
    };

    const getStatusLabel = (status?: string | null) => {
        const labelByStatus: Record<string, string> = {
            VALIDATED: 'מאושר כמקור',
            SCANNED: 'מוכן לבדיקה',
            PROCESSING: 'מנתח מסמך...',
            EXTRACTING: 'קורא מסמך...',
            ERROR: 'שגיאת ניתוח',
            PENDING: 'הועלה, ממתין לניתוח',
        };
        if (!status) return labelByStatus.PENDING;
        if (labelByStatus[status]) return labelByStatus[status];

        switch (status) {
            case 'VALIDATED':
                return 'מאומת';
            case 'SCANNED':
                return 'נסרק ומוכן';
            case 'PROCESSING':
                return 'מנתח מסמך...';
            case 'EXTRACTING':
                return 'קורא את המסמך...';
            case 'ERROR':
                return 'נדרשת בדיקה';
            default:
                return 'ממתין לטיפול';
        }
    };

    const getEvidenceConfidenceLabel = (doc: ProjectDocument) => {
        const rawConfidence = doc.parsed_json?.confidence ?? doc.parsed_json?.confidence_score ?? doc.parsed_json?.document_confidence;
        const confidence = typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence);

        if (doc.parsed_json?.system_error || doc.parsed_json?.analysis_status === 'AI_ERROR') return 'AI לא עבד';
        if (doc.ai_status === 'VALIDATED') return 'אושר ידנית';
        if (doc.ai_status === 'SCANNED') return 'צריך אישור';
        if (doc.extracted_text_hash || doc.ocr_status === 'COMPLETED') return 'טקסט נקרא';

        if (Number.isFinite(confidence) && confidence > 0) {
            const percent = confidence <= 1 ? confidence * 100 : confidence;
            return `${Math.round(percent)}%`;
        }

        if (doc.ai_status === 'VALIDATED') return 'אומת ידנית';
        if (doc.extracted_text_hash || doc.ocr_status === 'COMPLETED' || doc.ai_status === 'SCANNED') return 'נדרש אישור';
        return 'עדיין לא נותח';
    };

    const getCategoryLabel = (docCategory?: string | null) => {
        if (docCategory === 'CONTRACT') return 'חוזה';
        if (docCategory === 'PRICELIST') return 'מחירון';
        return 'ביצוע';
    };

    const cleanDocumentTitle = (title?: string | null) => {
        return String(title || '')
            .replace(/\.(pdf|docx|doc|xlsx|xls|pptx|ppt|rtf|txt|text|csv|tsv|md|markdown|html|htm|odt|ods|odp|ifc|dxf|dwg|dwf|dwfx|rvt|rfa|dgn|skp|mpp|tlv|skn|boq|bq|qty|reg|gdoc|gsheet|gslides|webp|png|jpg|jpeg)$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim();
    };

    const looksCorruptText = (value: string) => {
        if (!value.trim()) return false;
        if (/[�\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return true;
        if (/ג[€”‚]|׳.{0,2}׳|׀/.test(value)) return true;

        const suspicious = (value.match(/[׳״`~^]/g) || []).length;
        return suspicious > 3 && suspicious / Math.max(value.length, 1) > 0.12;
    };

    const inferDocumentType = (doc: ProjectDocument) => {
        const title = cleanDocumentTitle(doc.title).toLowerCase();
        if (/לוז|לוח|schedule/.test(title)) return 'לוח זמנים';
        if (/סיכום|ישיבה|פרוטוקול/.test(title)) return 'סיכום ישיבה';
        if (/מכתב|התכתבות|mail|fw_|re_/.test(title)) return 'מכתב / התכתבות';
        if (/חשבון|מחיר|כמות|boq|כתב כמויות/.test(title)) return 'מסמך כספי';
        if (doc.category === 'CONTRACT') return 'מסמך חוזה';
        if (doc.category === 'PRICELIST') return 'מחירון';
        return 'מסמך ביצוע';
    };

    const getParsedDocumentType = (doc: ProjectDocument) => {
        const parsedType = String(doc.parsed_json?.document_type || doc.parsed_json?.type || '').trim();
        return parsedType && !looksCorruptText(parsedType) ? parsedType : inferDocumentType(doc);
    };

    const hasSystemError = (doc: ProjectDocument) => {
        return doc.ai_status === 'ERROR' || Boolean(doc.parsed_json?.system_error || doc.parsed_json?.analysis_status === 'AI_ERROR');
    };

    const getSystemErrorCode = (doc: ProjectDocument) => {
        return String(doc.parsed_json?.system_errors?.[0]?.code || doc.parsed_json?.system_error || 'AI_ANALYSIS_FAILED');
    };

    const getSystemErrorHint = (doc: ProjectDocument) => {
        const code = getSystemErrorCode(doc);
        const hints: Record<string, string> = {
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

        return hints[code] || hints.AI_ANALYSIS_FAILED;
    };

    const getActionHint = (doc: ProjectDocument) => {
        if (hasSystemError(doc)) return getSystemErrorHint(doc);
        if (doc.ai_status === 'SCANNED') return 'בדוק את מה שהמערכת מצאה ואשר רק אם זה נכון.';
        if (doc.ai_status === 'VALIDATED') return 'המסמך מאושר ויכול לשמש מקור להמשך העבודה.';
        if (doc.ai_status === 'PROCESSING' || doc.ai_status === 'EXTRACTING') return 'המערכת עובדת על המסמך עכשיו.';
        if (doc.extracted_text_hash || doc.ocr_status === 'COMPLETED') return 'הטקסט נקרא, אבל עדיין צריך ניתוח AI.';
        return 'המסמך הועלה ועדיין לא נותח.';
    };

    const getPrimaryActionLabel = (doc: ProjectDocument) => {
        if (hasSystemError(doc)) return 'נסה ניתוח שוב';
        if (doc.ai_status === 'SCANNED') return 'סקירת תוצאות ואישור';
        return 'ניתוח מסמך';
    };

    const getStatusPriority = (doc: ProjectDocument) => {
        if (hasSystemError(doc)) return 0;
        if (doc.ai_status === 'SCANNED') return 1;
        if (doc.ai_status === 'PENDING' || !doc.ai_status) return 2;
        if (doc.ai_status === 'EXTRACTING' || doc.ai_status === 'PROCESSING') return 3;
        if (doc.ai_status === 'VALIDATED') return 4;
        return 5;
    };

    const documentsNeedingAction = documents.filter((doc) =>
        hasSystemError(doc) || doc.ai_status === 'SCANNED' || doc.ai_status === 'PENDING' || !doc.ai_status
    );
    const documentErrors = documents.filter(hasSystemError);
    const validatedDocuments = documents.filter((doc) => doc.ai_status === 'VALIDATED');
    const filterTabs = [
        { id: 'ACTION' as const, label: 'דורש פעולה', count: documentsNeedingAction.length },
        { id: 'ALL' as const, label: 'כל המסמכים', count: documents.length },
        { id: 'ERROR' as const, label: 'שגיאות', count: documentErrors.length },
        { id: 'PENDING' as const, label: 'ממתין לניתוח', count: documents.filter((doc) => doc.ai_status === 'PENDING' || !doc.ai_status).length },
        { id: 'VALIDATED' as const, label: 'מאושרים', count: validatedDocuments.length },
    ];

    const visibleDocuments = documents
        .filter((doc) => {
            if (activeFilter === 'ALL') return true;
            if (activeFilter === 'ACTION') return documentsNeedingAction.some((candidate) => candidate.id === doc.id);
            if (activeFilter === 'ERROR') return hasSystemError(doc);
            if (activeFilter === 'PENDING') return doc.ai_status === 'PENDING' || !doc.ai_status;
            return doc.ai_status === 'VALIDATED';
        })
        .sort((a, b) => getStatusPriority(a) - getStatusPriority(b));

    return (
        <div className="flex flex-col gap-8 p-2 max-w-full overflow-x-hidden" dir="rtl">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-[#151C24]/60 border border-white/5 rounded-[2rem] p-8"
                >
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                            <Layers className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-gray-400">מסמכים בפרויקט</div>
                            <div className="text-3xl font-black text-white mt-1">{documents.length}</div>
                        </div>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="md:col-span-1 bg-[#151C24]/60 border border-white/5 rounded-[2rem] p-8"
                >
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-gray-400">מסמכים מאומתים</div>
                            <div className="text-3xl font-black text-emerald-400 mt-1">
                                {documents.filter(d => d.ai_status === 'VALIDATED').length}
                            </div>
                        </div>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="md:col-span-2 bg-black/40 border border-white/5 rounded-[2rem] p-2 flex items-center"
                >
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 px-5 sm:px-8 py-5 rounded-[1.5rem] border-2 border-dashed transition-all cursor-pointer min-w-0 ${
                            isDragging ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_30px_rgba(59,130,246,0.2)]' : 'border-white/5 hover:border-white/20'
                        }`}
                    >
                        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                            <div className="p-4 bg-white/5 rounded-2xl">
                                <Upload className={`w-6 h-6 ${isUploading ? 'animate-bounce text-blue-400' : 'text-gray-400'}`} />
                            </div>
                            <div className="flex flex-col text-right min-w-0">
                                <span className="text-lg font-black text-white">קליטת מסמכים למערכת</span>
                                <span className="text-sm text-gray-400 font-medium">גרור קבצים או לחץ להעלאה</span>
                            </div>
                        </div>
                        <button className="min-h-11 px-6 py-3 bg-white text-black rounded-xl text-sm font-black hover:scale-105 transition-transform active:scale-95">
                            העלאת מסמך
                        </button>
                    </div>
                    <input type="file" ref={fileInputRef} onChange={handleFileInput} className="hidden" multiple />
                </motion.div>
            </div>

            {isLocalProject && (
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-5 py-4 text-sm font-bold leading-6 text-amber-100">
                    {isDemoProject ? 'מצב הדגמה: הנתונים לא נשמרים ב-Supabase. לבדיקה אמיתית צריך פרויקט אמיתי.' : 'מצב מקומי: חלק מהנתונים נשמרים רק בדפדפן. לבדיקה אמיתית צריך פרויקט Supabase.'}
                </div>
            )}

            <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-[#101720]/70 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="text-base font-black text-white">מה דורש טיפול עכשיו</div>
                        <div className="text-sm text-gray-400">שגיאות וסקירות מופיעות ראשונות כדי שלא תאבד מסמך חשוב.</div>
                    </div>
                    <div className="text-sm font-bold text-amber-300">
                        {documentsNeedingAction.length} מסמכים דורשים פעולה
                    </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveFilter(tab.id)}
                            className={`min-h-11 shrink-0 rounded-xl border px-4 py-2 text-sm font-black transition-all ${
                                activeFilter === tab.id
                                    ? 'border-blue-400 bg-blue-500 text-black'
                                    : 'border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/10'
                            }`}
                        >
                            {tab.label} <span className="opacity-70">({tab.count})</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <AnimatePresence mode="popLayout">
                    {visibleDocuments.map((doc, idx) => (
                        <motion.div
                            key={doc.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ delay: Math.min(idx, 6) * 0.015 }}
                            className="group relative bg-[#151C24]/55 border border-white/5 rounded-[2rem] overflow-hidden hover:bg-white/[0.03] transition-all hover:shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                        >
                            <div className={`absolute top-0 right-0 w-1.5 h-full opacity-30 group-hover:opacity-100 transition-opacity ${
                                doc.category === 'CONTRACT'
                                    ? 'bg-blue-500 shadow-[0_0_15px_blue]'
                                    : doc.category === 'PRICELIST'
                                        ? 'bg-purple-500 shadow-[0_0_15px_purple]'
                                        : 'bg-emerald-500 shadow-[0_0_15px_emerald]'
                            }`} />

                            <div className="p-6 flex flex-col h-full gap-5">
                                <div className="flex justify-between items-start gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center">
                                            <FileText className={`w-4 h-4 ${
                                                doc.category === 'CONTRACT' ? 'text-blue-400' : 'text-emerald-400'
                                            }`} />
                                        </div>
                                        <span className="text-sm font-bold text-gray-400">{getCategoryLabel(doc.category)}</span>
                                    </div>

                                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 border border-white/5 rounded-full">
                                        {getStatusIcon(doc.ai_status)}
                                        <span className="text-xs font-bold text-gray-300">{getStatusLabel(doc.ai_status)}</span>
                                    </div>
                                </div>

                                <div className="flex-1">
                                    <h4 className="text-lg font-black text-gray-100 line-clamp-2 leading-relaxed group-hover:text-white transition-colors" dir="rtl">
                                        {cleanDocumentTitle(doc.title)}
                                    </h4>
                                    <div className="mt-3 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gray-700" />
                                        <span className="text-sm text-gray-400">נוסף בתאריך {new Date(doc.created_at || Date.now()).toLocaleDateString('he-IL')}</span>
                                    </div>
                                    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-bold leading-6 ${
                                        hasSystemError(doc)
                                            ? 'border-red-500/20 bg-red-500/10 text-red-200'
                                            : doc.ai_status === 'SCANNED'
                                                ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                                                : doc.ai_status === 'VALIDATED'
                                                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                                                    : 'border-white/5 bg-black/30 text-gray-300'
                                    }`}>
                                        {getActionHint(doc)}
                                    </div>
                                </div>

                                {doc.parsed_json && !hasSystemError(doc) && (
                                    <div className="p-4 bg-black/40 rounded-2xl border border-white/5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold text-gray-400">מה נמצא במסמך</span>
                                            <span className="hidden">
                                            <span className="text-sm font-bold text-gray-400">פענוח המסמך</span>
                                            </span>
                                            <Cpu className="w-4 h-4 text-blue-500/50" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="flex flex-col">
                                                <span className="text-[11px] text-gray-500 font-bold">סוג מסמך</span>
                                                <span className="text-sm text-gray-200 font-bold truncate">
                                                    {getParsedDocumentType(doc) || 'לא זוהה'}
                                                </span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[11px] text-gray-500 font-bold">רמת ודאות</span>
                                                <span className="text-sm text-amber-400 font-black">{getEvidenceConfidenceLabel(doc)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setSelectedDocForVerification(doc)}
                                            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/5 text-gray-500 hover:text-white hover:bg-white/10 transition-all"
                                            title="פתיחת מסמך"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(doc.id, doc.title || 'document')}
                                            className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-500/[0.03] border border-white/5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 transition-all"
                                            title="מחיקת מסמך"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    <div className="flex flex-wrap justify-end gap-2">
                                        {(doc.ai_status === 'PENDING' || doc.ai_status === 'ERROR' || !doc.ai_status) && (
                                            <button
                                                onClick={() => runAIParsing(doc)}
                                                disabled={Boolean(processingId)}
                                                className={`min-h-11 flex items-center gap-2 px-4 py-3 bg-blue-500 text-black rounded-xl text-sm font-black hover:scale-105 transition-transform active:scale-95 shadow-[0_10px_20px_rgba(59,130,246,0.2)] ${processingId ? 'opacity-60 cursor-not-allowed hover:scale-100' : ''}`}
                                            >
                                                <Play size={12} className="fill-current" />
                                                {processingId === doc.id ? 'מנתח...' : getPrimaryActionLabel(doc)}
                                            </button>
                                        )}
                                        {doc.ai_status === 'SCANNED' && (
                                            <button
                                                onClick={() => setSelectedDocForVerification(doc)}
                                                className="min-h-11 flex items-center gap-2 px-4 py-3 bg-white text-black rounded-xl text-sm font-black hover:scale-105 transition-transform active:scale-95 shadow-xl"
                                            >
                                                <CheckCircle2 size={12} />
                                                {getPrimaryActionLabel(doc)}
                                            </button>
                                        )}
                                        {doc.ai_status === 'VALIDATED' && (
                                            <div className="min-h-11 flex items-center gap-2 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-xl text-sm font-black">
                                                <ShieldCheck size={12} />
                                                מאומת
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
            {documents.length > 0 && visibleDocuments.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-[#151C24]/70 p-8 text-center">
                    <div className="text-lg font-black text-white">אין מסמכים במסנן הזה</div>
                    <div className="mt-2 text-sm font-bold text-gray-400">
                        המסמכים עדיין שמורים בפרויקט. עבור לכל המסמכים כדי לראות אותם.
                    </div>
                    <button
                        onClick={() => setActiveFilter('ALL')}
                        className="mt-5 min-h-11 rounded-xl bg-white px-5 py-3 text-sm font-black text-black transition-transform hover:scale-105 active:scale-95"
                    >
                        הצג את כל המסמכים
                    </button>
                </div>
            )}

            {documents.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-[#151C24]/70 p-8 text-center">
                    <div className="text-lg font-black text-white">עדיין אין מסמכים בפרויקט</div>
                    <div className="mt-2 text-sm font-bold text-gray-400">
                        העלה מסמך חדש כדי להתחיל ניתוח.
                    </div>
                </div>
            )}

            <AnimatePresence>
                {selectedDocForVerification && (
                    <ScreenOfTruthModal
                        document={selectedDocForVerification}
                        projectId={projectId}
                        onClose={() => setSelectedDocForVerification(null)}
                        onValidate={(id, updatedJSON) => handleValidate(id, updatedJSON)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function Clock(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}
