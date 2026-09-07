'use client';

import { useEffect, useState } from 'react';

export interface ClientAiReadiness {
    available: boolean;
    provider: string;
    reason: string | null;
}

export function useAiReadiness() {
    const [status, setStatus] = useState<ClientAiReadiness | null>(null);

    useEffect(() => {
        let cancelled = false;

        fetch('/api/system/ai-status', { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error('AI status unavailable');
                return response.json() as Promise<ClientAiReadiness>;
            })
            .then((nextStatus) => {
                if (!cancelled) setStatus(nextStatus);
            })
            .catch(() => {
                if (!cancelled) {
                    setStatus({ available: false, provider: 'Gemini 3.5 Flash', reason: 'STATUS_UNAVAILABLE' });
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return status;
}
