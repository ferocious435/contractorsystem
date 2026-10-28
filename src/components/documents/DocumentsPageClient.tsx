"use client";

import React, { useRef, useState } from 'react';
import ScreenOfTruthModal from './ScreenOfTruthModal';
import { DocumentsCatalogView, type DocumentFilter } from './DocumentsCatalogView';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { Button } from '@/components/ui/titanium/Button';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { isDemoProjectId, isLocalProjectId } from '@/utils/local-projects';
import type { DocumentCategory, ParsedDocumentJson, ProjectDocument } from './types';
import { useAiReadiness } from '@/hooks/useAiReadiness';

interface DocumentsPageClientProps {
    projectId: string;
    initialDocuments?: ProjectDocument[];
    category?: DocumentCategory;
}

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
    const aiStatus = useAiReadiness();
    const [documents, setDocuments] = useState<ProjectDocument[]>(
        (initialDocuments.length ? initialDocuments : buildDemoDocuments(projectId, category)).map(normalizeDocument)
    );
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocForVerification, setSelectedDocForVerification] = useState<ProjectDocument | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [activeFilter, setActiveFilter] = useState<DocumentFilter>('ALL');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(!isLocalProject && initialDocuments.length === 0);
    const [readAttempt, setReadAttempt] = useState(0);
    const [actionError, setActionError] = useState<string | null>(null);
    const [sourceReadErrors, setSourceReadErrors] = useState<Record<string, string>>({});
    const [deleteDocument, setDeleteDocument] = useState<ProjectDocument | null>(null);
    const [deleting, setDeleting] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        let cancelled = false;
        const fetchDocs = async () => {
            if (isLocalProject || (initialDocuments.length > 0 && readAttempt === 0)) return;
            setLoading(true);
            setLoadError(null);
            try {
                const params = new URLSearchParams({ projectId });
                if (category) params.set('category', category);
                const res = await fetch('/api/documents?' + params.toString());
                const data = await res.json();
                if (!res.ok || !data.success || !Array.isArray(data.documents)) throw new Error('DOCUMENT_LIST_READ_FAILED');
                if (!cancelled) {
                    setDocuments((prev) => {
                        const nextDocuments = data.documents.map(normalizeDocument);
                        if (nextDocuments.length === 0 && prev.length > 0) return prev;
                        return nextDocuments;
                    });
                    const loadedIds = new Set(data.documents.map((document: ProjectDocument) => document.id));
                    setSourceReadErrors(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !loadedIds.has(id))));
                }
            } catch {
                if (!cancelled) setLoadError('לא ניתן לטעון את רשימת המסמכים כרגע. אפשר לנסות לקרוא אותה שוב.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void fetchDocs();
        return () => { cancelled = true; };
    }, [projectId, category, initialDocuments.length, isLocalProject, readAttempt]);

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

        setActionError(null);
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

                if (insertedDoc?.id) {
                    setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

                    try {
                        const extractRes = await fetch('/api/documents/extract-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId, documentId: insertedDoc.id }),
                        });
                        const extractData = await extractRes.json();

                        if (extractData.success) {
                            const params = new URLSearchParams({ projectId });
                            if (category) params.set('category', category);
                            const savedResponse = await fetch('/api/documents?' + params.toString());
                            const savedBody = await savedResponse.json();
                            if (!savedResponse.ok || !savedBody.success || !Array.isArray(savedBody.documents)) throw new Error('SAVED_DOCUMENT_READ_FAILED');
                            const savedDocument = savedBody.documents.find((document: ProjectDocument) => document.id === insertedDoc.id);
                            if (!savedDocument) throw new Error('SAVED_DOCUMENT_NOT_FOUND');
                            setDocuments(prev => prev.map(document => document.id === insertedDoc.id ? normalizeDocument(savedDocument) : document));
                        } else {
                            setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                        }
                    } catch {
                        setDocuments(prev => prev.map(d => d.id === insertedDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                        setActionError('הקובץ נשמר, אך הטקסט המלא לא נקרא למסך. יש לקרוא שוב את המסמך לפני אימות המקור.');
                    }
                }
            } catch (err) {
                console.error('Upload error for file:', file.name, err);
                setActionError('חלק מהקבצים לא הועלו. בדוק את הרשימה ונסה שוב את הקבצים החסרים.');
            }
        }

        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const runAIParsing = async (doc: ProjectDocument) => {
        if (processingId) return;
        if (!isLocalProject && aiStatus?.available !== true) return;
        setProcessingId(doc.id);

        if (isLocalProject) {
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'SCANNED', parsed_json: { document_type: 'Demo document', confidence: 0.8 } } : d));
            setProcessingId(null);
            return;
        }

        setSourceReadErrors(previous => ({ ...previous, [doc.id]: 'הטקסט העדכני ייקרא למסך בסיום הניתוח.' }));
        try {
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

            try {
                await fetch('/api/documents/extract-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId, documentId: doc.id }),
                });
            } catch (err) {
                console.warn('Failed to extract text:', err);
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
                    category: data.parsed_json?.category || d.category,
                } : d));
                return;
            }

            setDocuments(prev => prev.map(d => d.id === doc.id ? {
                ...d,
                ai_status: 'SCANNED',
                parsed_json: data.parsed_json,
                category: data.parsed_json?.category || d.category,
            } : d));
        } catch (e) {
            console.error(e);
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'ERROR' } : d));
        } finally {
            try {
                // Read the saved source independently of the analysis result and its category.
                const savedResponse = await fetch('/api/documents?' + new URLSearchParams({ projectId }).toString(), { cache: 'no-store' });
                const savedBody = await savedResponse.json();
                if (!savedResponse.ok || !savedBody.success || !Array.isArray(savedBody.documents)) throw new Error('SAVED_DOCUMENT_READ_FAILED');
                const savedDocument = savedBody.documents.find((document: ProjectDocument) => document.id === doc.id);
                if (!savedDocument) throw new Error('SAVED_DOCUMENT_NOT_FOUND');
                setDocuments(previous => previous.map(document => document.id === doc.id ? normalizeDocument(savedDocument) : document));
                setSourceReadErrors(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== doc.id)));
            } catch {
                setSourceReadErrors(previous => ({ ...previous, [doc.id]: 'הטקסט העדכני לא נקרא למסך. יש לנסות לקרוא אותו שוב; קובץ המקור השמור עדיין זמין לפתיחה.' }));
            }
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

    const handleDelete = async (id: string, confirmed = false) => {
        if (!confirmed) return;

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
            console.error('Delete failed:', e);
            setActionError('המחיקה לא הושלמה. המסמך הוחזר לרשימה.');
            setDocuments(previousDocs);
        }
    };

    const verificationDocument = selectedDocForVerification
        ? documents.find(document => document.id === selectedDocForVerification.id) || selectedDocForVerification
        : null;
    const retryRead = async () => { setReadAttempt(value => value + 1); };

    return <>
        {actionError && <Feedback tone="danger">{actionError}</Feedback>}
        <DocumentsCatalogView documents={documents} category={category} activeFilter={activeFilter} uploading={isUploading} processingId={processingId} selectedId={selectedId} loadError={loadError} loading={loading} sourceReadErrors={sourceReadErrors}
            analysisAvailable={isLocalProject || aiStatus?.available === true} analysisDisabledReason={aiStatus?.available === false ? 'שירות הניתוח אינו זמין כרגע. אפשר לפתוח את המקור השמור.' : 'בודק זמינות שירות הניתוח…'}
            onSelect={setSelectedId} onFilter={setActiveFilter} onRetryRead={retryRead} onUpload={handleFiles} onAnalyze={runAIParsing} onPreview={setSelectedDocForVerification} onDelete={async doc => { setDeleteDocument(doc); }} />
        {verificationDocument && <ScreenOfTruthModal document={verificationDocument} sourceReadError={sourceReadErrors[verificationDocument.id]} onRetryRead={retryRead} retryingRead={loading || Boolean(processingId)} projectId={projectId} onClose={() => setSelectedDocForVerification(null)} onValidate={handleValidate} />}
        <Dialog open={Boolean(deleteDocument)} labelledBy="document-delete-title" onClose={() => { if (!deleting) setDeleteDocument(null); }}>
            <h2 id="document-delete-title" className="ti-section-title">מחיקת מסמך</h2><p className="ti-copy">האם למחוק את המסמך ״{deleteDocument?.title}״?</p>
            <div className="ti-actions"><Button onClick={() => setDeleteDocument(null)} disabled={deleting}>ביטול</Button><Button variant="danger" pending={deleting} busyLabel="מוחק…" onClick={async () => { if (!deleteDocument) return;setDeleting(true);try { await handleDelete(deleteDocument.id, true);setDeleteDocument(null); } finally { setDeleting(false); } }}>מחיקת המסמך</Button></div>
        </Dialog>
    </>;
}
