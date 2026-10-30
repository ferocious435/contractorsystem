"use client";

import {useId, type KeyboardEvent, type RefObject} from 'react';
import {Bot, Send, User} from 'lucide-react';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Panel} from '@/components/ui/titanium/Panel';
import type {Message} from '../AIConsultant';

interface ConsultantViewProps {
    messages: Message[];
    input: string;
    isLoading: boolean;
    canSend?: boolean;
    suggestedQuestions: string[];
    errorIndexes?: number[];
    inputRef?: RefObject<HTMLTextAreaElement | null>;
    messagesEndRef?: RefObject<HTMLDivElement | null>;
    onInput(value: string): void;
    onSend(): Promise<void>;
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
}

export function ConsultantView({messages,input,isLoading,canSend=true,suggestedQuestions,errorIndexes=[],inputRef,messagesEndRef,onInput,onSend,onKeyDown}: ConsultantViewProps): React.JSX.Element {
    const inputId=useId(),helpId=useId();
    return <section className="ti-page ti-consultant" dir="rtl">
        <header className="ti-page-heading"><div><p className="ti-eyebrow">שאלות על הפרויקט</p><h1 className="ti-title">יועץ הפרויקט</h1><p className="ti-subtitle">התשובות מבוססות על הנתונים הזמינים ודורשות בדיקת מקורות.</p></div></header>
        <Panel className="ti-consultant-frame">
            <div className="ti-consultant-thread" role="log" aria-label="שיחה עם היועץ" aria-busy={isLoading} aria-live="polite">
                {messages.length===0 ? <div className="ti-consultant-empty"><Bot size={32} aria-hidden="true"/><h2 className="ti-section-title">במה אפשר לעזור?</h2><p className="ti-copy">אפשר לשאול על המסמכים, הממצאים והתמחור. תשובה אינה מחליפה אסמכתה או הנחיה מאושרת.</p><div className="ti-consultant-suggestions">{suggestedQuestions.map(question=><Button key={question} onClick={()=>{onInput(question);inputRef?.current?.focus();}}>{question}</Button>)}</div></div> : messages.map((message,index)=><article className={`ti-consultant-message ti-consultant-message--${message.role}`} key={index}>
                    <header className="ti-consultant-message__meta"><span>{message.role==='user'?<User size={16} aria-hidden="true"/>:<Bot size={16} aria-hidden="true"/>}{message.role==='user'?'אני':'העוזר'}</span><time dateTime={message.timestamp.toISOString()}><bdi dir="ltr">{message.timestamp.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}</bdi></time></header>
                    {errorIndexes.includes(index)?<Feedback tone="danger"><p className="ti-consultant-message__content" dir="auto">{message.content}</p></Feedback>:<p className="ti-consultant-message__content" dir="auto">{message.content}</p>}
                </article>)}
                {isLoading&&<Feedback aria-live="polite"><span className="ti-spinner" aria-hidden="true"/>ממתין לתשובת העוזר…</Feedback>}
                <div ref={messagesEndRef}/>
            </div>
            <div className="ti-consultant-compose"><label htmlFor={inputId} className="ti-field__label">השאלה שלך</label><div className="ti-consultant-compose__row"><textarea ref={inputRef} id={inputId} aria-describedby={helpId} className="ti-textarea" name="consultantQuestion" value={input} onChange={event=>onInput(event.target.value)} onKeyDown={onKeyDown} rows={3} placeholder="שאל שאלה על הפרויקט…"/><Button variant="primary" aria-label="שליחת שאלה" onClick={()=>void onSend()} disabled={isLoading||!canSend||!input.trim()} pending={isLoading} busyLabel="ממתין לתשובה…"><Send size={18} aria-hidden="true"/>שליחה</Button></div><p id={helpId} className="ti-meta"><bdi dir="ltr">Enter</bdi> לשליחה · <bdi dir="ltr">Shift+Enter</bdi> לשורה חדשה. השאלות והתשובות שמורות בפרויקט. אפשר להמשיך לנסח בזמן ההמתנה.</p></div>
        </Panel>
    </section>;
}
