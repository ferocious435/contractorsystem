"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { PricelistsCatalogView } from './PricelistsCatalogView';
import readExcelFile, { type Row } from 'read-excel-file/browser';

interface PricelistsPageClientProps {
    projectId: string;
}

export interface PricelistRecord {
    id: string;
    name: string;
    is_global?: boolean | null;
    created_at: string;
    item_count?: number;
    item_row_count?: number;
    structural_row_count?: number;
    pricelist_items?: Array<{ count?: number | null }>;
}

export interface PricelistItemRecord {
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
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number, step: string } | null>(null);
    const [uploadNotice, setUploadNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // View Items State
    const [selectedPricelist, setSelectedPricelist] = useState<PricelistRecord | null>(null);
    const [items, setItems] = useState<PricelistItemRecord[]>([]);
    const [isLoadingItems, setIsLoadingItems] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [totalItems, setTotalItems] = useState(0);

    const [catalogLoading, setCatalogLoading] = useState(true);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [itemError, setItemError] = useState<string | null>(null);
    const failedItemRead = useRef<{pricelistId: string; reset: boolean; search: string} | null>(null);
    const pageRef = useRef(page);
    const supabase = useMemo(() => createClient(), []);

    const fetchPricelists = useCallback(async () => {
        setCatalogLoading(true); setCatalogError(null);
        try {
        const { data, error } = await supabase
            .from('pricelists')
            .select('id, name, is_global, created_at')
            .or(`project_id.eq.${projectId},is_global.eq.true`)
            .order('created_at', { ascending: false });

        if (error || !data) {
            if (error) console.error('Failed to load pricelists:', error);
            setCatalogError('לא ניתן לטעון את המחירונים כרגע. הרשימה הקודמת נשמרה.');
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
        } catch (cause) {
            console.error('Failed to load pricelists:', cause);
            setCatalogError('לא ניתן לטעון את המחירונים כרגע. הרשימה הקודמת נשמרה.');
        } finally { setCatalogLoading(false); }
    }, [projectId, supabase]);

    const fetchItems = useCallback(async (pricelistId: string, reset = false, search = '') => {
        setIsLoadingItems(true); setItemError(null);
        try {
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

        const { data, count, error } = await query;
        if (error) throw error;
        if (!data) throw new Error('ITEM_READ_FAILED');

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
        } catch (cause) {
            console.error('Failed to load pricelist items:', cause);
            failedItemRead.current = {pricelistId, reset, search};
            setItemError(reset ? 'החיפוש לא הושלם. הרשימה הקודמת נשמרה; אפשר לנסות שוב.' : 'טעינת ההמשך נכשלה. הסעיפים שנקראו נשמרו; אפשר לנסות שוב.');
        } finally { setIsLoadingItems(false); }
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
    const handleFiles = async (files: File[]) => {
        const file = files[0];
        if (!file) return;

        const lowerFileName = file.name.toLowerCase();
        const isXlsx = lowerFileName.endsWith('.xlsx');
        const isSpreadsheet = isXlsx || lowerFileName.endsWith('.xls');
        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf';

        if (!isSpreadsheet && !isImage && !isPDF) {
            const message = 'אנא העלה קובץ אקסל, PDF או תמונה.';
            setUploadNotice({ type: 'error', message });

            return;
        }

        setIsUploading(true);
        setUploadNotice(null);
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
                    setUploadNotice({ type: 'success', message: `המחירון נשמר: ${insertedCount.toLocaleString()} סעיפים.` });
                    fetchPricelists();
                } catch (err) {
                    console.error(err);
                    const message = err instanceof Error ? err.message : 'שגיאה בתהליך עיבוד המחירון';
                    setUploadNotice({ type: 'error', message });

                    setIsUploading(false);
                    setUploadProgress(null);
                }
            } else {
                // NEW: Universal AI Server-side parsing
                setUploadProgress({ current: 0, total: 1, step: 'מנתח קובץ באמצעות AI (Gemini)...' });

                const formData = new FormData();
                formData.append('file', file);
                formData.append('projectId', projectId);
                formData.append('name', file.name.replace(/\.[^.]+$/i, ''));

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
                setUploadNotice({
                    type: 'success',
                    message: `המחירון נשמר: ${Number(result.itemCount || 0).toLocaleString()} סעיפים.`
                });
                fetchPricelists();
            }

        } catch (err) {
            console.error("Upload error:", err);
            const message = err instanceof Error ? err.message : 'שגיאה בהעלאת המחירון';
            setUploadNotice({ type: 'error', message });

            setIsUploading(false);
            setUploadProgress(null);
        }

    };

    const handleDelete = async (id: string, _name: string) => {

        try {
            const { error } = await supabase.from('pricelists').delete().eq('id', id);
            if (error) throw error;
            await fetchPricelists();
        } catch (e) {
            console.error(e);
            setUploadNotice({type: 'error', message: 'מחיקת המחירון לא הושלמה.'});
            throw e;

        }
    };

    const selectPricelist = (record: PricelistRecord) => {
        setSelectedPricelist(record); setSearchTerm(''); setPage(0);
        setTotalItems(getPricelistCount(record));
        void fetchItems(record.id, true, '');
    };
    return <PricelistsCatalogView pricelists={pricelists} selectedPricelist={selectedPricelist} items={items}
        searchTerm={searchTerm} hasMore={hasMore} isLoadingItems={isLoadingItems} isUploading={isUploading}
        uploadProgress={uploadProgress} notice={uploadNotice} totalItems={totalItems}
        catalogLoading={catalogLoading} catalogError={catalogError} itemError={itemError}
        onRetryCatalog={fetchPricelists} onRetryItems={async () => {const failed = failedItemRead.current; if (failed) await fetchItems(failed.pricelistId, failed.reset, failed.search);}}
        onUpload={handleFiles} onSelect={selectPricelist} onClose={() => setSelectedPricelist(null)}
        onSearch={setSearchTerm} onLoadMore={async () => {if (selectedPricelist) await fetchItems(selectedPricelist.id, false, searchTerm);}}
        onDelete={handleDelete}/>;
}
