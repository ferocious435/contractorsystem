"use client";

import {Button} from '@/components/ui/titanium/Button';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
import type {MsgReadingProof} from '@/utils/msg-source-types';
import type {RegistryUnit} from '@/utils/visual-source-reading';

type Props={projectId:string;documentId:string;sourceHash:string;proof:MsgReadingProof;selectedPartId?:string|null;onSelectPart?:(partId:string)=>void;units?:RegistryUnit[]};

function limitation(issue:string):string {
    if(/HTML/.test(issue))return 'תוכן נוסף בגוף ההודעה טרם אומת';
    if(/RTF/.test(issue))return 'אובייקט מוטמע בגוף ההודעה טרם נקרא';
    if(/PAYLOAD/.test(issue))return 'אין קובץ עצמאי מאומת לחלק המוטמע';
    if(/UNSUPPORTED|FORMAT/.test(issue))return 'סוג הקובץ אינו נתמך בקריאה האוטומטית';
    if(/HEADER|DATE/.test(issue))return 'פרטי ההודעה טרם אומתו במלואם';
    return 'קריאת החלק טרם אומתה במלואה';
}

/** Source fields are plain React text; opening a part never starts another analysis. */
export function MsgSourceDetails({projectId,documentId,sourceHash,proof,selectedPartId,onSelectPart,units=[]}:Props) {
    const parts=(Array.isArray(proof.parts)?proof.parts:[]).filter(part=>part&&typeof part.id==='string'&&typeof part.name==='string');
    const root=parts.find(part=>part.id===proof.rootPartId);
    const message=parts.find(part=>part.id===selectedPartId&&part.kind==='MESSAGE')||root;
    const headers=message?.headers;
    const original='/api/documents/file?'+new URLSearchParams({projectId,documentId});
    const addresses=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string').join('; '):'';
    const globalIssues=[...new Set((Array.isArray(proof.issues)?proof.issues:[]).map(limitation))];
    return <section aria-label="הודעת Outlook והקבצים המצורפים">
        <h4 className="ti-section-title">הודעת Outlook והקבצים המצורפים</h4>
        {headers&&<dl className="ti-source-metadata">
            <div><dt>נושא</dt><dd dir="auto">{headers.subject||'לא נמצא נושא'}</dd></div>
            <div><dt>מאת</dt><dd dir="auto">{addresses(headers.from)||'לא נמצא שולח'}</dd></div>
            <div><dt>אל</dt><dd dir="auto">{addresses(headers.to)||'לא נמצאו נמענים'}</dd></div>
            {addresses(headers.cc)&&<div><dt>העתק</dt><dd dir="auto">{addresses(headers.cc)}</dd></div>}
            {addresses(headers.bcc)&&<div><dt>העתק מוסתר</dt><dd dir="auto">{addresses(headers.bcc)}</dd></div>}
            <div><dt>תאריך ההודעה</dt><dd>{headers.sentAt||headers.sentAtRaw?<BidiText kind="date" value={headers.sentAt||headers.sentAtRaw||''}/>:'לא נמצא תאריך מאומת'}</dd></div>
        </dl>}
        {globalIssues.length>0&&<Feedback tone="warning"><ul>{globalIssues.map(issue=><li key={issue}>{issue}</li>)}</ul></Feedback>}
        <ol aria-label="חלקי ההודעה לפי סדר המקור">
            {parts.map(part=>{
                const parent=parts.find(item=>item.id===part.parentId),partUnits=units.filter(unit=>Array.isArray(part.unitIds)&&part.unitIds.includes(unit.id));
                const missingPages=[...new Set(partUnits.filter(unit=>unit.status!=='READ').flatMap(unit=>(Array.isArray(unit.locations)?unit.locations:[]).flatMap(location=>location?.page?[location.page]:[])))];
                const issues=[...new Set((Array.isArray(part.issues)?part.issues:[]).map(limitation))];
                const attachment=part.id!==proof.rootPartId&&part.payloadHash?'/api/documents/attachment?'+new URLSearchParams({projectId,documentId,sourceHash,partId:part.id}):null;
                return <li key={part.id} data-msg-part={part.id} data-msg-status={part.status}>
                    <p><BidiText kind="file" value={part.id===proof.rootPartId?'גוף ההודעה':part.name}/> <StatusChip tone={part.status==='READ'?'info':'warning'}>{part.status==='READ'?'נקרא':'הקריאה לא הושלמה'}</StatusChip></p>
                    {parent&&parent.id!==proof.rootPartId&&<p className="ti-meta">בתוך <BidiText kind="file" value={parent.name}/></p>}
                    {missingPages.length>0&&<p className="ti-meta">עמודים שלא נקראו: <BidiText kind="code" value={missingPages.join(', ')}/></p>}
                    {issues.length>0&&<ul>{issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
                    <div className="ti-actions">
                        {onSelectPart&&<Button data-msg-select={part.id} aria-pressed={selectedPartId===part.id} onClick={()=>onSelectPart(part.id)}>הצגת הטקסט השמור</Button>}
                        {attachment&&<a className="ti-button ti-button--secondary" href={attachment} target="_blank" rel="noreferrer">פתיחת הקובץ המצורף</a>}
                    </div>
                </li>;
            })}
        </ol>
        <a className="ti-button ti-button--secondary" href={original} target="_blank" rel="noreferrer">פתיחת הודעת Outlook המקורית</a>
    </section>;
}
