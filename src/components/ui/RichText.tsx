"use client";

import {useId,useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {Button} from './titanium/Button';
import {Dialog} from './titanium/Dialog';
interface EvidenceData {contract_quote?:string;work_quote?:string;contract_title?:string;work_title?:string;contract_page?:number|string;work_page?:number|string;contract_url?:string;work_url?:string;document_pair?:{contract_doc_id?:string|null;work_doc_id?:string|null};}
function EvidenceMarker({part,isMarker1,evidence,onOpen}:{part:string;isMarker1:boolean;evidence:EvidenceData;onOpen?:(documentId:string|null,page:number|string|null)=>void}){
 const [showQuote,setShowQuote]=useState(false),titleId=useId();
 const quote=isMarker1?evidence.contract_quote:evidence.work_quote,title=isMarker1?evidence.contract_title:evidence.work_title,page=isMarker1?evidence.contract_page:evidence.work_page,url=isMarker1?evidence.contract_url:evidence.work_url,documentId=isMarker1?evidence.document_pair?.contract_doc_id:evidence.document_pair?.work_doc_id;
 if(!quote)return <span className="ti-chip ti-tone--warning">{part} נדרש אימות</span>;
 const canOpen=Boolean(onOpen&&documentId||url);
 return <span className="ti-evidence-marker"><button type="button" className="ti-evidence-marker__button" aria-label={`פתיחת מקור ${part} · ${page?`עמוד ${page}`:'עמוד לא אומת'}`} aria-haspopup="dialog" onClick={event=>{event.stopPropagation();setShowQuote(true);}}>{part}<ExternalLink size={13} aria-hidden="true"/><span className="ti-sr-only">{page?`עמוד ${page}`:'עמוד לא אומת'}</span></button><Dialog open={showQuote} labelledBy={titleId} onClose={()=>setShowQuote(false)}><header className="ti-dialog__header"><h2 id={titleId} className="ti-section-title">ציטוט מקור {part}</h2><Button onClick={()=>setShowQuote(false)}>סגירה</Button></header><p className="ti-source-name"><bdi dir="auto">{title||'מסמך מקור'}</bdi> · {page?`עמוד ${page}`:'עמוד לא אומת'}</p><blockquote className="ti-evidence-quote" dir="auto">״{quote}״</blockquote><p className="ti-meta">המובאה מוצגת מהנתונים השמורים; מצבה וההקשר שלה נבדקים בכרטיס.</p><Button onClick={()=>{if(onOpen&&documentId)onOpen(documentId,page||null);else if(url)window.open(page?`${url}#page=${page}`:url,'_blank','noopener,noreferrer');}} disabled={!canOpen} disabledReason={!canOpen?'אין קובץ מקור מקושר לפתיחה':undefined}>פתיחת קובץ המקור<ExternalLink size={16} aria-hidden="true"/></Button></Dialog></span>;
}
interface RichTextProps {text:string;evidence?:EvidenceData;onOpen?:(documentId:string|null,page:number|string|null)=>void;className?:string;dir?:'rtl'|'ltr'|'auto';}
export function RichText({text,evidence,onOpen,className='',dir='auto'}:RichTextProps){if(!text)return null;return <span className={`ti-rich-text ${className}`} dir={dir}>{text.split(/(\[[12]\])/).map((part,index)=>part==='[1]'||part==='[2]'?<EvidenceMarker key={index} part={part} isMarker1={part==='[1]'} evidence={evidence||{}} onOpen={onOpen}/>:<span key={index}>{part}</span>)}</span>;}
