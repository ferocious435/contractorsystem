"use client";

import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/titanium/Button';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {consultantBoqRowKey} from '@/utils/consultant-result';
import {normalizeEvidenceSource} from '@/utils/radar-evidence-assessment';
import type {ConsultantBoqRow} from '@/utils/consultant-boq';
import {readBoqPdf,type BoqComparisons} from './boqSources';

interface ConsultantBoqRowsProps {projectId:string;rows:ConsultantBoqRow[];comparisons?:BoqComparisons;comparisonUnavailable?:boolean}
const price=new Intl.NumberFormat('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2});

/** Native image rendering also works in browsers without an embedded PDF viewer. */
export function ConsultantSourcePage({url,title,onError}:{url:string;title:string;onError():void}):React.JSX.Element {
    const [zoom,setZoom]=useState(100);
    return <section aria-label={title}>
        <div className="ti-actions"><Button onClick={()=>setZoom(100)}>התאמה לרוחב</Button><Button disabled={zoom>=300} onClick={()=>setZoom(value=>Math.min(300,value+50))}>הגדלה</Button><Button disabled={zoom<=100} onClick={()=>setZoom(value=>Math.max(100,value-50))}>הקטנה</Button><span aria-live="polite"><bdi dir="ltr">{zoom}%</bdi></span></div>
        <div tabIndex={0} role="region" aria-label="עמוד המקור — גלילה" style={{overflow:'auto',maxHeight:'55vh',background:'#fff',direction:'ltr'}}>
            {/* The verified Blob is local and must bypass the remote image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={title} onError={onError} style={{display:'block',width:`${zoom}%`,maxWidth:'none',height:'auto'}}/>
        </div>
    </section>;
}

export function ConsultantBoqRows({projectId,rows,comparisons={},comparisonUnavailable=false}:ConsultantBoqRowsProps):React.JSX.Element {
    const [source,setSource]=useState<ConsultantBoqRow|null>(null),[pdf,setPdf]=useState<string|null>(null),[sourceState,setSourceState]=useState<'READING'|'PDF'|'QUOTE'>('READING');
    const titleId=useId(),request=useRef<AbortController|null>(null);
    const groups=useMemo(()=>{
        const grouped=new Map<string,ConsultantBoqRow[]>();
        for(const row of rows){const group=grouped.get(row.itemCode)||[];group.push(row);grouped.set(row.itemCode,group);}
        return [...grouped];
    },[rows]);
    const close=useCallback(()=>{request.current?.abort();setSource(null);setPdf(null);},[]);
    useEffect(()=>{
        if(!source)return;
        const controller=new AbortController();request.current=controller;let objectUrl:string|null=null;
        void readBoqPdf(projectId,source,controller.signal).then(blob=>{
            if(controller.signal.aborted)return;
            objectUrl=URL.createObjectURL(blob);setPdf(objectUrl);setSourceState('PDF');
        }).catch(()=>{if(!controller.signal.aborted)setSourceState('QUOTE');});
        return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
    },[projectId,source]);
    const open=useCallback((row:ConsultantBoqRow)=>{request.current?.abort();setPdf(null);setSourceState('READING');setSource(row);},[]);
    const renderRow=(row:ConsultantBoqRow,label:string):React.JSX.Element=><tr key={consultantBoqRowKey(row)} data-boq-source={row.documentId}>
        <td style={{minWidth:180,maxWidth:350,whiteSpace:'normal'}}><strong>{label}</strong><p dir="auto">{normalizeEvidenceSource(row.scope)}</p>
            <p>{row.title}</p><p>תאריך מהדורה: <bdi dir="ltr">{row.revision.date??'לא צוין'}</bdi></p>
            {row.revision.printedDate&&<p>תאריך הדפסה: <bdi dir="ltr">{row.revision.printedDate}</bdi></p>}
            {!!row.revision.conflictingDateEvidence?.length&&<p className="ti-meta">תאריכים סותרים במסמך — תאריך המהדורה לא הוכרע.</p>}
            {row.ambiguousItemCode&&<p>מספר הסעיף מופיע יותר מפעם אחת במקור.</p>}
        </td>
        <td><bdi dir="ltr">{row.unit}</bdi></td><td style={{whiteSpace:'nowrap'}}><bdi dir="ltr">{price.format(row.unitPrice)} ₪</bdi><p className="ti-meta">{row.vatBasis==='EXCL'?'ללא מע״מ':row.vatBasis==='INCL'?'כולל מע״מ':'בסיס מע״מ לא אומת'}</p></td>
        <td style={{minWidth:180,whiteSpace:'normal'}}>{row.binding.status==='UNVERIFIED'&&<p>שיוך למקטע לא אומת.</p>}{row.binding.warnings.map((warning,i)=><p key={i}>{warning}</p>)}
            <Button onClick={()=>open(row)} aria-label={`${row.title} — ${row.page===null?'ציטוט שמור':`עמוד ${row.page}`} — סעיף ${row.itemCode}`}>{row.page===null?'ציטוט שמור':<>עמוד <bdi dir="ltr">{row.page}</bdi></>}</Button>
        </td>
    </tr>;
    return <section aria-label="סעיפי כתב כמויות" className="ti-source-text">
        <h3 className="ti-section-title">סעיפי כתב כמויות ומקורות</h3><p className="ti-meta">מקורות נפרדים לאותו סעיף מוצגים להשוואה. אין לחבר מחירים; תוספת תשלום דורשת בסיס נפרד.</p>
        {comparisonUnavailable&&<p role="status">השוואת מהדורות אינה זמינה כעת. שורות המקור השמורות נשארו ללא שינוי.</p>}
        {groups.map(([code,originals])=>{
            const additions=new Map<string,ConsultantBoqRow>();
            for(const row of originals){const comparison=comparisons[consultantBoqRowKey(row)];if(comparison?.status==='REPLACED'&&!originals.some(original=>consultantBoqRowKey(original)===consultantBoqRowKey(comparison.currentRow)))additions.set(consultantBoqRowKey(comparison.currentRow),comparison.currentRow);}
            return <section key={code}><h4>סעיף <bdi dir="ltr">{code}</bdi></h4><div style={{overflowX:'auto'}} tabIndex={0} role="region" aria-label={`מקורות לסעיף ${code}`}><table className="ti-table" style={{width:'100%',textAlign:'right',fontSize:'0.875rem'}}><thead><tr><th scope="col">עבודה ומהדורה</th><th scope="col">יחידה</th><th scope="col">מחיר ליחידה</th><th scope="col">מקטע ומקור</th></tr></thead><tbody>
                {originals.map(row=>renderRow(row,originals.some(original=>{const comparison=comparisons[consultantBoqRowKey(original)];return comparison?.status==='REPLACED'&&consultantBoqRowKey(comparison.currentRow)===consultantBoqRowKey(row);})?'מהדורה מחליפה מאומתת':comparisons[consultantBoqRowKey(row)]?.status==='REPLACED'?'מהדורה קודמת — מקור שמור בתשובה':'מקור שמור בתשובה'))}{[...additions.values()].map(row=>renderRow(row,'מהדורה מחליפה מאומתת'))}
            </tbody></table></div>
                {originals.map(row=>{const comparison=comparisons[consultantBoqRowKey(row)];return comparison&&<div key={consultantBoqRowKey(row)} className="ti-meta">
                    <p>{row.title}: {comparison.status==='REPLACED'?`מהדורה מחליפה מאומתת. ${comparison.description}`:comparison.reason??'לא הוכחה מהדורה מחליפה מחייבת.'}</p>
                    {comparison.warnings.map((warning,i)=><p key={i}>{warning}</p>)}
                    {comparison.editionHistory.length>0&&<details><summary>ראיות והיסטוריית החלפת מסמכים</summary>{comparison.editionHistory.map((hop,i)=><blockquote key={i} dir="auto" style={{whiteSpace:'pre-wrap'}}>{hop.evidence.quote}</blockquote>)}</details>}
                </div>;})}
            </section>;
        })}
        <Dialog open={source!==null} labelledBy={titleId} onClose={close} className="ti-consultant-source-dialog">
            <h2 id={titleId}>{source?.title} — {source?.page===null?'ציטוט שמור':<>עמוד <bdi dir="ltr">{source?.page}</bdi></>}</h2><Button onClick={close}>חזרה לשיחה</Button>
            {sourceState==='READING'&&<p role="status">בודק את קובץ המקור… הציטוט השמור זמין למטה.</p>}
            {sourceState==='QUOTE'&&<p role="status">לא ניתן לאמת ולפתוח את קובץ המקור. מוצג הציטוט המדויק שנשמר עם התשובה.</p>}
            {pdf&&sourceState==='PDF'&&<ConsultantSourcePage key={pdf} url={pdf} title={`${source?.title} — עמוד ${source?.page}`} onError={()=>{setPdf(null);setSourceState('QUOTE');}}/>}
            <details open={sourceState!=='PDF'}><summary>הציטוט השמור ללא שינוי</summary><pre dir="auto" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{source?.quote}</pre></details>
        </Dialog>
    </section>;
}
