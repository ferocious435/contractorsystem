export interface ContractDocumentLike {
    title?: string | null;
    extracted_text?: string | null;
    parsed_json?: {
        type?: string | null;
    } | null;
}

export interface ContractBaseResolution {
    amount: number | null;
    sourceTitle: string | null;
    strategy: "BOQ_MAX_TOTAL" | "CONTRACT_SUM" | "FALLBACK_MAX_TOTAL" | "NONE";
}

function normalizeText(value: string | null | undefined): string {
    return (value || "").replace(/[^\dA-Za-z\u0590-\u05FF.]+/g, "");
}

function normalizeTitle(value: string | null | undefined): string {
    return (value || "").toLowerCase().replace(/[^\dA-Za-z\u0590-\u05FF]+/g, "");
}

function parseAmount(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function extractGeneralTotalFromText(text: string | null | undefined): number | null {
    const normalized = normalizeText(text);
    const matches = [...normalized.matchAll(/סךהכל(\d+(?:\.\d{2})?)סהככללי/g)];
    const lastMatch = matches.at(-1);
    return parseAmount(lastMatch?.[1] || null);
}

function isLikelyBoqDocument(doc: ContractDocumentLike): boolean {
    const normalizedTitle = normalizeTitle(doc.title);
    const normalizedText = normalizeText(doc.extracted_text);

    if (normalizedText.includes("כתבכמויות") || normalizedText.includes("כמויותומחירים")) {
        return true;
    }

    if (normalizedTitle.includes("כמויות") || normalizedTitle.includes("boq")) {
        return true;
    }

    // "לביצוע" contract books often contain the priced BOQ pages for the whole project.
    return normalizedTitle.includes("לביצוע") && normalizedText.includes("סהככללי");
}

function isLikelyAgreementDocument(doc: ContractDocumentLike): boolean {
    const normalizedTitle = normalizeTitle(doc.title);
    const parsedType = normalizeTitle(doc.parsed_json?.type);

    return (
        normalizedTitle.includes("הסכם") ||
        normalizedTitle.includes("חוזה") ||
        parsedType.includes("הסכם") ||
        parsedType.includes("חוזה")
    );
}

export function resolveProjectContractBase(docs: ContractDocumentLike[]): ContractBaseResolution {
    const candidates = docs
        .map((doc) => ({
            title: doc.title || null,
            total: extractGeneralTotalFromText(doc.extracted_text),
            isBoq: isLikelyBoqDocument(doc),
            isAgreement: isLikelyAgreementDocument(doc),
        }))
        .filter((doc) => (doc.total || 0) > 0);

    if (!candidates.length) {
        return {
            amount: null,
            sourceTitle: null,
            strategy: "NONE",
        };
    }

    const boqCandidates = candidates.filter((doc) => doc.isBoq);
    if (boqCandidates.length) {
        const selected = boqCandidates.reduce((best, current) =>
            (current.total || 0) > (best.total || 0) ? current : best
        );

        return {
            amount: selected.total || null,
            sourceTitle: selected.title,
            strategy: "BOQ_MAX_TOTAL",
        };
    }

    const agreementCandidates = candidates.filter((doc) => doc.isAgreement);
    if (agreementCandidates.length) {
        return {
            amount: agreementCandidates.reduce((sum, doc) => sum + (doc.total || 0), 0),
            sourceTitle: agreementCandidates.map((doc) => doc.title).filter(Boolean).join(", "),
            strategy: "CONTRACT_SUM",
        };
    }

    const fallback = candidates.reduce((best, current) =>
        (current.total || 0) > (best.total || 0) ? current : best
    );

    return {
        amount: fallback.total || null,
        sourceTitle: fallback.title,
        strategy: "FALLBACK_MAX_TOTAL",
    };
}
