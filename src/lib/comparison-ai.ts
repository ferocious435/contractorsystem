import { geminiModel, withRetry } from '@/lib/gemini';
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
        kind: 'gemini' as const,
        provider: 'Gemini',
        model: 'gemini-3.5-flash',
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

    const result = await withRetry(() => geminiModel.generateContent(prompt));
    return result.response.text();
}
