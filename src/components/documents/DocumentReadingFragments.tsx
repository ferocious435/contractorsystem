"use client";

import {useState} from 'react';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {documentFragmentUrl} from './documentAiApi';
import {visualSourceLocationLabel} from '@/utils/visual-source-location';
import type {VerifiedUnit,RegistryUnit} from '@/utils/visual-source-reading';
import {observedPrintedLine,type FragmentAddress,type FragmentProof,type FragmentResponse} from '@/utils/visual-fragment-contracts';

interface FragmentProps {documentId:string;projectId:string;sourceHash:string;textHash:string;units:VerifiedUnit[];sourceUnits?:Pick<RegistryUnit,'id'|'locations'>[]}
const addressLabel=(a:FragmentAddress)=>a.kind==='line'?`שורת טקסט ${a.line+1}`:`טבלה ${a.table+1} · שורה ${a.row+1}`;
function problemLabel(reason:string):string {
    if(reason.includes('ambiguous')||reason.includes('context')||reason.includes('aligned')||reason.includes('structure'))return 'המיקום או ההקשר של חלק מהתוכן עדיין לא אומתו.';
    if(reason.includes('uncertainty')||reason.includes('unclear')||reason.includes('verification'))return 'חלק מתוכן המקור עדיין אינו ברור מספיק לאימות.';
    if(reason.startsWith('Fragment '))return 'הבדיקה המוגדלת טרם אישרה את כל התוכן הנדרש.';
    return reason;
}
function ConfirmedFragment({proof,url}:{proof:FragmentProof;url:string}) {
    const [open,setOpen]=useState(false),[failed,setFailed]=useState(false);
    const positioned=proof.positioned;
    const line=proof.correction?.match??positioned?.match;
    const excerpt=(raw:string)=>{
        try{
            const observation:FragmentResponse=JSON.parse(raw);
            const block=observation.blocks.find(b=>b.id===proof.target.id);
            return line&&block&&observedPrintedLine(block.value,line.cell,line.line.text)?.text;
        }catch{return undefined;}
    };
    const evidence=positioned?.support?.raw??(positioned?.raw?[proof.raw[positioned.match.choice],positioned.raw]:proof.raw);
    let excerpts=proof.correction?proof.raw.map(excerpt):positioned?.support?.raw.map(excerpt);
    if(positioned?.raw){
        try{excerpts=[excerpt(evidence[0]),JSON.parse(positioned.raw).text];}catch{excerpts=undefined;}
    }
    return <li>
        <p>{addressLabel(proof.target.address)} — הקריאה אומתה</p>
        <pre className="ti-copy ti-preserve-lines" dir="auto">{Array.isArray(proof.value)?proof.value.join(' | '):proof.value}</pre>
        <Button onClick={()=>setOpen(value=>!value)} aria-expanded={open}>{open?'סגירת האזור המוגדל':'פתיחת האזור המוגדל'}</Button>
        {open&&(failed?<Feedback tone="warning">לא ניתן לפתוח את האזור המאומת. קובץ המקור נשאר זמין; הקריאה לא הופעלה שוב.</Feedback>:
            // Private source pixels are served only after authorization and proof validation.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ti-source-image" src={url} alt={`אזור המקור: ${addressLabel(proof.target.address)}`} onError={()=>setFailed(true)}/>)}
        {line&&<p>השורה במקור <bdi>{line.line.text}</bdi></p>}
        {excerpts?.length===2&&excerpts.every(Boolean)&&<ol aria-label="שתי קריאות של השורה במקור">
            {excerpts.map((text,index)=><li key={index}>קריאה {index+1} · <bdi>{text}</bdi></li>)}
        </ol>}
        <details><summary>שתי הקריאות של האזור המוגדל</summary>{evidence.map((raw,index)=><pre className="ti-copy ti-preserve-lines" dir="auto" key={index}>{raw}</pre>)}</details>
    </li>;
}

export function DocumentReadingFragments({documentId,projectId,sourceHash,textHash,units,sourceUnits=[]}:FragmentProps) {
    const composed=units.filter(unit=>unit.composition);
    return composed.length>0&&<section aria-label="בדיקת אזורים במקור" dir="rtl">
        <h4 className="ti-section-title">בדיקת אזורים במקור</h4>
        {composed.map(unit=>{const c=unit.composition!,source=sourceUnits.find(value=>value.id===unit.unitId),total=c.proofs.length+c.pending.length;
            return <div key={unit.unitId}>
                <p className="ti-meta">{source?.locations.map(visualSourceLocationLabel).join(', ')||'חלק במקור'} · אזורים שאומתו: <bdi>{c.proofs.length} / {total}</bdi></p>
                {!unit.complete&&<Feedback tone="warning">הקריאה של חלק זה עדיין לא הושלמה. האזורים שאומתו נשמרו להמשך.</Feedback>}
                <ul>{c.proofs.map(proof=>{const url=documentFragmentUrl({documentId,projectId,sourceHash,textHash,unitId:unit.unitId,targetId:proof.target.id});return <ConfirmedFragment key={url} proof={proof} url={url}/>;})}</ul>
                {c.pending.length>0&&<ul aria-label="אזורים שעדיין דורשים בדיקה">{c.pending.map(target=><li key={target.id}>{addressLabel(target.address)} — שתי הקריאות טרם אישרו את התוכן ואת מקומו במקור.</li>)}</ul>}
                {c.issues.length>0&&<ul aria-label="מגבלות הקריאה">{[...new Set(c.issues.map(problemLabel))].map(reason=><li key={reason} dir="auto">{reason}</li>)}</ul>}
                <details><summary>הקריאות המקוריות שנשמרו</summary>{unit.views.map(view=><pre className="ti-copy ti-preserve-lines" dir="auto" key={view.viewId}>{JSON.stringify({reading:view.reading,confirmation:view.confirmation,initialReading:view.initialReading},null,2)}</pre>)}</details>
                {c.locator&&<details><summary>איתור האזור במקור</summary><pre className="ti-copy ti-preserve-lines" dir="auto">{c.locator.raw}</pre></details>}
                {Boolean(c.attempts?.length)&&<details><summary>בדיקות שעדיין לא אושרו</summary>{c.attempts!.map((attempt,index)=><div key={index}><p>{addressLabel(attempt.target.address)}</p>{attempt.raw.map((raw,i)=><pre className="ti-copy ti-preserve-lines" dir="auto" key={i}>{raw}</pre>)}</div>)}</details>}
            </div>;
        })}
    </section>;
}
