"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import { Download, FileText, Printer, FileSpreadsheet, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { VAT_RATE } from "@/utils/constants";

export function LedgerTable({ projectId }: { projectId: string | null }) {
    const [rows, setRows] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const tableRef = useRef<HTMLDivElement>(null);

    const supabase = createClient();

    useEffect(() => {
        if (!projectId) return;

        const fetchLedger = async () => {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('pricing_ledger')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true });

            if (data) {
                setRows(data);
            }
            setIsLoading(false);
        };

        fetchLedger();
    }, [projectId]);

    const calculateTotals = () => {
        const subtotal = rows.reduce((acc, row) => {
            const rowTotal = row.total_price_excl_vat || (row.quantity * row.unit_price_excl_vat);
            return acc + (Number(rowTotal) || 0);
        }, 0);

        const vat = subtotal * VAT_RATE;
        const total = subtotal + vat;

        return { subtotal, vat, total };
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        try {
            const { subtotal, vat, total } = calculateTotals();

            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;background:#fff;padding:40px;font-family:Arial,sans-serif;direction:rtl;color:#111;';

            container.innerHTML = `
                <div style="text-align:right;margin-bottom:24px;">
                    <h1 style="font-size:22px;margin:0 0 8px;color:#1a232e;">כתב כמויות - סיכום</h1>
                    <p style="font-size:12px;color:#666;margin:0;">תאריך: ${new Date().toLocaleDateString('he-IL')}</p>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:11px;">
                    <thead>
                        <tr style="background:#1a232e;color:#fff;">
                            <th style="padding:8px;text-align:right;border:1px solid #333;">סעיף</th>
                            <th style="padding:8px;text-align:right;border:1px solid #333;">תיאור</th>
                            <th style="padding:8px;text-align:center;border:1px solid #333;">יח׳</th>
                            <th style="padding:8px;text-align:center;border:1px solid #333;">כמות</th>
                            <th style="padding:8px;text-align:left;border:1px solid #333;">מחיר יחידה</th>
                            <th style="padding:8px;text-align:left;border:1px solid #333;">סה״כ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row, i) => {
                const rowTotal = row.total_price_excl_vat || ((row.quantity || 0) * (row.unit_price_excl_vat || 0));
                return `<tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'};">
                                <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${row.item_code || ''}</td>
                                <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${row.description || ''}</td>
                                <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${row.unit || ''}</td>
                                <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${row.quantity || 0}</td>
                                <td style="padding:6px 8px;border:1px solid #ddd;text-align:left;">₪ ${(row.unit_price_excl_vat || 0).toLocaleString()}</td>
                                <td style="padding:6px 8px;border:1px solid #ddd;text-align:left;font-weight:600;">₪ ${Number(rowTotal).toLocaleString()}</td>
                            </tr>`;
            }).join('')}
                    </tbody>
                </table>
                <div style="margin-top:20px;padding:16px;background:#f0f4f8;border-radius:8px;border:1px solid #d0d7de;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
                        <span style="font-weight:600;">₪ ${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <span>סה״כ (לפני מע״מ)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
                        <span style="font-weight:600;">₪ ${vat.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <span>מע״מ (${(VAT_RATE * 100).toFixed(0)}%)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:2px solid #1a232e;font-size:15px;font-weight:700;">
                        <span>₪ ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <span>סה״כ כולל מע״מ</span>
                    </div>
                </div>
            `;

            document.body.appendChild(container);

            const canvas = await html2canvas(container, {
                scale: 2,
                useCORS: true,
                logging: false,
            });

            document.body.removeChild(container);

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save('contractor_estimate.pdf');
        } catch (error) {
            console.error("Error generating PDF:", error);
            window.print();
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportCSV = () => {
        setIsExporting(true);
        try {
            const headers = ['סעיף', 'תיאור', 'יחידה', 'כמות', 'מחיר יחידה', 'סה"כ'];
            const csvRows = [headers.join(',')];

            rows.forEach(row => {
                const total = row.total_price_excl_vat || (row.quantity * row.unit_price_excl_vat);
                const values = [
                    row.item_code || '',
                    `"${(row.description || '').replace(/"/g, '""')}"`,
                    row.unit || '',
                    row.quantity || 0,
                    row.unit_price_excl_vat || 0,
                    total || 0
                ];
                csvRows.push(values.join(','));
            });

            const { subtotal, vat, total } = calculateTotals();
            csvRows.push('');
            csvRows.push(`,,,,סה"כ (לפני מע"מ),${subtotal}`);
            csvRows.push(`,,,,מע"מ (${(VAT_RATE * 100).toFixed(0)}%),${vat}`);
            csvRows.push(`,,,,סה"כ כולל מע"מ,${total}`);

            const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'pricing_ledger_export.csv');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Error exporting CSV:", error);
        } finally {
            setIsExporting(false);
        }
    };

    const { subtotal, vat, total } = calculateTotals();

    return (
        <div className="flex flex-col h-full gap-6">
            <div className="flex justify-between items-center px-1">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-sm">
                        <FileSpreadsheet size={18} className="text-emerald-500" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight uppercase">Pricing_Ledger [כתב כמויות]</h2>
                        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mt-1">מצב ביקורת: פעיל // בסיס מס: {(VAT_RATE * 100).toFixed(0)}% מע"מ</p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={handleExportCSV}
                        disabled={isExporting || rows.length === 0}
                        className="flex items-center gap-2 bg-transparent hover:bg-emerald-500/10 text-gray-400 hover:text-emerald-500 border border-white/10 hover:border-emerald-500/30 px-4 py-2 rounded-sm transition-all font-mono text-[10px] font-bold uppercase tracking-tighter disabled:opacity-30"
                    >
                        {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        ייצוא CSV
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={isExporting || rows.length === 0}
                        className="flex items-center gap-2 bg-white text-black hover:bg-gray-200 border border-transparent px-4 py-2 rounded-sm transition-all font-mono text-[10px] font-black uppercase tracking-tighter disabled:opacity-30"
                    >
                        {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                        ייצוא PDF
                    </button>
                </div>
            </div>

            <div className="bg-[#0B0F14] border border-white/5 rounded-sm overflow-hidden flex-1 flex flex-col shadow-2xl relative">
                <div className="overflow-x-auto flex-1 custom-scrollbar pb-32">
                    <table className="w-full text-right text-base border-collapse">
                        <thead className="bg-black/40 text-gray-500 text-[10px] font-mono font-black uppercase tracking-widest border-b border-white/5 sticky top-0 z-10 backdrop-blur-md">
                            <tr>
                                <th className="py-4 px-6 w-32 text-left">קוד סעיף</th>
                                <th className="py-4 px-6">תיאור סעיף</th>
                                <th className="py-4 px-6 w-20 text-center">יחידה</th>
                                <th className="py-4 px-6 w-28 text-left">כמות</th>
                                <th className="py-4 px-6 w-36 text-left">מחיר יחידה</th>
                                <th className="py-4 px-6 w-40 text-left">סה"כ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.03]">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-24">
                                        <div className="flex flex-col items-center gap-4">
                                            <Loader2 size={24} className="text-emerald-500 animate-spin" />
                                            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">מתשאל מסד נתונים...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-32">
                                        <div className="flex flex-col items-center gap-4 opacity-40">
                                            <FileText size={32} className="text-gray-600" />
                                            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">לא נמצאו רשומות // ממתין ל-OCR</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="py-4 px-6 font-mono text-gray-500 text-[11px] text-left tracking-tighter">{row.item_code}</td>
                                        <td className="py-4 px-6 font-bold text-gray-300 group-hover:text-white transition-colors">{row.description}</td>
                                        <td className="py-4 px-6 text-gray-400 text-center font-mono text-[10px] uppercase bg-white/[0.01]">{row.unit}</td>
                                        <td className="py-4 px-6 font-mono text-white font-bold text-left text-sm tracking-tight">{row.quantity}</td>
                                        <td className="py-4 px-6 font-mono text-gray-400 text-left text-sm">₪ {(row.unit_price_excl_vat || 0).toLocaleString()}</td>
                                        <td className="py-4 px-6 font-mono text-emerald-500 text-left tracking-tight font-black text-sm">
                                            ₪ {row.total_price_excl_vat ? row.total_price_excl_vat.toLocaleString() : ((row.quantity || 0) * (row.unit_price_excl_vat || 0)).toLocaleString()}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Summaries Panel - Glass Fixed */}
                {rows.length > 0 && (
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-xl border-t border-white/10 p-6 px-10 flex justify-between items-center">
                        <div className="flex gap-12">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">סיכום ביניים [לפני מע"מ]</span>
                                <span className="text-sm font-bold text-gray-300 font-mono">₪ {subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">מע"מ [{(VAT_RATE * 100).toFixed(0)}%]</span>
                                <span className="text-sm font-bold text-amber-500/80 font-mono">₪ {vat.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-8">
                            <div className="h-10 w-[1px] bg-white/5"></div>
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] font-mono text-emerald-500/50 font-black uppercase tracking-[0.2em] mb-1">סה"כ לתשלום</span>
                                <span className="text-2xl font-black text-emerald-500 font-mono tracking-tighter drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                    ₪ {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
