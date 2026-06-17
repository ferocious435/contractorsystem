import React from 'react';
import { Calculator, Download, FileText, Plus, RefreshCw } from 'lucide-react';

interface ActionBarProps {
    selectedCount: number;
    isSyncing: boolean;
    onGenerateLetter: () => void;
    onExportCSV: () => void;
    onAddNew: () => void;
    onSync: () => void;
}
export default function ActionBar({
    selectedCount,
    isSyncing,
    onGenerateLetter,
    onExportCSV,
    onAddNew,
    onSync,
}: ActionBarProps) {
    return (
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 shrink-0 bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-[0_0_40px_rgba(59,130,246,0.1)]">
                        <Calculator className="h-7 w-7 text-blue-500" />
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-black text-blue-500 uppercase tracking-[0.3em]">מרכז תמחור</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                        </div>
                        <h2 className="text-3xl font-black text-white font-mono uppercase tracking-tighter" dir="rtl">
                            ניהול תמחור פרויקט
                        </h2>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                    onClick={onSync}
                    disabled={isSyncing}
                    className="px-5 py-4 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 disabled:opacity-50 disabled:cursor-wait"
                >
                    <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>סנכרון BOQ</span>
                </button>
                <button
                    onClick={onGenerateLetter}
                    disabled={selectedCount === 0}
                    className="group relative px-6 py-4 bg-purple-500 text-black rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 overflow-hidden shadow-[0_10px_30px_rgba(168,85,247,0.2)] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-purple-500"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                    <FileText className="h-4 w-4" />
                    <span>הפקת מכתב ({selectedCount})</span>
                </button>
                <button
                    onClick={onExportCSV}
                    className="px-6 py-4 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3"
                >
                    <Download className="h-4 w-4" />
                    <span>ייצוא נתונים</span>
                </button>
                <button
                    onClick={onAddNew}
                    className="px-6 py-4 bg-white text-black hover:bg-blue-500 hover:text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 shadow-xl shadow-black/20"
                >
                    <Plus className="h-4 w-4" />
                    <span>הוספת שורה</span>
                </button>
            </div>
        </div>
    );
}
