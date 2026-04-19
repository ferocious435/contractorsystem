import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function PUT(req: Request) {
    try {
        const supabase = await createClient();

        // Ensure user is authenticated
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { documentId, validatedData } = await req.json();

        if (!documentId || !validatedData) {
            return NextResponse.json({ error: "documentId and validatedData are required" }, { status: 400 });
        }

        // Update status to VALIDATED and save the confirmed JSON
        const { error: updateError } = await supabase
            .from('documents')
            .update({
                ai_status: 'VALIDATED',
                parsed_json: validatedData
            })
            .eq('id', documentId);

        if (updateError) throw updateError;

        return NextResponse.json({
            success: true,
            message: "Document validated successfully"
        });

    } catch (error: any) {
        console.error("Error validating document:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
