"use client";

import React, { useState, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Upload, FileText, CheckCircle, AlertTriangle, Eye, Loader2, Play, Trash2 } from 'lucide-react';
import ScreenOfTruthModal from './ScreenOfTruthModal';

interface DocumentsPageClientProps {
    projectId: string;
    initialDocuments?: any[];
    category?: 'CONTRACT' | 'EXECUTION' | 'PRICELIST';
}

export default function DocumentsPageClient({ projectId, initialDocuments = [], category }: DocumentsPageClientProps) {
    const [documents, setDocuments] = useState<any[]>(initialDocuments);
    const supabase = createClient();

    React.useEffect(() => {
        const fetchDocs = async () => {
            let query = supabase
                .from('documents')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false });

            if (category) {
                query = query.eq('category', category);
            }

            const { data } = await query;
            if (data) setDocuments(data);
        };
        fetchDocs();
    }, [projectId, supabase, category]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocForVerification, setSelectedDocForVerification] = useState<any | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Drag and Drop Handlers
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
        setIsUploading(true);
        for (const file of files) {
            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${projectId}/${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

                const { error: storageError } = await supabase.storage.from('documents').upload(fileName, file);
                if (storageError) throw storageError;

                const { data: urlData } = supabase.storage.from('documents').getPublicUrl(fileName);
                const fileUrl = urlData.publicUrl;

                // Категория определяется секцией (prop), а НЕ именем файла
                const catStr = category || 'EXECUTION';

                const { data: newDoc, error: insertError } = await supabase
                    .from('documents')
                    .insert({
                        project_id: projectId,
                        title: file.name,
                        category: catStr,
                        file_url: fileUrl,
                        ai_status: 'PENDING'
                    })
                    .select()
                    .single();

                if (insertError) throw insertError;
                setDocuments(prev => [newDoc, ...prev]);

                // Автоматическое извлечение текста из PDF
                const isPDF = file.name.toLowerCase().endsWith('.pdf');
                if (isPDF && newDoc?.id) {
                    // Обновляем статус — извлекаем текст
                    setDocuments(prev => prev.map(d => d.id === newDoc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

                    try {
                        const extractRes = await fetch('/api/documents/extract-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ documentId: newDoc.id }),
                        });
                        const extractData = await extractRes.json();

                        if (extractData.success) {
                            setDocuments(prev => prev.map(d => d.id === newDoc.id ? {
                                ...d,
                                ai_status: 'SCANNED',
                                extracted_text: `[${extractData.textLength} chars]`
                            } : d));
                            console.log(`[extract] ${file.name}: ${extractData.textLength} chars, ${extractData.pages} pages`);
                        } else {
                            console.warn(`[extract] Failed for ${file.name}:`, extractData.error);
                            setDocuments(prev => prev.map(d => d.id === newDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                        }
                    } catch (extractErr) {
                        console.warn(`[extract] Error for ${file.name}:`, extractErr);
                        setDocuments(prev => prev.map(d => d.id === newDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                    }
                }

            } catch (err) {
                console.error("Upload error for file:", file.name, err);
            }
        }
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };


    const runAIParsing = async (doc: any) => {
        setProcessingId(doc.id);
        try {
            // Optimistic UI Update - show extracting text
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

            // FIRST: extract text
            let extractedTextStr = doc.extracted_text;
            try {
                const extractRes = await fetch('/api/documents/extract-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentId: doc.id })
                });
                const extractData = await extractRes.json();
                if (extractData.success) {
                    extractedTextStr = `[${extractData.textLength} chars]`;
                }
            } catch (err) {
                console.warn("Failed to extract text:", err);
            }

            // NOW: show processing
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'PROCESSING' } : d));

            const res = await fetch('/api/documents/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId: doc.id })
            });

            if (!res.ok) throw new Error("Failed to process document");
            const data = await res.json();

            // ALL documents auto-validate — no manual review ever
            setDocuments(prev => prev.map(d => d.id === doc.id ? {
                ...d,
                ai_status: 'VALIDATED',
                parsed_json: data.parsed_json,
                extracted_text: extractedTextStr,
                category: data.parsed_json?.category || d.category // update category if changed
            } : d));

        } catch (e) {
            console.error(e);
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'ERROR' } : d));
        } finally {
            setProcessingId(null);
        }
    };

    const handleValidate = async (id: string, updatedJSON: any) => {
        try {
            const res = await fetch('/api/documents/validate', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId: id, validatedData: updatedJSON })
            });

            if (!res.ok) throw new Error("Failed validation");

            setDocuments(prev => prev.map(d => d.id === id ? { ...d, ai_status: 'VALIDATED', parsed_json: updatedJSON } : d));
        } catch (e) {
            console.error("Validation error:", e);
            throw e;
        }
    };

    const handleDelete = async (id: string, fileName: string) => {
        if (!confirm(`האם אתה בטוח שברצונך למחוק את המסמך "${fileName}"?`)) return;

        // Optimistic update
        const previousDocs = [...documents];
        setDocuments(prev => prev.filter(d => d.id !== id));

        try {
            const res = await fetch(`/api/documents/delete?id=${id}`, {
                method: 'DELETE',
            });

            if (!res.ok) throw new Error("Failed to delete document");
        } catch (e) {
            console.error("Delete error:", e);
            alert("שגיאה במחיקת המסמך. נסה שוב.");
            // Revert on error
            setDocuments(previousDocs);
        }
    };

    // Helper to render avatars
    const getAvatar = (doc: any, index: number) => {
        if (doc.category === 'CONTRACT') return <div className="w-8 h-8 flex items-center justify-center rounded bg-blue-500/20 text-blue-400 font-bold text-xs border border-blue-500/30">ח-{index + 1}</div>;
        if (doc.title.includes('מפרט')) return <div className="w-8 h-8 flex items-center justify-center rounded bg-purple-500/20 text-purple-400 font-bold text-xs border border-purple-500/30">מ-{index + 1}</div>;
        if (doc.title.includes('כמות') || doc.title.includes('BOQ')) return <div className="w-8 h-8 flex items-center justify-center rounded bg-emerald-500/20 text-emerald-400 font-bold text-xs border border-emerald-500/30">כ"כ-{index + 1}</div>;
        return <div className="w-8 h-8 flex items-center justify-center rounded bg-gray-700 text-gray-300 font-bold text-xs border border-gray-600">כללי</div>;
    };

    let contractIndex = 0;
    let specIndex = 0;
    let boqIndex = 0;

    return (
        <div className="flex-1 flex flex-col gap-6">
            <div
                className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all duration-200 cursor-pointer 
                ${isDragging ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/30 bg-[#11161D]'}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileInput} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.tiff,.bmp,.dwg,.dxf" />
                <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-gray-400 mb-4">
                    {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : <Upload className="w-6 h-6" />}
                </div>
                <h3 className="text-lg font-medium text-white mb-1">
                    {isUploading ? "מעלה מסמכים..." : "גררו מסמכים לכאן או לחצו לבחירה"}
                </h3>
                <p className="text-sm text-gray-500">תמיכה: PDF, Word, Excel, תמונות סרוקות, DWG</p>
                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/5">PDF</span>
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/5">Word</span>
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/5">Excel</span>
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/5">תמונות</span>
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/5">DWG</span>
                </div>
            </div>

            <div className="bg-[#11161D] border border-white/10 rounded-xl overflow-hidden flex-1 flex flex-col">
                <div className="px-6 py-4 border-b border-white/10 bg-[#151C24] flex justify-between items-center">
                    <h2 className="font-semibold text-white">מאגר מסמכים נסרק ({documents.length})</h2>
                </div>
                <div className="overflow-auto flex-1 p-0">
                    <table className="w-full text-right" dir="rtl">
                        <thead className="bg-[#1A222C] border-b border-white/10 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-12 text-center">מס'</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-16">מזהה</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400">שם המסמך</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center">סטטוס מסמך</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center">פעולות AI</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-left">כלים</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {documents.map((doc, idx) => {
                                let avatarIndex = 0;
                                if (doc.category === 'CONTRACT') avatarIndex = contractIndex++;
                                else if (doc.title.includes('מפרט')) avatarIndex = specIndex++;
                                else if (doc.title.includes('כמות') || doc.title.includes('BOQ')) avatarIndex = boqIndex++;

                                return (
                                    <tr key={doc.id} className="hover:bg-white/5 transition-colors group">
                                        <td className="px-6 py-3 text-center">
                                            <span className="text-gray-500 font-mono text-sm">#{String(idx + 1).padStart(2, '0')}</span>
                                        </td>
                                        <td className="px-6 py-3">
                                            {getAvatar(doc, avatarIndex)}
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-200">{doc.title}</span>
                                                <span className="text-xs text-gray-500 font-mono mt-0.5">DOC-{doc.id.substring(0, 8).toUpperCase()}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-center">
                                            {doc.ai_status === 'VALIDATED' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                                    <CheckCircle className="w-3.5 h-3.5" /> מאומת ומקושר
                                                </span>
                                            )}
                                            {(doc.ai_status === 'SCANNED') && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                                    <CheckCircle className="w-3.5 h-3.5" /> נסרק ונקלט
                                                </span>
                                            )}
                                            {doc.ai_status === 'PROCESSING' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> סורק באמצעות AI...
                                                </span>
                                            )}
                                            {doc.ai_status === 'EXTRACTING' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> מחלץ טקסט מ-PDF...
                                                </span>
                                            )}
                                            {doc.ai_status === 'PENDING' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300 border border-gray-600">
                                                    <FileText className="w-3.5 h-3.5" /> ממתין לעיבוד
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3 text-center">
                                            {doc.ai_status === 'PENDING' && (
                                                <button
                                                    onClick={() => runAIParsing(doc)}
                                                    disabled={processingId === doc.id}
                                                    className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors text-xs font-medium"
                                                >
                                                    <Play className="w-3 h-3" /> הפעל OCR/סריקה
                                                </button>
                                            )}
                                            {doc.ai_status === 'VALIDATED' && (
                                                <span className="text-xs text-green-400">נקלט ✓</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3 text-left">
                                            <div className="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                {doc.file_url && (
                                                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors" title="צפה במקור">
                                                        <Eye className="w-4 h-4" />
                                                    </a>
                                                )}
                                                {doc.ai_status === 'VALIDATED' && (
                                                    <button
                                                        onClick={() => setSelectedDocForVerification(doc)}
                                                        className="p-1.5 text-gray-400 hover:text-primary hover:bg-primary/10 rounded transition-colors" title="צפה בנתונים מאומתים"
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(doc.id, doc.title)}
                                                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title="מחק מסמך"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {documents.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-12 text-center text-gray-500">
                                        טרם הועלו מסמכים לפרויקט. השתמשו באזור העלאה למעלה.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selectedDocForVerification && (
                <ScreenOfTruthModal
                    document={selectedDocForVerification}
                    onClose={() => setSelectedDocForVerification(null)}
                    onValidate={handleValidate}
                />
            )}
        </div>
    );
}

