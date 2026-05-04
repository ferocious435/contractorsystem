"use client";

import React, { useState, useMemo } from 'react';
import { X, FileText, Loader2, Sparkles, Receipt, Calculator, ShieldCheck, Mail, Send, Type, Layers, Info, CheckCircle2, Printer } from 'lucide-react';
import { LedgerItem } from './LedgerTable';
import { generatePricingPDF } from '@/utils/pdfGenerator';
import { PrintableLetter } from './PrintableLetter';
import { motion, AnimatePresence } from 'framer-motion';
import { VAT_RATE, AI_MODEL_BRANDING } from '@/utils/constants';

interface GenerateVOLetterModalProps {
    selectedItems: LedgerItem[];
    onClose: () => void;
    totalAmount?: number;
}

export default function GenerateVOLetterModal({ selectedItems, onClose }: GenerateVOLetterModalProps) {
    const [recipient, setRecipient] = useState('');
    const [subject, setSubject] = useState(`דרישת תשלום לחריגים - חשבון חלקי`);
    const [keyPoints, setKeyPoints] = useState('');
    const [docType, setDocType] = useState<'vo_request' | 'rfi' | 'official_vo'>('vo_request');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [tone, setTone] = useState<'formal' | 'firm' | 'friendly' | 'aggressive' | 'skeleton'>('formal');
    const [generatedText, setGeneratedText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [showEvidencePreview, setShowEvidencePreview] = useState(false);

    const financialSummary = useMemo(() => {
        const subtotal = selectedItems
            .filter(i => !i.item_type || i.item_type === 'ITEM')
            .reduce((sum, i) => sum + (i.quantity * i.unit_price_excl_vat), 0);
        const vat = subtotal * VAT_RATE;
        return {
            subtotal,
            vat,
            total: subtotal + vat
        };
    }, [selectedItems]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { 
            style: 'currency', 
            currency: 'ILS',
            minimumFractionDigits: 2
        }).format(val);
    };

    const handleGenerate = async () => {
        if (!recipient) {
            setError('נא להזין נמען.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setIsSaved(false);

        try {
            // 1. Generate text via AI
            const res = await fetch('/api/generate-letter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: selectedItems[0]?.project_id || '',
                    letterType: docType,
                    recipient,
                    subject,
                    keyPoints,
                    tone,
                    items: selectedItems.map(i => ({
                        description: i.description,
                        quantity: i.quantity,
                        unit: i.unit,
                        price: i.unit_price_excl_vat,
                        total: i.quantity * i.unit_price_excl_vat,
                        code: i.item_code,
                        ai_rationale: i.ai_rationale,
                        governing_notes: i.governing_notes
                    }))
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'שגיאה ביצירת נוסח המכתב.');
            }

            const data = await res.json();
            const legalText = data.letter;
            setGeneratedText(legalText);

            // 2. Save to database
            const saveRes = await fetch('/api/pricing/vo-letters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: selectedItems[0]?.project_id || '',
                    subject,
                    recipientName: recipient,
                    docType,
                    content: legalText,
                    totalExclVat: financialSummary.subtotal,
                    vatAmount: financialSummary.vat,
                    totalInclVat: financialSummary.total,
                    itemIds: selectedItems.map(i => i.id)
                })
            });

            if (!saveRes.ok) {
                console.warn('Failed to save to DB, but PDF will be generated.');
            } else {
                setIsSaved(true);
            }

            // 3. Show Preview
            setShowPreview(true);
        } catch (err: any) {
            setError(err.message || 'אירעה שגיאה בעת יצירת המסמך.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-2xl" dir="rtl">
            {showPreview ? (
                <PrintableLetter
                    projectName={selectedItems[0]?.project_id ? `פרויקט ${selectedItems[0].project_id.substring(0, 8)}` : 'פרויקט כללי'}
                    recipient={recipient}
                    subject={subject}
                    legalText={generatedText}
                    items={selectedItems}
                    onClose={onClose}
                />
            ) : (
                <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="bg-[#0B0F14] border border-white/10 rounded-[2.5rem] w-full max-w-6xl h-[85vh] flex overflow-hidden shadow-[0_0_100px_rgba(0,0,0,1)] relative"
                >
                {/* Left Side: Summary & Financials (Loki Style) */}
                <div className="w-1/3 bg-[#151C24]/50 border-l border-white/5 p-10 flex flex-col gap-10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
                    
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_emerald]" />
                            <span className="text-[10px] font-mono font-black text-emerald-500 uppercase tracking-[0.3em]">רשימת פריטים</span>
                        </div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">סיכום פריטים</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                        {selectedItems.map((item, idx) => (
                            <div key={idx} className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col gap-2 group hover:border-white/10 transition-all">
                                <div className="flex justify-between items-start">
                                    <span className="text-[9px] font-mono font-black text-gray-600 uppercase tracking-widest">{item.item_code || 'פריט חדש'}</span>
                                    <span className="text-[10px] font-mono font-black text-emerald-400">{formatCurrency(item.quantity * item.unit_price_excl_vat)}</span>
                                </div>
                                <span className="text-xs text-gray-300 font-bold leading-relaxed line-clamp-2">{item.description}</span>
                            </div>
                        ))}
                    </div>

                    {/* Evidence Appendix Preview */}
                    {selectedItems.some(i => i.governing_notes || i.ai_rationale) && (
                        <div className="mt-4 p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
                            <div className="flex items-center gap-2 mb-3">
                                <ShieldCheck className="w-3 h-3 text-blue-400" />
                                <span className="text-[10px] font-mono font-black text-blue-400 uppercase tracking-widest">נספח הוכחות מוכן</span>
                            </div>
                            <div className="space-y-2">
                                {selectedItems.filter(i => i.governing_notes || i.ai_rationale).slice(0, 3).map((item, idx) => (
                                    <div key={idx} className="text-[9px] text-gray-500 flex items-start gap-2">
                                        <div className="w-1 h-1 bg-blue-500/40 rounded-full mt-1" />
                                        <span className="line-clamp-1">{item.description}</span>
                                    </div>
                                ))}
                                {selectedItems.filter(i => i.governing_notes || i.ai_rationale).length > 3 && (
                                    <div className="text-[9px] text-blue-400 font-bold italic">
                                        + עוד {selectedItems.filter(i => i.governing_notes || i.ai_rationale).length - 3} הוכחות...
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="mt-auto space-y-6 bg-black/40 p-8 rounded-[2rem] border border-white/5 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20" />
                        
                        <div className="flex justify-between items-center text-gray-500">
                            <span className="text-[10px] font-mono font-black uppercase tracking-widest">ערך בסיס</span>
                            <span className="text-sm font-mono font-black text-gray-300">{formatCurrency(financialSummary.subtotal)}</span>
                        </div>
                        <div className="flex justify-between items-center text-blue-400/80">
                            <span className="text-[10px] font-mono font-black uppercase tracking-widest">מע"מ {VAT_RATE * 100}%</span>
                            <span className="text-sm font-mono font-black">{formatCurrency(financialSummary.vat)}</span>
                        </div>
                        <div className="pt-4 border-t border-white/5 flex flex-col gap-2">
                            <span className="text-[9px] font-mono font-black text-emerald-400 uppercase tracking-[0.3em]">השפעה סופית</span>
                            <span className="text-3xl font-mono font-black text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                                {formatCurrency(financialSummary.total)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Right Side: Configuration & Action */}
                <div className="flex-1 p-10 flex flex-col gap-10 bg-[#0B0F14]">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <h2 className="text-3xl font-black text-white uppercase tracking-tighter font-mono">
                                עמדת הפקת מסמכים <span className="text-gray-600 font-light font-sans text-xl">/ הפקת מסמך רשמי</span>
                            </h2>
                            <div className="flex items-center gap-3">
                                <p className="text-[10px] text-gray-500 uppercase font-black tracking-[0.3em]">פרוטוקול דרישת תשלום רשמי</p>
                                <span className="text-[10px] font-mono font-black text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 uppercase tracking-widest">{AI_MODEL_BRANDING}</span>
                            </div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="w-12 h-12 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 transition-all rounded-2xl border border-transparent hover:border-white/10"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-8 overflow-y-auto custom-scrollbar flex-1 pr-2">
                        <div className="flex flex-col gap-3 col-span-2">
                            <label className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                <Mail className="w-3 h-3" /> פרטי נמען
                            </label>
                            <input 
                                type="text"
                                placeholder="לכבוד: מנהל הפרויקט / מפקח..."
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                className="bg-[#151C24] border border-white/10 rounded-2xl p-4 text-sm text-white focus:border-blue-500/50 outline-none transition-all font-bold"
                            />
                        </div>

                        <div className="flex flex-col gap-3 col-span-2">
                            <label className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                <Type className="w-3 h-3" /> נושא המכתב
                            </label>
                            <input 
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                className="bg-[#151C24] border border-white/10 rounded-2xl p-4 text-sm text-white focus:border-blue-500/50 outline-none transition-all font-bold"
                            />
                        </div>

                        <div className="flex flex-col gap-3 col-span-2">
                            <label className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                <Layers className="w-3 h-3" /> סוג מסמך
                            </label>
                            <div className="grid grid-cols-3 gap-4">
                                {[
                                    { id: 'vo_request', label: 'מכתב דרישה', sub: 'CLAIM LETTER' },
                                    { id: 'rfi', label: 'בקשת מידע', sub: 'RFI / INFO' },
                                    { id: 'official_vo', label: 'פקו"ש רשמי', sub: 'OFFICIAL VO' }
                                ].map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setDocType(t.id as any)}
                                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${
                                            docType === t.id 
                                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.1)]' 
                                            : 'border-white/5 bg-white/[0.01] text-gray-500 hover:border-white/10'
                                        }`}
                                    >
                                        <span className="text-sm font-black">{t.label}</span>
                                        <span className="text-[9px] font-mono font-black uppercase tracking-widest opacity-50">{t.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 col-span-2">
                            <label className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                <Info className="w-3 h-3" /> מידע נוסף
                            </label>
                            <textarea 
                                placeholder="ציין סיבת החריגה, אישור בשטח או כל מידע נוסף שיסייע ל-AI לכתוב את המכתב..."
                                value={keyPoints}
                                onChange={(e) => setKeyPoints(e.target.value)}
                                className="bg-[#151C24] border border-white/10 rounded-2xl p-4 text-sm text-white focus:border-blue-500/50 outline-none transition-all resize-none h-32 font-sans font-medium"
                            />
                        </div>

                        <div className="flex flex-col gap-3 col-span-2">
                            <label className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest">טון המכתב</label>
                            <div className="grid grid-cols-3 gap-4">
                                {[
                                    { id: 'formal', label: 'רשמי', sub: 'סטנדרטי' },
                                    { id: 'firm', label: 'תקיף', sub: 'נחרץ' },
                                    { id: 'friendly', label: 'ידידותי', sub: 'שיתופי' },
                                    { id: 'aggressive', label: 'אגרסיבי', sub: 'התראה' },
                                    { id: 'skeleton', label: 'שלד בלבד', sub: 'טיוטה' }
                                ].map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setTone(t.id as any)}
                                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${
                                            tone === t.id 
                                            ? 'border-blue-500 bg-blue-500/10 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.1)]' 
                                            : 'border-white/5 bg-white/[0.01] text-gray-500 hover:border-white/10'
                                        }`}
                                    >
                                        <span className="text-sm font-black">{t.label}</span>
                                        <span className="text-[9px] font-mono font-black uppercase tracking-widest opacity-50">{t.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-white/5">
                        <AnimatePresence>
                            {error && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-black uppercase tracking-widest flex items-center gap-3"
                                >
                                    <ShieldCheck className="w-4 h-4 rotate-180" />
                                    {error}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <motion.button
                            whileHover={{ scale: 1.02, backgroundColor: isSaved ? '#10b981' : '#fff' }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleGenerate}
                            disabled={isLoading || isSaved}
                            className={`w-full py-6 rounded-3xl text-sm font-black uppercase tracking-[0.6em] transition-all flex items-center justify-center gap-4 ${
                                isLoading 
                                ? 'bg-white/5 text-gray-600 cursor-not-allowed' 
                                : isSaved
                                ? 'bg-emerald-500 text-white'
                                : 'bg-white text-black shadow-[0_20px_40px_rgba(255,255,255,0.1)]'
                            }`}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    מפיק ומערכב...
                                </>
                            ) : isSaved ? (
                                <>
                                    <CheckCircle2 className="w-5 h-5" />
                                    נשמר במערכת בהצלחה
                                </>
                            ) : (
                                <>
                                    <Send className="w-5 h-5" />
                                    הפקת PDF ושמירה
                                </>
                            )}
                        </motion.button>
                    </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
