'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
import {refreshAiReadiness} from '@/hooks/useAiReadiness';
import type {RuntimeDescriptor} from '@/server/ai/contracts';
const effortLabels:Record<string,string>={none:'ללא בדיקה נוספת',minimal:'קצרה',low:'מהירה',medium:'רגילה',high:'מעמיקה',xhigh:'מעמיקה מאוד',max:'מרבית',ultra:'מרבית מאוד'};

export function AiRuntimeSettings(){
    const [data,setData]=useState<RuntimeDescriptor|null>(null),[model,setModel]=useState(''),[effort,setEffort]=useState('');
    const [error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[skeleton,setSkeleton]=useState(false);
    const dirty=useRef(false),sequence=useRef(0),modelId=useId(),effortId=useId();
    const load=useCallback(async()=>{const token=++sequence.current,started=Date.now();let shown=false;const timer=setTimeout(()=>{shown=true;if(token===sequence.current)setSkeleton(true);},300);
        try{const response=await fetch('/api/ai/runtime',{cache:'no-store',signal:AbortSignal.timeout(15000)}),value=await response.json();if(!response.ok||!value.success)throw Error('לא הצלחנו לקרוא את הגדרות העוזר. אפשר לנסות שוב.');
            if(shown)await new Promise(resolve=>setTimeout(resolve,Math.max(0,600-(Date.now()-started))));if(token!==sequence.current)return;setData(value);setError('');
            if(!dirty.current){setModel(value.profile?.model??'');setEffort(value.profile?(value.profile.effort??'__default__'):'');}
        }catch{if(token===sequence.current)setError('לא הצלחנו לקרוא את הגדרות העוזר. אפשר לנסות שוב.');}
        finally{clearTimeout(timer);if(token===sequence.current)setSkeleton(false);}
    },[]);
    const invalidate=useCallback(()=>{++sequence.current;},[]);
    useEffect(()=>{void load();const focus=()=>{void load();};window.addEventListener('focus',focus);return()=>{invalidate();window.removeEventListener('focus',focus);};},[load,invalidate]);
    useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),3000);return()=>clearTimeout(timer);},[message]);
    async function save(){setSaving(true);setError('');setMessage('');try{const response=await fetch('/api/ai/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'save',selection:{model,effort:effort==='__default__'?null:effort},expectedRevision:data?.profile?.revision??0})});const value=await response.json();if(!response.ok||!value.success)throw Error();dirty.current=false;await load();setMessage('הבחירה נשמרה.');refreshAiReadiness();}catch{setError('הבחירה לא נשמרה. הטקסטים והמסמכים שלכם נשמרו; אפשר לנסות שוב.');}finally{setSaving(false);}}
    async function login(){setSaving(true);setError('');const popup=window.open('about:blank','contractor-chatgpt-login');try{const response=await fetch('/api/ai/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'login'})}),value=await response.json();if(!response.ok||typeof value.authUrl!=='string')throw Error();if(popup)popup.location.href=value.authUrl;else window.location.assign(value.authUrl);setMessage('לאחר הכניסה חזרו לכאן ורעננו את החיבור.');}catch{popup?.close();setError('לא הצלחנו לפתוח את הכניסה ל-ChatGPT. אפשר לנסות שוב.');}finally{setSaving(false);}}
    const selected=data?.models.find(choice=>choice.model===model);
    return <section aria-label="הגדרות עוזר העבודה" className="ti-ai-runtime">
        <style>{`.ti-ai-runtime-skeleton{height:40px;margin-block:12px;border-radius:10px;background:var(--ti-border,#e4e6ea);animation:ti-ai-runtime-pulse 1.5s ease-in-out infinite}@keyframes ti-ai-runtime-pulse{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.ti-ai-runtime-skeleton{animation:none}}`}</style>
        {!data&&!error&&<><Feedback>קורא את מצב השירות…</Feedback>{skeleton&&<div aria-hidden="true"><div className="ti-ai-runtime-skeleton"/><div className="ti-ai-runtime-skeleton"/></div>}</>}
        {error&&<Feedback tone="danger">{error}<Button onClick={()=>{void load();}}>ניסיון נוסף</Button></Feedback>}
        {message&&<Feedback tone="success">{message}</Feedback>}
        {data&&<>
            <StatusChip tone={data.authenticated?'success':'warning'}>{data.authenticated?'חשבון ChatGPT מחובר':'נדרשת כניסה ל-ChatGPT'}</StatusChip>
            {!data.authenticated?<><p className="ti-copy">היכנסו לחשבון ChatGPT כדי לבחור את עוזר העבודה.</p><Button onClick={()=>{void login();}} disabled={saving} aria-busy={saving}>כניסה ל-ChatGPT</Button><Button onClick={()=>{void load();}}>רענון החיבור</Button></>:<>
                <p className="ti-copy">בחרו פעם אחת את המודל ועומק הבדיקה לעבודות במערכת.</p>
                {!data.profile&&<Feedback>עדיין לא נשמרה בחירה. בחרו בשני השדות ולחצו על שמירה.</Feedback>}
                <div className="ti-field"><label className="ti-field__label" htmlFor={modelId}>המודל לעבודה במערכת</label><select id={modelId} className="ti-input" value={model} disabled={saving} onChange={event=>{dirty.current=true;setModel(event.target.value);setEffort('');setMessage('');}}><option value="">בחרו מודל</option>{data.models.map(choice=><option key={choice.model} value={choice.model}>{choice.displayName}{choice.images?' · טקסט ותמונות':' · טקסט'}</option>)}</select></div>
                <div className="ti-field"><label className="ti-field__label" htmlFor={effortId}>עומק הבדיקה</label><select id={effortId} className="ti-input" value={effort} disabled={saving||!selected} onChange={event=>{dirty.current=true;setEffort(event.target.value);setMessage('');}}><option value="">בחרו עומק בדיקה</option><option value="__default__">לפי ברירת המחדל של המודל</option>{selected?.efforts.map(choice=><option key={choice.value} value={choice.value}>{effortLabels[choice.value]??choice.description}</option>)}</select></div>
                <Button variant="primary" onClick={()=>{void save();}} disabled={saving||!selected||!effort} aria-busy={saving}>{saving?'שומר את הבחירה…':'שמירת בחירת העוזר'}</Button>
                {data.configured&&<p className="ti-meta">הבחירה שמורה במחשב הזה.</p>}
                {data.configured&&data.reason==='AI_ACTIONS_PREPARING'&&<Feedback>כלי העבודה עדיין בתהליך עדכון. הבחירה נשמרה.</Feedback>}
                {data.authenticated&&!data.models.length&&<Feedback tone="warning">רשימת המודלים לא התקבלה.<Button onClick={()=>{void load();}}>רענון הרשימה</Button></Feedback>}
            </>}
        </>}
    </section>;
}
