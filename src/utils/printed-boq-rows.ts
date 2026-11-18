import { normalizeEvidenceSource } from './radar-evidence-assessment.ts';

export function printedNumber(raw: string): number | null {
    const compact = raw.replace(/[ \u00a0]/g, '');
    const separators = [...compact.matchAll(/[.,]/g)];
    if (!separators.length) return Number(compact);
    const last = separators.at(-1)!, tail = compact.slice(last.index + 1);
    const decimal = tail.length <= 2 || (separators.length === 1 && compact.startsWith('0'));
    const integer = (decimal ? compact.slice(0, last.index) : compact).split(/[.,]/);
    if (integer.length > 1 && (integer[0].length > 3 || integer.slice(1).some(part => part.length !== 3))) return null;
    const value = Number(integer.join('') + (decimal ? `.${tail}` : ''));
    return Number.isFinite(value) ? value : null;
}
export function explicitVatBasis(value: string): 'EXCL' | 'INCL' | null {
    const excluded = /ללא\s*מע["״'׳]{0,2}מ|לפני\s*מע["״'׳]{0,2}מ|לא\s+כולל(?:ים|ות)?\s*מע["״'׳]{0,2}מ|\+\s*מע["״'׳]{0,2}מ|exclud(?:es?|ing)\s+VAT|without\s+VAT/iu.test(value);
    const included = /(?:^|[^\p{L}])(?<!לא\s)כולל\s*מע["״'׳]{0,2}מ|includ(?:es?|ing)\s+VAT/iu.test(value);
    return excluded && !included ? 'EXCL' : included && !excluded ? 'INCL' : null;
}
export function normalizeWorkChangeUnit(value: string) {
    const unit = normalizeEvidenceSource(value).toLowerCase().replace(/["״'׳.]/g, '').trim();
    if (/^(?:מ|מטר|מטרים|m|meter|meters|metre|metres)$/u.test(unit)) return 'm';
    if (/^(?:מק|מטר מעוקב|m3|m³)$/u.test(unit)) return 'm3';
    if (/^(?:מר|מטר מרובע|m2|m²)$/u.test(unit)) return 'm2';
    if (/^(?:יח|יחידה|יחידות|pcs|piece|pieces)$/u.test(unit)) return 'pcs';
    if (/^(?:קומפ|קומפלט|lump sum|ls)$/u.test(unit)) return 'lot';
    return null;
}

export type PrintedBoqRow = {
    itemCode: string; scope: string; quantity: number; unit: string; unitPrice: number; total: number;
    quote: string; start: number; end: number; arithmeticVerified: boolean;
    ambiguousItemCode: boolean; vatBasis: 'EXCL' | 'INCL' | null;
};

/** Decode columns only. Source authority and permitted citation ranges belong to callers. */
export function parsePrintedBoqRows(body: string): PrintedBoqRow[] {
    const rows: PrintedBoqRow[] = [];
    const numeric = '(\\d[\\d,.]*)', unit = '(מטר(?:ים)?|מ["״׳\']?[קר]?|יח[.׳\']?|יחידה|יחידות|m[23³²]?|pcs|lot)';
    const forward = new RegExp(`^${unit}\\s+${numeric}\\s+${numeric}\\s+${numeric}$`, 'iu');
    const reverse = new RegExp(`^${numeric}\\s+${numeric}\\s+${numeric}\\s+${unit}(?:\\s|$)`, 'iu');
    let item: { code: string; start: number } | null = null;
    for (const line of body.matchAll(/[^\n]+/gu)) {
        const code = line[0].match(/(?<![\d.])\d{1,3}(?:\.\d{1,4}){2,4}(?!\d|\.\d)/u);
        if (code) item = { code: code[0], start: line.index };
        if (!item || line.index - item.start > 8_000) continue;
        const normalized = normalizeEvidenceSource(line[0]), f = normalized.match(forward), r = normalized.match(reverse);
        if (!f && !r) continue;
        const values = f ? [f[2], f[3], f[4], f[1]] : [r![3], r![2], r![1], r![4]];
        const quantity = printedNumber(values[0]), unitPrice = printedNumber(values[1]), total = printedNumber(values[2]);
        const canonicalUnit = normalizeWorkChangeUnit(values[3]);
        if (quantity === null || quantity <= 0 || unitPrice === null || total === null || !canonicalUnit) continue;
        if (Math.abs(quantity * unitPrice - total) > 0.5) continue;
        const end = line.index + line[0].length, quote = body.slice(item.start, end);
        rows.push({ itemCode: item.code, scope: body.slice(item.start, line.index).trim(),
            quantity, unit: canonicalUnit, unitPrice, total, quote, start: item.start, end,
            arithmeticVerified: Math.abs(Math.round(quantity * unitPrice * 100) - Math.round(total * 100)) <= 1,
            ambiguousItemCode: false, vatBasis: explicitVatBasis(quote) || explicitVatBasis(body) });
        item = null;
    }
    for (const row of rows) row.ambiguousItemCode = rows.some(other => other !== row && other.itemCode === row.itemCode);
    return rows;
}
