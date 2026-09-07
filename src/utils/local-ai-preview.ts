export function normalizePdfLetterSpacing(value: string) {
    return value.replace(
        /(?<![\u0590-\u05ff])[\u0590-\u05ff](?:[ \u200e\u200f]*\t+[ \u200e\u200f]*[\u0590-\u05ff])+(?![\u0590-\u05ff])/gu,
        (sequence) => sequence.replace(/[ \t\u200e\u200f]+/g, '')
    );
}

function normalizeWhitespace(value: string) {
    return normalizePdfLetterSpacing(value).replace(/\s+/g, ' ').trim();
}

export function quoteExistsInSource(sourceText: string, quote: string) {
    const normalizedQuote = normalizeWhitespace(quote);
    if (!normalizedQuote) return false;
    return normalizeWhitespace(sourceText).includes(normalizedQuote);
}

export function findEvidenceReferenceMatch(sourceText: string, quote: string, radius = 500) {
    const normalizedSource = normalizeWhitespace(sourceText);
    const cleanReferenceText = quote.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
    const referencePattern = /\d{2}(?:\s*\.\s*\d+){2,}/g;
    const references = (cleanReferenceText.match(referencePattern) || [])
        .map((reference) => reference.replace(/[^0-9.]/g, ''));

    for (const reference of references) {
        const exactMatchIndex = normalizedSource.indexOf(reference);
        const referenceDigits = reference.replace(/\D/g, '');
        const flexibleReference = new RegExp(referenceDigits.split('').join('[^0-9]{0,8}'));
        const flexibleMatch = flexibleReference.exec(normalizedSource);
        const matchIndex = exactMatchIndex >= 0 ? exactMatchIndex : flexibleMatch?.index ?? -1;
        if (matchIndex < 0) continue;

        return {
            reference,
            excerpt: normalizedSource.slice(
                Math.max(0, matchIndex - radius),
                Math.min(normalizedSource.length, matchIndex + reference.length + radius)
            ).trim(),
        };
    }

    const expectedSuffixes = cleanReferenceText.match(/\d{4}/g) || [];
    const sourceReferences = normalizedSource.matchAll(/\d{2}(?:\.\d+){2,}/g);
    for (const sourceReference of sourceReferences) {
        const reference = sourceReference[0];
        if (!expectedSuffixes.some((suffix) => reference.endsWith(suffix))) continue;
        const matchIndex = sourceReference.index;

        return {
            reference,
            excerpt: normalizedSource.slice(
                Math.max(0, matchIndex - radius),
                Math.min(normalizedSource.length, matchIndex + reference.length + radius)
            ).trim(),
        };
    }

    return null;
}

export function findEvidenceTermMatches(sourceText: string, quote: string, radius = 300) {
    const normalizedSource = normalizeWhitespace(sourceText);
    const terms = Array.from(new Set(
        (normalizeWhitespace(quote).match(/[0-9A-Za-z\u0590-\u05ff]+/g) || [])
            .filter((term) => term.length >= 4)
    ));

    return terms.flatMap((term, order) => {
        const matchIndex = normalizedSource.indexOf(term);
        if (matchIndex < 0) return [];

        let occurrences = 0;
        let nextIndex = matchIndex;
        while (nextIndex >= 0) {
            occurrences += 1;
            nextIndex = normalizedSource.indexOf(term, nextIndex + term.length);
        }

        return [{
            term,
            order,
            occurrences,
            excerpt: normalizedSource.slice(
                Math.max(0, matchIndex - radius),
                Math.min(normalizedSource.length, matchIndex + term.length + radius)
            ).trim(),
        }];
    })
        .sort((left, right) =>
            left.occurrences - right.occurrences
            || right.term.length - left.term.length
            || left.order - right.order
        )
        .slice(0, 8)
        .map(({ term, excerpt }) => ({ term, excerpt }));
}

export function extractEvidenceWindow(sourceText: string, quote: string, radius = 500) {
    const cleanSource = normalizeWhitespace(sourceText);
    const cleanQuote = normalizeWhitespace(quote);
    const referenceMatch = findEvidenceReferenceMatch(cleanSource, cleanQuote, radius);
    if (referenceMatch) return referenceMatch.excerpt;

    let matchIndex = cleanQuote ? cleanSource.indexOf(cleanQuote) : -1;

    if (matchIndex < 0) {
        const termMatch = findEvidenceTermMatches(cleanSource, cleanQuote, radius)[0];
        if (termMatch) return termMatch.excerpt;
    }

    if (matchIndex < 0) {
        const anchor = cleanQuote
            .split(' ')
            .filter((token) => token.length >= 4)
            .slice(0, 4)
            .join(' ');
        matchIndex = anchor ? cleanSource.indexOf(anchor) : -1;
    }

    if (matchIndex < 0) {
        return cleanSource.slice(0, radius * 2).trim();
    }

    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(cleanSource.length, matchIndex + cleanQuote.length + radius);
    return cleanSource.slice(start, end).trim();
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
