"use client";

import React, { useState, useRef, useEffect } from 'react';
import {ConsultantView} from './consultant/ConsultantView';

export interface Message {
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
    const [errorIndexes, setErrorIndexes] = useState<number[]>([]);
    const markResponseError = () => setErrorIndexes(previous => [...previous, messages.length + 1]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
                markResponseError();
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `שגיאה: ${data.error || 'תקלה לא ידועה'}`,
                    timestamp: new Date()
                }]);
            }
        } catch (err) {
            console.error('Chat error:', err);
            markResponseError();
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

    return <ConsultantView messages={messages} input={input} isLoading={isLoading} suggestedQuestions={suggestedQuestions} errorIndexes={errorIndexes} inputRef={inputRef} messagesEndRef={messagesEndRef} onInput={setInput} onSend={handleSend} onKeyDown={handleKeyDown}/>;
}
