"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import { Download, FileText } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const VAT_RATE = 0.18; // 18% НДС (מע"מ)

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

            // Создаём скрытый HTML-элемент с полной таблицей для рендеринга в PDF
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
                        <span>מע״מ (18%)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:2px solid #1a232e;font-size:15px;font-weight:700;">
                        <span>₪ ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <span>סה״כ כולל מע״מ</span>
                    </div>
                </div>
            `;

            document.body.appendChild(container);

            // Рендерим HTML в canvas с помощью html2canvas
            const canvas = await html2canvas(container, {
                scale: 2,
                useCORS: true,
                logging: false,
            });

            document.body.removeChild(container);

            // Создаём PDF из canvas
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

            // Add totals row
            const { subtotal, vat, total } = calculateTotals();
            csvRows.push('');
            csvRows.push(`,,,,סה"כ (לפני מע"מ),${subtotal}`);
            csvRows.push(`,,,,מע"מ (18%),${vat}`);
            csvRows.push(`,,,,סה"כ כולל מע"מ,${total}`);

            // Create blob with BOM for Excel Hebrew support
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
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-bold flex items-center gap-3 text-white drop-shadow-sm">
                    <span>כתב כמויות - שלד</span>
                </h2>

                <div className="flex gap-2">
                    <button
                        onClick={handleExportCSV}
                        disabled={isExporting || rows.length === 0}
                        className="flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
                    >
                        {isExporting ? (
                            <div className="w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"></div>
                        ) : (
                            <Download size={16} />
                        )}
                        ייצוא ל-CSV
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={isExporting || rows.length === 0}
                        className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 px-4 py-2 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
                    >
                        {isExporting ? (
                            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                        ) : (
                            <FileText size={16} />
                        )}
                        ייצוא ל-PDF
                    </button>
                </div>
            </div>

            <div className="bg-workspace border border-border-subtle rounded-xl overflow-hidden shadow-2xl flex-1 flex flex-col">
                <div className="overflow-x-auto flex-1 custom-scrollbar">
                    <table className="w-full text-right text-base border-collapse">
                        <thead className="bg-[#1a232e] text-gray-200 text-sm font-semibold border-b-2 border-border-subtle shadow-md sticky top-0 z-10">
                            <tr>
                                <th className="py-4 px-5 w-28 text-left">סעיף</th>
                                <th className="py-4 px-5">תיאור</th>
                                <th className="py-4 px-5 w-20 text-center">יח׳</th>
                                <th className="py-4 px-5 w-28 text-left">כמות</th>
                                <th className="py-4 px-5 w-36 text-left">מחיר יחידה</th>
                                <th className="py-4 px-5 w-40 text-left">סה״כ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle bg-workspace">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-gray-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                                            <span>טוען נתונים...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-16 text-gray-400">
                                        <div className="flex flex-col items-center gap-3 opacity-60">
                                            <FileText size={32} className="text-gray-500" />
                                            <span>אין נתונים זמינים. העלה מסמך כדי להתחיל.</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id} className="hover:bg-[#1e2733] transition-colors duration-200 cursor-pointer">
                                        <td className="py-4 px-5 font-mono text-gray-300 text-left tracking-wide">{row.item_code}</td>
                                        <td className="py-4 px-5 font-medium text-white">{row.description}</td>
                                        <td className="py-4 px-5 text-gray-300 text-center bg-black/10">{row.unit}</td>
                                        <td className="py-4 px-5 font-mono text-white font-semibold text-left">{row.quantity}</td>
                                        <td className="py-4 px-5 font-mono text-gray-300 text-left">₪ {(row.unit_price_excl_vat || 0).toLocaleString()}</td>
                                        <td className="py-4 px-5 font-mono text-white text-left tracking-wide font-bold">
                                            ₪ {row.total_price_excl_vat ? row.total_price_excl_vat.toLocaleString() : ((row.quantity || 0) * (row.unit_price_excl_vat || 0)).toLocaleString()}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Fixed Footer for Totals */}
                {rows.length > 0 && (
                    <div className="bg-[#151d26] border-t border-border-subtle p-5 px-8 flex flex-col gap-2">
                        <div className="flex justify-between items-center text-gray-400 text-sm">
                            <span className="font-mono">₪ {subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            <span>סה״כ (לפני מע״מ)</span>
                        </div>
                        <div className="flex justify-between items-center text-orange-400/80 text-sm">
                            <span className="font-mono">₪ {vat.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            <span>מע״מ (18%)</span>
                        </div>
                        <div className="flex justify-between items-center text-white text-lg font-bold border-t border-white/10 pt-3 mt-1">
                            <span className="font-mono text-primary drop-shadow-sm">₪ {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            <span>סה״כ לתשלום</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
