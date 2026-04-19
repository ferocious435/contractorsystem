import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        const { error } = await supabase
            .from('contradictions')
            .delete()
            .eq('project_id', projectId);

        if (error) {
            console.error("Error clearing contradictions:", error);
            return NextResponse.json({ error: "Failed to clear contradictions" }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "Contradictions cleared successfully" });

    } catch (error: any) {
        console.error("Clear contradictions error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to clear contradictions" },
            { status: 500 }
        );
    }
}
