export const PDF_DUPLICATE_TEXT_THRESHOLD = 0.97;

const PDF_EXTENSION = "pdf";
const TEXT_DOCUMENT_EXTENSIONS = new Set(["doc", "docx"]);
const MIN_DUPLICATE_TEXT_TOKENS = 120;
const FILE_EXTENSION_PATTERN = /\.([a-z0-9]{2,8})(?:\s*\(\d+\))?$/i;
const BIDI_AND_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export type DuplicateCandidateDocument = {
    id: string;
    title?: string | null;
    category?: string | null;
    content_hash?: string | null;
    storage_path?: string | null;
    file_url?: string | null;
    extracted_text?: string | null;
};

export type PreferredPdfDuplicate = {
    canonical: DuplicateCandidateDocument;
    duplicate: DuplicateCandidateDocument;
    similarity: number;
    titleKey: string;
};

function cleanUnicode(value: string) {
    return value.normalize("NFKC").replace(BIDI_AND_CONTROL_PATTERN, "");
}

export function getDocumentExtension(document: DuplicateCandidateDocument) {
    const candidates = [document.title, document.storage_path, document.file_url];

    for (const candidate of candidates) {
        const cleanCandidate = String(candidate || "").split(/[?#]/, 1)[0];
        const match = cleanCandidate.match(FILE_EXTENSION_PATTERN);
        if (match) return match[1].toLowerCase();
    }

    return "";
}

export function normalizeDuplicateTitle(title: unknown) {
    let normalized = cleanUnicode(String(title || "")).toLowerCase().trim();
    normalized = normalized.replace(/\.(?:pdf|docx?|odt)(?:\s*\(\d+\))?$/i, "");
    normalized = normalized.replace(/\s*[([]\s*(?:\d+|copy|עותק)\s*[)\]]\s*$/i, "");
    return normalized
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function tokenizeDuplicateText(text: unknown) {
    return cleanUnicode(String(text || ""))
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) || [];
}

function buildShingleCounts(text: string, width = 9) {
    const counts = new Map<string, number>();

    if (text.length < width) {
        if (text) counts.set(text, 1);
        return counts;
    }

    for (let index = 0; index <= text.length - width; index += 1) {
        const shingle = text.slice(index, index + width);
        counts.set(shingle, (counts.get(shingle) || 0) + 1);
    }

    return counts;
}

export function measureDocumentTextSimilarity(leftText: unknown, rightText: unknown) {
    const leftTokens = tokenizeDuplicateText(leftText);
    const rightTokens = tokenizeDuplicateText(rightText);

    if (leftTokens.length < MIN_DUPLICATE_TEXT_TOKENS || rightTokens.length < MIN_DUPLICATE_TEXT_TOKENS) {
        return 0;
    }

    // PDF extraction often joins Hebrew words that are separated in DOCX. Compare
    // the visible letters and numbers so layout artifacts do not hide a real match.
    const leftComparableText = leftTokens.join("");
    const rightComparableText = rightTokens.join("");

    if (leftComparableText === rightComparableText) {
        return 1;
    }

    const leftCounts = buildShingleCounts(leftComparableText);
    const rightCounts = buildShingleCounts(rightComparableText);
    let overlap = 0;
    let leftTotal = 0;
    let rightTotal = 0;

    for (const count of leftCounts.values()) leftTotal += count;
    for (const count of rightCounts.values()) rightTotal += count;
    for (const [shingle, leftCount] of leftCounts) {
        overlap += Math.min(leftCount, rightCounts.get(shingle) || 0);
    }

    if (leftTotal + rightTotal === 0) return 0;
    return (2 * overlap) / (leftTotal + rightTotal);
}

export function findPreferredPdfDuplicates(
    documents: DuplicateCandidateDocument[],
    threshold = PDF_DUPLICATE_TEXT_THRESHOLD,
) {
    const duplicates: PreferredPdfDuplicate[] = [];
    const pdfDocuments = documents
        .filter((document) => getDocumentExtension(document) === PDF_EXTENSION)
        .sort((left, right) => left.id.localeCompare(right.id));
    const textDocuments = documents
        .filter((document) => TEXT_DOCUMENT_EXTENSIONS.has(getDocumentExtension(document)))
        .sort((left, right) => left.id.localeCompare(right.id));

    for (const duplicate of textDocuments) {
        let bestMatch: PreferredPdfDuplicate | null = null;

        for (const canonical of pdfDocuments) {
            if (String(canonical.category || "") !== String(duplicate.category || "")) continue;
            const similarity = measureDocumentTextSimilarity(
                canonical.extracted_text,
                duplicate.extracted_text,
            );
            if (similarity < threshold) continue;
            if (!bestMatch || similarity > bestMatch.similarity) {
                bestMatch = {
                    canonical,
                    duplicate,
                    similarity,
                    titleKey: normalizeDuplicateTitle(canonical.title || duplicate.title),
                };
            }
        }

        if (bestMatch) duplicates.push(bestMatch);
    }

    return duplicates;
}

function descriptiveTitleScore(document: DuplicateCandidateDocument) {
    const normalized = normalizeDuplicateTitle(document.title);
    const letters = normalized.match(/\p{L}/gu)?.length || 0;
    return (letters * 1000) + normalized.length;
}

export function findExactContentHashDuplicates(documents: DuplicateCandidateDocument[]) {
    const groups = new Map<string, DuplicateCandidateDocument[]>();

    for (const document of documents) {
        const contentHash = String(document.content_hash || "").trim();
        if (!contentHash) continue;
        const key = `${String(document.category || "")}:${contentHash}`;
        const group = groups.get(key) || [];
        group.push(document);
        groups.set(key, group);
    }

    const duplicates: PreferredPdfDuplicate[] = [];

    for (const [key, group] of groups) {
        if (group.length < 2) continue;
        const ordered = [...group].sort((left, right) => (
            descriptiveTitleScore(right) - descriptiveTitleScore(left)
            || String(left.title || "").localeCompare(String(right.title || ""))
            || left.id.localeCompare(right.id)
        ));
        const canonical = ordered[0];
        for (const duplicate of ordered.slice(1)) {
            duplicates.push({
                canonical,
                duplicate,
                similarity: 1,
                titleKey: key,
            });
        }
    }

    return duplicates;
}
