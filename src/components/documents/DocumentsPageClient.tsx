"use client";

import React, { useState, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { 
    Upload, FileText, CheckCircle, AlertTriangle, Eye, 
    Loader2, Play, Trash2, Database, ShieldCheck, 
    Cpu, Scan, Zap, Layers, Activity, FileSearch, CheckCircle2
} from 'lucide-react';
import ScreenOfTruthModal from './ScreenOfTruthModal';
import { motion, AnimatePresence } from 'framer-motion';

interface DocumentsPageClientProps {
    projectId: string;
    initialDocuments?: any[];
    category?: 'CONTRACT' | 'EXECUTION' | 'PRICELIST';
}

export default function DocumentsPageClient({ projectId, initialDocuments = [], category }: DocumentsPageClientProps) {
    const normalizeDocument = (doc: any) => {
        const hasUsefulExtraction = Boolean(
            doc.extracted_text_hash ||
            doc.ocr_status === 'COMPLETED' ||
            (typeof doc.extracted_text === 'string' && doc.extracted_text.length > 1000)
        );

        if (doc.ai_status === 'VALIDATED') return doc;
        if (hasUsefulExtraction && (doc.ai_status === 'PENDING' || doc.ai_status === 'DONE')) {
            return { ...doc, ai_status: 'SCANNED' };
        }

        return doc;
    };

    const [documents, setDocuments] = useState<any[]>(initialDocuments.map(normalizeDocument));
    const supabase = createClient();

    React.useEffect(() => {
        const fetchDocs = async () => {
            let query = supabase
                .from('documents')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false });

            if (category === 'CONTRACT') {
                // Если мы в контрактах, ищем либо по категории, либо по названию (для тех, что загрузились не туда)
                query = query.or(`category.eq.CONTRACT,title.ilike.%חוזה%,title.ilike.%הסכם%`);
            } else if (category) {
                query = query.eq('category', category);
            }

            const { data } = await query;
            if (data) {
                setDocuments(data.map(normalizeDocument));
            }
        };
        fetchDocs();
    }, [projectId, supabase, category]);

    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocForVerification, setSelectedDocForVerification] = useState<any | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

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

                const isPDF = file.name.toLowerCase().endsWith('.pdf');
                if (isPDF && newDoc?.id) {
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
                                extracted_text: `[${extractData.textLength} תווים]`
                            } : d));
                        } else {
                            setDocuments(prev => prev.map(d => d.id === newDoc.id ? { ...d, ai_status: 'PENDING' } : d));
                        }
                    } catch (extractErr) {
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
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'EXTRACTING' } : d));

            let extractedTextStr = doc.extracted_text;
            try {
                const extractRes = await fetch('/api/documents/extract-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentId: doc.id })
                });
                const extractData = await extractRes.json();
                if (extractData.success) {
                    extractedTextStr = `[${extractData.textLength} תווים]`;
                }
            } catch (err) {
                console.warn("Failed to extract text:", err);
            }

            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ai_status: 'PROCESSING' } : d));

            const res = await fetch('/api/documents/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId: doc.id })
            });

            if (!res.ok) throw new Error("Failed to process document");
            const data = await res.json();

            setDocuments(prev => prev.map(d => d.id === doc.id ? {
                ...d,
                ai_status: 'SCANNED',
                parsed_json: data.parsed_json,
                extracted_text: extractedTextStr,
                category: data.parsed_json?.category || d.category
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

        const previousDocs = [...documents];
        setDocuments(prev => prev.filter(d => d.id !== id));

        try {
            const res = await fetch(`/api/documents/delete?id=${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed delete");
            }
            console.log("Document deleted successfully");
        } catch (e: any) {
            alert(`שגיאה במחיקה: ${e.message}`);
            setDocuments(previousDocs);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'VALIDATED': return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
            case 'SCANNED': return <Scan className="w-4 h-4 text-blue-400" />;
            case 'PROCESSING': 
            case 'EXTRACTING': return <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />;
            case 'ERROR': return <AlertTriangle className="w-4 h-4 text-red-500" />;
            default: return <Clock className="w-4 h-4 text-gray-500" />;
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'VALIDATED': return 'כספת_מאומתת';
            case 'SCANNED': return 'חילוץ_נתונים_מוכן';
            case 'PROCESSING': return 'סריקת_AI_עמוקה...';
            case 'EXTRACTING': return 'פענוח_טקסט...';
            case 'ERROR': return 'שגיאת_לוגיקה';
            default: return 'ממתין_לקליטה';
        }
    };

    const getEvidenceConfidenceLabel = (doc: any) => {
        const rawConfidence = doc.parsed_json?.confidence ?? doc.parsed_json?.confidence_score ?? doc.parsed_json?.document_confidence;
        const confidence = typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence);

        if (Number.isFinite(confidence) && confidence > 0) {
            const percent = confidence <= 1 ? confidence * 100 : confidence;
            return `${Math.round(percent)}%`;
        }

        if (doc.ai_status === 'VALIDATED') return 'אומת ידנית';
        if (doc.extracted_text_hash || doc.ocr_status === 'COMPLETED' || doc.ai_status === 'SCANNED') return 'נדרש אימות';
        return 'לא אומת';
    };

    return (
        <div className="flex flex-col gap-10 p-2 max-w-full overflow-x-hidden" dir="rtl">
            {/* Header: Document Intelligence Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-[#151C24]/50 border border-white/5 rounded-[2.5rem] p-8 flex flex-col gap-4 relative overflow-hidden"
                >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                            <Layers className="w-5 h-5 text-blue-400" />
                        </div>
                        <div className="flex flex-col">
                        <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest">נכסי_מסמכים</span>
                            <span className="text-2xl font-mono font-black text-white">{documents.length}</span>
                        </div>
                    </div>
                </motion.div>

                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="md:col-span-1 bg-[#151C24]/50 border border-white/5 rounded-[2.5rem] p-8 flex flex-col gap-4 relative overflow-hidden"
                >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest">אבטחה_מאומתת</span>
                            <span className="text-2xl font-mono font-black text-emerald-400">{documents.filter(d => d.ai_status === 'VALIDATED').length}</span>
                        </div>
                    </div>
                </motion.div>

                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="md:col-span-2 bg-black/40 border border-white/5 rounded-[2.5rem] p-2 flex items-center"
                >
                    <div 
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 px-4 sm:px-8 py-4 rounded-[2rem] border-2 border-dashed transition-all cursor-pointer min-w-0 ${
                            isDragging ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_30px_rgba(59,130,246,0.2)]' : 'border-white/5 hover:border-white/20'
                        }`}
                    >
                        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                            <div className="p-4 bg-white/5 rounded-2xl">
                                <Upload className={`w-6 h-6 ${isUploading ? 'animate-bounce text-blue-400' : 'text-gray-400'}`} />
                            </div>
                            <div className="flex flex-col text-right min-w-0">
                                <span className="text-sm font-black text-white uppercase tracking-tight font-mono">קליטת_מסמכים_לבינה_מלאכותית</span>
                                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">גרור_קבצים_לזיהוי_אוטומטי</span>
                            </div>
                        </div>
                        <button className="min-h-11 px-6 py-3 bg-white text-black rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform active:scale-95">
                            העלאת_מסמך
                        </button>
                    </div>
                    <input type="file" ref={fileInputRef} onChange={handleFileInput} className="hidden" multiple />
                </motion.div>
            </div>

            {/* Document Matrix */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <AnimatePresence mode="popLayout">
                    {documents.map((doc, idx) => (
                        <motion.div 
                            key={doc.id}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ delay: idx * 0.05 }}
                            className="group relative bg-[#151C24]/50 border border-white/5 rounded-[2rem] overflow-hidden hover:bg-white/[0.03] transition-all hover:shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                        >
                            {/* Visual Type Indicator */}
                            <div className={`absolute top-0 right-0 w-1.5 h-full opacity-30 group-hover:opacity-100 transition-opacity ${
                                doc.category === 'CONTRACT' ? 'bg-blue-500 shadow-[0_0_15px_blue]' : 
                                doc.category === 'PRICELIST' ? 'bg-purple-500 shadow-[0_0_15px_purple]' : 'bg-emerald-500 shadow-[0_0_15px_emerald]'
                            }`} />

                            <div className="p-6 flex flex-col h-full gap-5">
                                {/* Card Header */}
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-black/40 border border-white/5 flex items-center justify-center">
                                            <FileText className={`w-4 h-4 ${
                                                doc.category === 'CONTRACT' ? 'text-blue-400' : 'text-emerald-400'
                                            }`} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-mono font-black text-gray-500 uppercase tracking-widest">
                                                {doc.category === 'CONTRACT' ? 'חוזה' : doc.category === 'PRICELIST' ? 'מחירון' : 'ביצוע'}
                                            </span>
                                            <span className="text-[8px] font-mono text-gray-600 uppercase tracking-tighter">
                                                ID: {doc.id.substring(0, 8)}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-black/40 border border-white/5 rounded-full">
                                        {getStatusIcon(doc.ai_status)}
                                        <span className="text-[9px] font-mono font-black uppercase tracking-widest text-gray-400">
                                            {getStatusLabel(doc.ai_status)}
                                        </span>
                                    </div>
                                </div>

                                {/* Title */}
                                <div className="flex-1">
                                    <h4 className="text-sm font-black text-gray-200 line-clamp-2 leading-relaxed group-hover:text-white transition-colors" dir="rtl">
                                        {doc.title}
                                    </h4>
                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="w-1 h-1 rounded-full bg-gray-700" />
                                        <span className="text-[9px] font-mono text-gray-600 uppercase">נרשם בתאריך: {new Date(doc.created_at).toLocaleDateString('he-IL')}</span>
                                    </div>
                                </div>

                                {/* AI Intelligence Panel */}
                                {doc.parsed_json && (
                                    <div className="p-4 bg-black/40 rounded-2xl border border-white/5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[8px] font-mono font-black text-gray-600 uppercase tracking-widest">חילוץ_נתונים</span>
                                            <Cpu className="w-3 h-3 text-blue-500/50" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="flex flex-col">
                                                <span className="text-[8px] text-gray-600 uppercase font-black">סוג</span>
                                                <span className="text-[10px] text-gray-400 font-bold truncate">{doc.parsed_json.document_type || '---'}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[8px] text-gray-600 uppercase font-black">רמת_ודאות</span>
                                                <span className="text-[10px] text-amber-400 font-black">{getEvidenceConfidenceLabel(doc)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Actions Bar */}
                                <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => window.open(doc.file_url, '_blank')}
                                            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/5 text-gray-500 hover:text-white hover:bg-white/10 transition-all shadow-sm"
                                            title="צפייה במקור"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button 
                                            onClick={() => handleDelete(doc.id, doc.title)}
                                            className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-500/[0.03] border border-white/5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 transition-all shadow-sm"
                                            title="מחיקת מסמך"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    <div className="flex gap-2">
                                        {(doc.ai_status === 'PENDING' || doc.ai_status === 'ERROR') && (
                                            <button 
                                                onClick={() => runAIParsing(doc)}
                                                disabled={processingId === doc.id}
                                                className="min-h-11 flex items-center gap-2 px-4 py-3 bg-blue-500 text-black rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-transform active:scale-95 shadow-[0_10px_20px_rgba(59,130,246,0.2)]"
                                            >
                                                <Play size={12} className="fill-current" />
                                                הפעל_סריקה
                                            </button>
                                        )}
                                        {doc.ai_status === 'SCANNED' && (
                                            <button 
                                                onClick={() => setSelectedDocForVerification(doc)}
                                                className="min-h-11 flex items-center gap-2 px-4 py-3 bg-white text-black rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-transform active:scale-95 shadow-xl"
                                            >
                                                <CheckCircle2 size={12} />
                                                אימות_נתונים
                                            </button>
                                        )}
                                        {doc.ai_status === 'VALIDATED' && (
                                            <div className="min-h-11 flex items-center gap-2 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-xl text-[9px] font-black uppercase tracking-widest">
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

            {/* Verification Modal */}
            <AnimatePresence>
                {selectedDocForVerification && (
                    <ScreenOfTruthModal
                        document={selectedDocForVerification}
                        onClose={() => setSelectedDocForVerification(null)}
                        onValidate={(id: string, updatedJSON: any) => handleValidate(id, updatedJSON)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function Clock(props: any) {
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
    )
}
