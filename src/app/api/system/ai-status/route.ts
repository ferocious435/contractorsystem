import { NextResponse } from 'next/server';
import { getAiReadiness } from '@/utils/ai-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json(getAiReadiness(process.env));
}
