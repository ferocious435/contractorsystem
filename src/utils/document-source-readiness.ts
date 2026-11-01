import {assessVisualReading, VISUAL_READING_VERSION,type VisualReadingVerification} from './visual-source-reading';

export type DocumentSourceInput = {
    title?: string | null;
    extracted_text?: string | null;
    ocr_status?: string | null;
    storage_path?: string | null;
    file_url?: string | null;
    parsed_json?: unknown;
    content_hash?: string | null;
    extracted_text_hash?: string | null;
};

export const DOCUMENT_READING_VERSION = 'page-coverage-v1';
export const DOCX_READING_VERSION = 'docx-image-coverage-v1';
export type DocxReadingVerification = {
    version: typeof DOCX_READING_VERSION;
    complete: boolean;
    sourceHash: string;
    expectedImageReferences: number;
    images: Array<{
        anchor: string;
        part: string;
        mediaName: string;
        sha256: string | null;
        status: 'READ' | 'REQUIRES_REVIEW' | 'UNREADABLE';
        confidence: number | null;
        numericReviewRequired: boolean;
        reason: string | null;
    }>;
    issues: string[];
};
export type PdfReadingVerification = {
    version: typeof DOCUMENT_READING_VERSION;
    complete: boolean;
    totalPages: number;
    readPages: number[];
    unreadablePages: number[];
    emptyPageProofs?: RenderedEmptyPageProof[];
};
export type RenderedEmptyPageProof = {
    version: 'rendered-empty-v1';
    page: number;
    kind: 'BLANK' | 'PAGE_NUMBER_ONLY';
    imageSha256: string;
    width: number;
    height: number;
    numberText?: string;
    numberConfidence?: number;
    numberBounds?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
};
export type DocumentReadingVerification = PdfReadingVerification | DocxReadingVerification | VisualReadingVerification;

export type ExtractedPdfPage = { num: number; text: string };
export type RecognizedPdfPage = { page: number; text: string; confidence: number; requiresVisualReview?: boolean; emptyPageProof?: RenderedEmptyPageProof };

export function removeExtractionNoise(value: string) {
    return value
        .replace(/\[(?:DOCX_(?:IMAGE|PART|ISSUE)\b[^\]\r\n]*|END_DOCX_(?:IMAGE|PART))\]/g, '')
        .replace(/^[ \t]*\[PAGE\s+\d+\][ \t]*$/gm, '')
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

function validHash(hash: unknown) {
    return typeof hash === 'string' && /^[a-f\d]{64}$/i.test(hash);
}

