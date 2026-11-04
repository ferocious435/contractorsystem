"use client";

import { ExternalLink, FileText } from 'lucide-react';
import { assessDocumentSourceReadiness, DOCX_READING_VERSION, isDocxImageReadingComplete } from '@/utils/document-source-readiness';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { StatusChip } from '@/components/ui/titanium/StatusChip';
import { hasIncompleteAiAnalysis } from './documentDisplayStatus';
import type { ProjectDocument } from './types';
import {assessVisualReading,VISUAL_READING_VERSION,type VisualDescription} from '@/utils/visual-source-reading';
import {visualSourceLocationLabel} from '@/utils/visual-source-location';

function wordPartLabel(part: unknown) {
  return visualSourceLocationLabel({part:typeof part==='string'?part:undefined});
}

function imageReviewReason(reason: unknown) {
  if (reason === 'OCR_NUMBERS_REQUIRE_REVIEW') return 'המספרים בתמונה דורשים אימות';
  if (reason === 'OCR_LOW_CONFIDENCE') return 'הטקסט בתמונה אינו ברור מספיק';
  if (reason === 'OCR_FAILED' || reason === 'OCR_NO_READABLE_BODY') return 'לא ניתן לקרוא את הטקסט בתמונה';
  return 'קריאת התמונה לא אומתה';
}

