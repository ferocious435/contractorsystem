import { generateOllamaText, type OllamaGenerationTuning } from '@/lib/ollama';
import { getConfiguredOllamaModel, isOllamaProvider } from '@/utils/ai-readiness';

type Environment = Record<string, string | undefined>;

export function getComparisonAiIdentity(environment: Environment = process.env) {
    if (isOllamaProvider(environment)) {
        return {
            kind: 'ollama' as const,
            provider: 'Local AI',
            model: getConfiguredOllamaModel(environment),
        };
    }

    return {
        kind: 'unavailable' as const,
        provider: 'Local AI',
        model: getConfiguredOllamaModel(environment),
    };
}

export async function generateComparisonText(
    prompt: string,
    environment: Environment = process.env,
    tuning: OllamaGenerationTuning = {}
) {
    if (isOllamaProvider(environment)) {
        return generateOllamaText(prompt, { environment, ...tuning });
    }

    throw Object.assign(new Error('Локальное сравнение сейчас не настроено.'), {code:'AI_NOT_CONFIGURED'});
}