export function isPageNumberOnly(value: string) {
    return /^(?:(?:page|עמוד|עמ')\s*)?\d+(?:\s*(?:of|מתוך|\/)\s*\d+)?$/iu.test(value.replace(/\s+/g, ' ').trim());
}

export function hasRenderedEmptyPageProof(page: RecognizedPdfPage) {
    const proof = page.emptyPageProof;
    if (!proof || proof.version !== 'rendered-empty-v1' || proof.page !== page.page || !validHash(proof.imageSha256)
        || !Number.isInteger(proof.page) || proof.page < 1 || !Number.isInteger(proof.width) || proof.width < 1
        || !Number.isInteger(proof.height) || proof.height < 1 || proof.width * proof.height > 16_000_000) return false;
    if (proof.kind === 'BLANK') return page.text.trim() === '';
    return proof.kind === 'PAGE_NUMBER_ONLY' && typeof proof.numberText === 'string' && isPageNumberOnly(proof.numberText)
        && page.text.replace(/\s+/g, ' ').trim() === proof.numberText.replace(/\s+/g, ' ').trim()
        && typeof proof.numberConfidence === 'number' && Number.isFinite(proof.numberConfidence)
        && proof.numberConfidence >= 65 && proof.numberConfidence <= 100
        && Array.isArray(proof.numberBounds) && proof.numberBounds.length > 0
        && proof.numberBounds.every(box => box && [box.x0, box.y0, box.x1, box.y1].every(Number.isInteger)
            && box.x0 >= 0 && box.y0 >= 0 && box.x1 > box.x0 && box.y1 > box.y0
            && box.x1 <= proof.width && box.y1 <= proof.height
            && (box.y1 <= proof.height * 0.1 || box.y0 >= proof.height * 0.9));
}

export function isDocxImageReadingComplete(image: unknown): image is DocxReadingVerification['images'][number] {
    if (!image || typeof image !== 'object') return false;
    const record = image as Record<string, unknown>;
    return typeof record.part === 'string' && /^word\/.+\.xml$/.test(record.part)
        && typeof record.anchor === 'string' && record.anchor.startsWith(`${record.part}#`)
        && typeof record.mediaName === 'string' && record.mediaName.length > 0 && validHash(record.sha256)
        && record.status === 'READ' && record.numericReviewRequired === false && record.reason === null
        && typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        && record.confidence >= 65 && record.confidence <= 100;
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
    const visualRegistry = parsed.source_reading && typeof parsed.source_reading === 'object'
        && (parsed.source_reading as {version?:unknown}).version === VISUAL_READING_VERSION;
    const completeVisualCoverage = visualRegistry && assessVisualReading(parsed.source_reading, document).complete;
    const isDocx = verification?.version === DOCX_READING_VERSION || [document.title, document.storage_path, document.file_url]
        .some((value) => /\.docx(?:$|[?#\s._()\d-])/iu.test(value || ''));
    const pdf = verification?.version === DOCUMENT_READING_VERSION ? verification : undefined;
    const verifiedPages = new Set(Array.isArray(pdf?.readPages) ? pdf.readPages : []);
    const completePageCoverage = verification?.version === DOCUMENT_READING_VERSION && verification.complete
        && Number.isInteger(verification.totalPages) && verification.totalPages > 0
        && Array.isArray(verification.unreadablePages) && verification.unreadablePages.length === 0
        && verifiedPages.size === verification.totalPages
        && [...verifiedPages].every((page) => Number.isInteger(page) && page >= 1 && page <= verification.totalPages)
        && (pdf?.emptyPageProofs === undefined || Array.isArray(pdf.emptyPageProofs)
            && new Set(pdf.emptyPageProofs.map(proof => proof?.page)).size === pdf.emptyPageProofs.length
            && pdf.emptyPageProofs.every(proof => proof && verifiedPages.has(proof.page)
                && hasRenderedEmptyPageProof({page: proof.page, text: proof.numberText || '', confidence: 0, emptyPageProof: proof})));
    const docx = verification?.version === DOCX_READING_VERSION ? verification : undefined;
    const completeDocxCoverage = Boolean(docx?.complete === true && validHash(docx.sourceHash)
        && (!document.content_hash || document.content_hash === docx.sourceHash)
        && Number.isInteger(docx.expectedImageReferences) && docx.expectedImageReferences >= 0
        && Array.isArray(docx.issues) && docx.issues.length === 0 && Array.isArray(docx.images)
        && docx.images.length === docx.expectedImageReferences
        && new Set(docx.images.map((image) => image?.anchor)).size === docx.expectedImageReferences
        && docx.images.every(isDocxImageReadingComplete));
    const incomplete = ['REQUIRES_REVIEW', 'ERROR', 'PENDING', 'PROCESSING'].includes(String(document.ocr_status || ''))
        || (visualRegistry && !completeVisualCoverage)
        || (isPdf && (document.ocr_status !== 'COMPLETED' || !(completeVisualCoverage || completePageCoverage)))
        || (isDocx && (document.ocr_status !== 'COMPLETED' || !(completeVisualCoverage || completeDocxCoverage)))
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
        return Boolean(page && !page.requiresVisualReview && (hasRenderedEmptyPageProof(page)
            || hasDocumentBodyText(page.text) && Number.isFinite(page.confidence) && page.confidence >= 65));
    });
}
