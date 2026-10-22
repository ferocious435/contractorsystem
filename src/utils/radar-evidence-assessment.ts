import type { DocumentSourceInput, DocumentReadingVerification } from './document-source-readiness';
import { readEvidenceMeaning, type EvidenceMeaning, type EvidenceClaimExtraction } from './radar-evidence-meaning.ts';

export type { EvidenceMeaning, EvidenceClaimExtraction } from './radar-evidence-meaning.ts';

export type EvidenceAnchor = {
    documentId: string;
    quote: string;
    start: number;
    end: number;
    page: number | null;
};

type EvidenceDocument = DocumentSourceInput & { id: string };
type IndexedText = { text: string; starts: number[]; ends: number[] };
const indexedSources = new Map<string, IndexedText>();
const DIRECTION_MARK = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

// Every normalized code unit retains its position in the saved original text.
// This map is never written back to a document or used as a replacement source.
function indexedText(source: string): IndexedText {
    const cached = indexedSources.get(source);
    if (cached) return cached;
    const layoutSpaces = new Set<number>();
    for (const match of source.matchAll(/(?<![\u0590-\u05ff])[\u0590-\u05ff](?:[ \u200e\u200f]*\t+[ \u200e\u200f]*[\u0590-\u05ff])+(?![\u0590-\u05ff])/gu)) {
        for (let index = 0; index < match[0].length; index += 1) {
            if (/[ \t\u200e\u200f]/u.test(match[0][index])) layoutSpaces.add(match.index + index);
        }
    }
    const chars: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    let offset = 0;
    for (const character of source) {
        const start = offset;
        offset += character.length;
        if (DIRECTION_MARK.test(character) || layoutSpaces.has(start)) continue;
        for (const normalized of character.normalize('NFKC')) {
            if (/\s/u.test(normalized)) {
                if (chars.length === 0) continue;
                if (chars.at(-1) === ' ') { ends[ends.length - 1] = offset; continue; }
                chars.push(' '); starts.push(start); ends.push(offset);
            } else {
                for (const unit of normalized.split('')) {
                    chars.push(unit); starts.push(start); ends.push(offset);
                }
            }
        }
    }
    if (chars.at(-1) === ' ') { chars.pop(); starts.pop(); ends.pop(); }
    const result = { text: chars.join(''), starts, ends };
    if (source.length >= 1000 && source.length <= 2_000_000) {
        if (indexedSources.size >= 4) indexedSources.delete(indexedSources.keys().next().value!);
        indexedSources.set(source, result);
    }
    return result;
}

export function normalizeEvidenceSource(value: string) {
    return indexedText(value).text;
}

function physicalPage(document: EvidenceDocument, start: number, end: number) {
    const metadata = document.parsed_json && typeof document.parsed_json === 'object'
        ? document.parsed_json as Record<string, unknown> : {};
    const coverage = metadata.source_reading as DocumentReadingVerification | undefined;
    if (document.ocr_status !== 'COMPLETED' || coverage?.version !== 'page-coverage-v1'
        || !coverage.complete || !Number.isInteger(coverage.totalPages) || coverage.totalPages < 1
        || !Array.isArray(coverage.unreadablePages) || !Array.isArray(coverage.readPages)
        || coverage.unreadablePages.length > 0
        || new Set(coverage.readPages).size !== coverage.totalPages
        || !coverage.readPages.every(page => Number.isInteger(page) && page >= 1 && page <= coverage.totalPages)) return null;
    const source = String(document.extracted_text || '');
    const next = [...source.matchAll(/--\s*(\d+)\s+of\s+(\d+)\s*--/g)]
        .find(match => match.index >= start);
    if (!next || Number(next[2]) !== coverage.totalPages || end > next.index) return null;
    const page = Number(next[1]);
    return coverage.readPages.includes(page) ? page : null;
}

