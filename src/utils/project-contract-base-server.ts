import { resolveProjectContractBase } from "@/utils/project-contract-base";

interface SupabaseLikeClient {
    from: (table: string) => {
        select: (columns: string) => {
            eq: (column: string, value: string) => Promise<{ data: any[] | null; error: any }>;
        };
        update: (values: Record<string, unknown>) => {
            eq: (column: string, value: string) => Promise<{ error: any }>;
        };
    };
}

export async function syncProjectContractBase(
    supabase: SupabaseLikeClient,
    projectId: string
) {
    const { data: documents, error: documentsError } = await supabase
        .from("documents")
        .select("title, extracted_text, parsed_json")
        .eq("project_id", projectId);

    if (documentsError) {
        throw documentsError;
    }

    const resolution = resolveProjectContractBase(documents || []);

    if ((resolution.amount || 0) > 0) {
        const { error: updateError } = await supabase
            .from("projects")
            .update({ budget: resolution.amount })
            .eq("id", projectId);

        if (updateError) {
            throw updateError;
        }
    }

    return resolution;
}
