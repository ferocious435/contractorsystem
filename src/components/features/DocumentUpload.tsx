"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function DocumentUpload({ projectId, onUploadSuccess, docType = 'contract' }: { projectId: string; onUploadSuccess?: (doc: any) => void; docType?: string }) {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const supabase = createClient();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setError(null);

        try {
            // 1. Upload file to Supabase Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${projectId}/${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

            const { data: storageData, error: storageError } = await supabase
                .storage
                .from('documents')
                .upload(fileName, file);

            if (storageError) throw storageError;

            // 2. Get Public URL
            const { data: urlData } = supabase
                .storage
                .from('documents')
                .getPublicUrl(fileName);

            const fileUrl = urlData.publicUrl;

            // 3. Создание записи в таблице 'documents'
            // Категория определяется секцией загрузки, а НЕ захардкожена
            const dbCategory = docType === 'contract' ? 'CONTRACT' : 'EXECUTION';
            const { data: docData, error: docError } = await supabase
                .from('documents')
                .insert({
                    project_id: projectId,
                    title: file.name,
                    category: dbCategory,
                    doc_type: docType,
                    file_url: fileUrl,
                    ai_status: 'PENDING'
                })
                .select()
                .single();

            if (docError) throw docError;

            if (onUploadSuccess) {
                onUploadSuccess(docData);
            }

        } catch (err: any) {
            console.error("Upload error:", err);
            setError(err.message || "Failed to upload document.");
        } finally {
            setIsUploading(false);
            // Reset input
            e.target.value = '';
        }
    };

    return (
        <div className="h-full flex flex-col">
            <h2 className="text-xl font-bold mb-5 flex items-center gap-3 text-white drop-shadow-sm">
                <span>העלאת מסמכים</span>
            </h2>
            <div className="bg-workspace p-8 border-dashed border-2 border-border-subtle rounded-xl flex-1 flex flex-col items-center justify-center text-center space-y-5 hover:border-primary/50 hover:shadow-[0_4px_20px_rgba(59,130,246,0.1)] transition-all cursor-pointer relative group min-h-[300px]">
                <input
                    type="file"
                    onChange={handleFileChange}
                    disabled={isUploading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx,.rtf,.txt,.skn,.dwg,.msg,.eml"
                />

                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300 border border-primary/20 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                </div>
                <div>
                    <h3 className="font-rubik text-lg font-semibold text-white group-hover:text-primary transition-colors">בחר או גרור קובץ</h3>
                    <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto leading-relaxed">PDF, Excel, Word, SKN, תוכניות, אימיילים ועוד</p>
                </div>

                {isUploading && (
                    <div className="px-4 py-2 rounded-full bg-primary/20 border border-primary/30 text-primary animate-pulse text-sm font-medium mt-4">
                        מעלה קובץ...
                    </div>
                )}
                {error && (
                    <div className="text-red-400 text-sm font-medium mt-4 bg-red-400/10 px-3 py-2 rounded-md border border-red-400/20 z-20 relative">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
