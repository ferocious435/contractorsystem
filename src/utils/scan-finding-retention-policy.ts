export type ReplaceableScanFinding = {
    id: string;
    evidence_data?: unknown | null;
    scan_signature?: string | null;
    pricing_status?: string | null;
    status?: string | null;
};

export type RepeatableScanFinding = ReplaceableScanFinding & {
    title?: string | null;
    category?: string | null;
    source_execution_doc_id?: string | null;
    target_contract_doc_id?: string | null;
    created_at?: string | null;
};

export type RepeatableDocument = {
    id: string;
    title?: string | null;
};

export type RepeatedFindingHistoryEntry = {
    finding_id: string;
    source_document_id: string;
    source_document_title: string;
    document_date: string | null;
    title: string | null;
    category: string | null;
    work_quote: string;
};

export type RepeatedFindingConsolidation = {
    keepId: string;
    deleteIds: string[];
    repeatedHistory: RepeatedFindingHistoryEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function findingNeedsHistory(row: ReplaceableScanFinding) {
    const evidence = isRecord(row.evidence_data) ? row.evidence_data : {};
    return Boolean(
        evidence.manual_review
        || evidence.user_review
        || evidence.approved_by_user
        || row.pricing_status === 'PRICED'
        || row.status === 'MOVED_TO_PRICING'
    );
}

// A previous human review is not proof of correctness. Financial work needs a separate review.
export function canRemoveUnsupportedAutomaticFinding(row: ReplaceableScanFinding) {
    return Boolean(row.scan_signature)
        && row.pricing_status !== 'PRICED'
        && row.status !== 'MOVED_TO_PRICING';
}

export function isObsoleteAutomaticArchiveRow(row: ReplaceableScanFinding) {
    if (row.status !== 'ARCHIVED' || !row.scan_signature || findingNeedsHistory(row)) return false;
    const evidence = isRecord(row.evidence_data) ? row.evidence_data : {};
    const metadata = isRecord(evidence.archive_meta) ? evidence.archive_meta : {};
    return metadata.archive_reason === 'A complete replacement scan finished successfully for this work document.'
        && typeof metadata.current_scan_signature === 'string'
        && metadata.current_scan_signature.length > 0;
}

function normalizedRepeatedQuote(value: unknown) {
    if (typeof value !== 'string') return '';
    return value
        .normalize('NFKC')
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function documentDateFromTitle(title: string) {
    const match = title.match(/(?:^|\D)(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})(?:\D|$)/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const rawYear = Number(match[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) return null;

    return date.toISOString().slice(0, 10);
}

function findingSortTime(entry: RepeatedFindingHistoryEntry, finding: RepeatableScanFinding) {
    const documentTime = entry.document_date ? Date.parse(`${entry.document_date}T00:00:00.000Z`) : Number.NaN;
    if (Number.isFinite(documentTime)) return documentTime;
    const createdTime = finding.created_at ? Date.parse(finding.created_at) : Number.NaN;
    return Number.isFinite(createdTime) ? createdTime : 0;
}

export function planRepeatedFindingConsolidation(params: {
    findings: RepeatableScanFinding[];
    documents: RepeatableDocument[];
}): RepeatedFindingConsolidation[] {
    const documentsById = new Map(params.documents.map((document) => [document.id, document]));
    const groups = new Map<string, Array<{
        finding: RepeatableScanFinding;
        history: RepeatedFindingHistoryEntry;
        priorHistory: RepeatedFindingHistoryEntry[];
        sortTime: number;
    }>>();

    for (const finding of params.findings) {
        if (!finding.scan_signature || findingNeedsHistory(finding)) continue;
        const evidence = isRecord(finding.evidence_data) ? finding.evidence_data : {};
        const workQuote = normalizedRepeatedQuote(evidence.work_quote);
        if (workQuote.length < 40) continue;

        const sourceDocumentId = String(finding.source_execution_doc_id || '');
        const sourceDocument = documentsById.get(sourceDocumentId);
        if (!sourceDocument) continue;
        const sourceDocumentTitle = String(sourceDocument.title || '');
        const history: RepeatedFindingHistoryEntry = {
            finding_id: finding.id,
            source_document_id: sourceDocumentId,
            source_document_title: sourceDocumentTitle,
            document_date: documentDateFromTitle(sourceDocumentTitle),
            title: finding.title ?? null,
            category: finding.category ?? null,
            work_quote: workQuote,
        };
        const priorHistory = Array.isArray(evidence.repeated_history)
            ? evidence.repeated_history.flatMap((value): RepeatedFindingHistoryEntry[] => {
                if (!isRecord(value)) return [];
                const priorQuote = normalizedRepeatedQuote(value.work_quote);
                const priorDocumentId = typeof value.source_document_id === 'string' ? value.source_document_id : '';
                if (priorQuote !== workQuote || !priorDocumentId) return [];
                const priorDocumentTitle = typeof value.source_document_title === 'string'
                    ? value.source_document_title
                    : '';
                return [{
                    finding_id: typeof value.finding_id === 'string' ? value.finding_id : finding.id,
                    source_document_id: priorDocumentId,
                    source_document_title: priorDocumentTitle,
                    document_date: typeof value.document_date === 'string'
                        ? value.document_date
                        : documentDateFromTitle(priorDocumentTitle),
                    title: typeof value.title === 'string' ? value.title : null,
                    category: typeof value.category === 'string' ? value.category : null,
                    work_quote: priorQuote,
                }];
            })
            : [];
        const groupKey = JSON.stringify([
            workQuote,
            (isRecord(evidence.contract_reference_authority) ? evidence.contract_reference_authority.reference_chunk_id : null)
                || finding.target_contract_doc_id || evidence.contract_document_id || '',
            normalizedRepeatedQuote(evidence.contract_quote),
            finding.category || '',
        ]);
        const group = groups.get(groupKey) || [];
        group.push({ finding, history, priorHistory, sortTime: findingSortTime(history, finding) });
        groups.set(groupKey, group);
    }

    const plan: RepeatedFindingConsolidation[] = [];
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        group.sort((left, right) => (
            left.sortTime - right.sortTime
            || left.finding.id.localeCompare(right.finding.id)
        ));
        const latest = group[group.length - 1];
        const historyByDocument = new Map<string, RepeatedFindingHistoryEntry>();
        for (const history of group.flatMap((entry) => [...entry.priorHistory, entry.history])) {
            historyByDocument.set(`${history.source_document_id}\u0000${history.work_quote}`, history);
        }
        const repeatedHistory = [...historyByDocument.values()].sort((left, right) => {
            const leftTime = left.document_date ? Date.parse(`${left.document_date}T00:00:00.000Z`) : 0;
            const rightTime = right.document_date ? Date.parse(`${right.document_date}T00:00:00.000Z`) : 0;
            return leftTime - rightTime || left.source_document_title.localeCompare(right.source_document_title);
        });
        plan.push({
            keepId: latest.finding.id,
            deleteIds: group.slice(0, -1).map(({ finding }) => finding.id),
            repeatedHistory,
        });
    }

    return plan.sort((left, right) => left.keepId.localeCompare(right.keepId));
}

export function attachRepeatedFindingHistory(
    evidenceData: unknown,
    repeatedHistory: RepeatedFindingHistoryEntry[],
) {
    const evidence = isRecord(evidenceData) ? evidenceData : {};
    return {
        ...evidence,
        repeated_history: repeatedHistory,
        repeated_in_documents: repeatedHistory.length,
    };
}
