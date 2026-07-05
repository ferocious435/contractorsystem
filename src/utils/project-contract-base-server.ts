import { resolveProjectContractBase } from "@/utils/project-contract-base";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function syncProjectContractBase(
    supabase: SupabaseClient,
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
