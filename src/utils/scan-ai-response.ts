import { COMPARISON_ATTRIBUTES, STATEMENT_ROLES } from './radar-evidence-meaning.ts';

export type ParsedScanFinding = Record<string, unknown>;

function validateSemanticFinding(value: unknown) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (!record || Object.keys(record).some(key => !['title', 'category', 'work_quote', 'contract_quote', 'comparison'].includes(key))
        || !['title', 'category', 'work_quote'].every(key => typeof record[key] === 'string' && String(record[key]).trim())
        || !['סתירה', 'שינוי/חריג', 'אירוע שטח', 'חוסר נתונים', 'אין התאמה ישירה', 'פעולה לביצוע'].includes(String(record.category))
        || String(record.title).length > 160 || String(record.work_quote).length > 700
        || !Object.hasOwn(record, 'contract_quote') || (record.contract_quote !== null
            && (typeof record.contract_quote !== 'string' || !record.contract_quote.trim() || record.contract_quote.length > 700))) {
        throw new Error('Incomplete semantic finding');
    }
    const comparison = record.comparison as Record<string, unknown> | null;
    if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison)
        || Object.keys(comparison).length !== 2 || !Object.hasOwn(comparison, 'work') || !Object.hasOwn(comparison, 'baseline')) {
        throw new Error('Incomplete semantic comparison');
    }
    for (const [side, quote] of [['work', record.work_quote], ['baseline', record.contract_quote]] as const) {
        const claim = comparison[side] as Record<string, unknown> | null;
        if (side === 'baseline' && quote === null) {
            if (claim !== null) throw new Error('A baseline extraction requires a baseline quote');
            continue;
        }
        const fields = ['role', 'subject', 'attribute', 'value', 'scope', 'location', 'party', 'condition', 'period'];
        if (!claim || typeof claim !== 'object' || Array.isArray(claim) || Object.keys(claim).length !== fields.length
            || fields.some(key => !Object.hasOwn(claim, key))
            || !STATEMENT_ROLES.includes(claim.role as typeof STATEMENT_ROLES[number])
            || !COMPARISON_ATTRIBUTES.includes(claim.attribute as typeof COMPARISON_ATTRIBUTES[number])
            || typeof claim.subject !== 'string' || !claim.subject.trim() || claim.subject.length > 100
            || fields.slice(3).some(key => claim[key] !== null
                && (typeof claim[key] !== 'string' || !String(claim[key]).trim() || String(claim[key]).length > 120))) {
            throw new Error('Incomplete semantic source extraction');
        }
    }
}

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

    for (const key of ["findings", "results", "items", "finding", "result", "data", "output", "response"]) {
        const nested = record[key];
        if (Array.isArray(nested) || (nested && typeof nested === "object")) {
            const normalized = normalizeFindings(nested);
            if (normalized) return normalized;
        }
    }

    if (Object.keys(record).length === 0) return [];
    if (["title", "description", "category", "work_quote", "contract_quote"].some((key) => key in record)) {
        return [record];
    }

    return null;
}

export function parseScanFindings(text: string, options: { requireSemantic?: boolean } = {}) {
    const cleanText = text.replace(/```json|```/gi, "").trim();

    if (options.requireSemantic) {
        const parsed: unknown = JSON.parse(cleanText); // No recovery of an inner array from a cut-off response.
        if (!Array.isArray(parsed) || parsed.length > 1) throw new Error('Expected zero or one complete semantic finding');
        parsed.forEach(validateSemanticFinding);
        return parsed as ParsedScanFinding[];
    }

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
