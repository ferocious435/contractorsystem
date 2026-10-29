"use client";
import {useState, useRef, useEffect} from 'react';
import {ConsultantView} from './consultant/ConsultantView';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Button} from '@/components/ui/titanium/Button';
import {useAiReadiness, refreshAiReadiness} from '@/hooks/useAiReadiness';
import {LocalWritingRequest, localWritingRequestMessage} from '@/utils/local-writing-request';
import {isRecord} from '@/utils/letter-snapshot';

export interface Message {role: 'user' | 'assistant'; content: string; timestamp: Date;}
export default function AIConsultant({projectId}: {projectId: string}) {
    const [messages, setMessages] = useState<Message[]>([]), [input, setInput] = useState(''), [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null), readiness = useAiReadiness();
    const request = useRef(new LocalWritingRequest()), busy = useRef(false), activeProject = useRef(projectId);
    activeProject.current = projectId;
    const latest = useRef({messages, input, readiness}); latest.current = {messages, input, readiness};
    const messagesEndRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        request.current.cancel(); busy.current = false; setMessages([]); setInput(''); setError(null); setIsLoading(false);
        const current = request.current; return () => current.cancel();
    }, [projectId]);
    useEffect(() => {messagesEndRef.current?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});}, [messages]);
    const handleSend = async () => {
        const current = latest.current, text = current.input.trim();
        if (!text || busy.current) return;
        if (current.readiness?.available !== true) {setError('העיבוד המקומי אינו זמין כעת. השאלה נשארה לניסיון חוזר.'); refreshAiReadiness(); return;}
        const ticket = request.current.begin(projectId), userMessage: Message = {role: 'user', content: text, timestamp: new Date()};
        const history = current.messages.at(-1)?.role === 'user' && current.messages.at(-1)?.content === text ? current.messages : [...current.messages, userMessage];
        busy.current = true; setMessages(history); setIsLoading(true); setError(null);
        try {
            const response = await fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({projectId, messages: history.map(({role, content}) => ({role, content}))}), signal: AbortSignal.timeout(310_000)});
            const data: unknown = await response.json();
            if (!response.ok || !isRecord(data) || data.success !== true || typeof data.response !== 'string' || !data.response.trim()) {
                throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : 'לא התקבלה תשובה מקומית מלאה. השאלה נשארה לניסיון חוזר.');
            }
            if (!request.current.accepts(ticket, activeProject.current)) return;
            setMessages(previous => [...previous, {role: 'assistant', content: data.response as string, timestamp: new Date()}]);
            setInput(previous => previous.trim() === text ? '' : previous);
        } catch (cause) {
            if (request.current.accepts(ticket, activeProject.current)) setError(localWritingRequestMessage(cause, 'ההכנה המקומית לא הושלמה. השאלה נשארה זמינה לניסיון חוזר.'));
            refreshAiReadiness();
        } finally {if (activeProject.current === projectId && request.current.finish(ticket)) {busy.current = false; setIsLoading(false);}}
    };
    return <>
        {readiness?.available !== true && <Feedback tone="warning"><span>{readiness === null ? 'בודק זמינות מקומית…' : readiness.reason === 'AI_MODEL_MISSING' ? 'המודל המקומי המוגדר אינו נמצא.' : readiness.reason === 'STATUS_UNAVAILABLE' ? 'לא ניתן לאשר את זמינות העיבוד המקומי.' : 'השרת המקומי אינו זמין.'} אפשר להמשיך לנסח את השאלה.</span><Button onClick={() => refreshAiReadiness()}>בדיקת זמינות חוזרת</Button></Feedback>}
        {error && <Feedback tone="danger"><span>{error}</span><Button disabled={isLoading || readiness?.available !== true} onClick={() => void handleSend()}>ניסיון חוזר</Button></Feedback>}
        <ConsultantView messages={messages} input={input} isLoading={isLoading} canSend={readiness?.available === true}
            suggestedQuestions={['מהם הסיכונים העיקריים בפרויקט?', 'סכם את הסתירות שנמצאו', 'מה ההמלצה שלך לגבי התקציב?', 'איך לנהל חריגים בפרויקט זה?']}
            inputRef={inputRef} messagesEndRef={messagesEndRef} onInput={setInput} onSend={handleSend}
            onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); void handleSend();}}}/>
    </>;
}
