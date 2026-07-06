"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles } from 'lucide-react';
import { AI_MODEL_BRANDING } from '@/utils/constants';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface AIConsultantProps {
    projectId: string;
}

export default function AIConsultant({ projectId }: AIConsultantProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        const userMessage: Message = { role: 'user', content: trimmed, timestamp: new Date() };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
                    projectId
                })
            });

            const data = await response.json();

            if (data.success) {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: data.response,
                    timestamp: new Date()
                }]);
            } else {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `שגיאה: ${data.error || 'תקלה לא ידועה'}`,
                    timestamp: new Date()
                }]);
            }
        } catch (err) {
            console.error('Chat error:', err);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'שגיאת תקשורת. אנא נסה שוב.',
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const suggestedQuestions = [
        'מהם הסיכונים העיקריים בפרויקט?',
        'סכם את הסתירות שנמצאו',
        'מה ההמלצה שלך לגבי התקציב?',
        'איך לנהל חריגים בפרויקט זה?'
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                        יועץ AI
                        <span className="text-[10px] font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 uppercase tracking-widest font-black">{AI_MODEL_BRANDING}</span>
                    </h2>
                    <p className="text-xs text-gray-400">שאל כל שאלה על הפרויקט. היועץ משתמש בנתונים הזמינים ומסמן מה עדיין דורש אימות.</p>
                </div>
            </div>

            {/* אזור הצ'אט */}
            <div className="bg-workspace border border-border-subtle rounded-xl overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 320px)', minHeight: '400px' }}>
                {/* הודעות */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <Sparkles className="w-8 h-8 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-lg font-medium text-gray-200 mb-2">שלום! אני היועץ AI שלך</h3>
                                <p className="text-sm text-gray-400 max-w-md">
                                    אני משתמש בנתונים הזמינים בפרויקט: מסמכים, ממצאים, תמחור ותקציב. אם חסרה הוכחה, אסמן זאת במקום לנחש.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 max-w-lg w-full" dir="rtl">
                                {suggestedQuestions.map((q, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { setInput(q); inputRef.current?.focus(); }}
                                        className="text-right text-sm px-3 py-2.5 bg-background border border-border-subtle rounded-lg hover:border-primary/30 hover:bg-primary/5 text-gray-300 transition-colors"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((msg, idx) => (
                            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {msg.role === 'assistant' && (
                                    <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0 mt-1">
                                        <Bot className="w-4 h-4 text-primary" />
                                    </div>
                                )}
                                <div
                                    className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user'
                                            ? 'bg-primary text-white rounded-br-md'
                                            : 'bg-background/80 border border-border-subtle text-gray-200 rounded-bl-md'
                                        }`}
                                    dir="rtl"
                                >
                                    {msg.content}
                                </div>
                                {msg.role === 'user' && (
                                    <div className="w-8 h-8 rounded-lg bg-gray-700 border border-gray-600 flex items-center justify-center flex-shrink-0 mt-1">
                                        <User className="w-4 h-4 text-gray-300" />
                                    </div>
                                )}
                            </div>
                        ))
                    )}

                    {isLoading && (
                        <div className="flex gap-3 justify-start">
                            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0 mt-1">
                                <Bot className="w-4 h-4 text-primary" />
                            </div>
                            <div className="bg-background/80 border border-border-subtle text-gray-400 px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm">חושב...</span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* שדה הזנה */}
                <div className="p-4 border-t border-border-subtle bg-background/50">
                    <div className="flex gap-3 items-end">
                        <button
                            onClick={handleSend}
                            disabled={isLoading || !input.trim()}
                            className="p-3 bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:hover:bg-primary text-white rounded-xl transition-colors shadow-blue flex-shrink-0"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="שאל שאלה על הפרויקט..."
                            rows={1}
                            dir="rtl"
                            className="flex-1 resize-none bg-workspace border border-border-subtle rounded-xl px-4 py-3 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 custom-scrollbar"
                            style={{ maxHeight: '120px' }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
