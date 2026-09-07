type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export interface OllamaRuntimeState {
    reachable: boolean;
    modelInstalled: boolean;
}

interface OllamaOptions {
    environment?: Environment;
    fetchImpl?: FetchLike;
}

export interface OllamaGenerationTuning {
    numCtx?: number;
    numPredict?: number;
    timeoutMs?: number;
}

function getConfiguredOllamaModel(environment: Environment) {
    return environment.OLLAMA_MODEL?.trim() || 'qwen3:4b';
}

function getOllamaBaseUrl(environment: Environment) {
    const configuredUrl = environment.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
    const url = new URL(configuredUrl);
    const hostname = url.hostname.toLowerCase();
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

    if (url.protocol !== 'http:' || !isLoopback) {
        throw new Error('Ollama URL must use the local loopback interface');
    }

    return url.origin;
}

export async function checkOllamaRuntime(options: OllamaOptions = {}): Promise<OllamaRuntimeState> {
    const environment = options.environment || process.env;
    const fetchImpl = options.fetchImpl || fetch;
    const model = getConfiguredOllamaModel(environment);

    try {
        const response = await fetchImpl(`${getOllamaBaseUrl(environment)}/api/tags`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5_000),
        });

        if (!response.ok) {
            return { reachable: false, modelInstalled: false };
        }

        const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
        const modelInstalled = (body.models || []).some((item) => item.name === model || item.model === model);
        return { reachable: true, modelInstalled };
    } catch {
        return { reachable: false, modelInstalled: false };
    }
}

export async function generateOllamaText(
    prompt: string,
    options: OllamaOptions & OllamaGenerationTuning = {}
) {
    const environment = options.environment || process.env;
    const fetchImpl = options.fetchImpl || fetch;
    const model = getConfiguredOllamaModel(environment);
    const response = await fetchImpl(`${getOllamaBaseUrl(environment)}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model,
            prompt,
            stream: false,
            format: 'json',
            think: false,
            keep_alive: '10m',
            options: {
                temperature: 0.1,
                num_ctx: options.numCtx ?? 8_192,
                num_predict: options.numPredict ?? 768,
            },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Local AI request failed (${response.status}): ${errorBody.slice(0, 500)}`);
    }

    const body = await response.json() as { response?: unknown };
    if (typeof body.response !== 'string' || !body.response.trim()) {
        throw new Error('Local AI returned an empty response');
    }

    return body.response;
}
