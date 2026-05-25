import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { VAT_RATE } from '@/utils/constants';

const ALLOWED_SOURCES = new Set(['BOQ', 'DEKEL', 'CONTRACTOR', 'CUSTOM_ANALYSIS']);
const ALLOWED_TYPES = new Set(['BASE_CONTRACT', 'APPROVED_VO', 'PENDING_VO', 'SENT_VO']);

function toNumber(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}

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
            item_code,
            description,
            unit,
            quantity,
            unit_price_excl_vat,
            markup_percentage,
            ai_rationale,
            governing_notes,
            expert_strategy,
            source = 'CUSTOM_ANALYSIS',
            type = 'PENDING_VO',
            vat_rate = VAT_RATE, // Using global constant
        } = data;

        if (!project_id) {
            return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
        }

        // Determine correct ID to use (queue_id is legacy, contradiction_id is preferred in AIEstimatorModal)
        const activeContradictionId = contradiction_id || queue_id;
        const safeSource = ALLOWED_SOURCES.has(source) ? source : 'CUSTOM_ANALYSIS';
        const safeType = ALLOWED_TYPES.has(type) ? type : 'PENDING_VO';
        const safeQuantity = toNumber(quantity, 1);
        const legacyAmount = user_final_amount ?? ai_estimated_amount;
        const safeUnitPrice = roundMoney(toNumber(unit_price_excl_vat ?? legacyAmount, 0));
        const safeVatRate = toNumber(vat_rate, VAT_RATE) === VAT_RATE ? VAT_RATE : VAT_RATE;
        const rationale = ai_rationale || ai_explanation || '';
        const notes = governing_notes || (user_notes ? [user_notes] : []);

        // Start by saving to ledger
        const { data: newLedgerItem, error: insertError } = await supabase
            .from('pricing_ledger')
            .insert({
                project_id,
                contradiction_id: activeContradictionId,
                type: safeType,
                source: safeSource,
                item_code: item_code || null,
                description: description || item_name || user_notes || ai_explanation || 'פריט תמחור ללא תיאור',
                unit: unit || 'יח',
                quantity: safeQuantity,
                unit_price_excl_vat: safeUnitPrice,
                markup_percentage: toNumber(markup_percentage, 0),
                ai_rationale: rationale,
                governing_notes: notes,
                expert_strategy,
                vat_rate: safeVatRate
            })
            .select(`
                *,
                projects ( id, name )
            `)
            .single();

        if (insertError) throw insertError;

        // Update the queue status in contradictions
        let updateError = null;
        if (activeContradictionId) {
            const result = await supabase
                .from('contradictions')
                .update({ pricing_status: 'PRICED', status: 'MOVED_TO_PRICING' })
                .eq('id', activeContradictionId);
            updateError = result.error;
        }

        if (updateError) throw updateError;

        return NextResponse.json({ success: true, item: newLedgerItem });
    } catch (error: unknown) {
        console.error('Error saving ledger:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
