"use client";

import React, { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { FileText, Send, Copy, Check, Loader2, ChevronDown } from 'lucide-react';

interface SmartLetterGeneratorProps {
    projectId: string;
}

const LETTER_TYPES = [
    { value: 'claim', label: 'תביעה / דרישה', icon: '⚠️', desc: 'מכתב תביעה לפיצוי או דרישה' },
    { value: 'notice', label: 'הודעה רשמית', icon: '📋', desc: 'הודעה על עיכוב, שינוי, או בעיה' },
    { value: 'vo_request', label: 'בקשת חריג', icon: '📝', desc: 'בקשה לאישור עבודה נוספת' },
    { value: 'response', label: 'תשובה למזמין', icon: '💬', desc: 'תשובה מקצועית למכתב שהתקבל' },
    { value: 'general', label: 'מכתב כללי', icon: '✉️', desc: 'מכתב חופשי בהתאמה אישית' }
];

const TONE_OPTIONS = [
    { value: 'professional', label: 'מקצועי וידידותי' },
    { value: 'formal', label: 'פורמלי' },
    { value: 'firm', label: 'תקיף' }
];

export default function SmartLetterGenerator({ projectId }: SmartLetterGeneratorProps) {
    const [letterType, setLetterType] = useState('');
    const [recipient, setRecipient] = useState('');
    const [subject, setSubject] = useState('');
    const [keyPoints, setKeyPoints] = useState('');
    const [tone, setTone] = useState('professional');
    const [generatedLetter, setGeneratedLetter] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const [ledgerItems, setLedgerItems] = useState<any[]>([]);
    const [selectedLedgerItems, setSelectedLedgerItems] = useState<string[]>([]);

    const supabase = createClient();

    React.useEffect(() => {
        if (projectId) {
            fetchLedgerItems();
        }
    }, [projectId]);

    const fetchLedgerItems = async () => {
        try {
            const { data, error } = await supabase
                .from('pricing_ledger')
                .select('*')
                .eq('project_id', projectId)
                .in('type', ['PENDING_VO', 'APPROVED_VO']);
            
            if (error) throw error;
            setLedgerItems(data || []);
        } catch (err) {
            console.error('Error fetching ledger items:', err);
        }
    };

    const handleGenerate = async () => {
        if (!letterType) return;
        setIsGenerating(true);
        setGeneratedLetter('');

        try {
            const selectedItemsData = ledgerItems.filter(item => selectedLedgerItems.includes(item.id));
            const itemsContext = selectedItemsData.length > 0 
                ? `פריטים לתמחור:\n${selectedItemsData.map(i => `- ${i.description}: ${i.quantity} ${i.unit} במחיר ${i.unit_price_excl_vat} ₪ ליחידה`).join('\n')}`
                : '';

            const response = await fetch('/api/generate-letter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    projectId, 
                    letterType, 
                    recipient, 
                    subject, 
                    keyPoints: `${keyPoints}\n\n${itemsContext}`.trim(), 
                    tone 
                })
            });

            const data = await response.json();
            if (data.success) {
                setGeneratedLetter(data.letter);
            } else {
                setGeneratedLetter(`שגיאה: ${data.error || 'תקלה לא ידועה'}`);
            }
        } catch (err) {
            console.error('Letter generation error:', err);
            setGeneratedLetter('שגיאת תקשורת. אנא נסה שוב.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(generatedLetter);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-100">מחולל מכתבים חכמים</h2>
                    <p className="text-xs text-gray-400">צור מכתבים מקצועיים על בסיס נתוני הפרויקט בעזרת AI</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Левая панель: форма */}
                <div className="space-y-5">
                    {/* Тип письма */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3" dir="rtl">סוג המכתב</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {LETTER_TYPES.map(lt => (
                                <button
                                    key={lt.value}
                                    onClick={() => setLetterType(lt.value)}
                                    className={`text-right p-3 rounded-lg border transition-all ${letterType === lt.value
                                            ? 'border-primary bg-primary/10 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                                            : 'border-border-subtle bg-workspace hover:border-gray-600'
                                        }`}
                                    dir="rtl"
                                >
                                    <div className="flex items-center gap-2">
                                        <span>{lt.icon}</span>
                                        <span className="text-sm font-medium text-gray-200">{lt.label}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1 mr-6">{lt.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Получатель */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2" dir="rtl">נמען</label>
                        <input
                            type="text"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder="שם הנמען / חברה"
                            dir="rtl"
                            className="w-full bg-workspace border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                        />
                    </div>

                    {/* Тема */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2" dir="rtl">נושא</label>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            placeholder="לדוגמה: דרישה לפיצוי בגין עיכוב"
                            dir="rtl"
                            className="w-full bg-workspace border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                        />
                    </div>

                    {/* Выбор элементов из леджера для V.O. */}
                    {letterType === 'vo_request' && ledgerItems.length > 0 && (
                        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-3">
                            <label className="block text-sm font-medium text-blue-300" dir="rtl">צרף פריטים מהלג'ר (תמחור)</label>
                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                {ledgerItems.map(item => (
                                    <label key={item.id} className="flex items-center gap-3 p-2 bg-black/20 rounded-lg cursor-pointer hover:bg-black/40 transition-colors border border-white/5" dir="rtl">
                                        <input 
                                            type="checkbox"
                                            checked={selectedLedgerItems.includes(item.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedLedgerItems(prev => [...prev, item.id]);
                                                else setSelectedLedgerItems(prev => prev.filter(id => id !== item.id));
                                            }}
                                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary focus:ring-primary"
                                        />
                                        <div className="flex-1">
                                            <p className="text-xs font-medium text-gray-200">{item.description}</p>
                                            <p className="text-[10px] text-gray-500">{item.quantity} {item.unit} | {item.unit_price_excl_vat} ₪</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Ключевые пункты */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2" dir="rtl">נקודות מפתח נוספות</label>
                        <textarea
                            value={keyPoints}
                            onChange={(e) => setKeyPoints(e.target.value)}
                            placeholder="תאר את הנקודות העיקריות שצריכות להופיע במכתב..."
                            rows={4}
                            dir="rtl"
                            className="w-full bg-workspace border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 resize-none"
                        />
                    </div>

                    {/* Тон */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2" dir="rtl">טון המכתב</label>
                        <div className="flex gap-2" dir="rtl">
                            {TONE_OPTIONS.map(t => (
                                <button
                                    key={t.value}
                                    onClick={() => setTone(t.value)}
                                    className={`px-4 py-2 rounded-lg text-sm border transition-all ${tone === t.value
                                            ? 'border-primary bg-primary/10 text-primary font-medium'
                                            : 'border-border-subtle bg-workspace text-gray-400 hover:border-gray-600'
                                        }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Кнопка генерации */}
                    <button
                        onClick={handleGenerate}
                        disabled={!letterType || isGenerating}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded-xl font-medium shadow-blue transition-all"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                מייצר מכתב...
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5" />
                                צור מכתב
                            </>
                        )}
                    </button>
                </div>

                {/* Правая панель: результат */}
                <div className="bg-workspace border border-border-subtle rounded-xl overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-[#1e2333]">
                        <span className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            תצוגה מקדימה
                        </span>
                        {generatedLetter && (
                            <button
                                onClick={handleCopy}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-workspace border border-border-subtle rounded-lg hover:bg-white/5 text-gray-300 transition-colors"
                            >
                                {isCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                                {isCopied ? 'הועתק!' : 'העתק'}
                            </button>
                        )}
                    </div>
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar" style={{ minHeight: '500px' }}>
                        {isGenerating ? (
                            <div className="flex flex-col items-center justify-center h-full gap-3">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                <span className="text-sm text-gray-400">הבינה המלאכותית כותבת את המכתב...</span>
                            </div>
                        ) : generatedLetter ? (
                            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-200 leading-relaxed" dir="rtl">
                                {generatedLetter}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-gray-800 border border-border-subtle flex items-center justify-center">
                                    <FileText className="w-8 h-8 text-gray-600" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-medium text-gray-400 mb-1">המכתב יופיע כאן</h4>
                                    <p className="text-xs text-gray-500">בחר סוג מכתב ולחץ על "צור מכתב"</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
