import type { SupabaseClient } from "@supabase/supabase-js";

export type ContradictionArchiveRow = {
    id: string;
    evidence_data?: unknown | null;
};

type ArchiveMetadata = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeArchiveEvidenceData(existingEvidence: unknown, archiveMetadata: ArchiveMetadata) {
    const existing = isRecord(existingEvidence) ? existingEvidence : {};
    const existingHistory = Array.isArray(existing.archive_history)
        ? existing.archive_history.filter(isRecord)
        : [];
    const existingMeta = isRecord(existing.archive_meta) ? [existing.archive_meta] : [];
    const nextArchiveMeta = { ...archiveMetadata };

    return {
        ...existing,
        archive_meta: nextArchiveMeta,
        archive_history: [...existingHistory, ...existingMeta, nextArchiveMeta].slice(-10),
    };
}

export async function archiveContradictionRows(
    supabase: SupabaseClient,
    rows: ContradictionArchiveRow[],
    archiveMetadata: ArchiveMetadata
) {
    for (const row of rows) {
        const { error } = await supabase
            .from("contradictions")
            .update({
                status: "ARCHIVED",
                evidence_data: mergeArchiveEvidenceData(row.evidence_data, archiveMetadata),
            })
            .eq("id", row.id);

        if (error) {
            throw new Error(`Failed to archive contradiction ${row.id}: ${error.message}`);
        }
    }

    return rows.length;
}
