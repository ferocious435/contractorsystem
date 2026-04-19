import React, { useState } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import { LedgerItem } from './LedgerTable';
import { generatePricingPDF } from '@/utils/pdfGenerator';

interface GenerateVOLetterModalProps {
    selectedItems: LedgerItem[];
    onClose: () => void;
}

export default function GenerateVOLetterModal({ selectedItems, onClose }: GenerateVOLetterModalProps) {
    const [recipient, setRecipient] = useState('');
    const [subject, setSubject] = useState(`דרישת תשלום לחריגים - חשבון חלקי`);
    const [keyPoints, setKeyPoints] = useState('');
    const [tone, setTone] = useState<'formal' | 'firm' | 'friendly'>('formal');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        if (!recipient) {
            setError('נא להזין נמען.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Generate Legal Text via AI
            const res = await fetch('/api/generate-letter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: selectedItems[0]?.project_id || '',
                    letterType: 'vo_request',
                    recipient,
                    subject,
                    keyPoints,
                    tone
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to generate letter text.');
            }

            const data = await res.json();
            const legalText = data.letter;

            // Optional: Project Name lookup could be done or passed down, defaulting here if not exact.
            const projectName = selectedItems[0]?.project_id ? `פרויקט ${selectedItems[0].project_id.substring(0, 8)}` : 'פרויקט כללי';

            // Generate the PDF Document
            generatePricingPDF({
                projectName,
                recipient,
                subject,
                legalText,
                items: selectedItems
            });

            // Close modal after success
            onClose();

        } catch (err: any) {
            setError(err.message || 'אירעה שגיאה בעת יצירת המסמך.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-[#11161d] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#151C24] rounded-t-2xl shrink-0">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <FileText className="w-5 h-5 text-emerald-400" />
                        הפקת מכתב דרישה (V.O Composer)
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form Body */}
                <div className="p-6 flex-1 overflow-y-auto space-y-5" dir="rtl">
                    <p className="text-sm text-gray-400">
                        מערכת ה-AI תיצור מכתב ליווי מקצועי הכולל את {selectedItems.length} הסעיפים שנבחרו בצורה משפטית ומסודרת עד לרמת המע"מ.
                    </p>

                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">נמען (לכבוד)</label>
                        <input
                            type="text"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            className="w-full bg-[#1A222C] border border-white/10 rounded-lg px-4 py-2 text-white outline-none focus:border-emerald-500/50"
                            placeholder="לדוגמה: משה כהן, מנהל פרויקט..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">נושא מכתב</label>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            className="w-full bg-[#1A222C] border border-white/10 rounded-lg px-4 py-2 text-white outline-none focus:border-emerald-500/50"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">נימה משפטית (Tone)</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setTone('formal')}
                                className={`flex-1 py-2 rounded-lg text-sm transition-colors border ${tone === 'formal' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                            >
                                רשמי ומקצועי
                            </button>
                            <button
                                onClick={() => setTone('firm')}
                                className={`flex-1 py-2 rounded-lg text-sm transition-colors border ${tone === 'firm' ? 'bg-orange-500/20 border-orange-500/30 text-orange-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                            >
                                תקיף (התראה)
                            </button>
                            <button
                                onClick={() => setTone('friendly')}
                                className={`flex-1 py-2 rounded-lg text-sm transition-colors border ${tone === 'friendly' ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                            >
                                ידידותי / אינפורמטיבי
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">נקודות חשובות להדגשה ל-AI (אופציונלי)</label>
                        <textarea
                            value={keyPoints}
                            onChange={(e) => setKeyPoints(e.target.value)}
                            className="w-full bg-[#1A222C] border border-white/10 rounded-lg px-4 py-3 text-white outline-none focus:border-emerald-500/50 min-h-[100px] resize-none"
                            placeholder="לדוגמה: ציין שהעיכוב נגרם בעקבות חוסר בתוכניות... אל תשכח להזכיר את סעיף 4 בחוזה..."
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 bg-[#151C24] rounded-b-2xl shrink-0 flex justify-end gap-3" dir="rtl">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-6 py-2.5 rounded-lg font-medium text-gray-400 transition-colors hover:text-white"
                    >
                        ביטול
                    </button>
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="px-6 py-2.5 rounded-lg font-medium bg-emerald-500 text-white transition-all hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                מייצר מסמך...
                            </>
                        ) : (
                            'הפק PDF עכשיו'
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
}
