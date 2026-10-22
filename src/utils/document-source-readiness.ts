export type DocumentSourceInput = {
    title?: string | null;
    extracted_text?: string | null;
    ocr_status?: string | null;
    storage_path?: string | null;
    file_url?: string | null;
    parsed_json?: unknown;
};

export const DOCUMENT_READING_VERSION = 'page-coverage-v1';
export type DocumentReadingVerification = {
    version: typeof DOCUMENT_READING_VERSION;
    complete: boolean;
    totalPages: number;
    readPages: number[];
    unreadablePages: number[];
};

export type ExtractedPdfPage = { num: number; text: string };
export type RecognizedPdfPage = { page: number; text: string; confidence: number; requiresVisualReview?: boolean };

export function removeExtractionNoise(value: string) {
    return value
        .replace(/^[ \t]*--\s*\d+\s+of\s+\d+\s*--[ \t]*$/gim, '')
        .replace(/^[ \t]*(?:page\s+)?\d+\s+(?:of|מתוך)\s+\d+[ \t]*$/gim, '')
        .replace(/^[ \t]*(?:עמוד|עמ')\s*\d+(?:\s*מתוך\s*\d+)?[ \t]*$/gm, '')
        .trim();
}

export function hasDocumentBodyText(value: string) {
    const body = removeExtractionNoise(value).replace(/[\u200e\u200f]/g, '').trim();
    if (!body) return false;
    // Filename/date/form identifiers alone are not a successfully extracted body.
    if (/^[\w.\-/ ]+\.(?:pdf|docx?|xlsx?)(?:\s+\d[\d.\-/ ]*)?$/iu.test(body)) return false;
    if (/^[A-Z]{1,8}[.\-][A-Z\d.\-]+(?:\s+\d[\d.\-/ ]*)?$/u.test(body)) return false;
    if (/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/u.test(body)) return false;
    // No minimum sentence/word/character count: a complete instruction can be one line.
    return /\p{L}{2,}/u.test(body);
}

function findExplicitDocumentMarker(document: DocumentSourceInput) {
    const title = String(document.title || '').replace(/\.[a-z\d]{1,12}$/iu, '').trim();
    const draftTitle = title.match(/(?:^|[\s_\-–—(])(?:טיוטה|draft)(?:[\s_\-–—()\d.]*(?:v\d[\d.]*)?)?$/iu);
    if (draftTitle) return { status: 'DRAFT' as const, quote: draftTitle[0].trim() };
    const headerLines = String(document.extracted_text || '').split(/\r?\n/).slice(0, 12);
    for (const line of headerLines) {
        const header = line.trim();
        if (/^(?:טיוטה|draft)(?:\s*[-:–—]?\s*(?:לעיון בלבד|לעיון|בלבד|לבדיקה|לא לביצוע|for review only|for review|only|v?\d[\d.]*))*$/iu.test(header)) {
            return { status: 'DRAFT' as const, quote: header };
        }
        if (/^(?:קטע\s+מתוך|חלק\s+מתוך|fragment\s+(?:of|from)|excerpt\s+from)\s+.+/iu.test(header)) {
            return { status: 'FRAGMENT' as const, quote: header };
        }
    }
    return null;
}

export function assessDocumentSourceReadiness(document: DocumentSourceInput) {
    const text = String(document.extracted_text || '');
    const hasReadableText = hasDocumentBodyText(text);
    const marker = findExplicitDocumentMarker(document);
    const isPdf = [document.title, document.storage_path, document.file_url]
        .some((value) => /\.pdf(?:$|[?#\s._()\d-])/iu.test(value || ''));
    const parsed = document.parsed_json && typeof document.parsed_json === 'object'
        ? document.parsed_json as Record<string, unknown> : {};
    const verification = parsed.source_reading as DocumentReadingVerification | undefined;
    const verifiedPages = new Set(Array.isArray(verification?.readPages) ? verification.readPages : []);
    const completePageCoverage = verification?.version === DOCUMENT_READING_VERSION && verification.complete
        && Number.isInteger(verification.totalPages) && verification.totalPages > 0
        && Array.isArray(verification.unreadablePages) && verification.unreadablePages.length === 0
        && verifiedPages.size === verification.totalPages
        && [...verifiedPages].every((page) => Number.isInteger(page) && page >= 1 && page <= verification.totalPages);
    const incomplete = ['REQUIRES_REVIEW', 'ERROR', 'PENDING', 'PROCESSING'].includes(String(document.ocr_status || ''))
        || (isPdf && (document.ocr_status !== 'COMPLETED' || !completePageCoverage))
        || /\[Document text was truncated for AI analysis\./u.test(text);
    const status = !hasReadableText ? 'UNREADABLE' as const
        : incomplete ? 'EXTRACTION_INCOMPLETE' as const
            : marker?.status || 'READABLE' as const;
    return {
        status, hasReadableText, extractionComplete: hasReadableText && !incomplete,
        canCompare: status === 'READABLE', markerQuote: marker?.quote || null,
        documentStatus: marker?.status || 'UNDETERMINED',
        // READABLE confirms extraction only. It does not prove contractual authority or that
        // this version is final/current; comparison must check the dated document context.
    };
}

export function pdfPagesNeedingOcr(pages: ExtractedPdfPage[], total: number) {
    const byNumber = new Map(pages.map((page) => [page.num, page.text]));
    return Array.from({ length: total }, (_, index) => index + 1).filter((page) => {
        const text = removeExtractionNoise(byNumber.get(page) || '');
        // Sparse native text triggers a visual reading attempt; it is not a verdict that
        // a short original is incomplete. Completeness is checked after that attempt.
        return !hasDocumentBodyText(text) || text.replace(/\s+/g, ' ').length < 250;
    });
}

export function hasCompleteOcrPageCoverage(pages: RecognizedPdfPage[], expectedPages: number[]) {
    const byNumber = new Map(pages.map((page) => [page.page, page]));
    return expectedPages.every((number) => {
        const page = byNumber.get(number);
        return Boolean(page && !page.requiresVisualReview && hasDocumentBodyText(page.text)
            && Number.isFinite(page.confidence) && page.confidence >= 65);
    });
}
