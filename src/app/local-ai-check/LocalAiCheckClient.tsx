'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Panel} from '@/components/ui/titanium/Panel';

export type PreviewResult = {
    success?: boolean;
    readOnly?: boolean;
    databaseChanged?: boolean;
    findingRef?: string;
    provider?: string;
    model?: string;
    projectId?: string;
    findingId?: string;
    correctionApplied?: boolean;
    reviewRecommendation?: {
        title: string;
        description: string;
        category: string;
        severity: string;
        strategyAdvice: string;
        verdict: string;
        comparisonType: string;
        missingEvidence: string[];
    } | null;
    coverage?: {
        contract?: { sourceChars?: number; chunks?: number; complete?: boolean };
        work?: { sourceChars?: number; chunks?: number; complete?: boolean };
        project?: {
            documents?: number;
            workChunks?: number;
            relatedDocuments?: Array<{ id: string; title: string }>;
            complete?: boolean;
        };
    };
    documents?: {
        contract?: { id?: string; title?: string | null };
        work?: { id?: string; title?: string | null };
    };
    verification?: Record<string, boolean>;
    sourceDiagnostics?: {
        contractReference?: string | null;
        contractReferenceExcerpt?: string | null;
        contractTermMatches?: Array<{ term: string; excerpt: string }>;
        workReference?: string | null;
        workReferenceExcerpt?: string | null;
    };
    localResult?: {
        contradiction_confirmed?: boolean;
        explanation?: string;
        confidence?: number;
    };
    error?: string;
};

function chunkLabel(value?: number) {
    const count = value || 0;
    const mod100 = count % 100;
    const mod10 = count % 10;
    const word = mod100 >= 11 && mod100 <= 14
        ? 'частей'
        : mod10 === 1
            ? 'часть'
            : mod10 >= 2 && mod10 <= 4
                ? 'части'
                : 'частей';
    return `${count} ${word}`;
}

export default function LocalAiCheckClient({ findingRef }: { findingRef: string }) {
    const [result, setResult] = useState<PreviewResult | null>(null);
    const [error, setError] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [extractionStatus, setExtractionStatus] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [reviewStatus, setReviewStatus] = useState('');
    const [isApplyingReview, setIsApplyingReview] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        void fetch(`/api/scan/preview?findingRef=${encodeURIComponent(findingRef)}`, {
            cache: 'no-store',
            signal: controller.signal,
        })
            .then(async (response) => {
                const body = await response.json() as PreviewResult;
                if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
                setResult(body);
            })
            .catch((caught: unknown) => {
                if (caught instanceof DOMException && caught.name === 'AbortError') return;
                setError(caught instanceof Error ? caught.message : 'Проверка не выполнена');
            });

        return () => controller.abort();
    }, [findingRef, refreshKey]);

    async function reextractContractText() {
        const projectId = result?.projectId;
        const documentId = result?.documents?.contract?.id;
        if (!projectId || !documentId) return;

        setIsExtracting(true);
        setExtractionStatus('Повторно извлекаю текст из PDF…');

        try {
            const response = await fetch('/api/documents/extract-text', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ projectId, documentId, force: true }),
            });
            const body = await response.json() as { error?: string; textLength?: number; pages?: number };
            if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);

            setExtractionStatus(`Текст обновлён: ${body.pages || 0} стр., ${body.textLength || 0} знаков. Проверяю заново…`);
            setResult(null);
            setError('');
            setRefreshKey((value) => value + 1);
        } catch (caught: unknown) {
            setExtractionStatus(caught instanceof Error ? `Ошибка: ${caught.message}` : 'Не удалось обновить текст');
        } finally {
            setIsExtracting(false);
        }
    }

    async function applyReviewedCorrection() {
        if (!result?.projectId || !result.findingId || !result.reviewRecommendation) return;

        setIsApplyingReview(true);
        setReviewStatus('Сохраняю уточнённую карточку…');

        try {
            const response = await fetch('/api/contradictions', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    projectId: result.projectId,
                    id: result.findingId,
                    review: result.reviewRecommendation,
                }),
            });
            const body = await response.json() as { success?: boolean; error?: string };
            if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);

            setReviewStatus('Карточка исправлена и сохранена.');
            setResult(null);
            setError('');
            setRefreshKey((value) => value + 1);
        } catch (caught: unknown) {
            setReviewStatus(caught instanceof Error ? `Ошибка: ${caught.message}` : 'Не удалось исправить карточку');
        } finally {
            setIsApplyingReview(false);
        }
    }

    return <LocalAiResultView findingRef={findingRef} result={result} error={error} isExtracting={isExtracting} extractionStatus={extractionStatus} isApplyingReview={isApplyingReview} reviewStatus={reviewStatus} onReextract={reextractContractText} onApplyCorrection={applyReviewedCorrection}/>;
}

