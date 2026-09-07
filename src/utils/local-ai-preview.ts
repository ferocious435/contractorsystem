function normalizeWhitespace(value: string) {
    return value.replace(/\s+/g, ' ').trim();
}

export function quoteExistsInSource(sourceText: string, quote: string) {
    const normalizedQuote = normalizeWhitespace(quote);
    if (!normalizedQuote) return false;
    return normalizeWhitespace(sourceText).includes(normalizedQuote);
}

export function extractEvidenceWindow(sourceText: string, quote: string, radius = 500) {
    const cleanQuote = quote.trim();
    let matchIndex = cleanQuote ? sourceText.indexOf(cleanQuote) : -1;

    if (matchIndex < 0) {
        const anchor = normalizeWhitespace(cleanQuote)
            .split(' ')
            .filter((token) => token.length >= 4)
            .slice(0, 4)
            .join(' ');
        matchIndex = anchor ? normalizeWhitespace(sourceText).indexOf(anchor) : -1;
    }

    if (matchIndex < 0) {
        return sourceText.slice(0, radius * 2).trim();
    }

    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(sourceText.length, matchIndex + cleanQuote.length + radius);
    return sourceText.slice(start, end).trim();
}

export function extractFirstJsonObject(text: string): Record<string, unknown> {
    const cleanText = text.replace(/```json|```/gi, '').trim();
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start < 0 || end < start) {
        throw new Error('Local AI did not return a JSON object');
    }

    const parsed: unknown = JSON.parse(cleanText.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Local AI returned an invalid JSON object');
    }
    return parsed as Record<string, unknown>;
}
