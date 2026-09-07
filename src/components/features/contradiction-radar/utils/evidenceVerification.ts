export type EvidenceDisplayStatus = 'SOURCE_VERIFIED' | 'QUOTES_REQUIRE_SOURCE_CHECK' | 'INCOMPLETE';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function getEvidenceDisplayStatus(evidence: unknown): EvidenceDisplayStatus {
    const record = asRecord(evidence);
    if (!record) return 'INCOMPLETE';

    const hasQuotes = Boolean(record.contract_quote && record.work_quote);
    if (!hasQuotes) return 'INCOMPLETE';

    const sourceVerification = asRecord(record.source_verification);
    const quotesMatched = sourceVerification?.contract_quote_matched === true
        && sourceVerification?.work_quote_matched === true;

    return record.evidence_status === 'VERIFIED' && quotesMatched
        ? 'SOURCE_VERIFIED'
        : 'QUOTES_REQUIRE_SOURCE_CHECK';
}