interface LocalAiResultViewProps {findingRef:string;result:PreviewResult|null;error:string;isExtracting:boolean;extractionStatus:string;isApplyingReview:boolean;reviewStatus:string;onReextract():Promise<void>;onApplyCorrection():Promise<void>;}
const validChunkCount=(value?:number):boolean=>typeof value==='number'&&Number.isInteger(value)&&value>0;
function coverageText(value?:{complete?:boolean;chunks?:number}):string {if(value?.complete!==true)return value?.complete===false?'неполный':'не проверен';return validChunkCount(value.chunks)?'весь текст · '+chunkLabel(value.chunks):'полнота не подтверждена: число частей не передано';}
const verificationText=(value?:boolean):string=>value===true?'найдена в файле':value===false?'не найдена':'не проверено';
export function LocalAiResultView({findingRef,result,error,isExtracting,extractionStatus,isApplyingReview,reviewStatus,onReextract,onApplyCorrection}:LocalAiResultViewProps): React.JSX.Element {
 const busy=isExtracting||isApplyingReview;
 const sourcesConfirmed=result?.success===true&&result.verification?.contractQuoteMatched===true&&result.verification?.workQuoteMatched===true&&result.coverage?.contract?.complete===true&&validChunkCount(result.coverage.contract.chunks)&&result.coverage?.work?.complete===true&&validChunkCount(result.coverage.work.chunks)&&result.coverage?.project?.complete===true;
 const confidence=result?.localResult?.confidence;
 const details=result?[['Модель',(result.provider||'—')+' · '+(result.model||'—')],['Расхождение',result.localResult?.contradiction_confirmed===true?'подтверждено':result.localResult?.contradiction_confirmed===false?'не подтверждено':'не проверено'],['Уверенность',typeof confidence==='number'&&Number.isFinite(confidence)&&confidence>=0&&confidence<=1?Math.round(confidence*100)+'%':'—'],['Изменение базы',result.readOnly===true&&result.databaseChanged===false?'нет, только чтение':result.databaseChanged===true?'да, изменение отмечено':'требует проверки'],['Точная цитата договора',verificationText(result.verification?.contractQuoteMatched)],['Фрагмент договора',result.sourceDiagnostics?.contractReferenceExcerpt||result.sourceDiagnostics?.contractTermMatches?.length?'найден в PDF':result.sourceDiagnostics?'не найден':'не проверено'],['Цитата выполнения',verificationText(result.verification?.workQuoteMatched)],['Охват договора',coverageText(result.coverage?.contract)],['Охват выполнения',coverageText(result.coverage?.work)],['Контекст всего проекта',result.coverage?.project?.complete===true?(result.coverage.project.relatedDocuments?.length??0)+' связанных документов из '+(typeof result.coverage.project.documents==='number'?result.coverage.project.documents:'—')+' прочитанных':'не проверен']]:[];
 const excerpt=result?.sourceDiagnostics?.contractReferenceExcerpt||result?.sourceDiagnostics?.contractTermMatches?.[0]?.excerpt;
 return <main className="titanium-theme ti-page ti-service-shell" dir="ltr" lang="ru">
  <header className="ti-page-heading"><div><p className="ti-eyebrow">Локальная проверка · <BidiText kind="code" value={findingRef}/></p><h1 className="ti-title">Проверка расхождения</h1><p className="ti-subtitle">Результат чтения источников и отдельные действия с данными</p></div></header>
  {!result&&!error&&<Feedback>Модель читает подтверждённые фрагменты документов…</Feedback>}
  {error&&<Feedback tone="danger">Ошибка: {error}</Feedback>}
  {result&&<>
   <Feedback tone={sourcesConfirmed?'success':'warning'}>{sourcesConfirmed?'Цитаты и документы подтверждены.':'Нужна ручная проверка источников.'}</Feedback>
   <Panel><h2 className="ti-section-title">Результат и охват проверки</h2><dl className="ti-service-facts">{details.map(([label,value])=><div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl></Panel>
   {Boolean(result.coverage?.project?.relatedDocuments?.length)&&<Panel><details><summary>Какие связанные документы учтены</summary><ul className="ti-service-documents">{result.coverage?.project?.relatedDocuments?.map((document,index)=><li key={document.id+'-'+index} dir="auto">{document.title}</li>)}</ul></details></Panel>}
   {result.localResult?.explanation&&<Panel><h2 className="ti-section-title">Объяснение модели</h2><p className="ti-copy ti-preserve-lines" dir="auto">{result.localResult.explanation}</p></Panel>}
   {excerpt&&<Panel><h2 className="ti-section-title">{result.sourceDiagnostics?.contractReferenceExcerpt?'Фрагмент по пункту '+(result.sourceDiagnostics.contractReference||'—'):'Ближайший фрагмент по слову «'+(result.sourceDiagnostics?.contractTermMatches?.[0]?.term||'—')+'»'}</h2><blockquote className="ti-service-quote" dir="auto">{excerpt}</blockquote></Panel>}
   <Panel><h2 className="ti-section-title">Отдельные действия</h2><p className="ti-copy">Извлечение повторно читает PDF. Исправление карточки записывает изменение в базу только после нажатия соответствующей кнопки.</p>
    {result.projectId&&result.documents?.contract?.id&&<div className="ti-actions"><a className="ti-button ti-button--secondary" href={'/api/documents/file?projectId='+encodeURIComponent(result.projectId)+'&documentId='+encodeURIComponent(result.documents.contract.id)} target="_blank" rel="noreferrer">Открыть договорный PDF</a><Button disabled={busy} pending={isExtracting} busyLabel="Обновляю текст…" onClick={()=>void onReextract()}>Повторно извлечь текст из PDF</Button></div>}
    {extractionStatus&&<Feedback>{extractionStatus}</Feedback>}
    {result.correctionApplied&&<Feedback tone="success">Карточка уточнена по всей истории: основные материалы согласованы. Если подрядчику всё ещё нужны два поставщика, нужно передать разбивку по зонам и получить письменное решение.</Feedback>}
    {result.reviewRecommendation&&<Button variant="primary" disabled={busy} pending={isApplyingReview} busyLabel="Сохраняю…" onClick={()=>void onApplyCorrection()}>{'Исправить карточку '+findingRef}</Button>}
    {reviewStatus&&<Feedback>{reviewStatus}</Feedback>}
   </Panel>
  </>}
  <Link href="/" className="ti-button ti-button--text">Вернуться в программу</Link>
 </main>;
}
