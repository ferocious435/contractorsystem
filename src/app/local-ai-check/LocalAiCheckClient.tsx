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
    verification?: Record<string, boolean>;
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
    }, [findingRef]);

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
                            <dt className="text-slate-400">Цитата договора</dt>
                            <dd>{result.verification?.contractQuoteMatched ? 'найдена в файле' : 'не найдена'}</dd>
                            <dt className="text-slate-400">Цитата выполнения</dt>
                            <dd>{result.verification?.workQuoteMatched ? 'найдена в файле' : 'не найдена'}</dd>
                        </dl>
                        {result.localResult?.explanation && (
                            <p dir="rtl" className="rounded-lg bg-slate-950 p-4 text-right text-slate-200">
                                {result.localResult.explanation}
                            </p>
                        )}
                    </div>
                )}

                <Link href="/" className="mt-8 inline-block text-sm text-cyan-400 hover:text-cyan-300">
                    Вернуться в программу
                </Link>
            </div>
        </main>
    );
}