export function anchorSourceRange(document: EvidenceDocument, start: number, end: number): EvidenceAnchor {
    const source = String(document.extracted_text || '');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) {
        throw new Error('Evidence range must refer to the saved source text');
    }
    return { documentId: document.id, quote: source.slice(start, end), start, end,
        page: physicalPage(document, start, end) };
}

export function findEvidenceAnchor(document: EvidenceDocument, quote: string, range?: { start: number; end: number }): EvidenceAnchor | null {
    const query = indexedText(quote).text;
    if (!query) return null;
    const source = indexedText(String(document.extracted_text || ''));
    const normalizedStart = range ? source.starts.findIndex(start => start >= range.start) : 0;
    if (normalizedStart < 0) return null;
    const index = source.text.indexOf(query, normalizedStart);
    if (index < 0) return null;
    const anchor = anchorSourceRange(document, source.starts[index], source.ends[index + query.length - 1]);
    if (range && anchor.end > range.end) return null;
    const repeated = source.text.indexOf(query, index + 1);
    if (repeated >= 0 && (!range || source.ends[repeated + query.length - 1] <= range.end)) anchor.page = null;
    return anchor;
}

export function evidenceMeaningMarkers(value: string) {
    const text = normalizeEvidenceSource(value).toLowerCase();
    return {
        numbers: text.match(/\d+(?:[.,/:-]\d+)*/g) || [],
        qualifications: text.match(/(?<!\p{L})(?:[ושבכלמ]?(?:לא|טרם|אין|אינו|אינה|אינם|אינן|בכפוף|בתנאי|לאחר|ללא|אם|אושר|אושרה|אושרו|יאושר|יאושרו|תאושר|נחתם|נחתמה|נחתמו|ייחתם|ייחתמו|חתום|חתומה)|not|no|never|unless|subject to|conditional|after|without|until|if|pending|approved|rejected|refused|must|shall|may|might|will|would|could)(?!\p{L})/gu) || [],
    };
}

export type ComparisonRelation = 'INCOMPATIBLE' | 'COMPATIBLE' | 'DIFFERENT_SUBJECT' | 'INSUFFICIENT_EVIDENCE';
export type EvidenceRelationInput = {
    work: { document: EvidenceDocument; quote: string; anchor?: EvidenceAnchor | null; extraction?: EvidenceClaimExtraction | null };
    baseline: { document: EvidenceDocument; quote: string; anchor?: EvidenceAnchor | null; extraction?: EvidenceClaimExtraction | null } | null;
};
export type EvidenceRelationAssessment = {
    version: 'evidence-relation-v1';
    relation: ComparisonRelation;
    resultType: 'CONTRADICTION' | 'KNOWN_CHANGE' | 'EVENT' | 'NEEDS_VERIFICATION' | 'NO_CONFLICT';
    reasons: string[];
    sourceAnchors: EvidenceAnchor[];
    work: EvidenceMeaning;
    baseline: EvidenceMeaning | null;
    attribute: string | null;
};

function extractionIsGrounded(extraction: EvidenceClaimExtraction | null | undefined, quote: string, meaning: EvidenceMeaning) {
    if (!extraction) return true; // Legacy records use source-derived facts, never their old VERIFIED flag.
    const normalize = (value: string) => normalizeEvidenceSource(value).toLowerCase();
    const source = normalize(quote);
    const statement = normalize(meaning.statement);
    for (const key of ['subject', 'value', 'scope', 'location', 'party', 'condition', 'period'] as const) {
        const value = extraction[key];
        if (value !== null && (typeof value !== 'string' || !value.trim() || !source.includes(normalize(value))
            || !statement.includes(normalize(value)))) return false;
    }
    return true;
}

