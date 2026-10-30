'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {canApplyAiResult,startAiAction,observeAiJob,restoreAiJobs,cancelAiJob,type AiEditorContext} from '@/utils/ai-job-client';
import type {AiJobKind,JobDto,JsonValue} from '@/server/ai/contracts';
interface Options {projectId:string;kind:AiJobKind;clientContextId?:string|null;editorRevision?:number;onResult?:(result:JsonValue,job:JobDto)=>void;}
interface ViewState {key:string;job:JobDto|null;error:string|null;pendingResult:JsonValue|null;}
const scope=(value:{projectId:string;kind:AiJobKind;clientContextId:string|null})=>[value.projectId,value.kind,value.clientContextId??''].join(':');
const empty={job:null,error:null,pendingResult:null};
export function useAiJob({projectId,kind,clientContextId=null,editorRevision=0,onResult}:Options){
    const key=scope({projectId,kind,clientContextId}),[state,setState]=useState<ViewState>(()=>({key,...empty}));
    const ticket=useRef(0),observer=useRef<AbortController|null>(null),mounted=useRef(false),latest=useRef({projectId,kind,clientContextId,editorRevision,onResult});
    useLayoutEffect(()=>{latest.current={projectId,kind,clientContextId,editorRevision,onResult};},[projectId,kind,clientContextId,editorRevision,onResult]);
    const update=useCallback((target:string,patch:Partial<Omit<ViewState,'key'>>)=>setState(previous=>({...((previous.key===target)?previous:empty),...patch,key:target})),[]);
    const stop=useCallback(()=>observer.current?.abort(),[]);
    const context=useCallback((value:number):AiEditorContext=>({projectId:latest.current.projectId,kind:latest.current.kind,clientContextId:latest.current.clientContextId,editorRevision:latest.current.editorRevision,ticket:value}),[]);
    const follow=useCallback(async(current:JobDto,captured:AiEditorContext,restore=false)=>{const controller=new AbortController();observer.current=controller;let final=current;const target=scope(captured);
        try{const result=current.state==='SUCCEEDED'?current.result:await observeAiJob(current.id,{projectId:current.projectId,signal:controller.signal,onProgress:next=>{final=next;if(mounted.current&&ticket.current===captured.ticket)update(target,{job:next});}});
            if(!mounted.current||ticket.current!==captured.ticket||controller.signal.aborted)return;
            if(restore||!canApplyAiResult(final,captured,context(ticket.current)))update(target,{pendingResult:result});else latest.current.onResult?.(result,final);
        }catch(error){if(mounted.current&&!controller.signal.aborted&&ticket.current===captured.ticket)update(target,{error:error instanceof Error?error.message:'Действие прервано. Данные сохранены.'});}
    },[context,update]);
    useEffect(()=>{const current=++ticket.current;mounted.current=true;stop();
        if(clientContextId)void restoreAiJobs(projectId,kind,clientContextId).then(jobs=>{if(!mounted.current||ticket.current!==current)return;const last=jobs[0],saved=jobs.find(value=>value.state==='SUCCEEDED');update(key,{job:last??null,error:null,pendingResult:saved?.result??null});if(last&&(last.state==='QUEUED'||last.state==='RUNNING'))void follow(last,context(current),true);}).catch(error=>{if(mounted.current&&ticket.current===current)update(key,{error:error instanceof Error?error.message:'Не удалось восстановить действие.'});});
        return()=>{mounted.current=false;stop();};
    },[projectId,kind,clientContextId,key,follow,context,stop,update]);
    const start=useCallback(async(url:string,payload:Record<string,unknown>,requestKey:string)=>{const current=++ticket.current;stop();const captured=context(current),target=scope(captured);update(target,{error:null,pendingResult:null});
        try{const next=await startAiAction(url,{...payload,projectId:captured.projectId,clientContextId:captured.clientContextId},requestKey);if(!mounted.current||ticket.current!==current)return;update(target,{job:next});await follow(next,captured);}catch(error){if(mounted.current&&ticket.current===current)update(target,{error:error instanceof Error?error.message:'Действие не завершено.'});}
    },[context,follow,stop,update]);
    const view=state.key===key?state:empty;
    const cancel=useCallback(async()=>{const job=view.job;if(!job)return;try{const cancelled=await cancelAiJob(job.id,job.revision);++ticket.current;stop();update(key,{job:cancelled,error:null,...(cancelled.state==='SUCCEEDED'?{pendingResult:cancelled.result}:{})});}catch(error){update(key,{error:error instanceof Error?error.message:'Не удалось отменить действие.'});}},[view.job,key,stop,update]);
    return {job:view.job,error:view.error,pendingResult:view.pendingResult,start,cancel};
}
