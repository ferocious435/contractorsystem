import type { SupabaseClient } from "@supabase/supabase-js";

import { getDocumentStorageBucket, getDocumentStoragePath } from "@/utils/document-storage";
import type { PreferredPdfDuplicate } from "@/utils/document-duplicates";

type LinkedFinding = {
    id: string;
    status?: string | null;
    scan_signature?: string | null;
};

export type DuplicateCleanupResult = {
    removedDocuments: number;
    removedAutomaticFindings: number;
    preservedUserFindings: number;
    storageWarnings: string[];
};

const USER_CONTROLLED_FINDING_STATUSES = new Set(["IGNORED", "MOVED_TO_PRICING"]);

export async function removePreferredPdfDuplicates(
    supabase: SupabaseClient,
    projectId: string,
    matches: PreferredPdfDuplicate[],
): Promise<DuplicateCleanupResult> {
    const result: DuplicateCleanupResult = {
        removedDocuments: 0,
        removedAutomaticFindings: 0,
        preservedUserFindings: 0,
        storageWarnings: [],
    };

    for (const match of matches) {
        const duplicateId = match.duplicate.id;
        const canonicalId = match.canonical.id;
        const { data: currentDocuments, error: documentCheckError } = await supabase
            .from("documents")
            .select("id")
            .eq("project_id", projectId)
            .in("id", [duplicateId, canonicalId]);
        if (documentCheckError) throw documentCheckError;
        if ((currentDocuments || []).length !== 2) continue;

        const { data: linkedFindings, error: linkedFindingsError } = await supabase
            .from("contradictions")
            .select("id, status, scan_signature")
            .eq("project_id", projectId)
            .eq("source_execution_doc_id", duplicateId);
        if (linkedFindingsError) throw linkedFindingsError;

        const findings = (linkedFindings || []) as LinkedFinding[];
        const findingsToPreserve = findings.filter((finding) => (
            !finding.scan_signature || USER_CONTROLLED_FINDING_STATUSES.has(String(finding.status || ""))
        ));
        const automaticFindingIds = findings
            .filter((finding) => !findingsToPreserve.some((preserved) => preserved.id === finding.id))
            .map((finding) => finding.id);

        if (findingsToPreserve.length > 0) {
            const { error: preserveError } = await supabase
                .from("contradictions")
                .update({ source_execution_doc_id: canonicalId, scan_signature: null })
                .in("id", findingsToPreserve.map((finding) => finding.id));
            if (preserveError) throw preserveError;
            result.preservedUserFindings += findingsToPreserve.length;
        }

        if (automaticFindingIds.length > 0) {
            const { error: deleteFindingsError } = await supabase
                .from("contradictions")
                .delete()
                .in("id", automaticFindingIds);
            if (deleteFindingsError) throw deleteFindingsError;
            result.removedAutomaticFindings += automaticFindingIds.length;
        }

        const { error: stateDeleteError } = await supabase
            .from("document_scan_state")
            .delete()
            .eq("project_id", projectId)
            .eq("work_doc_id", duplicateId);
        if (stateDeleteError) throw stateDeleteError;

        const { error: documentDeleteError } = await supabase
            .from("documents")
            .delete()
            .eq("project_id", projectId)
            .eq("id", duplicateId);
        if (documentDeleteError) throw documentDeleteError;

        result.removedDocuments += 1;

        const storagePath = getDocumentStoragePath(match.duplicate);
        if (storagePath) {
            const { error: storageError } = await supabase.storage
                .from(getDocumentStorageBucket(match.duplicate))
                .remove([storagePath]);
            if (storageError) {
                result.storageWarnings.push(`${match.duplicate.title || duplicateId}: ${storageError.message}`);
            }
        }
    }

    return result;
}
