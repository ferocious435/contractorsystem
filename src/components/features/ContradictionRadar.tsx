import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight, CheckCircle2, XCircle, ArrowRightLeft, Search, RefreshCw, Check, Download, FileText, Trash2, ShieldAlert, FileSearch, ArrowRight, ArrowLeft } from 'lucide-react';

interface ContradictionRadarProps {
    projectId: string;
}

export default function ContradictionRadar({ projectId }: ContradictionRadarProps) {
    const supabase = createClient();
    const [contradictions, setContradictions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanMethod, setScanMethod] = useState<'gemini_ai' | 'gemini_fast' | 'structural'>('structural');
    const [isClearing, setIsClearing] = useState(false);
    const [scanResult, setScanResult] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        fetchContradictions();
    }, [projectId]);

    const fetchContradictions = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('contradictions')
                .select('*, source_doc: documents!contradictions_source_execution_doc_id_fkey(title), target_doc: documents!contradictions_target_contract_doc_id_fkey(title)')
                .eq('project_id', projectId)
                .order('severity', { ascending: false }) // HIGH first, then MEDIUM, LOW
                .order('created_at', { ascending: false });

            if (error) throw error;
            setContradictions(data || []);
        } catch (err: any) {
            console.error('Error fetching contradictions:', err);
            // alert("Ошибка загрузки противоречий");
        } finally {
            setIsLoading(false);
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'HIGH': return <AlertTriangle className="h-5 w-5 text-red-500" />;
            case 'MEDIUM': return <AlertCircle className="h-5 w-5 text-orange-500" />;
            case 'LOW': return <Info className="h-5 w-5 text-blue-500" />;
            default: return <Info className="h-5 w-5 text-gray-400" />;
        }
    };

    const getSeverityLabel = (severity: string) => {
        switch (severity) {
            case 'HIGH': return 'קריטי (Критично)';
            case 'MEDIUM': return 'בינוני (Средне)';
            case 'LOW': return 'נמוך (Низко)';
            default: return severity;
        }
    };

    const updateStatus = async (id: string, newStatus: string) => {
        try {
            const { error } = await supabase
                .from('contradictions')
                .update({ status: newStatus })
                .eq('id', id);

            if (error) throw error;

            setContradictions(prev =>
                prev.map(c => c.id === id ? { ...c, status: newStatus } : c)
            );
        } catch (err) {
            console.error('Error updating status:', err);
            alert('שגיאה בעדכון הסטטוס');
        }
    };

    // Глобальный AI-скан: загружает документы и отправляет на анализ
    const scanProject = async () => {
        setIsScanning(true);
        setScanResult(null);

        // Setup AbortController for network timeout (60 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
            // 0. Автоматически очищаем старые противоречия перед новым сканированием
            setScanResult('מנקה סריקות קודמות...');
            try {
                await fetch(`/api/scan/clear?projectId=${projectId}`, { method: 'DELETE' });
            } catch (e) {
                console.warn("Failed to clear old contradictions, proceeding with scan anyway", e);
            }
            setScanResult('מנתח מסמכים...');

            // 1. Загружаем все документы проекта (client-side, с авторизацией)
            const { data: docs, error: docsError } = await supabase
                .from('documents')
                .select('id, title, category, ai_status, extracted_text, file_url')
                .eq('project_id', projectId);

            if (docsError || !docs || docs.length === 0) {
                setScanResult('אין מסמכים לסריקה');
                setIsScanning(false);
                clearTimeout(timeoutId);
                return;
            }

            // 2. Отправляем документы в API для анализа
            const res = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, documents: docs }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await res.json();

            if (data.success && data.found > 0 && data.contradictions) {
                // 3. Вставляем в БД client-side (есть авторизация → RLS пропускает)
                let savedCount = 0;
                const workDocs = docs.filter(d => d.category === 'EXECUTION');
                const contractDocs = docs.filter(d => d.category === 'CONTRACT');

                for (const c of data.contradictions) {
                    const { error: insertError } = await supabase
                        .from('contradictions')
                        .insert({
                            project_id: projectId,
                            title: c.title,
                            description: c.description,
                            strategy_advice: c.strategy_advice,
                            severity: c.severity || 'MEDIUM',
                            status: 'OPEN',
                            source_execution_doc_id: c.source_doc_id || workDocs[0]?.id || null,
                            target_contract_doc_id: c.target_doc_id || contractDocs[0]?.id || null,
                        });

                    if (!insertError) savedCount++;
                }

                setScanResult(`נמצאו ${data.found} סתירות, נשמרו ${savedCount} `);
                await fetchContradictions();
            } else if (data.success) {
                setScanResult(data.message || 'לא נמצאו סתירות חדשות');
            } else {
                setScanResult(data.error || 'שגיאה בסריקה');
            }
        } catch (err: any) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                setScanResult('הסריקה הופסקה: חריגת זמן (Timeout). נסה שנית.');
            } else {
                setScanResult('שגיאת רשת');
            }
            console.error('Scan error:', err);
        } finally {
            setIsScanning(false);
        }
    };

    // Передача противоречия в модуль ценообразования
    const moveToPricing = async (contradiction: any) => {
        try {
            // 1. Создаём строку PENDING_VO в pricing_ledger
            const { error: ledgerError } = await supabase
                .from('pricing_ledger')
                .insert({
                    project_id: projectId,
                    type: 'PENDING_VO',
                    source: 'BOQ',
                    item_code: '',
                    description: contradiction.title + ' — ' + (contradiction.description || ''),
                    unit: '',
                    quantity: 1,
                    unit_price_excl_vat: 0,
                    contradiction_id: contradiction.id,
                });
            if (ledgerError) throw ledgerError;

            // 2. Обновляем статус карточки
            await updateStatus(contradiction.id, 'MOVED_TO_PRICING');
        } catch (err) {
            console.error('Error moving to pricing:', err);
            alert('שגיאה בהעברה לתמחור');
        }
    };

    const handleExportCSV = () => {
        setIsExporting(true);
        try {
            const headers = ['כותרת', 'חומרה', 'סטטוס', 'מסמך מקור', 'מסמך יעד', 'תיאור'];
            const csvRows = [headers.join(',')];

            contradictions.forEach(row => {
                const values = [
                    `"${(row.title || '').replace(/"/g, '""')}"`,
                    getSeverityLabel(row.severity),
                    row.status,
                    `"${(row.source_doc?.title || '').replace(/"/g, '""')}"`,
                    `"${(row.target_doc?.title || '').replace(/"/g, '""')}"`,
                    `"${(row.description || '').replace(/"/g, '""')}"`
                ];
                csvRows.push(values.join(','));
            });

            const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'contradictions_export.csv');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error exporting CSV:', error);
        } finally {
            setIsExporting(false);
        }
    };

    // 5. ניקוי סתירות
    const clearContradictions = async () => {
        if (!confirm("האם למחוק את כל הסתירות שנמצאו בסריקות הקודמות? (לא ניתן לביטול)")) return;

        setIsClearing(true);
        try {
            const res = await fetch(`/api/scan/clear?projectId=${projectId}`, {
                method: 'DELETE'
            });

            if (!res.ok) throw new Error("Failed to clear contradictions");

            // Re-fetch (should be empty now)
            await fetchContradictions();
        } catch (error) {
            console.error("Error clearing contradictions:", error);
            alert("שגיאה במחיקת הסתירות. נסה שוב.");
        } finally {
            setIsClearing(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-white flex items-center gap-3">
                        <ShieldAlert className="w-6 h-6 text-red-400" />
                        רדאר סתירות - זיהוי אוטומטי
                    </h2>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchContradictions}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-workspace hover:bg-white/5 border border-border-subtle text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                            title="טען נתונים מקומיים ללא סריקה מחדש"
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                            <span className="text-sm">רענן תצוגה</span>
                        </button>

                        {contradictions.length > 0 && (
                            <button
                                onClick={clearContradictions}
                                disabled={isClearing || isScanning}
                                className="px-4 py-2 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Trash2 className="w-4 h-4" />
                                {isClearing ? "מוחק..." : "נקה סריקות קודמות"}
                            </button>
                        )}

                        <button
                            onClick={scanProject}
                            disabled={isScanning}
                            className="px-6 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="מבצע השוואה מחדש בין מסמכי החוזה למסמכי הביצוע באמצעות בינה מלאכותית"
                        >
                            <FileSearch className="w-4 h-4" />
                            {isScanning ? "מנתח מסמכים..." : "סרוק וחפש סתירות (AI)"}
                        </button>
                    </div>
                    {scanResult && (
                        <span className="text-sm text-green-400 animate-pulse">{scanResult}</span>
                    )}
                    <button
                        onClick={handleExportCSV}
                        disabled={isExporting || contradictions.length === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all ml-2"
                    >
                        {isExporting ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4" />
                        )}
                        ייצוא ל-CSV
                    </button>
                </div>
                <div className="text-sm text-gray-400 border border-border-subtle bg-workspace rounded-lg px-3 py-1.5 flex gap-4">
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div>קריטי: {contradictions.filter(c => c.severity === 'HIGH' && c.status === 'OPEN').length}</span>
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500"></div>בינוני: {contradictions.filter(c => c.severity === 'MEDIUM' && c.status === 'OPEN').length}</span>
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"></div>נמוך: {contradictions.filter(c => c.severity === 'LOW' && c.status === 'OPEN').length}</span>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : contradictions.length === 0 ? (
                <div className="text-center py-16 bg-workspace border border-border-subtle rounded-xl border-dashed">
                    <CheckCircle2 className="h-12 w-12 text-green-500/50 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-200 mb-2">לא נמצאו סתירות</h3>
                    <p className="text-gray-400">הכל תקין! המערכת לא זיהתה סתירות במסמכים.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {contradictions.map((contradiction, index) => (
                        <div
                            key={contradiction.id}
                            className={`border border-border-subtle bg-workspace rounded-xl overflow-hidden transition-all duration-200 ${expandedId === contradiction.id ? 'shadow-[0_4px_20px_rgba(0,0,0,0.3)] ring-1 ring-border-subtle' : 'hover:border-gray-700'
                                }`}
                        >
                            <div
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5"
                                onClick={() => setExpandedId(expandedId === contradiction.id ? null : contradiction.id)}
                            >
                                <div className="flex items-center gap-4 flex-1">
                                    {getSeverityIcon(contradiction.severity)}
                                    <div className="flex-1">
                                        <h3 className="text-lg font-medium text-gray-100 line-clamp-1 truncate" dir="rtl">
                                            <span className="text-gray-500 font-mono text-sm ml-2">#{String(index + 1).padStart(2, '0')}</span>
                                            {contradiction.title}
                                        </h3>
                                        <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                                            <span className="truncate max-w-[200px]" title={contradiction.source_doc?.title || 'Unknown Source'}>
                                                {contradiction.source_doc?.title || 'מסמך ביצוע'}
                                            </span>
                                            <ArrowRightLeft className="h-3 w-3 flex-shrink-0" />
                                            <span className="truncate max-w-[200px]" title={contradiction.target_doc?.title || 'Unknown Contract'}>
                                                {contradiction.target_doc?.title || 'חוזה (Договор)'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="flex flex-col items-end">
                                        <span className="text-xs text-gray-500 mb-1">סטטוס</span>
                                        <select
                                            value={contradiction.status}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                updateStatus(contradiction.id, e.target.value);
                                            }}
                                            onClick={e => e.stopPropagation()}
                                            className={`text-sm px-2 py-1 rounded-md bg-background border border-border-subtle focus:outline-none focus:ring-1 focus:ring-primary ${contradiction.status === 'OPEN' ? 'text-yellow-400' :
                                                contradiction.status === 'MOVED_TO_PRICING' ? 'text-blue-400' :
                                                    contradiction.status === 'IGNORED' ? 'text-gray-400' :
                                                        'text-green-400'
                                                }`}
                                            dir="rtl"
                                        >
                                            <option value="OPEN">פתוח (Открыто)</option>
                                            <option value="MOVED_TO_PRICING">לתמחור (В смету)</option>
                                            <option value="IGNORED">התעלם (Игнорировать)</option>
                                            <option value="AUTO_RESOLVED">נפתר (Решено)</option>
                                        </select>
                                    </div>

                                    {expandedId === contradiction.id ? (
                                        <ChevronDown className="h-5 w-5 text-gray-400" />
                                    ) : (
                                        <ChevronRight className="h-5 w-5 text-gray-400" />
                                    )}
                                </div>
                            </div>

                            {/* Expanded Content */}
                            {expandedId === contradiction.id && (
                                <div className="p-4 border-t border-border-subtle bg-background/50 space-y-4">
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-400 mb-2">תיאור מלא</h4>
                                        <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed bg-workspace p-3 rounded-lg border border-border-subtle" dir="rtl">
                                            {contradiction.description || 'אין תיאור מפורט'}
                                        </p>
                                    </div>

                                    {contradiction.strategy_advice && (
                                        <div>
                                            <h4 className="text-sm font-medium pr-1 text-primary mb-2 flex items-center gap-1.5" dir="rtl">
                                                <Info className="h-4 w-4" />
                                                המלצת פעולה
                                            </h4>
                                            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed bg-primary/10 border border-primary/20 p-3 rounded-lg" dir="rtl">
                                                {contradiction.strategy_advice}
                                            </p>
                                        </div>
                                    )}

                                    {contradiction.status === 'OPEN' && (
                                        <div className="flex justify-end gap-3 pt-2">
                                            <button
                                                onClick={() => updateStatus(contradiction.id, 'IGNORED')}
                                                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:text-white bg-workspace hover:bg-white/5 border border-border-subtle rounded-lg transition-colors"
                                            >
                                                <XCircle className="h-4 w-4" />
                                                התעלם
                                            </button>
                                            <button
                                                onClick={() => updateStatus(contradiction.id, 'AUTO_RESOLVED')}
                                                className="flex items-center gap-2 px-4 py-2 text-sm text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-lg transition-colors"
                                            >
                                                <Check className="h-4 w-4" />
                                                טופל
                                            </button>
                                            <button
                                                onClick={() => moveToPricing(contradiction)}
                                                className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-primary hover:bg-primary-hover border border-primary/50 shadow-blue rounded-lg transition-colors"
                                            >
                                                <ArrowRightLeft className="h-4 w-4" />
                                                העבר לתמחור
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
