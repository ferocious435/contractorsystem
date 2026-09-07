export interface AiReadiness {
    available: boolean;
    provider: string;
    reason: 'AI_NOT_CONFIGURED' | 'AI_UNAVAILABLE' | 'AI_MODEL_MISSING' | null;
}

export interface LocalAiRuntimeState {
    reachable: boolean;
    modelInstalled: boolean;
}

export function isOllamaProvider(environment: Record<string, string | undefined>) {
    return environment.AI_PROVIDER?.trim().toLowerCase() === 'ollama';
}

export function getConfiguredOllamaModel(environment: Record<string, string | undefined>) {
    return environment.OLLAMA_MODEL?.trim() || 'qwen3:4b';
}

export function getAiReadiness(
    environment: Record<string, string | undefined>,
    localRuntime?: LocalAiRuntimeState
): AiReadiness {
    if (isOllamaProvider(environment)) {
        const model = getConfiguredOllamaModel(environment);
        const provider = `Local AI · ${model}`;

        if (!localRuntime?.reachable) {
            return { available: false, provider, reason: 'AI_UNAVAILABLE' };
        }

        if (!localRuntime.modelInstalled) {
            return { available: false, provider, reason: 'AI_MODEL_MISSING' };
        }

        return { available: true, provider, reason: null };
    }

    const configured = Boolean(environment.GEMINI_API_KEY?.trim());

    return {
        available: configured,
        provider: 'Gemini 3.5 Flash',
        reason: configured ? null : 'AI_NOT_CONFIGURED',
    };
}
