'use client';
import {useEffect, useState} from 'react';

export interface ClientAiReadiness {available: boolean; provider: string; reason: string | null;}
export const AI_READINESS_REFRESH_EVENT = 'contractor:ai-readiness-refresh';
const unavailable = (): ClientAiReadiness => ({available: false, provider: 'Local AI', reason: 'STATUS_UNAVAILABLE'});
export async function fetchAiReadiness(fetchImpl: typeof fetch = fetch): Promise<ClientAiReadiness> {
    try {
        const response = await fetchImpl('/api/system/ai-status', {cache: 'no-store', signal: AbortSignal.timeout(8000)});
        if (!response.ok) return unavailable();
        const status: unknown = await response.json();
        if (!status || typeof status !== 'object') return unavailable();
        const value = status as Record<string, unknown>;
        if (typeof value.available !== 'boolean' || typeof value.provider !== 'string' || !/^Local AI(?: · |$)/.test(value.provider)
            || (value.available ? value.reason !== null : !['AI_UNAVAILABLE', 'AI_MODEL_MISSING', 'STATUS_UNAVAILABLE'].includes(String(value.reason)))) return unavailable();
        return {available: value.available, provider: value.provider, reason: value.reason as string | null};
    } catch {return unavailable();}
}
export function refreshAiReadiness(target: EventTarget | undefined = typeof window === 'undefined' ? undefined : window): void {
    target?.dispatchEvent(new Event(AI_READINESS_REFRESH_EVENT));
}
export function observeAiReadiness(onStatus: (status: ClientAiReadiness) => void,
    {target = typeof window === 'undefined' ? undefined : window, fetchImpl = fetch}: {target?: EventTarget; fetchImpl?: typeof fetch} = {}): () => void {
    let active = true, request = 0;
    const refresh = () => {const token = ++request; void fetchAiReadiness(fetchImpl).then(status => {if (active && token === request) onStatus(status);});};
    target?.addEventListener('focus', refresh); target?.addEventListener(AI_READINESS_REFRESH_EVENT, refresh); refresh();
    return () => {active = false; ++request; target?.removeEventListener('focus', refresh); target?.removeEventListener(AI_READINESS_REFRESH_EVENT, refresh);};
}
export function useAiReadiness() {
    const [status, setStatus] = useState<ClientAiReadiness | null>(null);
    useEffect(() => observeAiReadiness(setStatus), []);
    return status;
}
