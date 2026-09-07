import { NextResponse } from 'next/server';
import { getAiReadiness } from '@/utils/ai-readiness';
import { checkOllamaRuntime } from '@/lib/ollama';
import { isOllamaProvider } from '@/utils/ai-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
    const localRuntime = isOllamaProvider(process.env)
        ? await checkOllamaRuntime()
        : undefined;

    return NextResponse.json(getAiReadiness(process.env, localRuntime));
}
