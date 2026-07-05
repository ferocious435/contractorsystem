import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await request.json().catch(() => null);

        return NextResponse.json(
            {
                error: 'Legacy estimator is disabled. Use /api/pricing/evaluate-ai with projectId and contradictionId.',
            },
            { status: 410 }
        );

    } catch (error: unknown) {
        console.error('Error in AI Estimator:', error);
        const message = error instanceof Error ? error.message : 'Unknown AI Estimator error.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
