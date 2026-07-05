"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { AlertTriangle, Eye, Loader2, Play, Trash2, Database, X, Search } from 'lucide-react';
import readExcelFile, { type Row } from 'read-excel-file/browser';

interface PricelistsPageClientProps {
    projectId: string;
}

interface PricelistRecord {
    id: string;
    name: string;
    is_global?: boolean | null;
    created_at: string;
    item_count?: number;
    item_row_count?: number;
    structural_row_count?: number;
    pricelist_items?: Array<{ count?: number | null }>;
}

interface PricelistItemRecord {
    id: string;
    item_type?: string | null;
    item_code: string;
    description: string;
    unit?: string | null;
    rate: number;
}

type PricelistUploadItem = {
    pricelist_id: string;
    item_type: string;
    item_code: string;
    description: string;
    unit: string | null;
    quantity: number;
    rate: number;
    service_type: string;
    activity_number: string | null;
    notes?: string | null;
};

function toCellText(value: Row[number]) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function toCellNumber(value: Row[number]) {
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value || '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function getPricelistCount(pricelist: PricelistRecord) {
    return pricelist.item_count ?? pricelist.pricelist_items?.[0]?.count ?? 0;
}

export default function PricelistsPageClient({ projectId }: PricelistsPageClientProps) {
    const [pricelists, setPricelists] = useState<PricelistRecord[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number, step: string } | null>(null);

    // View Items State
    const [selectedPricelist, setSelectedPricelist] = useState<PricelistRecord | null>(null);
    const [items, setItems] = useState<PricelistItemRecord[]>([]);
    const [isLoadingItems, setIsLoadingItems] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [totalItems, setTotalItems] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pageRef = useRef(page);
    const supabase = useMemo(() => createClient(), []);

    const fetchPricelists = useCallback(async () => {
        const { data, error } = await supabase
            .from('pricelists')
            .select('id, name, is_global, created_at')
            .or(`project_id.eq.${projectId},is_global.eq.true`)
            .order('created_at', { ascending: false });

        if (error || !data) {
            if (error) console.error('Failed to load pricelists:', error);
            return;
        }

        const enrichedPricelists = await Promise.all(
            data.map(async (pl) => {
                const [allRows, itemRows] = await Promise.all([
                    supabase
                        .from('pricelist_items')
                        .select('id', { count: 'exact', head: true })
                        .eq('pricelist_id', pl.id),
                    supabase
                        .from('pricelist_items')
                        .select('id', { count: 'exact', head: true })
                        .eq('pricelist_id', pl.id)
                        .eq('item_type', 'ITEM')
                ]);

                const itemCount = allRows.count ?? 0;
                const itemRowCount = itemRows.count ?? 0;

                return {
                    ...pl,
                    item_count: itemCount,
                    item_row_count: itemRowCount,
                    structural_row_count: Math.max(itemCount - itemRowCount, 0),
                    pricelist_items: [{ count: itemCount }]
                } satisfies PricelistRecord;
            })
        );

        setPricelists(enrichedPricelists);
    }, [projectId, supabase]);

    const fetchItems = useCallback(async (pricelistId: string, reset = false, search = '') => {
        setIsLoadingItems(true);
        const currentPage = reset ? 0 : pageRef.current;
        const PAGE_SIZE = 500;

        let query = supabase
            .from('pricelist_items')
            .select('*', { count: 'exact' })
            .eq('pricelist_id', pricelistId)
            .order('item_code', { ascending: true })
            .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

        if (search) {
            query = query.or(`description.ilike.%${search}%,item_code.ilike.%${search}%,item_type.eq.NOTE`);
        }

        const { data, count } = await query;

        if (data) {
            if (reset) {
                setItems(data as PricelistItemRecord[]);
                setPage(1);
                pageRef.current = 1;
            } else {
                const nextPage = currentPage + 1;
                setItems(prev => [...prev, ...(data as PricelistItemRecord[])]);
                setPage(nextPage);
                pageRef.current = nextPage;
            }
            setHasMore(data.length === PAGE_SIZE);
            if (count !== null) setTotalItems(count);
        }
        setIsLoadingItems(false);
    }, [supabase]);

    useEffect(() => {
        pageRef.current = page;
    }, [page]);

    useEffect(() => {
        void fetchPricelists();
    }, [fetchPricelists]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (selectedPricelist) {
                void fetchItems(selectedPricelist.id, true, searchTerm);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [fetchItems, searchTerm, selectedPricelist]);
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

        const lowerFileName = file.name.toLowerCase();
        const isXlsx = lowerFileName.endsWith('.xlsx');
        const isSpreadsheet = isXlsx || lowerFileName.endsWith('.xls');
        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf';

        if (!isSpreadsheet && !isImage && !isPDF) {
            alert('אנא העלה קובץ אקסל, PDF או תמונה.');
            return;
        }

        setIsUploading(true);
        setUploadProgress({ current: 0, total: 0, step: 'קורא קובץ...' });

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                throw new Error('Unauthorized');
            }

            if (isXlsx) {
                try {
                    setUploadProgress({ current: 0, total: 0, step: 'מפענח נתונים (Parsing)...' });

                    const sheets = await readExcelFile(file);
                    const rows = sheets.flatMap(({ sheet, data }) =>
                        data.slice(1).map((row) => ({ sheet, row }))
                    );

                    setUploadProgress({ current: 0, total: rows.length, step: 'מכין נתונים לשמירה...' });

                    const { data: pricelist, error: plError } = await supabase
                        .from('pricelists')
                        .insert({
                            project_id: projectId,
                            contractor_id: user.id,
                            name: file.name.replace(/\.(xlsx|xls)$/i, ''),
                            description: 'הועלה ידנית מהמערכת',
                            is_global: false
                        })
                        .select()
                        .single();

                    if (plError) throw plError;

                    const itemsToInsert: PricelistUploadItem[] = [];
                    for (const { sheet, row } of rows) {
                        if (!row || row.length < 2) continue;

                        const service_type = toCellText(row[0]);
                        const item_code = toCellText(row[1]);
                        const description = toCellText(row[2]);
                        const activity_number = toCellText(row[3]);
                        const quantity = toCellNumber(row[4]);
                        const unit = toCellText(row[5]);
                        const rate = toCellNumber(row[6]);

                        let item_type = 'ITEM';
                        const keywords = ['הערה', 'הערות', 'הנחיות', 'כללי', 'תנאים', 'אופן המדידה', 'המחיר כולל', 'כולל חפירה', 'כולל הובלה', 'לרבות', 'בכפוף'];
                        const isNote =
                            keywords.some(k => description.includes(k)) ||
                            ((!rate || rate === 0) && !unit && description.length > 15);

                        if (item_code.endsWith('...')) {
                            item_type = 'CHAPTER';
                        } else if (item_code.endsWith('..') || item_code.endsWith('.')) {
                            // Если это подглава, но по смыслу это примечание (часто в Декель)
                            item_type = isNote ? 'NOTE' : 'SUBCHAPTER';
                        } else if (isNote || ((!rate || rate === 0) && !unit && item_code)) {
                            // В Декель коды типа 95.01.00.0001 часто являются примечаниями, если нет цены
                            item_type = 'NOTE';
                        }

                        itemsToInsert.push({
                            pricelist_id: pricelist.id,
                            item_type,
                            item_code,
                            description,
                            unit: unit || null,
                            quantity,
                            rate,
                            service_type,
                            activity_number: activity_number || null,
                            notes: sheet ? `Sheet: ${sheet}` : null
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

                    const hasContractPricedQuantities = itemsToInsert.some((item) =>
                        Number(item.quantity || 0) > 0 && Number(item.rate || 0) > 0
                    );

                    if (hasContractPricedQuantities) {
                        const syncResponse = await fetch('/api/projects/sync-contract-base', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                projectId,
                                pricelistIds: [pricelist.id],
                                forceContractBoq: true
                            })
                        });

                        if (!syncResponse.ok) {
                            throw new Error('Contract BOQ sync failed');
                        }
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
                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 w-16 text-center">מס&apos;</th>
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
                                            {getPricelistCount(pl).toLocaleString()} סעיפים
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
                                                    setTotalItems(getPricelistCount(pl));
                                                    void fetchItems(pl.id, true, '');
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
                                    <p className="text-xs text-gray-400">סה&quot;כ במחירון: {totalItems.toLocaleString()} סעיפים</p>
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
                                                <th className="px-6 py-3 text-xs font-semibold text-gray-400 text-center w-32">מחיר (לפני מע&quot;מ)</th>
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

                                                // NOTE STYLING (Premium Governing Note)
                                                if (item.item_type === 'NOTE') {
                                                    return (
                                                        <tr key={item.id} className="bg-amber-500/5 border-r-4 border-amber-500/50">
                                                            <td className="px-6 py-4 text-center">
                                                                <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto border border-amber-500/20">
                                                                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                                                                </div>
                                                            </td>
                                                            <td colSpan={3} className="px-6 py-4">
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">סעיף הנחיה / הערה</span>
                                                                    <div className="text-sm text-amber-100/90 leading-relaxed font-medium">
                                                                        {item.description}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                // STANDARD ITEM
                                                // Find the most relevant note for this item (last note with same prefix)
                                                const governingNote = [...items].reverse().find(n =>
                                                    n.item_type === 'NOTE' &&
                                                    item.item_code.startsWith(n.item_code.split('.').slice(0, 2).join('.')) &&
                                                    items.indexOf(n) < items.indexOf(item)
                                                );

                                                return (
                                                    <tr key={item.id} className="hover:bg-white/5 transition-colors group">
                                                        <td className="px-6 py-3 text-sm font-mono text-gray-400">
                                                            {item.item_code}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm text-gray-200">
                                                            <div className="flex flex-col gap-1">
                                                                <span>{item.description}</span>
                                                                {governingNote && (
                                                                    <div className="flex items-center gap-1.5 mt-1">
                                                                        <div className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-500 font-bold flex items-center gap-1">
                                                                            <AlertTriangle className="w-2.5 h-2.5" />
                                                                            <span>הנחיה פעילה: {governingNote.item_code}</span>
                                                                        </div>
                                                                        <span className="text-[10px] text-gray-500 truncate max-w-[300px]">
                                                                            {governingNote.description.substring(0, 60)}...
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
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
