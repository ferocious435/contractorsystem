"use client";

import React, { useState, useRef, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Upload, FileText, CheckCircle, AlertTriangle, Eye, Loader2, Play, Trash2, Database, X, Search } from 'lucide-react';
import * as xlsx from 'xlsx';

interface PricelistsPageClientProps {
    projectId: string;
}

export default function PricelistsPageClient({ projectId }: PricelistsPageClientProps) {
    const [pricelists, setPricelists] = useState<any[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number, step: string } | null>(null);
    
    // View Items State
    const [selectedPricelist, setSelectedPricelist] = useState<any>(null);
    const [items, setItems] = useState<any[]>([]);
    const [isLoadingItems, setIsLoadingItems] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [totalItems, setTotalItems] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const supabase = createClient();

    useEffect(() => {
        fetchPricelists();
    }, [projectId, supabase]);

    const fetchPricelists = async () => {
        const { data, error } = await supabase
            .from('pricelists')
            .select('*, pricelist_items(count)')
            .or(`project_id.eq.${projectId},is_global.eq.true`)
            .order('created_at', { ascending: false });
        
        if (data) {
            setPricelists(data);
        }
    };

    const fetchItems = async (pricelistId: string, reset = false, search = '') => {
        setIsLoadingItems(true);
        const currentPage = reset ? 0 : page;
        const PAGE_SIZE = 100;
        
        let query = supabase
            .from('pricelist_items')
            .select('*', { count: 'exact' })
            .eq('pricelist_id', pricelistId)
            .order('item_code', { ascending: true })
            .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

        if (search) {
            query = query.or(`description.ilike.%${search}%,item_code.ilike.%${search}%`);
        }
        
        const { data, count, error } = await query;
        
        if (data) {
            if (reset) {
                setItems(data);
                setPage(1);
            } else {
                setItems(prev => [...prev, ...data]);
                setPage(currentPage + 1);
            }
            setHasMore(data.length === PAGE_SIZE);
            if (count !== null) setTotalItems(count);
        }
        setIsLoadingItems(false);
    };

    const handleSearch = (val: string) => {
        setSearchTerm(val);
        // Debounce or just trigger on enter/button? Let's do a small delay
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            if (selectedPricelist) {
                fetchItems(selectedPricelist.id, true, searchTerm);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

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
        const file = files[0];
        if (!file) return;

        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf';

        if (!isExcel && !isImage && !isPDF) {
            alert('אנא העלה קובץ אקסל, PDF או תמונה.');
            return;
        }

        setIsUploading(true);
        setUploadProgress({ current: 0, total: 0, step: 'קורא קובץ...' });

        try {
            if (isExcel) {
                // Legacy Excel Client-side parsing
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const data = e.target?.result;
                        setUploadProgress({ current: 0, total: 0, step: 'מפענח נתונים (Parsing)...' });
                        
                        const workbook = xlsx.read(data, { type: 'binary' });
                        const sheetName = workbook.SheetNames[0];
                        const sheet = workbook.Sheets[sheetName];
                        const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

                        setUploadProgress({ current: 0, total: rows.length, step: 'מכין נתונים לשמירה...' });

                        const { data: pricelist, error: plError } = await supabase
                            .from('pricelists')
                            .insert({
                                project_id: projectId,
                                name: file.name.replace('.xlsx', '').replace('.xls', ''),
                                description: 'הועלה ידנית מהמערכת',
                                is_global: false
                            })
                            .select()
                            .single();

                        if (plError) throw plError;

                        const itemsToInsert = [];
                        for (let i = 1; i < rows.length; i++) {
                            const row = rows[i];
                            if (!row || row.length < 2) continue;
                            
                            const service_type = row[0] ? String(row[0]) : '';
                            const item_code = row[1] ? String(row[1]) : '';
                            const description = row[2] ? String(row[2]) : '';
                            const activity_number = row[3] ? String(row[3]) : '';
                            const quantity = parseFloat(row[4]) || 0;
                            const unit = row[5] ? String(row[5]).trim() : '';
                            const rate = parseFloat(row[6]) || 0;

                            let item_type = 'ITEM';
                            if (item_code.endsWith('...')) item_type = 'CHAPTER';
                            else if (item_code.endsWith('..') || item_code.endsWith('.')) item_type = 'SUBCHAPTER';
                            else if (rate === 0 && !unit) item_type = 'NOTE';

                            itemsToInsert.push({
                                pricelist_id: pricelist.id,
                                item_type,
                                item_code,
                                description,
                                unit: unit || null,
                                quantity,
                                rate,
                                service_type,
                                activity_number: activity_number || null
                            });
                        }

                        const BATCH_SIZE = 500;
                        let insertedCount = 0;
                        for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
                            const batch = itemsToInsert.slice(i, i + BATCH_SIZE);
                            setUploadProgress({ current: insertedCount, total: itemsToInsert.length, step: 'שומר נתונים...' });
                            
                            const { error } = await supabase.from('pricelist_items').insert(batch);
                            if (error) throw error;
                            insertedCount += batch.length;
                        }

                        setUploadProgress(null);
                        setIsUploading(false);
                        fetchPricelists();
                    } catch (err) {
                        console.error(err);
                        alert("שגיאה בתהליך עיבוד המחירון");
                        setIsUploading(false);
                        setUploadProgress(null);
                    }
                };
                reader.readAsBinaryString(file);
            } else {
                // NEW: Universal AI Server-side parsing
                setUploadProgress({ current: 0, total: 1, step: 'מנתח קובץ באמצעות AI (Gemini)...' });
                
                const formData = new FormData();
                formData.append('file', file);
                formData.append('projectId', projectId);
                formData.append('name', file.name.split('.')[0]);

                const response = await fetch('/api/pricing/upload-universal', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'AI Processing failed');
                }

                setUploadProgress(null);
                setIsUploading(false);
                fetchPricelists();
            }
            
        } catch (err) {
            console.error("Upload error:", err);
            setIsUploading(false);
            setUploadProgress(null);
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`האם אתה בטוח שברצונך למחוק את המחירון "${name}"? כל סעיפי המחירון ימחקו גם כן.`)) return;

        try {
            const { error } = await supabase.from('pricelists').delete().eq('id', id);
            if (error) throw error;
            fetchPricelists();
        } catch (e) {
            console.error(e);
            alert("שגיאה במחיקת המחירון.");
        }
    };

    return (
        <div className="flex-1 flex flex-col gap-6 rtl" dir="rtl">
            <div
                className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all duration-200 cursor-pointer 
                ${isDragging ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/30 bg-[#11161D]'}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isUploading && fileInputRef.current?.click()}
            >
                <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileInput} accept=".xls,.xlsx,.pdf,image/*" disabled={isUploading} />
                
                {isUploading ? (
                    <div className="flex flex-col items-center">
                        <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
                        <h3 className="text-lg font-medium text-white mb-2">{uploadProgress?.step}</h3>
                        {uploadProgress && uploadProgress.total > 0 && (
                            <div className="w-64">
                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-primary transition-all duration-300" 
                                        style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                                    />
                                </div>
                                <p className="text-xs text-gray-400 mt-2 text-center">
                                    {uploadProgress.current} מתוך {uploadProgress.total} שורות
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-gray-400 mb-4">
                            <Database className="w-6 h-6" />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-1">
                            גררו קובץ מחירון לכאן או לחצו לבחירה
                        </h3>
                        <p className="text-sm text-gray-500">תמיכה בקבצי אקסל (XLSX), PDF ותמונות (AI Parsing)</p>
                    </>
                )}
            </div>

            <div className="bg-[#11161D] border border-white/10 rounded-xl overflow-hidden flex-1 flex flex-col">
                <div className="px-6 py-4 border-b border-white/10 bg-[#151C24] flex justify-between items-center">
                    <h2 className="font-semibold text-white">מחירונים במערכת ({pricelists.length})</h2>
                </div>
                <div className="overflow-auto flex-1">
                    <table className="w-full text-right">
                        <thead className="bg-[#1A222C] border-b border-white/10 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-16 text-center">מס'</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400">שם מחירון</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center">מספר סעיפים</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center">תאריך העלאה</th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-left">פעולות</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {pricelists.map((pl, idx) => (
                                <tr key={pl.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-3 text-center">
                                        <span className="text-gray-500 font-mono text-sm">#{String(idx + 1).padStart(2, '0')}</span>
                                    </td>
                                    <td className="px-6 py-3">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-gray-200">{pl.name}</span>
                                            {pl.is_global && <span className="text-[10px] text-blue-400 uppercase tracking-wider font-bold mt-0.5">מחירון כללי</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-3 text-center">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            {pl.pricelist_items[0]?.count || 0} סעיפים
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-center text-sm text-gray-400 font-mono">
                                        {new Date(pl.created_at).toLocaleDateString('he-IL')}
                                    </td>
                                    <td className="px-6 py-3 text-left">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => { 
                                                    setSelectedPricelist(pl); 
                                                    setSearchTerm('');
                                                    setPage(0);
                                                    fetchItems(pl.id, true, ''); 
                                                }}
                                                className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            {!pl.is_global && (
                                                <button
                                                    onClick={() => handleDelete(pl.id, pl.name)}
                                                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* View Items Modal */}
            {selectedPricelist && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
                    <div className="bg-[#11161D] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                         <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-[#151C24]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/20 text-primary rounded-lg">
                                    <Database className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">עיון בסעיפי מחירון: {selectedPricelist.name}</h2>
                                    <p className="text-xs text-gray-400">סה"כ במחירון: {totalItems.toLocaleString()} סעיפים</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedPricelist(null)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="p-4 border-b border-white/5 bg-black/20 flex gap-4">
                            <div className="relative flex-1">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input 
                                    type="text" 
                                    placeholder="חפש לפי תיאור או קוד סעיף..." 
                                    className="w-full bg-white/5 border border-white/10 rounded-lg pr-10 pl-4 py-2 text-sm text-white outline-none focus:border-primary transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto">
                            {isLoadingItems && items.length === 0 ? (
                                <div className="flex items-center justify-center h-64">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : items.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                                    <Search className="w-12 h-12 mb-4 opacity-20" />
                                    <p>לא נמצאו סעיפים התואמים לחיפוש</p>
                                </div>
                            ) : (
                                <>
                                    <table className="w-full text-right border-collapse">
                                        <thead className="bg-[#1A222C] border-b border-white/10 sticky top-0 z-20">
                                            <tr>
                                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-32">קוד סעיף</th>
                                                <th className="px-6 py-3 text-xs font-semibold text-gray-400">תיאור</th>
                                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center w-24">יחידה</th>
                                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center w-32">מחיר (לפני מע"מ)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {items.map(item => {
                                                // CHAPTER STYLING
                                                if (item.item_type === 'CHAPTER') {
                                                    return (
                                                        <tr key={item.id} className="bg-[#1C252E] border-y border-white/10">
                                                            <td className="px-6 py-3 text-xs font-bold text-emerald-500 uppercase tracking-wider">
                                                                פרק
                                                            </td>
                                                            <td colSpan={3} className="px-6 py-3 text-base font-bold text-white">
                                                                {item.description}
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                // SUBCHAPTER STYLING
                                                if (item.item_type === 'SUBCHAPTER') {
                                                    return (
                                                        <tr key={item.id} className="bg-[#151C24]/50 border-y border-white/5">
                                                            <td className="px-6 py-2 text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                                                                תת-פרק
                                                            </td>
                                                            <td colSpan={3} className="px-6 py-2 text-sm font-semibold text-gray-300">
                                                                {item.description}
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                // NOTE STYLING
                                                if (item.item_type === 'NOTE') {
                                                    return (
                                                        <tr key={item.id} className="bg-transparent italic">
                                                            <td className="px-6 py-2"></td>
                                                            <td colSpan={3} className="px-6 py-2 text-xs text-gray-500 border-r border-white/5">
                                                                <span className="text-emerald-500/50 ml-2 font-bold font-mono">ⓘ</span>
                                                                {item.description}
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                // STANDARD ITEM
                                                return (
                                                    <tr key={item.id} className="hover:bg-white/5 transition-colors group">
                                                        <td className="px-6 py-3 text-sm font-mono text-gray-400">
                                                            {item.item_code}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm text-gray-200">
                                                            {item.description}
                                                        </td>
                                                        <td className="px-6 py-3 text-center text-sm text-gray-400">{item.unit || '-'}</td>
                                                        <td className="px-6 py-3 text-center text-sm font-mono text-emerald-400">
                                                            {item.rate > 0 ? `₪${item.rate.toLocaleString()}` : '-'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    
                                    {hasMore && (
                                        <div className="p-8 flex justify-center">
                                            <button 
                                                onClick={() => fetchItems(selectedPricelist.id, false, searchTerm)}
                                                disabled={isLoadingItems}
                                                className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-gray-300 transition-all flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {isLoadingItems ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 rotate-90" />}
                                                טען סעיפים נוספים...
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                                </div>

                        <div className="p-4 border-t border-white/10 bg-[#151C24] text-xs text-gray-500 text-center">
                            מציג {items.length.toLocaleString()} מתוך {totalItems.toLocaleString()} סעיפים. השתמש בחיפוש לסינון מהיר.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
