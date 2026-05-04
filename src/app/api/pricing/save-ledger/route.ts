import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { VAT_RATE } from '@/utils/constants';

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

        const {
            queue_id,
            contradiction_id,
            project_id,
            item_name,
            ai_estimated_amount,
            user_final_amount,
            ai_explanation,
            user_notes,
            source = 'CUSTOM_ANALYSIS',
            type = 'PENDING_VO',
            vat_rate = VAT_RATE, // Using global constant
        } = data;

        // Determine correct ID to use (queue_id is legacy, contradiction_id is preferred in AIEstimatorModal)
        const activeContradictionId = contradiction_id || queue_id;

        // Start by saving to ledger
        const { data: newLedgerItem, error: insertError } = await supabase
            .from('pricing_ledger')
            .insert({
                project_id,
                contradiction_id: activeContradictionId,
                type,
                source: source,
                description: item_name || user_notes || ai_explanation,
                quantity: 1,
                unit_price_excl_vat: user_final_amount || ai_estimated_amount || 0,
                vat_rate
            })
            .select(`
                *,
                projects ( id, name )
            `)
            .single();

        if (insertError) throw insertError;

        // Update the queue status in contradictions
        const { error: updateError } = await supabase
            .from('contradictions')
            .update({ pricing_status: 'PRICED' })
            .eq('id', activeContradictionId);

        if (updateError) throw updateError;

        return NextResponse.json(newLedgerItem);
    } catch (error: any) {
        console.error('Error saving ledger:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
