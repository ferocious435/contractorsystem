import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { findEvidenceAnchor, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { readEvidenceMeaning, type StatementRole } from './radar-evidence-meaning.ts';
import { getLedgerRowAmount, getMoneySum } from './project-financials.ts';
import type { SupportCandidate } from './support-source-enrichment.ts';
import { explicitPricingQuantity } from './pricing-scope-measurements.ts';

export type PricingScopeStatus = 'FULL' | 'PARTIAL' | 'REJECTED' | 'NEEDS_REVIEW';
export type PricingScopeSource = DocumentSourceInput & {
    id: string; title: string; role: 'WORK' | 'CONTRACT' | 'PRICE' | 'REFERENCE'; allowed: boolean;
};
export type PricingScopeCandidate = SupportCandidate & {
    sourceId: string; noteSourceIds: string[]; priceBasis: 'EXCL_VAT' | 'INCL_VAT' | 'UNKNOWN';
    pricelistId?: string | null; documentId?: string | null;
};
export type PricingScopeContext = {
    workSourceIds: string[]; sources: PricingScopeSource[]; candidates: PricingScopeCandidate[];
    relatedSourceIds?: string[];
    query?: string;
    workQuote?: string;
};
export type PricingScopeNumber = {
    value: number | null; basis: 'SOURCE' | 'MANUAL' | 'UNKNOWN'; evidence: EvidenceAnchor[];
};
export type PricingScopeRequirement = {
    id: string; description: string; role: StatementRole; evidence: EvidenceAnchor[];
};
export type PricingScopePosition = {
    candidateId: string; status: PricingScopeStatus; requirementIds: string[]; reason: string; evidence: EvidenceAnchor[];
    sourceTitle?: string | null; itemCode?: string | null; page?: number | null; documentId?: string | null;
};
export type PricingScopeLine = {
    candidateId: string; requirementIds: string[]; quantity: PricingScopeNumber; unitPriceExclVat: PricingScopeNumber;
    coefficients: PricingScopeNumber[]; amountExclVat: number | null;
    unit?: string | null;
};
export type PricingScopeResult = {
    version: 'price-scope-v1'; status: PricingScopeStatus; requirements: PricingScopeRequirement[];
    positions: PricingScopePosition[]; lines: PricingScopeLine[]; uncoveredRequirementIds: string[];
    issues: string[]; totalExclVat: number | null; requiresReview: boolean;
};
export type PricingCompatibility = {
    candidateId: string; status: 'MATCH' | 'MISMATCH' | 'UNKNOWN'; dimension: string; reason: string; evidence: EvidenceAnchor[];
};

const DIMENSIONS = ['work', 'material', 'method', 'unit', 'conditions'] as const;
const REQUIREMENT_ROLES = new Set(['INSTRUCTION', 'CONTRACT_RULE', 'REQUEST', 'DECISION']);
const unknownNumber = (): PricingScopeNumber => ({ value: null, basis: 'UNKNOWN', evidence: [] });
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const ids = (value: unknown): string[] => list(value).filter((id): id is string => typeof id === 'string' && id.length > 0);
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function verifiedAnchors(context: PricingScopeContext, value: unknown, allowedIds?: Set<string>) {
    const anchors: EvidenceAnchor[] = [];
    let valid = Array.isArray(value) && value.length > 0;
    for (const raw of list(value)) {
        const citation = record(raw);
        const source = context.sources.find(item => item.id === citation.documentId);
        const anchor = source && source.allowed && (!allowedIds || allowedIds.has(source.id))
            && assessDocumentSourceReadiness(source).canCompare && text(citation.quote)
            ? findEvidenceAnchor(source, text(citation.quote)) : null;
        if (anchor) anchors.push(anchor); else valid = false;
    }
    return { valid, anchors };
}

function hasNumber(quote: string, value: number, allowPercent = false) {
    return [...quote.matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu)].some(match => {
        if (!allowPercent && /^\s*%/u.test(quote.slice((match.index || 0) + match[0].length))) return false;
        return Number(match[0].replace(',', '.')) === value;
    });
}

function sourcedNumber(context: PricingScopeContext, raw: unknown, allowedIds: Set<string>): PricingScopeNumber {
    const value = record(raw);
    if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value <= 0 || value.basis !== 'SOURCE') return unknownNumber();
    const evidence = verifiedAnchors(context, value.evidence, allowedIds);
    return evidence.valid && evidence.anchors.some(anchor => hasNumber(anchor.quote, value.value as number))
        ? { value: value.value, basis: 'SOURCE', evidence: evidence.anchors } : unknownNumber();
}

