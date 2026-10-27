import { anchorSourceRange, findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { hasDocumentBodyText } from './document-source-readiness.ts';
import type { WorkChangePacket } from './work-change-sources.ts';
import { validateWorkChangeScopes, type WorkChangeScopeComparison } from './work-change-scope.ts';
import { buildWorkChangeFinancialReadiness, type WorkChangeFinancialReadiness } from './work-change-financial-readiness.ts';

export const WORK_CHANGE_VERSION = 'work-change-v1';
export const WORK_CHANGE_FACT_KINDS = ['BASELINE_WORK', 'PROPOSED_WORK', 'BASELINE_TOTAL', 'PROPOSAL_TOTAL',
    'DESIGN_FEE', 'CLAIM_TOTAL', 'AGREEMENT', 'OPEN_QUESTION'] as const;
export type WorkChangeFactKind = typeof WORK_CHANGE_FACT_KINDS[number];
export type WorkChangeFact = {
    id: string; sourceId: string; kind: WorkChangeFactKind; evidence: EvidenceAnchor;
    quantity: number | null; unit: string | null; amountExclVat: number | null; observedAmount: number | null;
    confirmed: boolean; issues: string[];
};
export type WorkChangeComparison = {
    baselineId: string; proposalId: string; status: 'NOT_COMPARABLE' | 'ARITHMETIC_ONLY';
    arithmeticDeltaExclVat: number | null; issues: string[];
};
export type WorkChangeTableRow = {
    id: string; sourceId: string; itemCode: string; quantity: number; unit: string; unitPrice: number; total: number;
    evidence: EvidenceAnchor; arithmeticVerified: boolean; requiresReview: boolean; ambiguousItemCode?: boolean; vatBasis: 'EXCL' | 'INCL' | null;
};
export type WorkChangeReview = {
    version: typeof WORK_CHANGE_VERSION; findingId: string; title: string;
    sources: Array<{ id: string; title: string; role: string; connection: string; readingStatus: string;
        canCompare: boolean; documentStatus: string; selectionComplete: boolean; readingGaps: string[] }>;
    facts: WorkChangeFact[]; tableRows: WorkChangeTableRow[]; comparisons: WorkChangeComparison[];
    scopeComparisons: WorkChangeScopeComparison[]; scopeUnmatchedIds: string[]; limitations: string[];
    financialReadiness: WorkChangeFinancialReadiness;
    ownerNotes: WorkChangePacket['ownerNotes']; requiresReview: boolean; paymentEntitlementConfirmed: false;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function printedNumber(raw: string): number | null {
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
function numberInQuote(quote: string, value: unknown): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    return [...quote.matchAll(/(?<![\p{L}\d./])(?:\d{1,3}(?:[ ,.\u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,6})?)(?![\p{L}\d./])/gu)]
        .some(match => !/^\s*%/u.test(quote.slice(match.index + match[0].length)) && printedNumber(match[0]) === value);
}
function explicitVatBasis(value: string): 'EXCL' | 'INCL' | null {
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

function quantityInQuote(quote: string, value: unknown, unit: string) {
    if (!normalizeWorkChangeUnit(unit) || !numberInQuote(quote, value)) return false;
    const body = normalizeEvidenceSource(quote);
    const escaped = normalizeEvidenceSource(unit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const afterUnit = new RegExp(`^\\s*${escaped}(?![\\p{L}\\d])`, 'iu');
    const beforeUnit = new RegExp(`(?<![\\p{L}\\d])${escaped}\\s*$`, 'iu');
    for (const match of body.matchAll(/(?<![\p{L}\d./])(?:\d{1,3}(?:[ ,.\u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,6})?)(?![\p{L}\d./])/gu)) {
        if (printedNumber(match[0]) !== value) continue;
        const before = body.slice(Math.max(0, match.index - 45), match.index);
        const after = body.slice(match.index + match[0].length, match.index + match[0].length + 45);
        if (/(?:קוטר|עומק|עד|diameter|depth)\s*(?:של\s*)?$/iu.test(before)) continue;
        if (afterUnit.test(after) || beforeUnit.test(before)) return true;
    }
    return false;
}

/** Only explicit numeric table columns are decoded; prose numbers never become rows. */
function tableRows(packet: WorkChangePacket): WorkChangeTableRow[] {
    const rows: WorkChangeTableRow[] = [];
    const numeric = '(\\d[\\d,.]*)', unit = '(מטר(?:ים)?|מ["״׳\']?[קר]?|יח[.׳\']?|יחידה|יחידות|m[23³²]?|pcs|lot)';
    const forward = new RegExp(`^${unit}\\s+${numeric}\\s+${numeric}\\s+${numeric}$`, 'iu');
    const reverse = new RegExp(`^${numeric}\\s+${numeric}\\s+${numeric}\\s+${unit}(?:\\s|$)`, 'iu');
    for (const source of packet.sources) {
        const body = String(source.extracted_text || '');
        let item: { code: string; start: number } | null = null;
        for (const line of body.matchAll(/[^\n]+/gu)) {
            const code = line[0].match(/(?<![\d.])\d{1,3}(?:\.\d{1,4}){2,4}(?!\d|\.\d)/u);
            if (code) item = { code: code[0], start: line.index };
            if (!item || line.index - item.start > 8_000) continue;
            if (source.role === 'CONTRACT' && source.referencedItemCodes?.length
                && !source.referencedItemCodes.includes(item.code.split('.').map(part => String(Number(part))).join('.'))) continue;
            const normalized = normalizeEvidenceSource(line[0]), f = normalized.match(forward), r = normalized.match(reverse);
            if (!f && !r) continue;
            const values = f ? [f[2], f[3], f[4], f[1]] : [r![3], r![2], r![1], r![4]];
            const quantity = printedNumber(values[0]), unitPrice = printedNumber(values[1]), total = printedNumber(values[2]);
            const canonicalUnit = normalizeWorkChangeUnit(values[3]);
            if (quantity === null || quantity <= 0 || unitPrice === null || total === null || !canonicalUnit) continue;
            if (Math.abs(quantity * unitPrice - total) > 0.5) continue;
            const end = line.index + line[0].length;
            const full = source.role === 'PRIMARY' || (source.role === 'RELATED' && body.length <= 16_000);
            if (!full && !source.selection.source_anchors.some(anchor => item!.start >= anchor.start && end <= anchor.end)) continue;
            const arithmeticVerified = Math.abs(Math.round(quantity * unitPrice * 100) - Math.round(total * 100)) <= 1;
            const evidence = anchorSourceRange(source, item.start, end);
            rows.push({ id: `T${rows.length + 1}`, sourceId: source.id, itemCode: item.code, quantity, unit: canonicalUnit,
                unitPrice, total, evidence, arithmeticVerified,
                requiresReview: !source.readiness.canCompare || !arithmeticVerified,
                vatBasis: explicitVatBasis(evidence.quote) || explicitVatBasis(body) });
            item = null;
        }
    }
    for (const row of rows) if (rows.some(other => other !== row && other.sourceId === row.sourceId && other.itemCode === row.itemCode)) {
        row.ambiguousItemCode = true; row.requiresReview = true;
    }
    return rows;
}

function explicitDesignerFees(packet: WorkChangePacket) {
    return packet.sources.filter(source => source.role !== 'CONTRACT').flatMap(source => {
        const body = String(source.extracted_text || '');
        // A dedicated fee offer can supply this field. An unrelated design annex
        // inside a mixed contract must not relabel neighbouring execution totals.
        if (!/שכר\s+טרחה|שכ["״']{1,2}ט|(?:design|planning)\s+fee/iu.test(normalizeEvidenceSource(body.slice(0, 1_500)))) return [];
        return [...body.matchAll(/(?<![\d./])\d[\d,.]*(?:\s|\t)*(?:₪|ש["״']{0,2}ח|NIS)/giu)].flatMap(match => {
            const start = Math.max(0, match.index - 400), end = Math.min(body.length, match.index + match[0].length + 180);
            const quote = body.slice(start, end), readable = normalizeEvidenceSource(quote);
            if (!/שכר\s+טרחה|שכ["״']{1,2}ט|(?:design|planning)\s+fee/iu.test(readable)) return [];
            const amount = printedNumber(match[0].match(/\d[\d,.]*/u)![0]);
            return amount === null ? [] : [{ sourceId: source.id, kind: 'DESIGN_FEE', quote, quantity: null, unit: '', amountExclVat: amount }];
        });
    });
}

/** Quotes and arithmetic are checked here. A source-backed fact is not an approved payment entitlement. */
export function validateWorkChangeReview(packet: WorkChangePacket, draft: unknown): WorkChangeReview {
    const input = object(draft), limitations = [...packet.limitations], facts: WorkChangeFact[] = [];
    const seen = new Set<string>();
    for (const [index, raw] of [...list(input.facts), ...explicitDesignerFees(packet)].entries()) {
        const value = object(raw), source = packet.sources.find(source => source.id === value.sourceId);
        const anchor = source && text(value.quote) ? findEvidenceAnchor(source, text(value.quote)) : null;
        if (!anchor || !hasDocumentBodyText(anchor.quote)) { limitations.push('fact_quote_unverified'); continue; }
        if (!WORK_CHANGE_FACT_KINDS.includes(value.kind as WorkChangeFactKind)) { limitations.push('fact_kind_unverified'); continue; }
        const kind = value.kind as WorkChangeFactKind;
        if (kind === 'DESIGN_FEE' && !/תכנון|מתכנ|שכ["״]?ט|שכר\s+טרחה|design|planning/iu.test(normalizeEvidenceSource(String(source!.extracted_text || '').slice(Math.max(0, anchor.start - 400), anchor.end)))) {
            limitations.push('fact_kind_unverified'); continue;
        }
        const key = `${source!.id}:${anchor.start}:${anchor.end}:${kind}:${JSON.stringify([value.quantity ?? null, text(value.unit), value.amountExclVat ?? null])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const issues: string[] = [];
        if (kind === 'PROPOSED_WORK' && source!.role === 'CONTRACT') issues.push('work_role_unverified');
        if (!source!.readiness.canCompare) issues.push('source_reading_unverified');
        const observedAmount = numberInQuote(anchor.quote, value.amountExclVat) ? value.amountExclVat as number : null;
        if (value.amountExclVat !== null && value.amountExclVat !== undefined && observedAmount === null) issues.push('amount_unverified');
        const basis = explicitVatBasis(anchor.quote) || explicitVatBasis(String(source!.extracted_text || ''));
        if (observedAmount !== null && basis !== 'EXCL') issues.push('vat_basis_unverified');
        const unitRate = /מחיר\s*(?:ה)?יחידה|unit\s+price|למטר|ליחידה|per\s+(?:unit|met(?:er|re))/iu.test(anchor.quote);
        if (observedAmount !== null && unitRate && !/סה["״']?כ|סך\s*הכל|\btotal\b/iu.test(anchor.quote)) issues.push('unit_price_not_total');
        const unit = text(value.unit), sourceUnit = normalizeEvidenceSource(anchor.quote).toLowerCase();
        const unitPresent = Boolean(normalizeWorkChangeUnit(unit) && sourceUnit.includes(normalizeEvidenceSource(unit).toLowerCase()));
        const quantity = unitPresent && quantityInQuote(anchor.quote, value.quantity, unit) ? value.quantity as number : null;
        if (value.quantity !== null && value.quantity !== undefined && quantity === null) issues.push('quantity_unverified');
        if (kind.endsWith('_WORK') && quantity === null) issues.push('quantity_unknown');
        const amountExclVat = source!.readiness.canCompare && basis === 'EXCL'
            && !issues.includes('design_scope_unverified') && !issues.includes('unit_price_not_total') ? observedAmount : null;
        facts.push({ id: `F${index + 1}`, sourceId: source!.id, kind, evidence: anchor,
            quantity: source!.readiness.canCompare ? quantity : null, unit: unitPresent ? normalizeWorkChangeUnit(unit) : null,
            amountExclVat, observedAmount, confirmed: source!.readiness.canCompare && issues.length === 0, issues });
    }
    const comparisons: WorkChangeComparison[] = [], seenPairs = new Set<string>();
    for (const raw of list(input.comparisons)) {
        const value = object(raw), baseline = facts.find(fact => fact.id === value.baselineId && fact.kind === 'BASELINE_WORK');
        const proposal = facts.find(fact => fact.id === value.proposalId && fact.kind === 'PROPOSED_WORK');
        if (!baseline || !proposal) { limitations.push('comparison_sources_unverified'); continue; }
        const key = `${baseline.id}:${proposal.id}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const issues: string[] = [];
        if (value.composition !== 'SAME') issues.push('composition_unverified');
        if (!baseline.unit || baseline.unit !== proposal.unit) issues.push('unit_differs');
        if (baseline.quantity === null || proposal.quantity === null) issues.push('quantity_unknown');
        else if (baseline.quantity !== proposal.quantity) issues.push('quantity_differs');
        if (baseline.amountExclVat === null || proposal.amountExclVat === null) issues.push('amount_unverified');
        if (!baseline.confirmed || !proposal.confirmed) issues.push('source_fact_requires_review');
        const delta = issues.length === 0 ? (Math.round(proposal.amountExclVat! * 100) - Math.round(baseline.amountExclVat! * 100)) / 100 : null;
        comparisons.push({ baselineId: baseline.id, proposalId: proposal.id, status: delta === null ? 'NOT_COMPARABLE' : 'ARITHMETIC_ONLY',
            arithmeticDeltaExclVat: delta, issues });
    }
    if (!facts.length) limitations.push('no_grounded_facts');
    if (!comparisons.length) limitations.push('work_comparison_missing');
    const extractedRows = tableRows(packet), scope = validateWorkChangeScopes(packet, extractedRows, input.scopeComparisons);
    if (scope.comparisons.length) {
        const missing = limitations.indexOf('work_comparison_missing');
        if (missing >= 0) limitations.splice(missing, 1);
        const empty = limitations.indexOf('no_grounded_facts');
        if (empty >= 0) limitations.splice(empty, 1);
        limitations.push('financial_scope_not_established');
    }
    limitations.push(...scope.limitations);
    const uniqueLimitations = [...new Set(limitations)];
    return { version: WORK_CHANGE_VERSION, findingId: packet.findingId, title: packet.title,
        sources: packet.sources.map(source => {
            const proof = object(object(source.parsed_json).source_reading), readingGaps: string[] = [];
            for (const page of list(proof.unreadablePages)) readingGaps.push(`עמוד ${String(page)} לא פוענח באופן מאומת.`);
            list(proof.images).forEach((raw, index) => { const image = object(raw);
                if (image.numericReviewRequired) readingGaps.push(`תמונה ${index + 1}: יש לאמת את המספרים מול המקור.`);
                else if (image.status !== 'READ') readingGaps.push(`תמונה ${index + 1}: הקריאה לא הושלמה באופן מאומת.`); });
            if (!source.readiness.extractionComplete && !readingGaps.length) readingGaps.push('כיסוי כל תוכן המקור עדיין לא אומת.');
            return { id: source.id, title: source.title, role: source.role,
                connection: source.connection.kind, readingStatus: source.readiness.status, canCompare: source.readiness.canCompare,
                documentStatus: source.readiness.documentStatus, selectionComplete: source.selection.complete, readingGaps };
        }),
        facts, tableRows: extractedRows, comparisons, scopeComparisons: scope.comparisons, scopeUnmatchedIds: scope.unmatchedIds,
        financialReadiness: buildWorkChangeFinancialReadiness(packet, extractedRows, scope.comparisons),
        ownerNotes: packet.ownerNotes, limitations: uniqueLimitations,
        requiresReview: uniqueLimitations.length > 0 || facts.some(fact => !fact.confirmed) || extractedRows.some(row => row.requiresReview)
            || comparisons.some(pair => pair.status === 'NOT_COMPARABLE'),
        paymentEntitlementConfirmed: false };
}
