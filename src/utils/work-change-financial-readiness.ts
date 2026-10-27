import { anchorSourceRange, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import type { WorkChangePacket, WorkChangeSource } from './work-change-sources.ts';
import type { WorkChangeTableRow } from './work-change-review.ts';
import type { WorkChangeScopeComparison, WorkChangeComponent } from './work-change-scope.ts';

type Quantity = {
    sourceId: string; rowIds: string[]; unit: string; value: number | null; observedValue: number;
    lengthPerPieceM: number | null; derivedLengthM: number | null; evidence: EvidenceAnchor[]; issues: string[];
};
type SourceTotal = {
    sourceId: string; scope: 'WHOLE_DOCUMENT'; netExclVat: number | null; observedNet: number;
    observedVat: number; observedGross: number; derivedVatPercent: number | null; printedVatPercent: number | null;
    arithmeticVerified: boolean; evidence: EvidenceAnchor[]; issues: string[];
};
export type WorkChangeFinancialReadiness = {
    quantities: Array<{ component: WorkChangeComponent; baseline: Quantity[]; proposal: Quantity[] }>;
    sourceTotals: SourceTotal[];
    mentions: Array<{ sourceId: string; value: number; evidence: EvidenceAnchor[]; requiresReview: true; canCompare: boolean }>;
    terms: Array<{ sourceId: string; evidence: EvidenceAnchor }>;
    adjustments: Array<{ sourceId: string; percent: number; evidence: EvidenceAnchor }>;
    confirmations: Array<{ code: 'MEASURED_SCOPE' | 'PRICE_BASIS_AND_APPROVAL' | 'INCLUSIONS_AND_RESPONSIBILITIES'
        | 'PRICE_ADJUSTMENTS' | 'HISTORICAL_VAT_RATE' | 'SOURCE_READING' | 'PRINTED_ARITHMETIC'; sourceIds: string[] }>;
    deltaExclVat: null; paymentEntitlementConfirmed: false;
};
const round = (value: number, places = 2) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const numberPattern = /(?<![\d./])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?<![\d./])\d+(?:\.\d{1,6})?(?![\d./])/gu;
const vatLabel = /מע\s*["״'׳]{0,2}\s*מ|\bVAT\b/iu;

function lineValue(body: string) {
    const numbers = [...body.matchAll(numberPattern)].filter(match =>
        !/^\s*%/u.test(body.slice(match.index + match[0].length))
        && !/%\s*$/u.test(body.slice(0, match.index)));
    if (numbers.length !== 1) return null;
    const match = numbers[0];
    if (/[-−(]\s*$/u.test(body.slice(0, match.index)) || /^\s*[-−)]/u.test(body.slice(match.index + match[0].length))) return null;
    return Number(match[0].replace(/,/g, ''));
}

/** A source-wide printed total is never a subtotal of the selected replacement work. */
function totals(source: WorkChangeSource): SourceTotal[] {
    const body = String(source.extracted_text || '');
    const lines = [...body.matchAll(/[^\n]+/gu)].map(match => ({ start: match.index, end: match.index + match[0].length,
        text: normalizeEvidenceSource(match[0]).replace(/\s*(["״])\s*/gu, '$1') }));
    const result: SourceTotal[] = [];
    for (let i = 0; i + 2 < lines.length; i++) {
        const [net, tax, gross] = lines.slice(i, i + 3);
        if (!/(?:סה["״']?כ\s*(?:עלות|כללי)|סך\s*הכל|\bnet\s+total\b)/iu.test(net.text) || vatLabel.test(net.text)) continue;
        if (!vatLabel.test(tax.text) || !/(?:כולל|including)/iu.test(gross.text) || !vatLabel.test(gross.text)) continue;
        const observedNet = lineValue(net.text), observedGross = lineValue(gross.text);
        // Percent glyphs may precede RTL digits. Preserve that observation, even when it disagrees with the amounts.
        const percent = tax.text.match(/(?<![\d.,])(\d{1,2}(?:\.\d{1,2})?)\s*%(?!\s*\d)|%\s*(\d(?:[ \t]*\d)?(?:\.\d+)?)/u);
        const printedVatPercent = percent ? Number((percent[1] || percent[2]).replace(/\s/g, '')) : null;
        const taxWithoutRate = percent ? tax.text.replace(percent[0], '') : tax.text;
        const observedVat = lineValue(taxWithoutRate);
        if (observedNet === null || observedVat === null || observedGross === null) continue;
        const arithmeticVerified = Math.round(observedNet * 100) + Math.round(observedVat * 100) === Math.round(observedGross * 100);
        const derivedVatPercent = observedNet > 0 ? round(observedVat / observedNet * 100, 4) : null;
        const issues = [!source.readiness.canCompare ? 'source_reading_unverified' : '',
            !arithmeticVerified ? 'printed_total_equation_unverified' : '',
            printedVatPercent !== null && derivedVatPercent !== null && Math.abs(printedVatPercent - derivedVatPercent) > 0.01
                ? 'printed_vat_rate_unverified' : ''].filter(Boolean);
        result.push({ sourceId: source.id, scope: 'WHOLE_DOCUMENT', observedNet, observedVat, observedGross,
            netExclVat: arithmeticVerified && source.readiness.canCompare ? observedNet : null,
            derivedVatPercent, printedVatPercent, arithmeticVerified, issues,
            evidence: [anchorSourceRange(source, net.start, gross.end)] });
    }
    return result;
}

function perPieceLength(row: WorkChangeTableRow): number | null {
    const body = normalizeEvidenceSource(row.evidence.quote);
    // Require a length explicitly attached to one pipe. Diameter/depth and arbitrary nearby metre values are excluded.
    const match = body.match(/(?:ל?יחידת\s+צינור|ביחידות)\s+באורך\s+(?:(\d+(?:[.,]\d+)?)\s*(?:מטר(?:ים)?|מ[׳'״"]?|m)(?![\p{L}\d])|(?:מטר(?:ים)?|מ[׳'״"]?|m)\s+(\d+(?:[.,]\d+)?)(?![\d.]))/iu);
    const reverse = body.match(/(?:מטר(?:ים)?|מ[׳'״"]?|m)\s+(\d+(?:[.,]\d+)?)\s+הינו\s+ליחידת\s+צינור\s+באורך/iu);
    const value = match ? match[1] || match[2] : reverse?.[1];
    const length = value ? Number(value.replace(',', '.')) : null;
    return length !== null && length > 0 ? length : null;
}

function quantities(packet: WorkChangePacket, rows: WorkChangeTableRow[], ids: string[], component: WorkChangeComponent): Quantity[] {
    const selected = rows.filter(row => ids.includes(row.id));
    const keys = [...new Set(selected.map(row => `${row.sourceId}:${row.unit}`))];
    return keys.map(key => {
        const group = selected.filter(row => `${row.sourceId}:${row.unit}` === key);
        const source = packet.sources.find(source => source.id === group[0].sourceId)!;
        const observedValue = round(group.reduce((sum, row) => sum + row.quantity, 0), 6);
        const readable = source.readiness.canCompare && group.every(row => !row.ambiguousItemCode);
        const lengths = component === 'MATERIAL_SUPPLY' && group[0].unit === 'pcs' ? group.map(perPieceLength) : [];
        const lengthPerPieceM = lengths.length && lengths.every(value => value !== null && value === lengths[0]) ? lengths[0] : null;
        return { sourceId: source.id, rowIds: group.map(row => row.id), unit: group[0].unit,
            value: readable ? observedValue : null, observedValue, lengthPerPieceM,
            derivedLengthM: readable && lengthPerPieceM !== null ? round(observedValue * lengthPerPieceM, 6) : null,
            evidence: group.map(row => row.evidence), issues: [!source.readiness.canCompare ? 'source_reading_unverified' : '',
                group.some(row => row.ambiguousItemCode) ? 'ambiguous_item_scope' : ''].filter(Boolean) };
    });
}

/** Read already saved text and validated rows. No model call, source re-reading, ledger write or entitlement decision. */
export function buildWorkChangeFinancialReadiness(packet: WorkChangePacket, rows: WorkChangeTableRow[], scope: WorkChangeScopeComparison[]): WorkChangeFinancialReadiness {
    const result: WorkChangeFinancialReadiness = { quantities: [], sourceTotals: [], mentions: [], terms: [], adjustments: [],
        confirmations: [], deltaExclVat: null, paymentEntitlementConfirmed: false };
    for (const component of [...new Set(scope.map(pair => pair.component))]) {
        const pairs = scope.filter(pair => pair.component === component);
        result.quantities.push({ component,
            baseline: quantities(packet, rows, [...new Set(pairs.flatMap(pair => pair.baselineIds))], component),
            proposal: quantities(packet, rows, [...new Set(pairs.flatMap(pair => pair.proposalIds))], component) });
    }
    const relevantIds = new Set(scope.flatMap(pair => [...pair.baselineIds, ...pair.proposalIds])
        .map(id => rows.find(row => row.id === id)?.sourceId).filter(Boolean));
    for (const source of packet.sources) {
        if (relevantIds.has(source.id)) result.sourceTotals.push(...totals(source));
        if (source.role === 'CONTRACT') continue;
        const body = String(source.extracted_text || '');
        const ranges = source.role === 'PRIMARY' || source.selection.complete
            ? [{ start: 0, end: body.length }] : source.selection.source_anchors;
        const inRange = (start: number, end: number) => ranges.some(range => start >= range.start && end <= range.end);
        // Currency-labelled prose amounts remain reported statements, separate from the explicit table total.
        for (const match of body.matchAll(/(?<![\d./])\d[\d,.]*[ \t]*(?:₪|ש["״']{0,2}ח|NIS)/giu)) {
            if (!inRange(match.index, match.index + match[0].length)) continue;
            if (/[-−(]\s*$/u.test(body.slice(Math.max(0, match.index - 8), match.index))) continue;
            const printed = match[0].match(/\d[\d,.]*/u)![0];
            if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/u.test(printed)) continue;
            const value = Number(printed.replace(/,/g, ''));
            if (!Number.isFinite(value)) continue;
            const start = Math.max(body.lastIndexOf('\n', match.index) + 1, match.index - 160);
            const newline = body.indexOf('\n', match.index + match[0].length);
            const end = Math.min(newline < 0 ? body.length : newline, match.index + match[0].length + 160);
            result.mentions.push({ sourceId: source.id, value, requiresReview: true, canCompare: source.readiness.canCompare,
                evidence: [anchorSourceRange(source, start, end)] });
        }
        for (const match of body.matchAll(/\d+(?:[.,]\d+)?\s*%/gu)) {
            if (!inRange(match.index, match.index + match[0].length)) continue;
            const start = Math.max(0, match.index - 130), end = Math.min(body.length, match.index + match[0].length + 130);
            const context = normalizeEvidenceSource(body.slice(start, end));
            if (!/הנח[הת]|רווח|להוסיף|discount|markup/iu.test(context) || vatLabel.test(context.slice(Math.max(0, context.indexOf(match[0]) - 20)))) continue;
            result.adjustments.push({ sourceId: source.id, percent: Number(match[0].replace(/[\s%]/g, '').replace(',', '.')),
                evidence: anchorSourceRange(source, start, end) });
        }
        for (const match of body.matchAll(/על\s+אחריות\s+וחשבון\s+מזמין\s+העבודה\s*:/gu)) {
            if (!inRange(match.index, match.index + match[0].length)) continue;
            const signature = body.indexOf('מאשר כתב הכמויות', match.index + match[0].length);
            const start = Math.max(0, body.lastIndexOf('\nהערות', match.index));
            const end = Math.min(signature < 0 ? body.length : signature, match.index + 2_500);
            result.terms.push({ sourceId: source.id, evidence: anchorSourceRange(source, start || match.index, end) });
        }
    }
    const sourceIds = [...new Set([...relevantIds, ...packet.primarySourceIds])].filter((id): id is string => typeof id === 'string');
    if (scope.length || result.mentions.length || result.sourceTotals.length) {
        result.confirmations.push(...(['MEASURED_SCOPE', 'PRICE_BASIS_AND_APPROVAL', 'INCLUSIONS_AND_RESPONSIBILITIES', 'PRICE_ADJUSTMENTS'] as const)
            .map(code => ({ code, sourceIds })));
    }
    if (result.sourceTotals.some(total => total.arithmeticVerified && total.derivedVatPercent !== null && Math.abs(total.derivedVatPercent - 18) > 0.01)) {
        result.confirmations.push({ code: 'HISTORICAL_VAT_RATE', sourceIds: [...new Set(result.sourceTotals.filter(total => total.derivedVatPercent !== null && Math.abs(total.derivedVatPercent - 18) > 0.01).map(total => total.sourceId))] });
    }
    const unread = packet.sources.filter(source => !source.readiness.canCompare).map(source => source.id);
    if (unread.length) result.confirmations.push({ code: 'SOURCE_READING', sourceIds: unread });
    const rounding = rows.filter(row => relevantIds.has(row.sourceId) && !row.arithmeticVerified).map(row => row.sourceId);
    if (rounding.length || result.sourceTotals.some(total => !total.arithmeticVerified || total.issues.includes('printed_vat_rate_unverified'))) {
        result.confirmations.push({ code: 'PRINTED_ARITHMETIC', sourceIds: [...new Set([...rounding, ...result.sourceTotals.filter(total => total.issues.length).map(total => total.sourceId)])] });
    }
    return result;
}
