import { createHash } from "crypto";
import { PDFParse } from "pdf-parse";

export type ReferenceDocumentType =
    | "BLUE_BOOK"
    | "SHELF_CONTRACT_3210"
    | "ISRAELI_STANDARD"
    | "OTHER_REFERENCE";

export type ReferenceDocumentChunk = {
    chunk_type: "DOCUMENT" | "CHAPTER" | "SECTION" | "CLAUSE" | "PAGE" | "NOTE" | "APPENDIX";
    section_code: string | null;
    title: string | null;
    page_from: number | null;
    page_to: number | null;
    ordinal: number;
    text: string;
    text_hash: string;
    token_estimate: number;
    metadata: Record<string, unknown>;
};

export type ReferencePdfParseResult = {
    text: string;
    text_hash: string;
    page_count: number;
    chunks: ReferenceDocumentChunk[];
};

type ExtractedPdfPage = {
    pageNumber: number;
    text: string;
};

const PAGE_MARKER_RE = /^--\s*(\d+)\s+of\s+(\d+)\s*--$/gm;
const MAX_DOCUMENT_CHUNK_CHARS = 12_000;
const MIN_PAGE_TEXT_CHARS = 20;

export function hashText(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

function cleanPdfText(value: string) {
    return value
        .replace(/\u0000/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

function estimateTokens(value: string) {
    return Math.max(1, Math.ceil(value.length / 4));
}

function splitTextByPdfPageMarkers(text: string): ExtractedPdfPage[] {
    const markers = [...text.matchAll(PAGE_MARKER_RE)];
    if (!markers.length) {
        return [{ pageNumber: 1, text: cleanPdfText(text) }];
    }

    return markers
        .map((marker, index) => {
            const pageNumber = Number(marker[1]) || index + 1;
            const start = (marker.index || 0) + marker[0].length;
            const end = markers[index + 1]?.index ?? text.length;

            return {
                pageNumber,
                text: cleanPdfText(text.slice(start, end)),
            };
        })
        .filter((page) => page.text.length >= MIN_PAGE_TEXT_CHARS);
}

function detectSectionMetadata(text: string, referenceType: ReferenceDocumentType) {
    const candidateLines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 4 && line.length <= 180);

    const heading = candidateLines.find((line) =>
        /^(?:פרק\s*)?\d{1,3}(?:[.\-]\d+)*\s+/.test(line) ||
        /^(?:section|chapter|clause)\s+\d+/i.test(line) ||
        /חוזה|מפרט|פרק|סעיף/.test(line)
    ) || candidateLines[0] || null;

    const sectionCode = heading?.match(/(?:פרק|סעיף|chapter|section|clause)?\s*(\d{1,3}(?:[.\-]\d+)*)/i)?.[1] || null;
    const chunkType = referenceType === "SHELF_CONTRACT_3210" && /סעיף|clause/i.test(heading || "")
        ? "CLAUSE"
        : "PAGE";

    return { heading, sectionCode, chunkType: chunkType as ReferenceDocumentChunk["chunk_type"] };
}

export function buildReferenceChunks(
    pages: ExtractedPdfPage[],
    referenceType: ReferenceDocumentType,
): ReferenceDocumentChunk[] {
    const chunks: ReferenceDocumentChunk[] = [];
    const documentText = cleanPdfText(pages.map((page) => page.text).join("\n\n")).slice(0, MAX_DOCUMENT_CHUNK_CHARS);

    if (documentText) {
        chunks.push({
            chunk_type: "DOCUMENT",
            section_code: null,
            title: referenceType,
            page_from: pages[0]?.pageNumber || 1,
            page_to: pages.at(-1)?.pageNumber || pages.length || 1,
            ordinal: 0,
            text: documentText,
            text_hash: hashText(documentText),
            token_estimate: estimateTokens(documentText),
            metadata: { reference_type: referenceType, truncated: pages.map((page) => page.text).join("\n\n").length > MAX_DOCUMENT_CHUNK_CHARS },
        });
    }

    pages.forEach((page, index) => {
        const { heading, sectionCode, chunkType } = detectSectionMetadata(page.text, referenceType);
        chunks.push({
            chunk_type: chunkType,
            section_code: sectionCode,
            title: heading,
            page_from: page.pageNumber,
            page_to: page.pageNumber,
            ordinal: index + 1,
            text: page.text,
            text_hash: hashText(page.text),
            token_estimate: estimateTokens(page.text),
            metadata: { reference_type: referenceType },
        });
    });

    return chunks;
}

export async function parseReferencePdf(
    data: Buffer | Uint8Array,
    referenceType: ReferenceDocumentType,
): Promise<ReferencePdfParseResult> {
    const parser = new PDFParse({ data });

    try {
        const result = await parser.getText();
        const text = cleanPdfText(result.text);
        const pages = splitTextByPdfPageMarkers(result.text);
        const markerPageCount = [...result.text.matchAll(PAGE_MARKER_RE)]
            .reduce((maxPage, marker) => Math.max(maxPage, Number(marker[2]) || Number(marker[1]) || 0), 0);

        return {
            text,
            text_hash: hashText(text),
            page_count: markerPageCount || pages.length || Number((result as { total?: unknown }).total) || 0,
            chunks: buildReferenceChunks(pages, referenceType),
        };
    } finally {
        await parser.destroy();
    }
}
