export interface AiReadiness {
    available: boolean;
    provider: string;
    reason: 'AI_NOT_CONFIGURED'|'AI_UNAVAILABLE'|'AI_MODEL_MISSING'|'AI_LOGIN_REQUIRED'|'AI_PROFILE_REQUIRED'|'AI_ACTIONS_PREPARING'|'AI_ACCOUNT_CHANGED'|'AI_MODEL_UNAVAILABLE'|null;
}

/** A prepared connection does not enable branches which still use the previous implementation. */
export function getCodexReadiness(state:{authenticated:boolean;configured:boolean;kinds:readonly string[];reason?:string|null},action?:string):AiReadiness {
    if(!state.authenticated)return {available:false,provider:'Codex',reason:'AI_LOGIN_REQUIRED'};
    if(!state.configured)return {available:false,provider:'Codex',reason:state.reason==='AI_ACCOUNT_CHANGED'?'AI_ACCOUNT_CHANGED':state.reason==='AI_MODEL_UNAVAILABLE'?'AI_MODEL_UNAVAILABLE':'AI_PROFILE_REQUIRED'};
    if(action?!state.kinds.includes(action):state.kinds.length===0)return {available:false,provider:'Codex',reason:'AI_ACTIONS_PREPARING'};
    return {available:true,provider:'Codex',reason:null};
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

    return {
        available: false,
        provider: 'Local AI',
        reason: 'AI_NOT_CONFIGURED',
    };
}
