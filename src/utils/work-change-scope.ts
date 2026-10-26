import { findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import type { WorkChangePacket } from './work-change-sources.ts';
import type { WorkChangeTableRow } from './work-change-review.ts';

export const WORK_CHANGE_SCOPE_VERSION = 'work-change-scope-v1';
export const WORK_CHANGE_COMPONENTS = ['METHOD_WORK', 'MATERIAL_SUPPLY', 'SHAFT', 'ANCILLARY'] as const;
export type WorkChangeComponent = typeof WORK_CHANGE_COMPONENTS[number];
export type WorkChangeScopeComparison = {
    id: string; component: WorkChangeComponent; baselineIds: string[]; proposalIds: string[];
    composition: 'SAME' | 'DIFFERENT' | 'UNKNOWN'; evidence: EvidenceAnchor[]; issues: string[];
    arithmeticDeltaExclVat: null;
};
type ScopeCandidate = {
    id: string; sourceId: string; sourceTitle: string; side: 'BASELINE' | 'PROPOSAL';
    component: WorkChangeComponent; itemCode: string; quote: string; quantity: number; unit: string;
};
type ScopeBasis = { id: string; evidence: EvidenceAnchor; baseline: string; proposal: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) && value.every(item => typeof item === 'string') ? value : [];

/** These are retrieval hints, not a claim of semantic equivalence or contractual authority. */
function componentHint(value: string): WorkChangeComponent | null {
    const body = normalizeEvidenceSource(value);
    if (/אספק(?:ה|ת)[^\p{L}\n]{0,12}בלבד|בלבד[^\p{L}\n]{0,12}אספקה|supply\s+only/iu.test(body)) return 'MATERIAL_SUPPLY';
    const description = body.replace(/^\s*(?:\d+(?:\.\d+){2,4})?\s*/u, '');
    if (/^(?:ביצוע\s+|התקנת\s+)?(?:פיר|שוח[הת]|תא\s+בקרה)|(?:ביצוע|התקנת)\s+פיר|^(?:construct(?:ion)?\s+)?(?:shaft|manhole)/iu.test(description.slice(0, 200))) return 'SHAFT';
    if (/דחיק[הת]|קידוח|\bdrill(?:ing)?\b|\bjacking\b/iu.test(description)) return 'METHOD_WORK';
    if (/הסדרי\s+תנועה|דרכי\s+גישה|מעקפי\s+זרימה|traffic\s+management|access\s+road|flow\s+bypass/iu.test(description)) return 'ANCILLARY';
    return null;
}

function replacementParts(line: string) {
    // Read the from/to statement itself. No technology name, item code or project amount is encoded here.
    if (/(?:לא|אין)\s+(?:הצעה\s+)?(?:לשנות|להחליף)|do\s+not\s+replace/iu.test(line)) return null;
    const patterns = [
        /(?:לשנות|לשינוי)\s+[^;\n]{0,120}?\sמ([\p{L}][^;\n]{2,800}?)\sל((?:שיטת|ביצוע|טכנולוגיית|עבודת)[^;\n]{3,800})/u,
        /(?:יוחלף|להחליף)\s+(?:את\s+)?([^;\n]{3,800}?)\sב((?:שיטת|ביצוע|טכנולוגיית)[^;\n]{3,800})/u,
        /\breplace\s+(.{3,800}?)\s+with\s+(.{3,800})/iu,
    ];
    for (const pattern of patterns) { const match = line.match(pattern); if (match) return { baseline: match[1].trim(), proposal: match[2].trim() }; }
    return null;
}

export function buildWorkChangeScopeContext(packet: WorkChangePacket, rows: WorkChangeTableRow[]) {
    const basis: ScopeBasis[] = [], seen = new Set<string>();
    for (const source of packet.sources.filter(source => source.role !== 'CONTRACT')) {
        const body = String(source.extracted_text || '');
        const ranges = source.role === 'PRIMARY' || body.length <= 16_000 ? [body] : source.selection.source_anchors.map(anchor => anchor.quote);
        for (const range of ranges) for (const line of range.split('\n')) {
            const parts = replacementParts(line);
            if (!parts || seen.has(normalizeEvidenceSource(line))) continue;
            const evidence = findEvidenceAnchor(source, line.trim());
            if (!evidence) continue;
            seen.add(normalizeEvidenceSource(line));
            basis.push({ id: `R${basis.length + 1}`, evidence, ...parts });
        }
    }
    const candidates: ScopeCandidate[] = [];
    for (const row of rows) {
        const source = packet.sources.find(source => source.id === row.sourceId);
        if (!source) continue;
        const component = componentHint(row.evidence.quote);
        if (!component) continue;
        const baseline = source.role === 'CONTRACT' && source.connection.kind !== 'CANDIDATE';
        const proposal = source.role !== 'CONTRACT'
            && /הצעת\s*(?:ה)?מחיר|quotation|price\s+proposal/iu.test(normalizeEvidenceSource(String(source.extracted_text || '')));
        if (!baseline && !proposal) continue;
        candidates.push({ id: row.id, sourceId: source.id, sourceTitle: source.title, side: baseline ? 'BASELINE' : 'PROPOSAL',
            component, itemCode: row.itemCode, quote: row.evidence.quote, quantity: row.quantity, unit: row.unit });
    }
    return { version: WORK_CHANGE_SCOPE_VERSION, basis, candidates };
}

export function validateWorkChangeScopes(packet: WorkChangePacket, rows: WorkChangeTableRow[], draft: unknown) {
    const context = buildWorkChangeScopeContext(packet, rows), comparisons: WorkChangeScopeComparison[] = [], limitations: string[] = [];
    const values = Array.isArray(draft) ? draft : [], used = new Set<string>();
    for (const raw of values) {
        const value = record(raw), component = value.component as WorkChangeComponent;
        const baselineIds = [...new Set(strings(value.baselineIds))], proposalIds = [...new Set(strings(value.proposalIds))];
        const baseline = baselineIds.map(id => context.candidates.find(row => row.id === id && row.side === 'BASELINE'));
        const proposal = proposalIds.map(id => context.candidates.find(row => row.id === id && row.side === 'PROPOSAL'));
        if (!baseline.length || !proposal.length || baseline.some(row => !row) || proposal.some(row => !row)) {
            // Distinguish a supplied but unrelated row from a role reversal.
            const suppliedRows = [...baselineIds, ...proposalIds].map(id => rows.find(row => row.id === id));
            limitations.push(suppliedRows.some(row => row && !componentHint(row.evidence.quote)) ? 'scope_component_unverified' : 'scope_roles_unverified');
            continue;
        }
        if (!WORK_CHANGE_COMPONENTS.includes(component) || [...baseline, ...proposal].some(row => row!.component !== component)) {
            limitations.push('scope_component_unverified'); continue;
        }
        const basisIds = [...new Set(strings(value.basisIds))], basis = basisIds.map(id => context.basis.find(item => item.id === id));
        if (!basis.length || basis.some(item => !item)) { limitations.push('scope_basis_unverified'); continue; }
        if (!['SAME', 'DIFFERENT', 'UNKNOWN'].includes(String(value.composition))) { limitations.push('scope_composition_unverified'); continue; }
        const key = JSON.stringify([component, [...baselineIds].sort(), [...proposalIds].sort()]);
        if (used.has(key)) continue;
        used.add(key);
        const selectedRows = [...baselineIds, ...proposalIds].map(id => rows.find(row => row.id === id)!);
        const sourceIds = new Set([...selectedRows.map(row => row.sourceId), ...basis.map(item => item!.evidence.documentId)]);
        const sources = packet.sources.filter(source => sourceIds.has(source.id)), issues: string[] = ['financial_scope_not_established'];
        if (sources.some(source => !source.readiness.canCompare)) issues.push('source_reading_unverified');
        if (sources.some(source => source.readiness.documentStatus !== 'FINAL')) issues.push('document_status_unverified');
        if (selectedRows.some(row => row.ambiguousItemCode)) issues.push('ambiguous_item_scope');
        if (selectedRows.some(row => !row.arithmeticVerified)) issues.push('printed_rounding_requires_review');
        if (new Set(selectedRows.map(row => row.unit)).size > 1) issues.push('unit_differs');
        if (baseline.length !== 1 || proposal.length !== 1) issues.push('quantities_not_reconciled');
        else if (baseline[0]!.quantity !== proposal[0]!.quantity) issues.push('quantity_differs');
        if (value.composition === 'UNKNOWN') issues.push('composition_unverified');
        comparisons.push({ id: `S${comparisons.length + 1}`, component, baselineIds, proposalIds,
            composition: value.composition as WorkChangeScopeComparison['composition'], evidence: basis.map(item => item!.evidence),
            issues, arithmeticDeltaExclVat: null });
    }
    // A component is a set of operations/variants. Pairwise model output must not
    // imply that every original shaft is an individual replacement for every new one.
    const grouped: WorkChangeScopeComparison[] = [];
    for (const comparison of comparisons) {
        const existing = grouped.find(item => item.component === comparison.component);
        if (!existing) { grouped.push({ ...comparison, id: `S${grouped.length + 1}` }); continue; }
        existing.baselineIds = [...new Set([...existing.baselineIds, ...comparison.baselineIds])];
        existing.proposalIds = [...new Set([...existing.proposalIds, ...comparison.proposalIds])];
        existing.issues = [...new Set([...existing.issues, ...comparison.issues])];
        for (const evidence of comparison.evidence) if (!existing.evidence.some(item => item.documentId === evidence.documentId
            && item.start === evidence.start && item.end === evidence.end)) existing.evidence.push(evidence);
        if (comparison.composition === 'DIFFERENT') existing.composition = 'DIFFERENT';
        else if (comparison.composition === 'UNKNOWN' && existing.composition === 'SAME') existing.composition = 'UNKNOWN';
    }
    for (const comparison of grouped) {
        if (comparison.baselineIds.length > 1 || comparison.proposalIds.length > 1) comparison.issues.push('quantities_not_reconciled');
        comparison.issues = [...new Set(comparison.issues)];
        if (comparison.composition === 'SAME' && comparison.issues.some(issue => ['quantity_differs', 'unit_differs', 'quantities_not_reconciled'].includes(issue))) {
            comparison.composition = 'UNKNOWN';
            if (!comparison.issues.includes('composition_unverified')) comparison.issues.push('composition_unverified');
        }
    }
    const selected = new Set(grouped.flatMap(item => [...item.baselineIds, ...item.proposalIds]));
    const unmatchedIds = context.candidates.filter(candidate => !selected.has(candidate.id)
        && !context.candidates.some(other => selected.has(other.id) && other.sourceId !== candidate.sourceId
            && other.side === candidate.side && other.component === candidate.component && other.itemCode === candidate.itemCode
            && other.quantity === candidate.quantity && other.unit === candidate.unit
            && normalizeEvidenceSource(other.quote) === normalizeEvidenceSource(candidate.quote))).map(candidate => candidate.id);
    if (unmatchedIds.length) limitations.push('scope_rows_unmatched');
    return { comparisons: grouped, unmatchedIds, limitations: [...new Set(limitations)], context };
}
