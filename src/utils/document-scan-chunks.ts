export type ScanChunkDocument = {
    id: string;
    title?: string | null;
    category?: string | null;
    extracted_text?: string | null;
};

export type DocumentScanChunk = {
    documentId: string;
    title: string;
    category: string;
    index: number;
    total: number;
    start: number;
    end: number;
    text: string;
};

const DEFAULT_CHUNK_CHARS = 9_000;
const DEFAULT_CHUNK_OVERLAP = 500;

function normalizePdfLetterSpacing(value: string) {
    return value.replace(
        /(?<![\u0590-\u05ff])[\u0590-\u05ff](?:[ \u200e\u200f]*\t+[ \u200e\u200f]*[\u0590-\u05ff])+(?![\u0590-\u05ff])/gu,
        (sequence) => sequence.replace(/[ \t\u200e\u200f]+/g, '')
    );
}

function chooseChunkEnd(text: string, start: number, maxChars: number) {
    const hardEnd = Math.min(text.length, start + maxChars);
    if (hardEnd >= text.length) return text.length;

    const minimumUsefulEnd = start + Math.floor(maxChars * 0.65);
    const paragraphEnd = text.lastIndexOf('\n\n', hardEnd);
    if (paragraphEnd >= minimumUsefulEnd) return paragraphEnd + 2;

    const lineEnd = text.lastIndexOf('\n', hardEnd);
    if (lineEnd >= minimumUsefulEnd) return lineEnd + 1;

    const wordEnd = text.lastIndexOf(' ', hardEnd);
    return wordEnd >= minimumUsefulEnd ? wordEnd + 1 : hardEnd;
}

export function chunkDocumentText(
    text: string,
    maxChars = DEFAULT_CHUNK_CHARS,
    overlapChars = DEFAULT_CHUNK_OVERLAP,
) {
    if (maxChars < 500) throw new Error('maxChars must be at least 500');
    if (overlapChars < 0 || overlapChars >= maxChars) {
        throw new Error('overlapChars must be non-negative and smaller than maxChars');
    }

    const source = String(text || '');
    if (!source.trim()) return [];

    const rawChunks: Array<Omit<DocumentScanChunk, 'documentId' | 'title' | 'category' | 'index' | 'total'>> = [];
    let start = 0;

    while (start < source.length) {
        const end = chooseChunkEnd(source, start, maxChars);
        rawChunks.push({ start, end, text: source.slice(start, end).trim() });
        if (end >= source.length) break;
        start = Math.max(start + 1, end - overlapChars);
    }

    return rawChunks.filter((chunk) => chunk.text.length > 0);
}

export function buildDocumentScanChunks(
    documents: ScanChunkDocument[],
    maxChars = DEFAULT_CHUNK_CHARS,
    overlapChars = DEFAULT_CHUNK_OVERLAP,
): DocumentScanChunk[] {
    return documents.flatMap((document) => {
        const chunks = chunkDocumentText(String(document.extracted_text || ''), maxChars, overlapChars);
        return chunks.map((chunk, index) => ({
            ...chunk,
            documentId: document.id,
            title: String(document.title || ''),
            category: String(document.category || ''),
            index,
            total: chunks.length,
        }));
    });
}

function tokenizeForRetrieval(value: string) {
    const tokens = (normalizePdfLetterSpacing(value).toLowerCase().match(/[0-9a-z\u0590-\u05ff]+/g) || [])
        .filter((token) => token.length >= 3);
    const expanded = new Set(tokens);

    for (const token of tokens) {
        if (!/^[\u0590-\u05ff]+$/u.test(token) || token.length < 5) continue;
        let stem = token;
        for (let index = 0; index < 2 && stem.length >= 5 && /^[והבלכמש]/u.test(stem); index += 1) {
            stem = stem.slice(1);
            if (stem.length >= 3) expanded.add(stem);
        }
    }

    return expanded;
}

function relevanceScore(
    contractChunk: DocumentScanChunk,
    workTokens: Set<string>,
    tokenWeights?: Map<string, number>,
) {
    const contractTokens = tokenizeForRetrieval(contractChunk.text);
    let score = 0;
    for (const token of workTokens) {
        if (!contractTokens.has(token)) continue;
        const baseScore = /^\d/.test(token) ? 12 : Math.min(8, token.length);
        score += baseScore * (tokenWeights?.get(token) || 1);
    }
    return score;
}

export function selectRelevantContractChunks(
    contractChunks: DocumentScanChunk[],
    workText: string,
    maxSelectedChars = 14_000,
    maxSelectedChunks = 3,
) {
    const workTokens = tokenizeForRetrieval(workText);
    const ranked = contractChunks
        .map((chunk, order) => ({ chunk, order, score: relevanceScore(chunk, workTokens) }))
        .sort((left, right) => right.score - left.score || left.order - right.order);

    const selected: DocumentScanChunk[] = [];
    let usedChars = 0;

    for (const candidate of ranked) {
        if (selected.length >= maxSelectedChunks) break;
        if (selected.length > 0 && usedChars + candidate.chunk.text.length > maxSelectedChars) continue;
        selected.push(candidate.chunk);
        usedChars += candidate.chunk.text.length;
    }

    return selected;
}

