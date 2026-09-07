'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type PreviewResult = {
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

    return (
        <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
            <div className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
                <p className="text-sm text-cyan-400">Локальная проверка · {findingRef}</p>
                <h1 className="mt-2 text-2xl font-semibold">Проверка расхождения</h1>

                {!result && !error && (
                    <p className="mt-6 text-slate-300">Модель читает подтверждённые фрагменты документов…</p>
                )}

                {error && (
                    <p className="mt-6 rounded-lg border border-red-800 bg-red-950/50 p-4 text-red-200">
                        Ошибка: {error}
                    </p>
                )}

                {result && (
                    <div className="mt-6 space-y-4">
                        <p className={result.success ? 'text-emerald-400' : 'text-amber-300'}>
                            {result.success ? 'Цитаты и документы подтверждены.' : 'Нужна ручная проверка источников.'}
                        </p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                            <dt className="text-slate-400">Модель</dt>
                            <dd>{result.provider} · {result.model}</dd>
                            <dt className="text-slate-400">Расхождение</dt>
                            <dd>{result.localResult?.contradiction_confirmed ? 'подтверждено' : 'не подтверждено'}</dd>
                            <dt className="text-slate-400">Уверенность</dt>
                            <dd>{typeof result.localResult?.confidence === 'number' ? `${Math.round(result.localResult.confidence * 100)}%` : '—'}</dd>
                            <dt className="text-slate-400">Изменение базы</dt>
                            <dd>{result.readOnly && result.databaseChanged === false ? 'нет, только чтение' : 'требует проверки'}</dd>
                            <dt className="text-slate-400">Точная цитата договора</dt>
                            <dd>{result.verification?.contractQuoteMatched ? 'найдена в файле' : 'не найдена'}</dd>
                            <dt className="text-slate-400">Фрагмент договора</dt>
                            <dd>{result.sourceDiagnostics?.contractReferenceExcerpt || result.sourceDiagnostics?.contractTermMatches?.length ? 'найден в PDF' : 'не найден'}</dd>
                            <dt className="text-slate-400">Цитата выполнения</dt>
                            <dd>{result.verification?.workQuoteMatched ? 'найдена в файле' : 'не найдена'}</dd>
                            <dt className="text-slate-400">Охват договора</dt>
                            <dd>{result.coverage?.contract?.complete ? `весь текст · ${chunkLabel(result.coverage.contract.chunks)}` : 'неполный'}</dd>
                            <dt className="text-slate-400">Охват выполнения</dt>
                            <dd>{result.coverage?.work?.complete ? `весь текст · ${chunkLabel(result.coverage.work.chunks)}` : 'неполный'}</dd>
                            <dt className="text-slate-400">Контекст всего проекта</dt>
                            <dd>{result.coverage?.project?.complete
                                ? `${result.coverage.project.relatedDocuments?.length || 0} связанных документов из ${result.coverage.project.documents || 0} прочитанных`
                                : 'не проверен'}</dd>
                        </dl>
                        {Boolean(result.coverage?.project?.relatedDocuments?.length) && (
                            <details className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm">
                                <summary className="cursor-pointer text-slate-300">Какие связанные документы учтены</summary>
                                <ul className="mt-3 space-y-2 text-slate-400">
                                    {result.coverage?.project?.relatedDocuments?.map((document) => (
                                        <li key={document.id} dir="auto">{document.title}</li>
                                    ))}
                                </ul>
                            </details>
                        )}
                        {result.localResult?.explanation && (
                            <p dir="auto" className="rounded-lg bg-slate-950 p-4 text-right text-slate-200">
                                {result.localResult.explanation}
                            </p>
                        )}
                        {result.sourceDiagnostics?.contractReferenceExcerpt && (
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                                <p className="mb-2 text-sm text-slate-400">
                                    Фрагмент по пункту {result.sourceDiagnostics.contractReference}
                                </p>
                                <p dir="rtl" className="text-right text-sm text-slate-200">
                                    {result.sourceDiagnostics.contractReferenceExcerpt}
                                </p>
                            </div>
                        )}
                        {!result.sourceDiagnostics?.contractReferenceExcerpt && Boolean(result.sourceDiagnostics?.contractTermMatches?.length) && (
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                                <p className="mb-2 text-sm text-slate-400">
                                    Ближайший фрагмент по слову «{result.sourceDiagnostics?.contractTermMatches?.[0]?.term}»
                                </p>
                                <p dir="rtl" className="text-right text-sm text-slate-200">
                                    {result.sourceDiagnostics?.contractTermMatches?.[0]?.excerpt}
                                </p>
                            </div>
                        )}
                        {result.projectId && result.documents?.contract?.id && (
                            <div className="flex flex-wrap items-center gap-4">
                                <a
                                    href={`/api/documents/file?projectId=${encodeURIComponent(result.projectId)}&documentId=${encodeURIComponent(result.documents.contract.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-block text-sm text-cyan-400 hover:text-cyan-300"
                                >
                                    Открыть договорный PDF
                                </a>
                                <button
                                    type="button"
                                    onClick={reextractContractText}
                                    disabled={isExtracting}
                                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                                >
                                    {isExtracting ? 'Обновляю текст…' : 'Повторно извлечь текст из PDF'}
                                </button>
                            </div>
                        )}
                        {extractionStatus && <p className="text-sm text-slate-300">{extractionStatus}</p>}
                        {result.correctionApplied && (
                            <p className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
                                Карточка уточнена по всей истории: основные материалы согласованы. Если подрядчику всё ещё нужны два поставщика, нужно передать разбивку по зонам и получить письменное решение.
                            </p>
                        )}
                        {result.reviewRecommendation && (
                            <button
                                type="button"
                                onClick={applyReviewedCorrection}
                                disabled={isApplyingReview}
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                            >
                                {isApplyingReview ? 'Сохраняю…' : 'Исправить карточку C-CE6070'}
                            </button>
                        )}
                        {reviewStatus && <p className="text-sm text-slate-300">{reviewStatus}</p>}
                    </div>
                )}

                <Link href="/" className="mt-8 inline-block text-sm text-cyan-400 hover:text-cyan-300">
                    Вернуться в программу
                </Link>
            </div>
        </main>
    );
}
