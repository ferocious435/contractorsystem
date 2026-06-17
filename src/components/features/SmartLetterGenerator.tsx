"use client";

import { 
    FileText, Copy, Check, Loader2,
    Brain, Shield, Terminal, Zap,
    History, Trash2, Printer, Share2,
    Edit3, Layout, DollarSign, Activity, ShieldAlert,
    Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VAT_RATE, AI_MODEL_BRANDING } from '@/utils/constants';
import { PrintableLetter } from '@/components/pricing/PrintableLetter';
import { getLedgerRowAmount } from '@/utils/project-financials';
import { LETTER_TYPES, TONE_OPTIONS } from './smart-letter/constants';
import { useSmartLetterState } from './smart-letter/hooks/useSmartLetterState';
import type { SmartLetterGeneratorProps } from './smart-letter/types';
import type { LedgerItem } from '@/components/pricing/LedgerTable';


/**
 * מחולל מכתבים חכם
 * מייצר מכתבים ודרישות תשלום על בסיס נתוני פרויקט וניתוח בינה מלאכותית.
 */


export default function SmartLetterGenerator({ projectId, initialSelectedItems, onClose }: SmartLetterGeneratorProps) {
    const { state, setters, actions, derived } = useSmartLetterState({ projectId, initialSelectedItems });
    const {
        letterType,
        recipient,
        subject,
        keyPoints,
        tone,
        generatedLetter,
        isGenerating,
        isCopied,
        isSaving,
        saveSuccess,
        ledgerItems,
        selectedLedgerItems,
        viewMode,
        savedLetters,
        isDeleting,
        showPrintPreview,
        projectName,
    } = state;
    const {
        setLetterType,
        setRecipient,
        setSubject,
        setKeyPoints,
        setTone,
        setGeneratedLetter,
        setViewMode,
    } = setters;
    const printableItems: LedgerItem[] = derived.selectedItems.map((item) => ({
        id: item.id,
        item_code: item.item_code || '',
        description: item.description || '',
        unit: item.unit || '',
        quantity: Number(item.quantity ?? 0),
        unit_price_excl_vat: Number(item.unit_price_excl_vat ?? item.unit_price ?? 0),
        total_price_excl_vat: getLedgerRowAmount(item),
        source: item.source || undefined,
        project_id: item.project_id,
        item_type: 'ITEM',
        type: typeof item.type === 'string' ? (item.type as LedgerItem['type']) : undefined,
        ai_rationale: item.ai_rationale || undefined,
        governing_notes: item.governing_notes,
        evidence_data: item.evidence_data,
    }));

    return (
        <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-1000" dir="rtl">
            {/* Terminal Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[#151C24]/50 border border-white/5 p-8 rounded-[2.5rem] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-blue-500/[0.05] to-transparent" />
                <div className="flex items-center gap-6 relative z-10">
                    <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                        <Terminal className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 bg-blue-500 shadow-[0_0_10px_blue] rounded-full animate-pulse" />
                            <span className="text-[10px] font-mono font-black text-blue-500 uppercase tracking-[0.3em]">מחולל מכתבים חכם</span>
                        </div>
                        <h2 className="text-3xl font-black text-white uppercase tracking-tighter font-mono">
                            מסוף יצירת מכתבים
                            <span className="text-gray-600 font-light font-sans text-xl mr-4">/ יצירת דרישות תשלום חכמות</span>
                        </h2>
                    </div>
                </div>

                <div className="flex items-center gap-4 relative z-10">
                    <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5">
                        <button 
                            onClick={() => setViewMode('edit')}
                            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-tighter flex items-center gap-3 transition-all duration-500 ${
                                viewMode === 'edit' 
                                ? 'bg-blue-500 text-black shadow-lg' 
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            <Edit3 className="w-4 h-4" />
                            עריכת פקודה
                        </button>
                        <button 
                            onClick={() => setViewMode('history')}
                            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-tighter flex items-center gap-3 transition-all duration-500 ${
                                viewMode === 'history' 
                                ? 'bg-blue-500 text-black shadow-lg' 
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            <History className="w-4 h-4" />
                            ארכיון מסמכים
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
                {/* Left Panel: Configuration */}
                <div className="xl:col-span-5 flex flex-col gap-8">
                    <div className="bg-[#0D1218]/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl space-y-10">
                        {/* Module Selection */}
                        <div className="space-y-6">
                            <label className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                                <div className="w-8 h-[1px] bg-gray-800" />
                                מודולי ביצוע
                                <div className="flex-1 h-[1px] bg-gray-800" />
                            </label>
                            <div className="grid grid-cols-2 gap-4">
                                {LETTER_TYPES.map(lt => (
                                    <button
                                        key={lt.value}
                                        onClick={() => setLetterType(lt.value)}
                                        className={`group relative text-right p-5 rounded-[1.5rem] border transition-all duration-500 overflow-hidden ${
                                            letterType === lt.value
                                            ? `border-${lt.color}-500 bg-${lt.color}-500/10 shadow-[0_0_30px_rgba(255,255,255,0.05)]`
                                            : 'border-white/5 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                                        }`}
                                    >
                                        <div className="flex items-center gap-4 mb-2">
                                            <div className={`p-2.5 rounded-xl bg-black/40 border border-white/5 transition-colors ${letterType === lt.value ? `text-${lt.color}-400 border-${lt.color}-500/30` : 'text-gray-600'}`}>
                                                <lt.icon className="w-5 h-5" />
                                            </div>
                                            <span className={`text-sm font-black transition-colors ${letterType === lt.value ? 'text-white' : 'text-gray-500'}`}>{lt.label}</span>
                                        </div>
                                        <div className="text-[8px] font-mono uppercase tracking-[0.2em] opacity-40 pr-12">{lt.desc}</div>
                                        {letterType === lt.value && (
                                            <motion.div 
                                                layoutId="activeModule"
                                                className={`absolute inset-0 border-2 border-${lt.color}-500/30 rounded-[1.5rem] pointer-events-none`} 
                                            />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Recipient & Subject Fields */}
                        <div className="grid grid-cols-1 gap-8">
                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-600 uppercase tracking-widest flex items-center gap-3">
                                    <Share2 className="w-4 h-4" /> נמען
                                </label>
                                <input
                                    type="text"
                                    value={recipient}
                                    onChange={(e) => setRecipient(e.target.value)}
                                    placeholder="נמען: מנהל הפרויקט / מזמין"
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-base text-white placeholder:text-gray-700 focus:border-blue-500/50 outline-none transition-all font-bold"
                                />
                            </div>
                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-600 uppercase tracking-widest flex items-center gap-3">
                                    <Layout className="w-4 h-4" /> נושא המסמך
                                </label>
                                <input
                                    type="text"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    placeholder="נושא המסמך..."
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-base text-white placeholder:text-gray-700 focus:border-blue-500/50 outline-none transition-all font-bold"
                                />
                            </div>
                        </div>

                        {/* Ledger Item Packets */}
                        {ledgerItems.length > 0 && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4 flex-1">
                                        <div className="w-8 h-[1px] bg-gray-800" />
                                        חבילות נתונים כספיים
                                        <div className="flex-1 h-[1px] bg-gray-800" />
                                    </label>
                                    <div className="flex items-center gap-3 mr-4">
                                        <span className="text-[10px] font-mono font-black text-emerald-500/80 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                                            ₪ {derived.totalInclVat.toLocaleString('he-IL')}
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-black/60 rounded-[2rem] border border-white/5 overflow-hidden">
                                    <div className="max-h-72 overflow-y-auto custom-scrollbar p-3 space-y-2">
                                        {ledgerItems.map(item => (
                                            <motion.div 
                                                key={item.id} 
                                                whileHover={{ x: -5 }}
                                                onClick={() => actions.toggleLedgerItem(item.id)}
                                                className={`group flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all border ${
                                                    selectedLedgerItems.includes(item.id) 
                                                    ? 'bg-blue-500/10 border-blue-500/30' 
                                                    : 'bg-white/[0.02] border-transparent hover:border-white/10'
                                                }`} 
                                            >
                                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                                                    selectedLedgerItems.includes(item.id) 
                                                    ? 'bg-blue-500 border-blue-500' 
                                                    : 'border-white/10 bg-black/40'
                                                }`}>
                                                    {selectedLedgerItems.includes(item.id) && <Check className="w-4 h-4 text-black font-black" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <p className="text-sm font-black text-gray-200 truncate">{item.description}</p>
                                                        <span className="text-[10px] font-mono text-gray-600 bg-black/40 px-2 py-0.5 rounded border border-white/5">{item.item_code}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/5 border border-white/5">
                                                            <Activity className="w-3 h-3 text-gray-500" />
                                                            <span className="text-[10px] text-gray-500 font-mono">{item.quantity} {item.unit}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/5 border border-blue-500/10">
                                                            <DollarSign className="w-3 h-3 text-blue-500/60" />
                                                            <span className="text-[10px] text-blue-400 font-black">₪ {getLedgerRowAmount(item).toLocaleString('he-IL')}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tone & Context */}
                        <div className="space-y-8">
                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-600 uppercase tracking-widest">טון פנייה</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {TONE_OPTIONS.map(t => (
                                        <button
                                            key={t.value}
                                            onClick={() => setTone(t.value)}
                                            className={`py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-tighter transition-all duration-500 border ${
                                                tone === t.value
                                                ? 'border-blue-500 bg-blue-500/10 text-blue-400 shadow-lg shadow-blue-500/10'
                                                : 'border-white/5 bg-black/40 text-gray-600 hover:text-gray-400 hover:border-white/20'
                                            }`}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="text-[11px] font-mono font-black text-gray-600 uppercase tracking-widest">הקשר נוסף</label>
                                <textarea
                                    value={keyPoints}
                                    onChange={(e) => setKeyPoints(e.target.value)}
                                    placeholder="דגשים נוספים לבינה המלאכותית..."
                                    rows={4}
                                    className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] p-6 text-base text-white placeholder:text-gray-700 focus:border-blue-500/50 outline-none transition-all resize-none font-bold"
                                />
                            </div>
                        </div>

                        {/* Execute Button */}
                        <motion.button
                            whileHover={{ scale: 1.02, y: -5 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={actions.generateLetter}
                            disabled={!derived.canGenerate || isGenerating}
                            className={`group w-full relative flex items-center justify-center gap-6 py-8 rounded-[2rem] text-sm font-black uppercase tracking-[0.5em] transition-all overflow-hidden shadow-2xl ${
                                isGenerating 
                                ? 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/5' 
                                : 'bg-blue-600 text-white shadow-[0_30px_60px_-15px_rgba(59,130,246,0.3)]'
                            }`}
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    <span>מנתח נתונים...</span>
                                </>
                            ) : (
                                <>
                                    <Zap className="w-6 h-6 group-hover:animate-pulse" />
                                    <span>צור מכתב חכם</span>
                                </>
                            )}
                            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                        </motion.button>
                    </div>
                </div>

                {/* Right Panel: Output & History */}
                <div className="xl:col-span-7 flex flex-col gap-8">
                    <div className="flex-1 bg-[#0D1218]/80 backdrop-blur-3xl border border-white/10 rounded-[3rem] shadow-2xl flex flex-col min-h-[850px] overflow-hidden relative">
                        {/* Terminal Tool Bar */}
                        <div className="flex items-center justify-between px-10 py-6 border-b border-white/5 bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
                                <span className="mr-4 text-[10px] font-mono text-gray-600 uppercase tracking-widest">תצוגת פלט</span>
                            </div>
                            
                            <AnimatePresence>
                                {generatedLetter && viewMode === 'edit' && (
                                    <motion.div 
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="flex items-center gap-3"
                                    >
                                        <button
                                            onClick={actions.saveLetter}
                                            disabled={!derived.canSave || isSaving || saveSuccess}
                                            className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-tight border transition-all duration-500 ${
                                                saveSuccess 
                                                ? 'bg-emerald-500 text-black border-emerald-500' 
                                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20'
                                            }`}
                                        >
                                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveSuccess ? <Check className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                                            {saveSuccess ? 'נשמר בארכיון' : 'שמור בארכיון'}
                                        </button>
                                        <button
                                            onClick={actions.openPrintPreview}
                                            className="flex items-center gap-3 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-tight bg-white/5 text-gray-400 border border-white/10 hover:border-white/20 hover:text-white transition-all"
                                        >
                                            <Printer className="w-4 h-4" />
                                            תצוגת הדפסה
                                        </button>
                                        <button
                                            onClick={actions.copyLetter}
                                            className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-tight border transition-all duration-500 ${
                                                isCopied 
                                                ? 'bg-white text-black border-white' 
                                                : 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30'
                                            }`}
                                        >
                                            {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                            {isCopied ? 'הועתק!' : 'העתק טקסט'}
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <div className="flex-1 p-12 relative overflow-y-auto custom-scrollbar">
                            <AnimatePresence mode="wait">
                                {viewMode === 'history' ? (
                                    <motion.div 
                                        key="history"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -20 }}
                                        className="space-y-6" 
                                        dir="rtl"
                                    >
                                        {savedLetters.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-32 opacity-20">
                                                <History className="w-24 h-24 mb-8" />
                                                <p className="text-xl font-black uppercase tracking-widest font-mono text-center">הארכיון ריק</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {savedLetters.map(letter => (
                                                    <motion.div 
                                                        key={letter.id}
                                                        layout
                                                        whileHover={{ scale: 1.02 }}
                                                        className="group relative bg-[#151C24]/50 border border-white/10 rounded-[2.5rem] p-8 hover:border-blue-500/50 transition-all cursor-pointer shadow-xl overflow-hidden"
                                                        onClick={() => actions.selectSavedLetter(letter)}
                                                    >
                                                        <div className="absolute top-0 right-0 w-full h-1 bg-gradient-to-l from-blue-500/30 to-transparent" />
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void actions.deleteLetter(letter.id);
                                                            }}
                                                            className="absolute top-6 left-6 p-2 rounded-xl bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/20 border border-red-500/20"
                                                        >
                                                            {isDeleting === letter.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                                        </button>
                                                        
                                                        <div className="flex items-center justify-between mb-6">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                                    <FileText className="w-5 h-5 text-blue-400" />
                                                                </div>
                                                                <span className="text-[11px] font-mono text-blue-400/60 font-black tracking-widest">{letter.letter_number}</span>
                                                            </div>
                                                            <span className="text-[10px] text-gray-600 font-mono">{new Date(letter.created_at).toLocaleDateString('he-IL')}</span>
                                                        </div>
                                                        <h4 className="text-xl font-black text-gray-200 mb-4 pl-12 leading-tight">{letter.subject}</h4>
                                                        <div className="flex items-center gap-4 flex-wrap mt-auto">
                                                            <div className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] text-gray-500 font-bold">
                                                                נמען: {letter.recipient_name}
                                                            </div>
                                                            <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-black">
                                                                ₪ {(letter.total_amount_incl_vat || 0).toLocaleString('he-IL')}
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                ) : isGenerating ? (
                                    <motion.div 
                                        key="generating"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0F14]/50 backdrop-blur-2xl z-50 gap-10"
                                    >
                                        <div className="relative w-40 h-40">
                                            <div className="absolute inset-0 border-[3px] border-blue-500/10 rounded-full" />
                                            <div className="absolute inset-0 border-t-[3px] border-blue-500 rounded-full animate-spin shadow-[0_0_30px_rgba(59,130,246,0.5)]" />
                                            <Brain className="absolute inset-0 m-auto w-12 h-12 text-blue-500 animate-pulse" />
                                        </div>
                                        <div className="text-center space-y-4">
                                            <p className="text-2xl font-black text-white uppercase tracking-widest font-mono animate-pulse">מייצר מסמך...</p>
                                            <p className="text-sm text-gray-500 font-mono uppercase tracking-[0.3em]">מנתח נתונים משפטיים...</p>
                                        </div>
                                    </motion.div>
                                ) : generatedLetter ? (
                                    <motion.div 
                                        key="letter"
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="bg-white rounded-[2.5rem] shadow-[0_40px_100px_rgba(0,0,0,0.5)] min-h-full p-16 text-black font-serif relative overflow-hidden group" dir="rtl"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent pointer-events-none" />
                                        {/* Luxury Letterhead */}
                                        <div className="border-b-[3px] border-black/5 pb-10 mb-12 flex justify-between items-center relative z-10">
                                            <div className="flex items-center gap-6">
                                                <div className="w-20 h-20 rounded-2xl bg-black flex items-center justify-center shadow-2xl text-white font-black text-3xl">
                                                    קי
                                                </div>
                                                <div>
                                                    <h1 className="text-2xl font-black text-gray-900 tracking-tighter uppercase">קבלני ישראל בע"מ</h1>
                                                    <p className="text-xs text-gray-500 font-sans tracking-widest mt-1">פתרונות בנייה מתקדמים</p>
                                                </div>
                                            </div>
                                            <div className="text-left font-mono">
                                                <div className="text-[10px] text-gray-400 mb-1 uppercase tracking-widest">אישור תנועה</div>
                                                <div className="text-xs text-gray-900 font-bold">סימוכין: {Math.random().toString(36).substring(7).toUpperCase()}</div>
                                                <div className="text-xs text-gray-400 mt-1">{new Date().toLocaleDateString('he-IL')}</div>
                                            </div>
                                        </div>

                                        <textarea
                                            value={generatedLetter}
                                            onChange={(e) => setGeneratedLetter(e.target.value)}
                                            dir="rtl"
                                            className="w-full h-[600px] bg-transparent text-gray-900 text-lg leading-[1.8] focus:outline-none resize-none custom-scrollbar font-serif font-medium relative z-10"
                                            spellCheck={false}
                                        />

                                        <div className="mt-16 pt-10 border-t border-gray-100 flex justify-between items-center relative z-10">
                                            <div className="flex flex-col gap-1">
                                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-widest">חתימת המערכת</span>
                                                <div className="flex items-center gap-2">
                                                    <Brain className="w-3 h-3 text-blue-500" />
                                                    <span className="text-xs text-gray-400 font-sans italic">{AI_MODEL_BRANDING}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-widest">פרוטוקול מאומת</span>
                                                <div className="flex items-center gap-2">
                                                    <Shield className="w-3 h-3 text-blue-500" />
                                                    <span className="text-[10px] font-black uppercase text-blue-500">מסמך מאובטח v6.1</span>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center gap-8 opacity-10 py-40">
                                        <div className="w-40 h-40 rounded-[3rem] bg-white/5 border border-white/10 flex items-center justify-center">
                                            <FileText className="w-20 h-20 text-gray-400" />
                                        </div>
                                        <div className="space-y-4">
                                            <h3 className="text-2xl font-black text-gray-300 uppercase tracking-widest font-mono">ממתין לבחירה</h3>
                                            <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed font-mono">
                                                יש לבחור מודול ונתונים כדי להתחיל בתהליך הניסוח
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Terminal Advisor */}
                    <div className="bg-amber-500/[0.05] border border-amber-500/20 p-8 rounded-[2.5rem] flex items-start gap-6 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-amber-500/[0.03] to-transparent pointer-events-none" />
                        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                            <ShieldAlert className="w-6 h-6 text-amber-500 animate-pulse" />
                        </div>
                        <div className="space-y-2 relative z-10">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono font-black text-amber-500 uppercase tracking-[0.4em]">ייעוץ משפטי חכם</span>
                            </div>
                            <p className="text-sm text-amber-100/70 leading-relaxed font-bold" dir="rtl">
                                המערכת משתמשת בבינה מלאכותית לניסוח המכתב. המכתב כולל חישוב מע"מ אוטומטי של <span className="text-amber-500">{(VAT_RATE * 100).toFixed(0)}%</span> בהתאם לתקנות המס בישראל. מומלץ לוודא את הנתונים הכספיים במודל ה-Edit לפני Commit סופי למערכת.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Branding Footer */}
            <div className="py-6 flex flex-col items-center gap-2 border-t border-white/5 bg-black/20">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Cpu className="w-3 h-3 text-blue-500/50" />
                        <span className="text-[10px] font-mono text-gray-500 font-black tracking-widest uppercase">{AI_MODEL_BRANDING}</span>
                    </div>
                    <div className="h-3 w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                        <Activity className="w-3 h-3 text-emerald-500/50" />
                        <span className="text-[10px] font-mono text-gray-500 font-black tracking-widest uppercase">Claims Engine v6.1</span>
                    </div>
                </div>
            </div>

            {/* Print Preview Overlay */}
            <AnimatePresence>
                {showPrintPreview && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999]"
                    >
                        <PrintableLetter
                            projectName={projectName}
                            recipient={recipient}
                            subject={subject}
                            legalText={generatedLetter}
                            onClose={actions.closePrintPreview}
                            items={printableItems}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
