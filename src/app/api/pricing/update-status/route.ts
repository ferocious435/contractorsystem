import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

const ALLOWED_STATUS_UPDATES = new Set(['PENDING_VO', 'APPROVED_VO', 'SENT_VO']);

export async function POST(req: Request) {
    try {
        const { itemId, status } = await req.json();

        if (!itemId || !status) {
            return NextResponse.json({ success: false, error: "Missing itemId or status" }, { status: 400 });
        }

        if (!ALLOWED_STATUS_UPDATES.has(status)) {
            return NextResponse.json({ success: false, error: "Unsupported status update" }, { status: 400 });
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const { data: ledgerItem, error: lookupError } = await supabase
            .from('pricing_ledger')
            .select('id, type, project_id, projects!inner(contractor_id)')
            .eq('id', itemId)
            .eq('projects.contractor_id', user.id)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (!ledgerItem) {
            return NextResponse.json({ success: false, error: "Ledger item not found or forbidden" }, { status: 404 });
        }

        if (ledgerItem.type === 'BASE_CONTRACT') {
            return NextResponse.json({ success: false, error: "Base contract rows are read-only" }, { status: 400 });
        }

        const { data: updatedItems, error } = await supabase
            .from('pricing_ledger')
            .update({ type: status })
            .eq('id', itemId)
            .eq('project_id', ledgerItem.project_id)
            .neq('type', 'BASE_CONTRACT')
            .select('id');

        if (error) throw error;

        if (!updatedItems?.length) {
            return NextResponse.json({ success: false, error: "Ledger item was not updated" }, { status: 409 });
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error("Status Update Error:", error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
