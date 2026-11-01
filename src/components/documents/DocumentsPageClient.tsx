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
import {requestDocumentAnalysis,requestDocumentReading,uploadDocumentAndAnalyze,observeDocumentJob,restoreDocumentJobs,cancelDocumentJob,fetchSavedDocument} from './documentAiApi';
import type {JobDto} from '@/server/ai/contracts';
import {documentJobStatusText} from './documentDisplayStatus';

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
    const aiStatus = useAiReadiness('document_analysis');
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
    const [readingId,setReadingId]=useState<string|null>(null),sourceProject=useRef(projectId),actionRunning=useRef(false);
    sourceProject.current=projectId;
    const completeSourceReading=async(document:ProjectDocument)=>{
        await runAIParsing(document,'read_source');
    };

    const [processingJob,setProcessingJob]=useState<JobDto|null>(null);
    const [analysisReady,setAnalysisReady]=useState(isLocalProject);
    const analysisObserver=useRef<AbortController|null>(null);
    React.useEffect(()=>{
        if(isLocalProject)return;let active=true;const controller=new AbortController();analysisObserver.current=controller;setAnalysisReady(false);setProcessingId(null);setProcessingJob(null);setReadingId(null);setIsUploading(false);actionRunning.current=false;
        void restoreDocumentJobs(projectId).then(async jobs=>{
            if(!active||controller.signal.aborted||analysisObserver.current!==controller)return;
            setAnalysisReady(true);const job=jobs.find(value=>value.state==='QUEUED'||value.state==='RUNNING');
            if(!job){if(jobs[0]&&['FAILED','CANCELLED','INTERRUPTED'].includes(jobs[0].state))setActionError('הניתוח האחרון לא הושלם. הנתונים השמורים נשמרו.');return;}
            actionRunning.current=true;setProcessingJob(job);setProcessingId(job.clientContextId);if(job.operation==='read_source')setReadingId(job.clientContextId);
            const result=await observeDocumentJob(job,controller.signal,value=>{if(active&&!controller.signal.aborted)setProcessingJob(value);}),saved=await fetchSavedDocument(projectId,String(job.clientContextId),controller.signal);
            if(!active||controller.signal.aborted)return;setDocuments(previous=>previous.map(value=>value.id===saved.id?saved:value));
            if(result.partial===true)setActionError('הניתוח חלקי. קריאת המקור והפרטים החסרים מסומנים לבדיקה.');
        }).catch(()=>{if(active&&!controller.signal.aborted)setActionError('לא ניתן להשלים או לשחזר את הפעולה. הנתונים נשמרו.');}).finally(()=>{if(active){setAnalysisReady(true);if(analysisObserver.current===controller){actionRunning.current=false;setProcessingId(null);setProcessingJob(null);setReadingId(null);}}});
        return()=>{active=false;controller.abort();analysisObserver.current?.abort();};
    },[projectId,isLocalProject]);
    const cancelAnalysis=async()=>{
        if(!processingJob)return;
        const controller=analysisObserver.current;
        try{const stopped=await cancelDocumentJob(processingJob);if(sourceProject.current!==projectId||analysisObserver.current!==controller)return;controller?.abort();
            const saved=await fetchSavedDocument(projectId,String(processingJob.clientContextId));if(sourceProject.current!==projectId||analysisObserver.current!==controller)return;setDocuments(previous=>previous.map(value=>value.id===saved.id?saved:value));
            setActionError(stopped.state==='SUCCEEDED'?'הפעולה כבר הסתיימה. התוצאה השמורה זמינה.':'הפעולה בוטלה. הנתונים השמורים נשמרו.');actionRunning.current=false;setIsUploading(false);setReadingId(null);setProcessingId(null);setProcessingJob(null);
        }catch{if(sourceProject.current===projectId)setActionError('לא ניתן לאשר שהפעולה בוטלה. אפשר לנסות שוב.');}
    };

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
        if(actionRunning.current)return;
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
        actionRunning.current=true;analysisObserver.current?.abort();const controller=new AbortController();analysisObserver.current=controller;
        const current=()=>sourceProject.current===projectId&&!controller.signal.aborted&&analysisObserver.current===controller;

        for (const file of files) {
            if(!current())break;
            try {
                const saved=await uploadDocumentAndAnalyze(projectId,file,category||'EXECUTION',{signal:controller.signal,
                    onUploaded:document=>{if(current()){setProcessingId(document.id);setDocuments(previous=>previous.some(value=>value.id===document.id)?previous: [document,...previous]);}},
                    onAccepted:job=>{if(current())setProcessingJob(job);},onProgress:job=>{if(current())setProcessingJob(job);}});
                if(current())setDocuments(previous=>previous.map(document=>document.id===saved.id?normalizeDocument(saved):document));
            } catch (err) {
                if(!current())break;
                console.error('Upload or document job failed:', file.name, err);
                setActionError('הפעולה לא הושלמה. הקבצים והתוצאות שכבר נשמרו זמינים ברשימה; אפשר לנסות שוב.');setReadAttempt(value=>value+1);
            }
        }

        if(current()){actionRunning.current=false;setIsUploading(false);setProcessingId(null);setProcessingJob(null);}
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const runAIParsing = async (doc: ProjectDocument,operation:'analyze'|'read_source'='analyze') => {
        if (actionRunning.current) return;
        if (!isLocalProject && aiStatus?.available !== true){setActionError('העוזר אינו זמין כרגע. קובץ המקור והטקסט השמור זמינים לפתיחה.');return;}
        actionRunning.current=true;
        setProcessingId(doc.id);
        analysisObserver.current?.abort();const controller=new AbortController();analysisObserver.current=controller;setActionError(null);
        if(operation==='read_source')setReadingId(doc.id);
        const current=()=>sourceProject.current===projectId&&!controller.signal.aborted&&analysisObserver.current===controller;
        const progress=(job:JobDto)=>{if(current())setProcessingJob(job);};

        if (isLocalProject) {
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'SCANNED', parsed_json: { document_type: 'Demo document', confidence: 0.8 } } : d));
            setProcessingId(null);
            setReadingId(null);actionRunning.current=false;
            return;
        }

        setSourceReadErrors(previous => ({ ...previous, [doc.id]: operation==='read_source'?'הטקסט העדכני ייקרא למסך בסיום הקריאה.':'הטקסט העדכני ייקרא למסך בסיום הניתוח.' }));
        try {
            controller.signal.throwIfAborted();
            if(operation==='read_source'){await requestDocumentReading(projectId,doc.id,{signal:controller.signal,onAccepted:progress,onProgress:progress});return;}
            const result=await requestDocumentAnalysis(projectId,doc.id,{signal:controller.signal,onAccepted:progress,onProgress:progress});
            if(!current())return;
            if(result.partial===true)setActionError(typeof result.message==='string'?result.message:'הניתוח חלקי. הפרטים והמקורות החסרים נשמרו לבדיקה.');
        } catch (e) {
            if(!current())return;
            setActionError('הניתוח לא הושלם. הנתונים השמורים נשמרו.');
            console.error(e);
        } finally {
            if(current()){
            try {
                const savedDocument=await fetchSavedDocument(projectId,doc.id,controller.signal);if(!current())return;
                setDocuments(previous => previous.map(document => document.id === doc.id ? normalizeDocument(savedDocument) : document));
                setSourceReadErrors(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== doc.id)));
            } catch {
                if(current())setSourceReadErrors(previous => ({ ...previous, [doc.id]: 'הטקסט העדכני לא נקרא למסך. יש לנסות לקרוא אותו שוב; קובץ המקור השמור עדיין זמין לפתיחה.' }));
            }
            if(current()){actionRunning.current=false;setProcessingId(null);setProcessingJob(null);setReadingId(null);}
            }
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
        {processingJob&&processingId&&<Feedback aria-live="polite"><p>{documentJobStatusText(processingJob)} · אפשר לסגור ולחזור.</p><Button onClick={()=>void cancelAnalysis()}>ביטול הפעולה</Button></Feedback>}
        <DocumentsCatalogView documents={documents} category={category} activeFilter={activeFilter} uploading={isUploading} processingId={processingId} selectedId={selectedId} loadError={loadError} loading={loading} sourceReadErrors={sourceReadErrors}
            analysisAvailable={isLocalProject || (analysisReady && aiStatus?.available === true)} analysisDisabledReason={aiStatus?.available === false ? 'שירות הניתוח אינו זמין כרגע. אפשר לפתוח את המקור השמור.' : 'בודק זמינות שירות הניתוח…'}
            onSelect={setSelectedId} onFilter={setActiveFilter} onRetryRead={retryRead} onReadSource={completeSourceReading} readingId={readingId} onUpload={handleFiles} onAnalyze={runAIParsing} onPreview={setSelectedDocForVerification} onDelete={async doc => { setDeleteDocument(doc); }} />
        {verificationDocument && <ScreenOfTruthModal document={verificationDocument} sourceReadError={sourceReadErrors[verificationDocument.id]} onRetryRead={retryRead} retryingRead={loading || Boolean(processingId)} onCompleteReading={()=>completeSourceReading(verificationDocument)} completingReading={Boolean(readingId||processingId)} projectId={projectId} onClose={() => setSelectedDocForVerification(null)} onValidate={handleValidate} />}
        <Dialog open={Boolean(deleteDocument)} labelledBy="document-delete-title" onClose={() => { if (!deleting) setDeleteDocument(null); }}>
            <h2 id="document-delete-title" className="ti-section-title">מחיקת מסמך</h2><p className="ti-copy">האם למחוק את המסמך ״{deleteDocument?.title}״?</p>
            <div className="ti-actions"><Button onClick={() => setDeleteDocument(null)} disabled={deleting}>ביטול</Button><Button variant="danger" pending={deleting} busyLabel="מוחק…" onClick={async () => { if (!deleteDocument) return;setDeleting(true);try { await handleDelete(deleteDocument.id, true);setDeleteDocument(null); } finally { setDeleting(false); } }}>מחיקת המסמך</Button></div>
        </Dialog>
    </>;
}
