export interface AiReadiness {
    available: boolean;
    provider: 'Gemini 3.5 Flash';
    reason: 'AI_NOT_CONFIGURED' | null;
}

export function getAiReadiness(environment: Record<string, string | undefined>): AiReadiness {
    const configured = Boolean(environment.GEMINI_API_KEY?.trim());

    return {
        available: configured,
        provider: 'Gemini 3.5 Flash',
        reason: configured ? null : 'AI_NOT_CONFIGURED',
    };
}
