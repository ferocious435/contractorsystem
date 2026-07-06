import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function requirePricingEvaluationProjectAccess(supabase: SupabaseClient, projectId: string) {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return {
            ok: false as const,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('contractor_id', user.id)
        .maybeSingle();

    if (projectError) throw projectError;

    if (!project) {
        return {
            ok: false as const,
            response: NextResponse.json({ error: 'Project not found or forbidden' }, { status: 403 }),
        };
    }

    return {
        ok: true as const,
        user,
        project,
    };
}
