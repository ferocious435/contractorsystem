"use client";

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/titanium/Button';
import { Field } from '@/components/ui/titanium/Field';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { Panel } from '@/components/ui/titanium/Panel';
import { DocumentListRow } from './DocumentListRow';
import { DocumentSourceView } from './DocumentSourceView';
import { getDocumentDisplayState, hasIncompleteAiAnalysis } from './documentDisplayStatus';
import type { DocumentCategory, ProjectDocument } from './types';

export type DocumentFilter = 'ACTION' | 'ALL' | 'ERROR' | 'PENDING' | 'VALIDATED';
const filters: {key: DocumentFilter; label: string}[] = [{key:'ACTION',label:'דורש טיפול'},{key:'ALL',label:'כל המסמכים'},{key:'ERROR',label:'ניתוח לא הושלם'},{key:'PENDING',label:'ממתין לניתוח'},{key:'VALIDATED',label:'אושר ידנית'}];
function matchesFilter(doc: ProjectDocument, filter: DocumentFilter) {
  return filter === 'ACTION' ? getDocumentDisplayState(doc).needsAction : filter === 'ERROR' ? hasIncompleteAiAnalysis(doc) : filter === 'PENDING' ? doc.ai_status === 'PENDING' || !doc.ai_status : filter === 'VALIDATED' ? doc.ai_status === 'VALIDATED' : true;
}
function priority(doc: ProjectDocument) { return hasIncompleteAiAnalysis(doc) ? 0 : doc.ai_status === 'SCANNED' ? 1 : doc.ai_status === 'PENDING' || !doc.ai_status ? 2 : doc.ai_status === 'PROCESSING' || doc.ai_status === 'EXTRACTING' ? 3 : doc.ai_status === 'VALIDATED' ? 4 : 5; }
export function selectCatalogDocuments(documents: readonly ProjectDocument[], category: DocumentCategory | undefined, filter: DocumentFilter, query: string) {
  const search = query.trim().toLocaleLowerCase();
  return documents.filter(doc => (!category || doc.category === category) && matchesFilter(doc,filter) && (!search || [doc.title,doc.parsed_json?.date,doc.created_at].filter(Boolean).join(' ').toLocaleLowerCase().includes(search))).sort((a,b) => priority(a) - priority(b));
}
export function DocumentsCatalogView({documents,category,activeFilter,uploading,processingId,selectedId,loadError,loading=false,sourceReadErrors,analysisAvailable=true,analysisDisabledReason,onSelect,onFilter,onRetryRead,onUpload,onAnalyze,onPreview,onDelete}: {
  documents: readonly ProjectDocument[]; category?: DocumentCategory; activeFilter: DocumentFilter; uploading: boolean; processingId: string | null; selectedId: string | null; loadError: string | null; loading?: boolean; analysisAvailable?: boolean; analysisDisabledReason?: string;
  sourceReadErrors?: Readonly<Record<string, string>>;
  onSelect(id:string):void; onFilter(filter:DocumentFilter):void; onRetryRead():Promise<void>; onUpload(files:File[]):Promise<void>; onAnalyze(document:ProjectDocument):Promise<void>; onPreview(document:ProjectDocument):void; onDelete(document:ProjectDocument):Promise<void>;
}) {
  const [query,setQuery] = useState('');
  const [dragging,setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const scoped = documents.filter(doc => !category || doc.category === category);
  const visible = selectCatalogDocuments(documents,category,activeFilter,query);
  const selected = visible.find(doc => doc.id === selectedId) || null;
  return <div className="ti-page ti-documents" dir="rtl" ref={container}>
    <header className="ti-page-header"><div><h1 className="ti-title">{category === 'EXECUTION' ? 'ביצוע ושטח' : category === 'CONTRACT' ? 'מסמכי חוזה' : 'מרכז מסמכים וחוזים'}</h1><p className="ti-subtitle">מסמכי הפרויקט, קריאת המקור וסקירת הניתוח</p></div><Button variant="primary" pending={uploading} busyLabel="מעלה מסמכים…" onClick={()=>input.current?.click()}><Upload size={18} aria-hidden="true" />העלאת מסמכים</Button><input ref={input} type="file" multiple className="ti-sr-only" tabIndex={-1} aria-label="קבצים להעלאה" onChange={async event=>{const files=Array.from(event.currentTarget.files || []);event.currentTarget.value='';if(files.length)await onUpload(files);}} /></header>
    {loadError && <Feedback tone="danger" title="טעינת המסמכים לא הושלמה"><p>{loadError}</p><Button onClick={onRetryRead} pending={loading}>ניסיון נוסף</Button></Feedback>}
    <div className="ti-tabs" aria-label="סינון מסמכים">{filters.map(filter=><button type="button" className="ti-tab" key={filter.key} aria-pressed={activeFilter===filter.key} onClick={()=>onFilter(filter.key)}>{filter.label} ({scoped.filter(doc=>matchesFilter(doc,filter.key)).length})</button>)}</div>
    <Field label="חיפוש במסמכים" hint="שם קובץ, קוד או תאריך זמין" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="חיפוש בשם המסמך…" />
    <div className="ti-documents-layout"><Panel className={`ti-document-list ${dragging?'ti-document-list--dragging':''}`} title="רשימת מסמכים" onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}} onDrop={async event=>{event.preventDefault();setDragging(false);if(!uploading&&event.dataTransfer.files.length)await onUpload(Array.from(event.dataTransfer.files));}}>
      {dragging && <Feedback>שחרר כאן את הקבצים להעלאה</Feedback>}
      {loading && <p role="status">טוען מסמכים…</p>}
      {!loading && !visible.length && !loadError && <Feedback title={scoped.length ? 'לא נמצאו מסמכים בסינון הזה' : 'עדיין אין מסמכים'}>{scoped.length ? 'אפשר לשנות את החיפוש או את המסנן.' : 'העלה מסמך ראשון כדי להתחיל. אפשר גם לגרור לכאן מספר קבצים.'}</Feedback>}
      {visible.map(doc=><DocumentListRow key={doc.id} document={doc} selected={doc.id===selectedId} processing={processingId===doc.id} analysisAvailable={analysisAvailable&&!processingId} analysisDisabledReason={processingId?'ניתוח אחר נמצא בתהליך':analysisDisabledReason} onSelect={()=>{if(container.current && container.current.clientWidth < 1080)onPreview(doc);else onSelect(doc.id);}} onAnalyze={()=>onAnalyze(doc)} onPreview={()=>onPreview(doc)} onDelete={()=>onDelete(doc)} />)}
    </Panel><Panel className="ti-document-source-panel" title="תצוגת מקור">{selected ? <DocumentSourceView document={selected} fullText={selected.extracted_text} sourceReadError={sourceReadErrors?.[selected.id]} onRetryRead={onRetryRead} retryingRead={loading || Boolean(processingId)} onPreview={()=>onPreview(selected)} /> : <Feedback>בחר מסמך מהרשימה כדי לראות את המקור ואת מצב הקריאה שלו.</Feedback>}</Panel></div>
  </div>;
}