export function selectRelevantProjectChunks(
    chunks: DocumentScanChunk[],
    queryText: string,
    maxSelectedChars = 8_000,
    maxSelectedChunks = 10,
    excludedDocumentId?: string,
    excerptCharsEstimate = 700,
) {
    const queryTokens = tokenizeForRetrieval(queryText);
    const documentIds = new Set(chunks.map((chunk) => chunk.documentId));
    const documentsByToken = new Map<string, Set<string>>();
    for (const chunk of chunks) {
        for (const token of tokenizeForRetrieval(chunk.text)) {
            if (!queryTokens.has(token)) continue;
            const matchingDocuments = documentsByToken.get(token) || new Set<string>();
            matchingDocuments.add(chunk.documentId);
            documentsByToken.set(token, matchingDocuments);
        }
    }
    const tokenWeights = new Map(
        [...queryTokens].map((token) => {
            const matchingDocuments = documentsByToken.get(token)?.size || 0;
            const rarity = Math.log((documentIds.size + 1) / (matchingDocuments + 1));
            return [token, Math.max(0.1, rarity * rarity)] as const;
        }),
    );
    const rareAnchorLimit = Math.max(3, Math.ceil(documentIds.size * 0.15));
    const rareAnchorTokens = new Set(
        [...queryTokens]
            .filter((token) => {
                const matchingDocuments = documentsByToken.get(token)?.size || 0;
                return !/^\d/.test(token)
                    && token.length >= 4
                    && matchingDocuments >= 1
                    && matchingDocuments <= rareAnchorLimit;
            }),
    );
    const matchingTextTokens = [...queryTokens]
        .filter((token) => !/^\d/.test(token) && token.length >= 4 && (documentsByToken.get(token)?.size || 0) > 0);
    const shortTopicTokens = [...matchingTextTokens]
        .sort((left, right) => right.length - left.length
            || (documentsByToken.get(left)?.size || 0) - (documentsByToken.get(right)?.size || 0))
        .slice(0, 3);
    const fallbackTokens = [...matchingTextTokens]
        .sort((left, right) => (documentsByToken.get(left)?.size || 0) - (documentsByToken.get(right)?.size || 0))
        .slice(0, 2);
    const anchorTokens = queryText.length <= 500 && shortTopicTokens.length > 0
        ? new Set(shortTopicTokens)
        : rareAnchorTokens.size > 0
            ? rareAnchorTokens
            : new Set(fallbackTokens);
    const ranked = chunks
        .filter((chunk) => chunk.documentId !== excludedDocumentId)
        .filter((chunk) => {
            if (anchorTokens.size === 0) return false;
            const chunkTokens = tokenizeForRetrieval(chunk.text);
            return [...anchorTokens].some((token) => chunkTokens.has(token));
        })
        .map((chunk, order) => ({ chunk, order, score: relevanceScore(chunk, anchorTokens, tokenWeights) }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.order - right.order);
    const bestChunkByDocument = new Map<string, (typeof ranked)[number]>();
    for (const candidate of ranked) {
        if (!bestChunkByDocument.has(candidate.chunk.documentId)) {
            bestChunkByDocument.set(candidate.chunk.documentId, candidate);
        }
    }
    const rankedDocuments = [...bestChunkByDocument.values()];
    const strongChronological = [...rankedDocuments]
        .sort((left, right) => documentDateFromTitle(left.chunk.title) - documentDateFromTitle(right.chunk.title)
            || right.score - left.score);
    const priorityCandidates = [
        ...strongChronological.slice(0, 3),
        ...strongChronological.slice(-3),
        ...rankedDocuments,
    ];

    const selected: DocumentScanChunk[] = [];
    const selectedDocuments = new Set<string>();
    let usedChars = 0;

    for (const candidate of priorityCandidates) {
        if (selected.length >= maxSelectedChunks) break;
        if (selectedDocuments.has(candidate.chunk.documentId)) continue;
        const selectedChars = Math.min(candidate.chunk.text.length, excerptCharsEstimate);
        if (selected.length > 0 && usedChars + selectedChars > maxSelectedChars) continue;
        selected.push(candidate.chunk);
        selectedDocuments.add(candidate.chunk.documentId);
        usedChars += selectedChars;
    }

    return selected;
}

function documentDateFromTitle(title: string) {
    const normalizedTitle = title.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    const match = normalizedTitle.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const yearValue = Number(match[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    return Date.UTC(year, Number(match[2]) - 1, Number(match[1]));
}

function relevantExcerpt(text: string, queryText: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    const searchable = normalizePdfLetterSpacing(text).toLowerCase();
    const queryTokens = [...tokenizeForRetrieval(queryText)].sort((left, right) => right.length - left.length);
    const matchingToken = queryTokens.find((token) => searchable.includes(token));
    const index = matchingToken ? searchable.indexOf(matchingToken) : 0;
    const start = Math.max(0, Math.min(text.length - maxChars, index - Math.floor(maxChars * 0.3)));
    return `${start > 0 ? '…' : ''}${text.slice(start, start + maxChars).trim()}${start + maxChars < text.length ? '…' : ''}`;
}

export function formatRelatedWorkTimeline(
    chunks: DocumentScanChunk[],
    queryText: string,
    excerptChars = 700,
) {
    return [...chunks]
        .sort((left, right) => documentDateFromTitle(left.title) - documentDateFromTitle(right.title)
            || left.title.localeCompare(right.title))
        .map((chunk) => `--- Related work document ID: ${chunk.documentId}
Title: ${chunk.title}
Category: ${chunk.category}
Relevant excerpt from chunk ${chunk.index + 1}/${chunk.total} ---
${relevantExcerpt(chunk.text, queryText, excerptChars)}`)
        .join('\n\n');
}

export function formatDocumentChunkContext(chunks: DocumentScanChunk[]) {
    return chunks.map((chunk) => `--- Document ID: ${chunk.documentId}
Title: ${chunk.title}
Category: ${chunk.category}
Chunk: ${chunk.index + 1}/${chunk.total}; source chars ${chunk.start}-${chunk.end} ---
${chunk.text}`).join('\n\n');
}

export const formatContractChunkContext = formatDocumentChunkContext;