function differentExplicitGrades(required: string, offered: string) {
    const grades = (value: string) => [...new Set([...value.matchAll(/(?:מסוג|סוג|ה?סימון|\b(?:type|grade|class|designation))\s+([a-z](?:[a-z\d-]*\d[a-z\d-]*|[a-z\d-]*)|[א-ת]['׳]?)(?![\p{L}\d])/giu)]
        .map(match => match[1].replace(/[-'׳]/g, '').toUpperCase()))];
    const left = grades(required), right = grades(offered);
    // Different labels alone do not prove non-equivalence across standards.
    // They do prevent an unsupported automatic assertion that they are identical.
    return left.length === 1 && right.length === 1 && left[0] !== right[0];
}

export function validatePricingCompatibility(context: PricingScopeContext, candidateId: string, draft: unknown): PricingCompatibility {
    const value = record(draft);
    const candidate = context.candidates.find(item => item.id === candidateId);
    const allowed = new Set([...context.workSourceIds, ...(candidate ? [candidate.sourceId, ...candidate.noteSourceIds] : [])]);
    const evidence = verifiedAnchors(context, value.evidence, allowed);
    const grounded = candidate && evidence.valid && evidence.anchors.some(anchor => anchor.documentId === candidate.sourceId)
        && evidence.anchors.some(anchor => context.workSourceIds.includes(anchor.documentId));
    const disputedGrade = differentExplicitGrades(evidence.anchors.filter(anchor => context.workSourceIds.includes(anchor.documentId)).map(anchor => anchor.quote).join('\n'), candidate?.text || '');
    return { candidateId, status: !grounded ? 'UNKNOWN' : value.compatible === 'YES' ? disputedGrade ? 'UNKNOWN' : 'MATCH'
        : value.compatible === 'NO' ? 'MISMATCH' : 'UNKNOWN', dimension: text(value.dimension), reason: text(value.reason), evidence: evidence.anchors };
}

function requirementsFrom(context: PricingScopeContext, value: unknown, issues: string[]) {
    const requirements: PricingScopeRequirement[] = [];
    const allowed = new Set(context.workSourceIds.filter(id => context.sources.some(source =>
        source.id === id && (source.role === 'WORK' || source.role === 'CONTRACT'))));
    for (const raw of list(value)) {
        const item = record(raw);
        const id = text(item.id);
        const evidence = verifiedAnchors(context, item.evidence, allowed);
        const hasNonInstruction = evidence.anchors.some(anchor => {
            const meaning = readEvidenceMeaning(anchor.quote);
            return ['PRICE', 'EVENT', 'PROPOSAL', 'PAYMENT_CLAIM'].includes(meaning.role) || meaning.modality === 'FORBID';
        });
        if (!id || !text(item.description) || requirements.some(requirement => requirement.id === id)
            || !REQUIREMENT_ROLES.has(text(item.role)) || !evidence.valid || hasNonInstruction) {
            issues.push(`requirement_unverified:${id || 'unknown'}`); continue;
        }
        requirements.push({ id, description: text(item.description), role: item.role as StatementRole, evidence: evidence.anchors });
    }
    return requirements;
}

function reviewPosition(context: PricingScopeContext, raw: unknown, requirements: PricingScopeRequirement[]): PricingScopePosition {
    const item = record(raw);
    const candidateId = text(item.candidateId);
    const candidate = context.candidates.find(value => value.id === candidateId);
    const requirementIds = ids(item.requirementIds);
    const relatedRequirements = requirements.filter(value => requirementIds.includes(value.id));
    const sourceIds = new Set([...context.workSourceIds, ...relatedRequirements.flatMap(value => value.evidence.map(anchor => anchor.documentId)),
        ...context.sources.filter(value => value.role === 'CONTRACT' || value.role === 'REFERENCE').map(value => value.id),
        ...(candidate ? [candidate.sourceId, ...candidate.noteSourceIds] : [])]);
    const evidence = verifiedAnchors(context, item.evidence, sourceIds);
    const dimensions = record(item.dimensions);
    const mismatch = DIMENSIONS.some(key => dimensions[key] === 'MISMATCH');
    const completeDimensions = DIMENSIONS.every(key => dimensions[key] === 'MATCH'
        || (dimensions[key] === 'NOT_APPLICABLE' && key !== 'work' && key !== 'unit'));
    const hasWork = evidence.anchors.some(anchor => relatedRequirements.some(requirement => requirement.evidence.some(work =>
        work.documentId === anchor.documentId && anchor.start < work.end && anchor.end > work.start)));
    const hasPrice = Boolean(candidate && evidence.anchors.some(anchor => anchor.documentId === candidate.sourceId));
    const disputedGrade = candidate && differentExplicitGrades(relatedRequirements.flatMap(item => item.evidence.map(anchor => anchor.quote)).join('\n'), candidate.text);
    const eligible = candidate && !disputedGrade && candidate.applicability !== 'REFERENCE_ONLY' && candidate.applicability !== 'NEEDS_REVIEW'
        && requirementIds.length > 0 && new Set(requirementIds).size === requirementIds.length
        && relatedRequirements.length === requirementIds.length && evidence.valid && hasWork && hasPrice && completeDimensions
        && text(item.reason) && ['FULL', 'PARTIAL'].includes(text(item.status));
    return { candidateId, requirementIds, status: mismatch || item.status === 'REJECTED' ? 'REJECTED'
        : eligible ? item.status as 'FULL' | 'PARTIAL' : 'NEEDS_REVIEW', reason: text(item.reason), evidence: evidence.anchors,
        sourceTitle: candidate?.title || context.sources.find(source => source.id === candidate?.sourceId)?.title || null,
        itemCode: candidate?.itemCode || null, page: candidate?.page ?? null, documentId: candidate?.documentId || null };
}

function candidatePrice(context: PricingScopeContext, candidate: PricingScopeCandidate, raw: unknown): PricingScopeNumber {
    const source = context.sources.find(item => item.id === candidate.sourceId);
    const rate = candidate.rate === null || candidate.rate === undefined || candidate.rate === '' ? null : Number(candidate.rate);
    if (rate === null || !Number.isFinite(rate) || rate < 0 || candidate.priceBasis !== 'EXCL_VAT'
        || !source?.allowed || !assessDocumentSourceReadiness(source).canCompare) return unknownNumber();
    const modelRate = record(raw).value;
    if (modelRate !== undefined && modelRate !== rate) return unknownNumber();
    const anchor = findEvidenceAnchor(source, candidate.text);
    if (!anchor) return unknownNumber();
    const stored = record(record(source.parsed_json).pricing_source);
    const structured = stored.pricelist_item_id === candidate.id && stored.pricelist_id === candidate.pricelistId
        && stored.rate === rate && stored.unit === candidate.unit && stored.price_basis === 'EXCL_VAT';
    const number = (value: string) => /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(value)
        ? Number(value.replace(/,/g, '')) : Number(value.replace(',', '.'));
    const prose = [...anchor.quote.matchAll(/(?:מחיר(?:\s+(?:ה?יחידה))?|unit\s+price|rate)\s*[:־-]?\s*(\d[\d,.]*)/giu)]
        .some(match => number(match[1]) === rate);
    const table = [...anchor.quote.matchAll(/^([^\n\t\d]{1,24})\t\s*\d[\d,.]*\s*\t\s*(\d[\d,.]*)/gmu)]
        .some(match => match[1].trim() === candidate.unit?.trim() && number(match[2]) === rate);
    return structured || prose || table ? { value: rate, basis: 'SOURCE', evidence: [anchor] } : unknownNumber();
}

function sourcedCoefficient(context: PricingScopeContext, value: unknown, sources: Set<string>): PricingScopeNumber {
    const candidate = sourcedNumber(context, value, sources);
    if (candidate.value === null) return candidate;
    const declared = candidate.evidence.some(anchor => [...anchor.quote.matchAll(/(?:מקדם|מכפיל|coefficient|multiplier|factor)(?:\s+(?:מחיר|תשלום|ה?יחידה|price|payment))?\s*[:=־-]?\s*(\d+(?:[.,]\d+)?)/giu)]
        .some(match => Number(match[1].replace(',', '.')) === candidate.value));
    return declared ? candidate : unknownNumber();
}

/** Semantic proposals are useful only after source, coverage and number checks. No I/O or model calls here. */
export function validatePricingScope(context: PricingScopeContext, draft: unknown): PricingScopeResult {
    const proposal = record(draft);
    const issues: string[] = [];
    const requirements = requirementsFrom(context, proposal.requirements, issues);
    const positions = list(proposal.positions).map(raw => reviewPosition(context, raw, requirements));
    const lines: PricingScopeLine[] = [];
    const covered = new Set<string>();
    const chargedCandidates = new Set<string>();
    for (const raw of list(proposal.lines)) {
        const line = record(raw);
        const candidateId = text(line.candidateId);
        const candidate = context.candidates.find(item => item.id === candidateId);
        const reviews = positions.filter(item => item.candidateId === candidateId);
        const position = reviews[0];
        const requirementIds = ids(line.requirementIds);
        if (!candidate || reviews.length !== 1 || !position || !['FULL', 'PARTIAL'].includes(position.status)
            || requirementIds.length === 0 || new Set(requirementIds).size !== requirementIds.length
            || requirementIds.some(id => !position.requirementIds.includes(id))) {
            issues.push(`position_unverified:${candidateId || 'unknown'}`); continue;
        }
        if (chargedCandidates.has(candidateId) || requirementIds.some(id => covered.has(id))) {
            issues.push(`duplicate_operation:${candidateId}`); continue;
        }
        chargedCandidates.add(candidateId);
        requirementIds.forEach(id => covered.add(id));
        const quantitySources = new Set(requirements.filter(item => requirementIds.includes(item.id))
            .flatMap(item => item.evidence.map(anchor => anchor.documentId)));
        const suppliedQuantity = sourcedNumber(context, line.quantity, quantitySources);
        const measurement = explicitPricingQuantity(context, candidate.unit);
        const quantity = suppliedQuantity.value !== null && suppliedQuantity.value === measurement.value ? suppliedQuantity : unknownNumber();
        const unitPriceExclVat = candidatePrice(context, candidate, line.unitPriceExclVat);
        const coefficientSources = new Set([candidate.sourceId, ...candidate.noteSourceIds,
            ...context.sources.filter(item => item.role === 'CONTRACT').map(item => item.id)]);
        const coefficients = list(line.coefficients).map(value => sourcedCoefficient(context, value, coefficientSources));
        if (quantity.value === null) issues.push(`quantity_unverified:${candidateId}`);
        if (unitPriceExclVat.value === null) issues.push(`price_unverified:${candidateId}`);
        if (coefficients.some(item => item.value === null)) issues.push(`coefficient_unverified:${candidateId}`);
        const effectiveUnitPrice = unitPriceExclVat.value === null || coefficients.some(item => item.value === null) ? null
            : getLedgerRowAmount({ quantity: 1, unit_price_excl_vat: unitPriceExclVat.value * coefficients.reduce((factor, item) => factor * item.value!, 1) });
        const amountExclVat = quantity.value === null || effectiveUnitPrice === null ? null
            : getLedgerRowAmount({ quantity: quantity.value, unit_price_excl_vat: effectiveUnitPrice });
        if (amountExclVat !== null && !Number.isFinite(amountExclVat)) issues.push(`amount_unverified:${candidateId}`);
        lines.push({ candidateId, requirementIds, quantity, unitPriceExclVat, coefficients, unit: candidate.unit || null,
            amountExclVat: amountExclVat !== null && Number.isFinite(amountExclVat) ? amountExclVat : null });
    }
    if (lines.length > 1 && lines.every(line => line.quantity.value === lines[0].quantity.value && line.unit === lines[0].unit
        && line.amountExclVat !== null && line.unitPriceExclVat.value !== null && line.coefficients.every(item => item.value !== null))) {
        const combinedRate = getMoneySum(lines.map(line => getLedgerRowAmount({ quantity: 1,
            unit_price_excl_vat: line.unitPriceExclVat.value! * line.coefficients.reduce((factor, item) => factor * item.value!, 1) })));
        const combinedAmount = getLedgerRowAmount({ quantity: lines[0].quantity.value!, unit_price_excl_vat: combinedRate });
        if (combinedAmount !== getMoneySum(lines.map(line => line.amountExclVat))) issues.push('combined_rounding_requires_review');
    }
    const uncoveredRequirementIds = requirements.filter(item => !covered.has(item.id)).map(item => item.id);
    const allRejected = positions.length > 0 && positions.every(item => item.status === 'REJECTED');
    const requiresReview = requirements.length === 0 || issues.length > 0 || uncoveredRequirementIds.length > 0 || lines.length === 0;
    const status: PricingScopeStatus = allRejected ? 'REJECTED' : requirements.length > 0 && uncoveredRequirementIds.length > 0 && lines.length > 0
        ? 'PARTIAL' : requiresReview ? 'NEEDS_REVIEW' : 'FULL';
    return { version: 'price-scope-v1', status, requirements, positions, lines, uncoveredRequirementIds,
        issues: [...new Set(issues)], totalExclVat: requiresReview ? null : getMoneySum(lines.map(line => line.amountExclVat)), requiresReview };
}
