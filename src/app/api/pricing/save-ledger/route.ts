import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
    deleteLedgerItem,
    saveLedgerItem,
} from './save-ledger-service';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const data = await req.json();

        // Ensure we have a user
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const result = await saveLedgerItem(supabase, user.id, data);

        return NextResponse.json(result.body, { status: result.status });
    } catch (error: unknown) {
        console.error('Error saving ledger:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const supabase = await createClient();
        const data = await req.json();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const result = await deleteLedgerItem(supabase, user.id, data);

        return NextResponse.json(result.body, { status: result.status });
    } catch (error: unknown) {
        console.error('Error deleting ledger:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
