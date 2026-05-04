import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { 
            projectId, 
            subject, 
            recipientName, 
            docType, 
            content, 
            totalExclVat, 
            vatAmount, 
            totalInclVat,
            itemIds 
        } = await req.json();

        // 1. Create the VO Letter
        const { data: letter, error: letterError } = await supabase
            .from('vo_letters')
            .insert({
                project_id: projectId,
                subject,
                recipient_name: recipientName,
                status: 'SENT',
                content,
                total_amount_excl_vat: totalExclVat,
                vat_amount: vatAmount,
                total_amount_incl_vat: totalInclVat,
                letter_number: `VO-${Math.floor(Date.now() / 1000)}`
            })
            .select()
            .single();

        if (letterError) throw letterError;

        // 2. Link items to the letter
        const letterItems = itemIds.map((id: string, index: number) => ({
            letter_id: letter.id,
            ledger_item_id: id,
            sort_order: index
        }));

        const { error: itemsError } = await supabase
            .from('vo_letter_items')
            .insert(letterItems);

        if (itemsError) throw itemsError;

        // 3. Update status in pricing_ledger
        const { error: ledgerError } = await supabase
            .from('pricing_ledger')
            .update({ type: 'SENT_VO' })
            .in('id', itemIds);

        if (ledgerError) throw ledgerError;

        return NextResponse.json({ success: true, letterId: letter.id });
    } catch (error: any) {
        console.error("VO Letter Save Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
