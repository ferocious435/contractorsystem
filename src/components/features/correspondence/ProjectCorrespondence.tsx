'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/titanium/Button';
import {Field} from '@/components/ui/titanium/Field';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Panel} from '@/components/ui/titanium/Panel';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {PrintableLetter} from '@/components/pricing/PrintableLetter';
import {useAiReadiness,refreshAiReadiness} from '@/hooks/useAiReadiness';
import {startAiAction,observeAiJob,restoreAiJobs,cancelAiJob} from '@/utils/ai-job-client';
import {readWritingBuffer,writeWritingBuffer} from '@/utils/writing-work-buffer';
import {record,validUuid,type JobDto} from '@/server/ai/contracts';
import type {LetterSourceRef} from '@/utils/letter-draft-types';
import {checkedCorrespondenceResult as checkedResult,generationIdentityAfterFailure,type CorrespondenceResult as Generated} from '@/utils/correspondence-result';
import {TONE_OPTIONS} from '../smart-letter/constants';
import {fetchSavedCorrespondence,writeSavedCorrespondence,isSavedCorrespondence,type SavedCorrespondence as Saved} from '@/utils/correspondence-client';

export function CorrespondenceHistory({letters,loading,error,busy,onOpen,onRetry}:{letters:Saved[];loading:boolean;error:string;busy:boolean;onOpen:(letter:Saved)=>void;onRetry:()=>void}){
    return <Panel><h2 className="ti-section-title">מכתבי עבודה שמורים</h2>
        {loading&&<Feedback aria-live="polite">קורא את המכתבים השמורים…</Feedback>}
        {error&&<Feedback tone="warning">קריאת המכתבים לא הושלמה. {error}<Button onClick={onRetry} disabled={loading||busy}>ניסיון חוזר</Button></Feedback>}
        {!loading&&!error&&!letters.length&&<p className="ti-copy">עדיין אין מכתבי עבודה שמורים.</p>}
        {letters.map(letter=><div key={letter.id} className="ti-actions"><Button onClick={()=>onOpen(letter)} disabled={busy}>{letter.subject}</Button><span className="ti-meta">{letter.status==='SENT'?'סומן כנשלח ידנית':'טיוטה'} · {new Date(letter.created_at).toLocaleDateString('he-IL')}</span></div>)}
    </Panel>;
}
export function ProjectCorrespondence({projectId}:{projectId:string}){
    const readiness=useAiReadiness('letter'),inputId=useId(),textId=useId(),toneId=useId(),sentId=useId();
    const [subject,setSubject]=useState(''),[recipient,setRecipient]=useState(''),[points,setPoints]=useState(''),[tone,setTone]=useState('professional'),[text,setText]=useState('');
    const [sources,setSources]=useState<LetterSourceRef[]>([]),[draftId,setDraftId]=useState(''),[saved,setSaved]=useState<Saved|null>(null),[history,setHistory]=useState<Saved[]>([]);
    const [historyLoading,setHistoryLoading]=useState(true),[historyError,setHistoryError]=useState(''),historyTicket=useRef(0);
    const [hydrated,setHydrated]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[bufferFailed,setBufferFailed]=useState(false);
    const [pending,setPending]=useState<Generated|null>(null),[job,setJob]=useState<JobDto|null>(null),[printing,setPrinting]=useState(false),[sentOpen,setSentOpen]=useState(false);
    const [generating,setGenerating]=useState(false);
    const version=useRef(0),observer=useRef<AbortController|null>(null),ticket=useRef(0),operation=useRef<{signature:string;id:string}|null>(null),generation=useRef<{signature:string;id:string}|null>(null);
    const readOnly=saved?.status==='SENT',signature=JSON.stringify([subject,recipient,text,sources]);
    const savedSignature=saved?JSON.stringify([saved.subject,saved.recipient,saved.content,saved.source_refs]):null;
    const dirty=signature!==savedSignature,working={subject,recipient,points,tone,text,sources,draftId,saved,operation:operation.current,generation:generation.current};
    const current=useRef(working);current.current=working;
    function changed(){version.current++;setMessage('');}
    const loadHistory=useCallback(async()=>{
        const token=++historyTicket.current;setHistoryLoading(true);setHistoryError('');
        try{const letters=await fetchSavedCorrespondence(projectId);if(token===historyTicket.current)setHistory(letters);}
        catch(cause){if(token===historyTicket.current)setHistoryError(cause instanceof Error?cause.message:'אפשר לנסות שוב.');}
        finally{if(token===historyTicket.current)setHistoryLoading(false);}
    },[projectId]);
    useEffect(()=>{
        let active=true;const lifecycle=ticket,historyLifecycle=historyTicket,buffer=readWritingBuffer(projectId,'correspondence');
        if(buffer&&validUuid(buffer.draftId)){
            setDraftId(buffer.draftId);for(const [key,setter] of [['subject',setSubject],['recipient',setRecipient],['points',setPoints],['tone',setTone],['text',setText]] as const)if(typeof buffer[key]==='string')setter(buffer[key]);
            if(Array.isArray(buffer.sources))setSources(buffer.sources as LetterSourceRef[]);
            if(isSavedCorrespondence(buffer.saved,projectId))setSaved(buffer.saved);
            if(record(buffer.operation)&&typeof buffer.operation.signature==='string'&&validUuid(buffer.operation.id))operation.current=buffer.operation as {signature:string;id:string};
            if(record(buffer.generation)&&typeof buffer.generation.signature==='string'&&validUuid(buffer.generation.id))generation.current=buffer.generation as {signature:string;id:string};
            const restoreTicket=++ticket.current;
            void restoreAiJobs(projectId,'letter',buffer.draftId).then(jobs=>{
                if(!active||ticket.current!==restoreTicket)return;const last=jobs[0];
                if(last?.state==='SUCCEEDED'){try{setPending(checkedResult(last.result));}catch{}return;}
                if(!last||!['QUEUED','RUNNING'].includes(last.state))return;
                setJob(last);setBusy(true);setGenerating(true);const controller=new AbortController();observer.current=controller;
                void observeAiJob(last.id,{projectId,signal:controller.signal,onProgress:next=>{if(active&&ticket.current===restoreTicket)setJob(next);}})
                    .then(value=>{if(active&&ticket.current===restoreTicket&&!controller.signal.aborted)setPending(checkedResult(value));})
                    .catch(e=>{if(active&&ticket.current===restoreTicket&&!controller.signal.aborted){generation.current=generationIdentityAfterFailure(generation.current,e);setError('הפעולה הקודמת נעצרה. הטקסט נשאר זמין.');}})
                    .finally(()=>{if(active&&ticket.current===restoreTicket){setBusy(false);setGenerating(false);writeWritingBuffer(projectId,'correspondence',{...current.current,generation:generation.current});}});
            }).catch(()=>{});
        }else setDraftId(crypto.randomUUID());
        setHydrated(true);void loadHistory();
        return()=>{active=false;++lifecycle.current;++historyLifecycle.current;observer.current?.abort();};
    },[projectId,loadHistory]);
    useEffect(()=>{if(hydrated)setBufferFailed(!writeWritingBuffer(projectId,'correspondence',current.current));},[hydrated,subject,recipient,points,tone,text,sources,draftId,saved,projectId]); // Browser recovery is separate from server saving.
    function apply(value:Generated){changed();setText(value.letter);setSources(value.sourceRefs);setPending(null);refreshAiReadiness();}
    async function generate(){
        setBusy(true);setGenerating(true);setJob(null);setError('');setMessage('');const started=version.current,turn=++ticket.current,controller=new AbortController();observer.current=controller;
        const payload={projectId,clientContextId:draftId,purpose:'correspondence',letterType:'general',itemIds:[],recipient,subject,keyPoints:points,tone,currentText:text};
        const key=JSON.stringify(payload);if(generation.current?.signature!==key)generation.current={signature:key,id:crypto.randomUUID()};
        writeWritingBuffer(projectId,'correspondence',{...current.current,generation:generation.current});
        try{const startedJob=await startAiAction('/api/generate-letter',payload,generation.current.id);if(turn!==ticket.current)return;setJob(startedJob);
            const value=checkedResult(startedJob.state==='SUCCEEDED'?startedJob.result:await observeAiJob(startedJob.id,{projectId,signal:controller.signal,onProgress:next=>{if(turn===ticket.current)setJob(next);}}));
            if(turn!==ticket.current)return;generation.current=null;writeWritingBuffer(projectId,'correspondence',{...current.current,generation:null});if(version.current===started)apply(value);else setPending(value);
        }catch(e){if(turn===ticket.current){generation.current=generationIdentityAfterFailure(generation.current,e);writeWritingBuffer(projectId,'correspondence',{...current.current,generation:generation.current});if(!controller.signal.aborted)setError(e instanceof Error?e.message:'הכנת המכתב לא הושלמה. הטקסט נשאר זמין.');}}
        finally{if(turn===ticket.current){setBusy(false);setGenerating(false);}}
    }
    async function save(markSent=false){
        setBusy(true);setGenerating(false);setError('');setMessage('');
        const payload=markSent?{operation:'markSent',projectId,clientDraftId:draftId,expectedRevision:saved?.revision??0}:{operation:'save',projectId,clientDraftId:draftId,expectedRevision:saved?.revision??0,subject,recipient,content:text,sourceRefs:sources};
        const key=JSON.stringify(payload);if(operation.current?.signature!==key)operation.current={signature:key,id:crypto.randomUUID()};
        writeWritingBuffer(projectId,'correspondence',{...current.current,operation:operation.current});
        try{const letter=await writeSavedCorrespondence({...payload,operationId:operation.current.id});setSaved(letter);setSources(letter.source_refs);setMessage(markSent?'סומן כנשלח ידנית.':'הטיוטה נשמרה.');setSentOpen(false);void loadHistory();}
        catch(e){setError(e instanceof Error?e.message:'השמירה לא אושרה. הטקסט נשאר זמין לניסיון חוזר.');void loadHistory();}finally{setBusy(false);}
    }
    function open(letter:Saved){++ticket.current;observer.current?.abort();changed();setBusy(false);setGenerating(false);setDraftId(letter.client_draft_id);setSaved(letter);setSubject(letter.subject);setRecipient(letter.recipient);setText(letter.content);setSources(letter.source_refs);setPoints('');setPending(null);setError('');operation.current=null;generation.current=null;}
    function newLetter(){++ticket.current;observer.current?.abort();changed();setBusy(false);setGenerating(false);setDraftId(crypto.randomUUID());setSaved(null);setSubject('');setRecipient('');setPoints('');setText('');setSources([]);setPending(null);setJob(null);setError('');operation.current=null;generation.current=null;}
    function download(){const blob=new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(subject||'מכתב עבודה').replace(/[\\/:*?"<>|]/g,'_')+'.txt';link.click();URL.revokeObjectURL(url);}
    return <div dir="rtl" className="ti-stack" aria-label="מכתבי עבודה">
        <Panel><div className="ti-actions"><h2 className="ti-section-title">מכתב עבודה</h2><Button onClick={newLetter} disabled={busy}>מכתב חדש</Button></div><p className="ti-copy">פנייה, בקשת הבהרה או תשובה. אפשר לכתוב ידנית או לבקש מהעוזר להכין מכתב לפי מסמכי הפרויקט.</p>
            {error&&<Feedback tone="danger">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}{bufferFailed&&<Feedback tone="warning">שמירה זמנית במכשיר אינה זמינה. אפשר לשמור טיוטה במערכת.</Feedback>}
            <Field label="נושא המכתב" value={subject} maxLength={500} disabled={readOnly||busy} onChange={e=>{changed();setSubject(e.target.value);}}/>
            <Field label="נמען" value={recipient} maxLength={500} disabled={readOnly||busy} onChange={e=>{changed();setRecipient(e.target.value);}}/>
            <div className="ti-field"><label htmlFor={inputId} className="ti-field__label">מה לכתוב או לשנות</label><textarea id={inputId} className="ti-input" rows={4} value={points} maxLength={30000} disabled={readOnly||busy} onChange={e=>{changed();setPoints(e.target.value);}}/></div>
            <div className="ti-field"><label htmlFor={toneId} className="ti-field__label">סגנון המכתב</label><select id={toneId} className="ti-input" value={tone} disabled={readOnly||busy} onChange={e=>{changed();setTone(e.target.value);}}>{TONE_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            <div className="ti-actions"><Button variant="primary" pending={generating} busyLabel={job?.state==='QUEUED'?'ממתין להכנת המכתב…':'מכין את המכתב…'} disabled={busy||readOnly||!subject.trim()||!points.trim()||!readiness?.available} onClick={()=>void generate()}>הכנת מכתב</Button>
                {generating&&job&&<Button onClick={()=>{const turn=ticket.current;void cancelAiJob(job.id,job.revision).then(result=>{if(ticket.current!==turn)return;++ticket.current;generation.current=null;writeWritingBuffer(projectId,'correspondence',{...current.current,generation:null});observer.current?.abort();setBusy(false);setGenerating(false);if(result.state==='SUCCEEDED'){setPending(checkedResult(result.result));setMessage('ההכנה כבר הסתיימה. ההצעה זמינה בנפרד מהטקסט הנוכחי.');}else setMessage('ההכנה בוטלה. הטקסט נשמר.');}).catch(()=>{if(ticket.current===turn)setError('הביטול לא אושר; אפשר לבדוק שוב את מצב הפעולה.');});}}>ביטול ההכנה</Button>}
                {!readiness?.available&&<Button onClick={()=>refreshAiReadiness()}>רענון העוזר</Button>}</div>
            {!readiness?.available&&<p className="ti-meta">{readiness===null?'בודק את זמינות העוזר…':'העוזר אינו זמין כרגע.'} אפשר להמשיך לכתוב ולשמור ידנית; בחירת העוזר נמצאת בהגדרות המערכת.</p>}
            {pending&&<Feedback>קיימת הצעה מוכנה. הטקסט הנוכחי נשמר.<Button onClick={()=>apply(pending)} disabled={busy||readOnly}>הצגת ההצעה במכתב</Button></Feedback>}
            <div className="ti-field"><label htmlFor={textId} className="ti-field__label">תוכן המכתב</label><textarea id={textId} className="ti-input" rows={18} value={text} maxLength={100000} readOnly={readOnly} onChange={e=>{changed();setText(e.target.value);}}/></div>
            {sources.length>0&&<details className="ti-source-text"><summary>מקורות המכתב ({sources.length})</summary>{sources.map((source,index)=><section key={index}><h3 className="ti-section-title">{source.title||'מקור שמור'}</h3><p className="ti-meta">קטע מהמקור שנבחר להכנת המכתב</p><pre style={{whiteSpace:'pre-wrap'}}>{source.quote}</pre>{source.documentId&&<a className="ti-button ti-button--secondary" target="_blank" rel="noreferrer" href={'/api/documents/file?'+new URLSearchParams({projectId,documentId:source.documentId})}>פתיחת המקור המלא</a>}</section>)}</details>}
            <div className="ti-actions"><Button variant="primary" pending={busy&&!generating} busyLabel="שומר טיוטה…" disabled={busy||readOnly||!dirty||!subject.trim()||!text.trim()} onClick={()=>void save()}>שמירת טיוטה</Button><Button disabled={busy||!text.trim()} onClick={()=>setPrinting(true)}>תצוגת הדפסה</Button><Button disabled={busy||!text.trim()} onClick={download}>הורדת המכתב</Button>
                {saved&&<Button disabled={busy||dirty||readOnly} onClick={()=>setSentOpen(true)}>{readOnly?'סומן כנשלח ידנית':'סימון כנשלח'}</Button>}</div>
            <p className="ti-meta">שמירה אינה שולחת את המכתב. לאחר שליחה מחוץ למערכת אפשר לסמן זאת בנפרד.</p>
        </Panel>
        <CorrespondenceHistory letters={history} loading={historyLoading} error={historyError} busy={busy} onOpen={open} onRetry={()=>void loadHistory()}/>
        <Dialog open={sentOpen} labelledBy={sentId} className="ti-dialog--compact" onClose={()=>{if(!busy)setSentOpen(false);}}><h2 id={sentId} className="ti-section-title">סימון לאחר שליחה</h2><p className="ti-copy">האם המכתב כבר נשלח מחוץ למערכת? הסימון יינעל את הגרסה השמורה.</p><div className="ti-actions"><Button disabled={busy} onClick={()=>setSentOpen(false)}>ביטול</Button><Button disabled={busy} onClick={()=>void save(true)}>כן, המכתב נשלח</Button></div></Dialog>
        {printing&&<PrintableLetter projectName="" subject={subject} recipient={recipient} legalText={text} items={[]} correspondence onClose={()=>setPrinting(false)} letterNumber={saved?.id??'טיוטה'} createdAt={saved?.created_at}/>}
    </div>;
}