function sourceStatement(document: EvidenceDocument, anchor: EvidenceAnchor | null, fallback: string) {
    if (!anchor) return fallback;
    const source = String(document.extracted_text || '');
    const boundary = (index: number) => /[;!?]/u.test(source[index]) || (source[index] === '.'
        && !(/\d/u.test(source[index - 1] || '') && /\d/u.test(source[index + 1] || '')))
        || source.slice(index, index + 2) === '\n\n';
    let start = anchor.start;
    let end = anchor.end;
    for (let index = anchor.start - 1; index >= Math.max(0, anchor.start - 600); index -= 1) {
        if (boundary(index)) { start = index + 1; break; }
        start = index;
    }
    if (!boundary(anchor.end - 1)) for (let index = anchor.end; index < Math.min(source.length, anchor.end + 600); index += 1) {
        end = index + 1;
        if (boundary(index)) break;
    }
    return source.slice(start, end);
}

export function assessEvidenceRelation(input: EvidenceRelationInput): EvidenceRelationAssessment {
    const boundAnchor = (side: NonNullable<EvidenceRelationInput['baseline']>) => side.anchor
        ? side.anchor.documentId === side.document.id
            && String(side.document.extracted_text || '').slice(side.anchor.start, side.anchor.end) === side.anchor.quote
            && normalizeEvidenceSource(side.anchor.quote) === normalizeEvidenceSource(side.quote) ? side.anchor : null
        : findEvidenceAnchor(side.document, side.quote);
    const workAnchor = boundAnchor(input.work);
    const baselineAnchor = input.baseline ? boundAnchor(input.baseline) : null;
    const sourceAnchors = [workAnchor, baselineAnchor].filter(anchor => anchor !== null);
    const work = readEvidenceMeaning(normalizeEvidenceSource(sourceStatement(input.work.document, workAnchor, input.work.quote)));
    const baseline = input.baseline ? readEvidenceMeaning(normalizeEvidenceSource(sourceStatement(input.baseline.document, baselineAnchor, input.baseline.quote)), true) : null;
    const quotedSourcesFound = sourceAnchors.length === (input.baseline ? 2 : 1);
    for (const [side, meaning] of [[input.work, work], [input.baseline, baseline]] as const) {
        if (!side || !meaning) continue;
        const contextAnchor = findEvidenceAnchor(side.document, meaning.statement);
        if (contextAnchor && !sourceAnchors.some(anchor => anchor.documentId === contextAnchor.documentId
            && anchor.start === contextAnchor.start && anchor.end === contextAnchor.end)) sourceAnchors.push(contextAnchor);
    }
    let extractionMeaningUnproved = false;
    const finish = (relation: ComparisonRelation, reason: string,
        resultType: EvidenceRelationAssessment['resultType'] = relation === 'INCOMPATIBLE' ? 'CONTRADICTION'
            : relation === 'INSUFFICIENT_EVIDENCE' ? 'NEEDS_VERIFICATION' : 'NO_CONFLICT'): EvidenceRelationAssessment => ({
        version: 'evidence-relation-v1', relation, resultType,
        reasons: [extractionMeaningUnproved && ['operative_requirements_not_established', 'subject_or_attribute_not_established',
            'incompatibility_not_established'].includes(reason) ? 'semantic_fields_not_established' : reason], sourceAnchors, work, baseline,
        attribute: work.attribute === baseline?.attribute ? work.attribute : null,
    });
    if (!quotedSourcesFound) return finish('INSUFFICIENT_EVIDENCE', 'source_quote_not_found');
    if (!extractionIsGrounded(input.work.extraction, input.work.quote, work)
        || (input.baseline && baseline && !extractionIsGrounded(input.baseline.extraction, input.baseline.quote, baseline))) {
        return finish('INSUFFICIENT_EVIDENCE', 'semantic_field_not_grounded');
    }
    for (const [side, meaning] of [[input.work, work], [input.baseline, baseline]] as const) {
        if (!side?.extraction || !meaning) continue;
        if ((side.extraction.attribute !== 'OTHER' && side.extraction.attribute !== meaning.attribute)
            || (side.extraction.role !== 'UNKNOWN' && side.extraction.role !== meaning.role
                && !(['INSTRUCTION', 'CONTRACT_RULE'].includes(side.extraction.role)
                    && ['INSTRUCTION', 'CONTRACT_RULE'].includes(meaning.role)))) {
            // Proposed labels are not evidence. Prefer the relation established
            // from the actual statements; preserve uncertainty if none is known.
            extractionMeaningUnproved = true;
        }
        for (const dimension of ['scope', 'location', 'party', 'condition', 'period'] as const) {
            if (side.extraction[dimension] && !meaning[dimension]) {
                // A named issuer of a demand is not its obligated recipient.
                // Ignore that model label only when the statement proves the role.
                if (dimension === 'party' && ['INSTRUCTION', 'CONTRACT_RULE'].includes(meaning.role)) {
                    const issuer = meaning.statement.match(/(?:^|\s)(הקבלן|המפקח|המתכנן|המזמין)\s+(?:דורש|דורשת|מורה|הורה)(?!\p{L})/u)?.[1];
                    if (issuer && normalizeEvidenceSource(side.extraction.party || '') === issuer) continue;
                }
                // Models can put a duration's start reference in condition. It
                // is understood only when the source establishes that period.
                if (dimension === 'condition' && meaning.period
                    && readEvidenceMeaning(side.extraction[dimension]).period === meaning.period) continue;
                return finish('INSUFFICIENT_EVIDENCE', 'context_dimension_not_established');
            }
        }
        if (side.extraction.scope && readEvidenceMeaning(side.extraction.scope).scope !== meaning.scope) {
            return finish('INSUFFICIENT_EVIDENCE', 'context_dimension_not_established');
        }
    }
    if (work.inlineReplacement && (!baseline || work.role === 'REQUEST' || work.role === 'PROPOSAL')) {
        return finish('INSUFFICIENT_EVIDENCE', 'documented_replacement_requires_scope_and_approval_check', 'KNOWN_CHANGE');
    }
    if (!baseline) return /אינו תואם|אינה תואמת|לא תואם|nonconformity|inconsistent with/iu.test(input.work.quote)
        ? finish('INSUFFICIENT_EVIDENCE', 'documented_field_mismatch_without_baseline', 'EVENT')
        : finish('INSUFFICIENT_EVIDENCE', 'baseline_missing');
    if (work.location && baseline.location && work.location !== baseline.location) return finish('DIFFERENT_SUBJECT', 'different_locations');
    if (work.scope && baseline.scope && work.scope !== baseline.scope) return finish('DIFFERENT_SUBJECT', 'different_construction_scopes');
    if (work.object && baseline.object && work.object !== baseline.object) return finish('DIFFERENT_SUBJECT', 'different_objects');
    if (work.party && baseline.party && work.party !== baseline.party) return finish('DIFFERENT_SUBJECT', 'different_obligated_parties');
    if (work.period && baseline.period && work.period !== baseline.period) return finish('DIFFERENT_SUBJECT', 'different_explicit_periods');
    if (work.attribute === 'COMPLETION_DEADLINE' && baseline.attribute === 'CONTRACT_DURATION') {
        return finish('INSUFFICIENT_EVIDENCE', 'completion_deadline_basis_not_established');
    }
    if (work.subject !== 'UNKNOWN' && baseline.subject !== 'UNKNOWN' && work.subject !== baseline.subject) {
        return finish('DIFFERENT_SUBJECT', 'different_work_subjects');
    }
    if (['PRICE', 'MEASUREMENT', 'PAYMENT_CLAIM'].includes(work.role)
        || ['PRICE', 'MEASUREMENT', 'PAYMENT_CLAIM'].includes(baseline.role)) return finish('DIFFERENT_SUBJECT', 'pricing_or_measurement_is_not_a_conflicting_instruction');
    if (work.attribute !== baseline.attribute
        && [work.attribute, baseline.attribute].every(attribute => ['INITIAL_SCHEDULE_SUBMISSION', 'SCHEDULE_UPDATE'].includes(attribute))) {
        return finish('COMPATIBLE', 'complementary_schedule_obligations');
    }
    if (work.attribute === 'APPROVAL_REQUIREMENT' && baseline.attribute === 'APPROVAL_REQUIREMENT'
        && work.approvalRequired === baseline.approvalRequired) return finish('COMPATIBLE', 'same_approval_workflow');
    if (work.attribute !== 'OTHER' && baseline.attribute !== 'OTHER' && work.attribute !== baseline.attribute) {
        return finish('DIFFERENT_SUBJECT', 'different_comparison_attributes');
    }
    if (work.subject === 'UNKNOWN' || baseline.subject === 'UNKNOWN' || work.attribute === 'OTHER' || baseline.attribute === 'OTHER') {
        return finish('INSUFFICIENT_EVIDENCE', 'subject_or_attribute_not_established');
    }
    const operative = ['INSTRUCTION', 'CONTRACT_RULE', 'DECISION'];
    if (!operative.includes(work.role) || !operative.includes(baseline.role)) return finish('INSUFFICIENT_EVIDENCE', 'operative_requirements_not_established');
    if (work.condition || baseline.condition) return finish('INSUFFICIENT_EVIDENCE', 'different_or_unproved_conditions');
    if (work.approvalRequired !== null && baseline.approvalRequired !== null && work.attribute === 'APPROVAL_REQUIREMENT') {
        return finish('INCOMPATIBLE', 'approval_required_against_explicit_waiver');
    }
    if (work.constraint && baseline.constraint) {
        if (work.constraint.unit !== baseline.constraint.unit) return finish('INSUFFICIENT_EVIDENCE', 'units_not_comparable');
        const a = work.constraint;
        const b = baseline.constraint;
        if (work.modality === 'FORBID' || baseline.modality === 'FORBID') {
            if (work.modality === 'FORBID' && baseline.modality === 'FORBID') return finish('COMPATIBLE', 'prohibitions_can_coexist');
            const forbidden = work.modality === 'FORBID' ? a : b;
            const required = work.modality === 'FORBID' ? b : a;
            const excluded = (required.min ?? -Infinity) >= (forbidden.min ?? -Infinity)
                && (required.max ?? Infinity) <= (forbidden.max ?? Infinity);
            return finish(excluded ? 'INCOMPATIBLE' : 'COMPATIBLE', excluded ? 'required_value_is_prohibited' : 'prohibited_value_does_not_exclude_requirement');
        }
        const overlap = Math.max(a.min ?? -Infinity, b.min ?? -Infinity) <= Math.min(a.max ?? Infinity, b.max ?? Infinity);
        return finish(overlap ? 'COMPATIBLE' : 'INCOMPATIBLE', overlap ? 'numeric_requirements_overlap' : 'numeric_requirements_do_not_overlap');
    }
    if (work.ambiguous || baseline.ambiguous) return finish('INSUFFICIENT_EVIDENCE', 'numeric_value_not_unambiguous');
    if (work.attribute === 'MATERIAL' && work.materialOptions.length && baseline.materialOptions.length) {
        if (work.modality === 'FORBID' || baseline.modality === 'FORBID') {
            if (work.modality === 'FORBID' && baseline.modality === 'FORBID') return finish('COMPATIBLE', 'prohibitions_can_coexist');
            const forbidden = work.modality === 'FORBID' ? work.materialOptions : baseline.materialOptions;
            const required = work.modality === 'FORBID' ? baseline.materialOptions : work.materialOptions;
            const excluded = required.every(material => forbidden.includes(material));
            return finish(excluded ? 'INCOMPATIBLE' : 'COMPATIBLE', excluded ? 'required_material_is_prohibited' : 'prohibited_material_does_not_exclude_requirement');
        }
        const overlap = work.materialOptions.some(material => baseline.materialOptions.includes(material));
        return finish(overlap ? 'COMPATIBLE' : 'INCOMPATIBLE', overlap ? 'allowed_material_choice' : 'mutually_exclusive_material_requirements');
    }
    return finish('INSUFFICIENT_EVIDENCE', 'incompatibility_not_established');
}
