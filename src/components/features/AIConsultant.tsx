"use client";
import {useState, useRef, useEffect, useCallback,useMemo} from 'react';
import {ConsultantView} from './consultant/ConsultantView';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Button} from '@/components/ui/titanium/Button';
import {useAiReadiness, refreshAiReadiness} from '@/hooks/useAiReadiness';
import {startAiAction,observeAiJob,restoreAiJobs,cancelAiJob} from '@/utils/ai-job-client';
import {BusinessAiError,record,validUuid,type JobDto} from '@/server/ai/contracts';
import {readWritingBuffer,writeWritingBuffer} from '@/utils/writing-work-buffer';
import {savedConversation,latestSavedConversation} from './consultant/savedConversation';

export interface Message {role: 'user' | 'assistant'; content: string; timestamp: Date;details?:string;}
export default function AIConsultant({projectId}: {projectId: string}) {
    const [jobs,setJobs]=useState<JobDto[]>([]),[input,setInput]=useState(''),[conversationId,setConversationId]=useState<string|null>(null);
    const [isLoading,setIsLoading]=useState(false),[restoring,setRestoring]=useState(true),[job,setJob]=useState<JobDto|null>(null);
    const [pendingQuestion,setPendingQuestion]=useState<string|null>(null);
    const [error,setError]=useState<string|null>(null),[bufferUnavailable,setBufferUnavailable]=useState(false),readiness=useAiReadiness('consultant');
    const observer=useRef<AbortController|null>(null),epoch=useRef(0),busy=useRef(false),pending=useRef<{question:string;requestKey:string;jobId:string|null}|null>(null);
    const latest=useRef({projectId,input,conversationId,readiness});latest.current={projectId,input,conversationId,readiness};
    const messagesEndRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
    const persist=useCallback(()=>{const current=latest.current;if(current.conversationId)setBufferUnavailable(!writeWritingBuffer(current.projectId,'consultant',{conversationId:current.conversationId,input:current.input,pending:pending.current}));},[]);
    const upsert=useCallback((current:JobDto)=>{setJob(current);setJobs(previous=>[current,...previous.filter(value=>value.id!==current.id)]);},[]);
    const follow=useCallback(async(current:JobDto,token:number,signal:AbortSignal)=>{
        let last=current;
        try{await observeAiJob(current.id,{projectId:current.projectId,signal,onProgress:next=>{last=next;if(token===epoch.current)upsert(next);}});
            if(token!==epoch.current||signal.aborted)return;
            if(pending.current?.jobId===current.id){const text=pending.current.question;pending.current=null;setPendingQuestion(null);setInput(previous=>previous.trim()===text?'':previous);}
        }catch(cause){if(token===epoch.current&&!signal.aborted){if(!['QUEUED','RUNNING'].includes(last.state)&&pending.current?.jobId===current.id)pending.current=null;
            setError(cause instanceof BusinessAiError&&cause.code==='AI_CANCELLED'?'ההכנה בוטלה. השאלה נשארה זמינה.':'לא התקבלה תשובה מלאה. השאלה וההיסטוריה נשמרו; אפשר לנסות שוב.');}}
        finally{if(token===epoch.current){busy.current=false;setIsLoading(false);persist();}}
    },[persist,upsert]);
    const restore=useCallback(async()=>{
        const token=++epoch.current;observer.current?.abort();const controller=new AbortController();observer.current=controller;busy.current=true;setRestoring(true);setError(null);
        const saved=readWritingBuffer(projectId,'consultant');let context=validUuid(saved?.conversationId)?saved.conversationId:null;
        if(!context){
            try{context=latestSavedConversation(await restoreAiJobs(projectId,'consultant'),projectId)||crypto.randomUUID();}
            catch{if(token===epoch.current){setError('קריאת השיחה השמורה לא הושלמה. אפשר לנסות שוב.');setRestoring(false);busy.current=false;}return;}
            if(token!==epoch.current)return;
        }
        latest.current={...latest.current,projectId,conversationId:context,input:typeof saved?.input==='string'?saved.input:''};
        setConversationId(context);setInput(latest.current.input);setJobs([]);setJob(null);setIsLoading(false);pending.current=null;
        if(record(saved?.pending)&&typeof saved.pending.question==='string'&&validUuid(saved.pending.requestKey)&&(saved.pending.jobId===null||validUuid(saved.pending.jobId)))pending.current=saved.pending as {question:string;requestKey:string;jobId:string|null};setPendingQuestion(pending.current?.question??null);persist();
        try{const restored=await restoreAiJobs(projectId,'consultant',context);if(token!==epoch.current)return;setJobs(restored);const current=restored[0];setJob(current??null);setRestoring(false);
            if(current&&['QUEUED','RUNNING'].includes(current.state)){setIsLoading(true);await follow(current,token,controller.signal);}
            else {if(current&&pending.current?.jobId===current.id&&['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(current.state)){pending.current=null;setPendingQuestion(null);}busy.current=false;persist();}
        }catch{if(token===epoch.current){setError('קריאת השיחה השמורה לא הושלמה. אפשר לנסות שוב.');busy.current=false;}}
        finally{if(token===epoch.current)setRestoring(false);}
    },[follow,persist,projectId]);
    const invalidate=useCallback(()=>{++epoch.current;observer.current?.abort();busy.current=false;},[]);
    useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void restore();});return()=>{active=false;invalidate();};},[restore,invalidate]);
    useEffect(()=>{if(conversationId&&!restoring)persist();},[conversationId,input,restoring,persist]);
    const messages=useMemo(()=>[...(conversationId?savedConversation(jobs,projectId,conversationId):[]),...(pendingQuestion?[{role:'user' as const,content:pendingQuestion,timestamp:new Date()}]:[])],[jobs,projectId,conversationId,pendingQuestion]);
    useEffect(() => {messagesEndRef.current?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});}, [messages]);
    const handleSend = async () => {
        const current = latest.current, text = current.input.trim();
        if (!text || busy.current||!current.conversationId||restoring) return;
        if (current.readiness?.available !== true) {setError('העוזר אינו זמין כעת. השאלה נשארה לניסיון חוזר.'); refreshAiReadiness(); return;}
        const token=++epoch.current;observer.current?.abort();const controller=new AbortController();observer.current=controller;
        const action=pending.current?.question===text?pending.current:{question:text,requestKey:crypto.randomUUID(),jobId:null};pending.current=action;setPendingQuestion(text);persist();
        busy.current = true; setIsLoading(true); setError(null);setJob(null);
        try {
            const accepted=await startAiAction('/api/chat',{projectId,conversationId:current.conversationId,clientContextId:current.conversationId,question:text},action.requestKey);
            if(token!==epoch.current)return;if(accepted.kind!=='consultant'||accepted.conversationId!==current.conversationId)throw new BusinessAiError('AI_CONTEXT_MISMATCH');
            action.jobId=accepted.id;upsert(accepted);persist();await follow(accepted,token,controller.signal);
        } catch (cause) {
            if(token===epoch.current){if(cause instanceof BusinessAiError&&cause.status>=400&&cause.status<500)pending.current=null;setError('ההכנה לא הושלמה. השאלה נשארה זמינה לניסיון חוזר.');}
            refreshAiReadiness();
        } finally {if(token===epoch.current){busy.current=false;setIsLoading(false);persist();}}
    };
    const cancel=async()=>{if(!job)return;const token=epoch.current;try{const result=await cancelAiJob(job.id,job.revision);if(token!==epoch.current)return;++epoch.current;observer.current?.abort();upsert(result);pending.current=null;setPendingQuestion(null);busy.current=false;setIsLoading(false);setError(result.state==='SUCCEEDED'?null:'ההכנה בוטלה. השאלה וההיסטוריה נשמרו.');persist();}catch{if(token===epoch.current)setError('הביטול לא אושר. אפשר לנסות שוב.');}};
    return <>
        {readiness?.available !== true && <Feedback tone="warning"><span>{readiness === null ? 'בודק זמינות של העוזר…' : 'העוזר אינו זמין כרגע. אפשר לבדוק את בחירת העוזר בהגדרות.'} אפשר להמשיך לנסח את השאלה.</span><Button onClick={() => refreshAiReadiness()}>בדיקת זמינות חוזרת</Button></Feedback>}
        {restoring&&<Feedback aria-live="polite">קורא את השיחה השמורה…</Feedback>}
        {bufferUnavailable&&<Feedback tone="warning">הדפדפן אינו מאפשר לשמור את השאלה שטרם נשלחה. יש להעתיק אותה לפני רענון העמוד.</Feedback>}
        {error && <Feedback tone="danger"><span>{error}</span><Button disabled={isLoading||restoring} onClick={() => void restore()}>קריאה חוזרת של השיחה</Button><Button disabled={isLoading||restoring||readiness?.available!==true||!input.trim()} onClick={()=>void handleSend()}>ניסיון חוזר</Button></Feedback>}
        {isLoading&&<Feedback>{job?.state==='QUEUED'?'השאלה שמורה וממתינה לעוזר.':'העוזר מכין תשובה.'}<Button disabled={!job||!['QUEUED','RUNNING'].includes(job.state)} onClick={()=>void cancel()}>ביטול ההכנה</Button></Feedback>}
        <ConsultantView messages={messages} input={input} isLoading={isLoading} canSend={!restoring&&readiness?.available === true}
            suggestedQuestions={['מהם הסיכונים העיקריים בפרויקט?', 'סכם את הסתירות שנמצאו', 'מה ההמלצה שלך לגבי התקציב?', 'איך לנהל חריגים בפרויקט זה?']}
            inputRef={inputRef} messagesEndRef={messagesEndRef} onInput={setInput} onSend={handleSend}
            onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); void handleSend();}}}/>
    </>;
}
