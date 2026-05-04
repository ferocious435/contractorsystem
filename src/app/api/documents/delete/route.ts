import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const documentId = searchParams.get('id');

        if (!documentId) {
            return NextResponse.json({ error: "Document ID is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Get document to find its file_url (to extract storage path)
        const { data: doc, error: fetchError } = await supabase
            .from('documents')
            .select('file_url')
            .eq('id', documentId)
            .single();

        if (fetchError) {
            console.error("Error fetching document:", fetchError);
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        // 2. Extract relative path from file_url for Storage deletion
        if (doc?.file_url) {
            try {
                // publicUrl format: https://.../storage/v1/object/public/documents/projectId/filename.pdf
                // We need: projectId/filename.pdf
                const urlParts = doc.file_url.split('/documents/');
                if (urlParts.length > 1) {
                    const storagePath = urlParts[1];
                    const { error: storageError } = await supabase.storage
                        .from('documents')
                        .remove([storagePath]);

                    if (storageError) {
                        console.error("Error deleting from storage:", storageError);
                        // Continue to delete from DB even if storage deletion fails
                    }
                }
            } catch (e) {
                console.error("Failed to parse storage url for deletion:", e);
            }
        }

        // 3. Delete from database
        console.log(`[delete] Attempting to delete doc ${documentId} from DB...`);
        const { error: dbError } = await supabase
            .from('documents')
            .delete()
            .eq('id', documentId);

        if (dbError) {
            console.error("[delete] Database error:", JSON.stringify(dbError, null, 2));
            return NextResponse.json({ 
                error: "Failed to delete from database",
                details: dbError.message,
                code: dbError.code 
            }, { status: 500 });
        }
        console.log(`[delete] Successfully deleted doc ${documentId}`);

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Delete document error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to delete document" },
            { status: 500 }
        );
    }
}
