import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { itemId, status } = await req.json();

        if (!itemId || !status) {
            return NextResponse.json({ success: false, error: "Missing itemId or status" }, { status: 400 });
        }

        const supabase = await createClient();

        const { error } = await supabase
            .from('pricing_ledger')
            .update({ type: status })
            .eq('id', itemId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error("Status Update Error:", error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
