export type ParsedScanFinding = Record<string, unknown>;

function extractFirstJsonArray(text: string) {
    const start = text.indexOf("[");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = start; index < text.length; index += 1) {
        const char = text[index];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === "\\") {
            escapeNext = true;
            continue;
        }

        if (char === "\"") {
            inString = !inString;
            continue;
        }

        if (inString) continue;
        if (char === "[") depth += 1;
        if (char === "]") depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
    }

    return null;
}

function normalizeFindings(value: unknown): ParsedScanFinding[] | null {
    if (Array.isArray(value)) {
        return value.filter((item): item is ParsedScanFinding => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }

    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;

    for (const key of ["findings", "results", "items"]) {
        if (Array.isArray(record[key])) {
            return normalizeFindings(record[key]);
        }
    }

    if (Object.keys(record).length === 0) return [];
    if (["title", "description", "category", "work_quote", "contract_quote"].some((key) => key in record)) {
        return [record];
    }

    return null;
}

export function parseScanFindings(text: string) {
    const cleanText = text.replace(/```json|```/gi, "").trim();

    try {
        const normalized = normalizeFindings(JSON.parse(cleanText));
        if (normalized) return normalized;
    } catch {
        // Fall through to extracting an array from surrounding model text.
    }

    const jsonArray = extractFirstJsonArray(cleanText);
    if (jsonArray) {
        const normalized = normalizeFindings(JSON.parse(jsonArray));
        if (normalized) return normalized;
    }

    throw new Error("Local AI did not return a usable JSON finding");
}
