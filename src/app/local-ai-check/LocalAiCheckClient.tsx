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

export default function LocalAiCheckClient({ findingRef }: { findingRef: string }) {
    const [result, setResult] = useState<PreviewResult | null>(null);
    const [error, setError] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [extractionStatus, setExtractionStatus] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);

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
                        </dl>
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
                    </div>
                )}

                <Link href="/" className="mt-8 inline-block text-sm text-cyan-400 hover:text-cyan-300">
                    Вернуться в программу
                </Link>
            </div>
        </main>
    );
}