export function DocumentSourceView({ document, fullText, visualDescriptions, readingCurrent=true, previewUrl, previewKind, previewError, sourceUrl, sourceReadError, onRetryRead, retryingRead, onCompleteReading, completingReading, onPreview, canValidate, validating, validationDisabledReason, validationError, onValidate }: {
  document: ProjectDocument; fullText?: string | null; previewUrl?: string | null; previewKind?: 'pdf' | 'image' | 'text' | 'office' | 'unsupported'; previewError?: string | null; sourceUrl?: string | null;
  visualDescriptions?:VisualDescription[];readingCurrent?:boolean;
  sourceReadError?: string | null; onRetryRead?(): Promise<void>; retryingRead?: boolean;
  onCompleteReading?():Promise<void>;completingReading?:boolean;
  onPreview?(): void; canValidate?: boolean; validating?: boolean; validationDisabledReason?: string; validationError?: string | null; onValidate?(): Promise<void>;
}) {
  const readiness = assessDocumentSourceReadiness(document);
  const rawReading = document.parsed_json?.source_reading;
  const reading = rawReading && typeof rawReading === 'object' && !Array.isArray(rawReading) ? rawReading as Record<string, unknown> : undefined;
  const visual=reading?.version===VISUAL_READING_VERSION?reading:undefined;
  const visualMatches=Boolean(visual&&visual.sourceHash===document.content_hash&&visual.currentTextHash===document.extracted_text_hash);
  const units=(Array.isArray(visual?.expectedUnits)?visual.expectedUnits:[]).filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object');
  const verifiedUnitIds=new Set(visualMatches?assessVisualReading(visual,document).verifiedUnitIds:[]);
  const confirmedUnits=units.filter(unit=>verifiedUnitIds.has(String(unit.id)));
  const brandingUnits=confirmedUnits.filter(unit=>unit.contentRole==='BRANDING_ONLY');
  const recognitionNotes=[...new Set(confirmedUnits.flatMap(unit=>Array.isArray(unit.nonBlockingNotes)?unit.nonBlockingNotes.filter((note):note is string=>typeof note==='string'):[]))];
  const transcripts=(visualMatches&&Array.isArray(visual?.units)?visual.units:[]).filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'
    &&value.complete===true&&typeof value.text==='string'&&Boolean(value.text.trim())&&confirmedUnits.some(unit=>unit.id===value.unitId&&unit.textHash===value.textHash));
  const descriptions=visualDescriptions||(Array.isArray(document.parsed_json?.source_reading_visual_descriptions)?document.parsed_json.source_reading_visual_descriptions as VisualDescription[]:[]);
  const imageSource=visual?.format==='IMAGE'||visual?.format==='XLSX';
  const visualOnlyRead=visualMatches&&imageSource&&readiness.extractionComplete&&!readiness.hasReadableText&&descriptions.some(description=>description.text.trim());
  const docx = reading?.version === DOCX_READING_VERSION ? reading : undefined;
  const isWord = Boolean(docx) || [document.title, document.storage_path, document.file_url].some(value => /\.docx(?:$|[?#\s._()\d-])/i.test(value || ''));
  const imageHashMatches = Boolean(docx && typeof docx.sourceHash === 'string' && /^[a-f\d]{64}$/i.test(docx.sourceHash)
    && (!document.content_hash || document.content_hash === docx.sourceHash));
  const expectedImages = typeof docx?.expectedImageReferences === 'number' && Number.isInteger(docx.expectedImageReferences) && docx.expectedImageReferences >= 0 ? docx.expectedImageReferences : null;
  const images: unknown[] = Array.isArray(docx?.images) ? docx.images : [];
  const readImages = new Set(images.filter(isDocxImageReadingComplete).map(image => image.anchor)).size;
  const imageAnchors = new Set(images.flatMap(image => image && typeof image === 'object' && typeof (image as Record<string, unknown>).anchor === 'string' ? [(image as Record<string, unknown>).anchor] : []));
  const imageRecordsMismatch = expectedImages !== null && (images.length !== expectedImages || imageAnchors.size !== images.length);
  const imageReviews = images.flatMap((image, index) => {
    if (isDocxImageReadingComplete(image)) return [];
    const record = image && typeof image === 'object' ? image as Record<string, unknown> : {};
    return [{ index: index + 1, part: wordPartLabel(record.part), reason: imageReviewReason(record.reason) }];
  });
  const partReviews = Array.isArray(docx?.issues) ? docx.issues.map(issue => {
    const [part, reason] = typeof issue === 'string' ? issue.split(':') : [];
    return { part: wordPartLabel(part), reason: reason === 'CONTENT_NOT_POSITIONED_BY_PARSER' ? 'מיקום הטקסט בחלק זה לא אומת' : 'קריאת החלק טרם אומתה במלואה' };
  }) : [];
  const visualPartReviews=Array.isArray(visual?.issues)?visual.issues.flatMap(issue=>{
    if(typeof issue!=='string'||!/^word\/.+\.xml:/u.test(issue))return [];
    const [part,reason]=issue.split(':');return [{part:wordPartLabel(part),reason:reason==='CONTENT_NOT_POSITIONED_BY_PARSER'?'מיקום הטקסט בחלק זה לא אומת':'קריאת החלק טרם אומתה במלואה'}];
  }):[];
  const pdf = /\.pdf(?:$|[?#])/i.test(String(document.title || document.storage_path || document.file_url || ''));
  const pages = visualMatches&&visual?.format==='PDF'?units.length:typeof reading?.totalPages === 'number' && Number.isInteger(reading.totalPages) && reading.totalPages > 0 ? reading.totalPages : null;
  const readPages = visualMatches&&visual?.format==='PDF'?confirmedUnits.flatMap(unit=>Array.isArray(unit.locations)?unit.locations.flatMap(location=>location&&typeof location.page==='number'?[location.page]:[]):[]):Array.isArray(reading?.readPages) ? [...new Set(reading.readPages.filter((value): value is number => Number.isInteger(value) && Number(value) > 0 && (!pages || Number(value) <= pages)))] : [];
  const unread = Array.isArray(reading?.unreadablePages) ? reading.unreadablePages.filter((value): value is number => Number.isInteger(value) && Number(value) > 0) : [];
  const missing = pages ? Array.from({length: pages}, (_, i) => i + 1).filter(page => !readPages.includes(page) || unread.includes(page)) : unread;
  const marker = readiness.documentStatus === 'DRAFT' || readiness.documentStatus === 'FRAGMENT' ? readiness.documentStatus : undefined;
  const aiIncomplete = hasIncompleteAiAnalysis(document);
  const analysisComplete = document.ai_status === 'SCANNED' && readiness.extractionComplete && !aiIncomplete;
  const textChunks = fullText?.match(/[\s\S]{1,8000}(?:\n|$)|[\s\S]{1,8000}/g) || [];
  return <section className="ti-source-view" data-source-status={readiness.status} data-document-marker={marker} aria-label="מקור המסמך">
    <div className="ti-source-view__header"><FileText size={20} aria-hidden="true" /><h3 className="ti-section-title">מקור המסמך</h3></div>
    <p className="ti-source-name"><BidiText kind="file" value={document.title || 'מסמך ללא שם'} /></p>
    {!readingCurrent&&<Feedback tone="info">מוצגת גרסת הקריאה שאליה מפנה הציטוט. הקריאה העדכנית של המסמך נשמרה בנפרד.</Feedback>}
    <div className="ti-source-states"><StatusChip tone="neutral">הקובץ נשמר</StatusChip>{document.ai_status === 'VALIDATED' && <StatusChip tone="success">אושר ידנית</StatusChip>}<StatusChip tone={readiness.extractionComplete ? 'info' : 'warning'}>{readiness.extractionComplete ? brandingUnits.length?'תוכן המסמך נקרא':'הטקסט נקרא' : 'הקריאה לא הושלמה'}</StatusChip><StatusChip tone={aiIncomplete ? 'warning' : 'neutral'}>{aiIncomplete ? 'ניתוח AI לא הושלם' : analysisComplete ? 'ניתוח הושלם' : 'השלמת ניתוח נבדקת בנפרד'}</StatusChip></div>
    {brandingUnits.length>0&&<p className="ti-meta" data-source-branding="recognized">סמלילים וסימני מיתוג זוהו חזותית; אינם הוראות או תנאים בפרויקט.</p>}
    {recognitionNotes.length>0&&<ul aria-label="הערות זיהוי שאינן מעכבות קריאה">{recognitionNotes.map(note=><li key={note}>{note}</li>)}</ul>}
    {pdf && <p className="ti-meta">{pages ? <>נקראו <BidiText kind="code" value={`${readPages.length} / ${pages}`} /> עמודים{missing.length > 0 && <> · עמודים שלא נקראו: <BidiText kind="code" value={missing.join(', ')} /></>}</> : 'מספר העמודים לא אומת'}</p>}
    {isWord && <div role="group" aria-label="קריאת חלקי המסמך">
      {visualMatches&&visual?.format==='DOCX'?<><p className="ti-meta">תמונות ייחודיות שקריאתן אומתה: <BidiText kind="code" value={`${confirmedUnits.length} / ${units.length}`}/></p>
        {confirmedUnits.length!==units.length&&<ul aria-label="תמונות שדורשות בדיקה">{units.filter(unit=>!verifiedUnitIds.has(String(unit.id))).map(unit=><li key={String(unit.id)}>{Array.isArray(unit.locations)?[...new Set(unit.locations.map(location=>wordPartLabel(location?.part)))].join(', '):'חלק במסמך'} — קריאת התמונה טרם אומתה</li>)}</ul>}</>:!docx ? <p className="ti-meta">מספר התמונות לא אומת</p> : !imageHashMatches ? <Feedback tone="warning">אימות התמונות אינו תואם לקובץ השמור</Feedback> : <>
        <p className="ti-meta">{expectedImages === null || images.length > expectedImages ? 'מספר התמונות לא אומת' : expectedImages === 0 && images.length === 0 ? 'לא נמצאו תמונות מוטמעות במסמך' : <>תמונות שקריאתן אומתה: <BidiText kind="code" value={`${readImages} / ${expectedImages}`} /></>}</p>
        {imageRecordsMismatch && <Feedback tone="warning">חסרות תוצאות קריאה או שיש חוסר התאמה ברישום התמונות. הקריאה אינה מלאה.</Feedback>}
        {imageReviews.length > 0 && <ul aria-label="תמונות שדורשות בדיקה">{imageReviews.map(image => <li key={image.index}>{image.part} · {`תמונה ${image.index}`} — {image.reason}</li>)}</ul>}
        {partReviews.length > 0 && <ul aria-label="חלקים נוספים שדורשים בדיקה">{partReviews.map((part, index) => <li key={index}>{part.part} — {part.reason}</li>)}</ul>}
      </>}
      {visualPartReviews.length>0&&<ul aria-label="חלקים נוספים שדורשים בדיקה">{visualPartReviews.map((part,index)=><li key={index}>{part.part} — {part.reason}</li>)}</ul>}
    </div>}
    {imageSource&&<div role="group" aria-label="קריאת תמונות המקור">
      {!visualMatches?<Feedback tone="warning">אימות התמונות אינו תואם לקובץ השמור</Feedback>:<>
        <p className="ti-meta">תמונות ופריימים שקריאתם אומתה: <BidiText kind="code" value={`${confirmedUnits.length} / ${units.length}`}/></p>
        {units.some(unit=>!verifiedUnitIds.has(String(unit.id)))&&<ul aria-label="תמונות שדורשות בדיקה">{units.filter(unit=>!verifiedUnitIds.has(String(unit.id))).map(unit=><li key={String(unit.id)}>{Array.isArray(unit.locations)?unit.locations.map(location=>visualSourceLocationLabel(location)).join(', '):'תמונה במקור'} — קריאת התמונה טרם אומתה</li>)}</ul>}
        {Array.isArray(visual?.issues)&&visual.issues.length>0&&<Feedback tone="warning">יש חלקים נוספים בקובץ שקריאתם טרם אומתה: <BidiText kind="code" value={String(visual.issues.length)}/>. הקריאה נשארת חלקית.</Feedback>}
      </>}
    </div>}
    {!readiness.extractionComplete && <Feedback tone="warning">שלמות קריאת המקור טרם אומתה. אישור ידני אינו מעיד שכל העמודים נקראו.</Feedback>}
    {(pdf||isWord)&&!visual&&readiness.extractionComplete&&<Feedback tone="warning">הטקסט נקרא; תוכן התמונות והתרשימים טרם נבדק חזותית.</Feedback>}
    {readingCurrent&&(!readiness.extractionComplete||(pdf||isWord)&&!visual)&&onCompleteReading&&<Button onClick={onCompleteReading} pending={completingReading} busyLabel="קורא את המקור…">השלמת קריאת המקור</Button>}
    {marker && <Feedback tone="warning" title={marker === 'DRAFT' ? 'טיוטה' : 'קטע מתוך מסמך'}>המקור מסומן כך במפורש ואינו הוראה מחייבת מאומתת. יש לבדוק את הגרסה המלאה ואת הקשר המסמך.</Feedback>}
    {previewError && <Feedback tone="warning">{previewError}</Feedback>}
    {previewUrl && (previewKind === 'pdf' || previewKind === 'text') && <iframe className="ti-source-frame" title="תצוגת מסמך מקור" src={previewUrl} />}
    {/* A source image is an original signed file; next/image cannot optimize private links. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {previewUrl && previewKind === 'image' && <img className="ti-source-image" src={previewUrl} alt={document.title || 'מסמך מקור'} />}
    {sourceReadError ? <Feedback tone="warning"><p>{sourceReadError}</p>{onRetryRead && <Button onClick={onRetryRead} pending={retryingRead}>ניסיון נוסף</Button>}</Feedback> : fullText ? <details className="ti-source-text" open={fullText.length <= 32000}><summary>הטקסט המלא שנשמר</summary><pre>{textChunks.map((text,index)=><span className="ti-source-text__chunk" dir="auto" key={index}>{text}</span>)}</pre></details> : visualOnlyRead?<Feedback tone="info">התוכן החזותי נקרא ונשמר בתיאורים להלן. לא נמצא טקסט מילולי לתצוגה.</Feedback>:<Feedback>אין עדיין טקסט שמור לתצוגה. אפשר לפתוח את קובץ המקור; פתיחה אינה מפעילה ניתוח.</Feedback>}
    {descriptions.length>0&&<section aria-label="תיאורי תרשימים ותוכן חזותי"><h4 className="ti-section-title">תיאורי תרשימים ותוכן חזותי</h4><p className="ti-meta">תיאור של מה שמופיע בתמונה; אינו ציטוט מילולי מהמסמך.</p>{descriptions.map((description,index)=><div key={index}><p className="ti-meta">{visualSourceLocationLabel(description.location||{})}</p><p className="ti-copy ti-preserve-lines" dir="auto">{description.text}</p></div>)}</section>}
    {transcripts.length>0&&<section aria-label="הטקסט שנקרא בתמונות"><h4 className="ti-section-title">הטקסט שנקרא בתמונות</h4>{transcripts.map(transcript=>{
      const unit=units.find(unit=>unit.id===transcript.unitId),locations=Array.isArray(unit?.locations)?unit.locations:[];
      return <details key={String(transcript.unitId)}><summary>{locations.map(location=>visualSourceLocationLabel(location)).join(', ')||'חלק במסמך'}</summary><pre className="ti-copy ti-preserve-lines" dir="auto">{String(transcript.text)}</pre></details>;
    })}</section>}
    {previewKind === 'unsupported' && <p className="ti-meta">לסוג הקובץ הזה אין תצוגה ישירה בדפדפן.</p>}
    <div className="ti-actions">{onPreview && <Button onClick={onPreview}>פתיחת המקור וסקירת הניתוח</Button>}{sourceUrl && <a className="ti-button ti-button--secondary" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />פתיחת קובץ המקור</a>}</div>
    {validationError && <Feedback tone="danger">{validationError}</Feedback>}
    {onValidate && <Button variant="primary" onClick={onValidate} pending={validating} busyLabel="שומר אישור…" disabled={!canValidate} disabledReason={validationDisabledReason}>אישור כמקור</Button>}
  </section>;
}
