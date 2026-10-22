import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { readEvidenceMeaning } from './radar-evidence-meaning.ts';
import { documentEventDate } from './radar-issue-history.ts';

export const ISSUE_RECONCILIATION_VERSION = 'issue-links-v1';
export type ReconciliationFinding = {
    id: string; project_id?: string; title?: string | null; description?: string | null;
    category?: string | null; status?: string | null; pricing_status?: string | null;
    xmin?: string;
    scan_signature?: string | null; source_execution_doc_id?: string | null;
    target_contract_doc_id?: string | null; created_at?: string | null; evidence_data?: unknown;
};
export type ReconciliationDocument = DocumentSourceInput & { id: string; category?: string | null };
export type IssueFinancialLink = { findingId: string; ledgerId: string; letterIds: string[] };
export type ReconciledHistoryEntry = {
    findingId: string; sourceDocumentId: string; sourceDocumentTitle: string;
    date: string | null; anchor: EvidenceAnchor; baselineAnchor: EvidenceAnchor | null;
    relation: 'PRIMARY' | 'REPEAT' | 'ADDITIONAL_BASIS' | 'CHANGED_CONDITION' | 'SOURCE_EVENT';
};
export type IssueReconciliationInput = {
    seedId: string; findings: ReconciliationFinding[]; documents: ReconciliationDocument[];
    financialLinks?: IssueFinancialLink[];
};
export type IssueReconciliationPlan = {
    version: typeof ISSUE_RECONCILIATION_VERSION; canonicalId: string | null;
    attachHistory: ReconciledHistoryEntry[]; linkRelatedRecordIds: string[];
    markDuplicates: string[]; flagInvalidEvidence: { findingId: string; reason: string; originalSourceId: string | null; originalBaselineId: string | null }[];
    missingEvidence: { findingId: string; reason: string }[]; financialLinks: IssueFinancialLink[];
};
export function reconciliationRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' && value !== 'null' ? normalizeEvidenceSource(value) : ''; }
function unique<T>(rows: T[], key: (value: T) => string) {
    return [...new Map(rows.map(row => [key(row), row])).values()].sort((a, b) => key(a).localeCompare(key(b)));
}
function locationIn(value: string) {
    // Preserve the whole name; a number or a second street word can distinguish work sites.
    const street = value.match(/(?:ב)?רחוב\s+["״]?([\p{L}\d-]+(?:\s+(?:[\p{L}-]+|\d+))?)/u)?.[1]
        ?.replace(/\s+(?:נדרש|מדחיקת|בקרית|לקידוח|בשיטת|בשיטה|בחול|במקום|בתנאי|הקבלן|תבוצע|אושר|טרם|עד|מתוך|מול)$/u, '');
    if (street) return `STREET:${street}`;
    const road = value.match(/(?:ב)?כביש\s*(?:מספר|מס[׳']?|№)?\s*(\d+[א-ת]?(?:[-/]\d+)?)/u)?.[1];
    if (road) return `ROAD:${road}`;
    return null;
}
function prepare(row: ReconciliationFinding, documents: Map<string, ReconciliationDocument>) {
    const evidence = reconciliationRecord(row.evidence_data), quote = text(evidence.work_quote);
    const document = documents.get(row.source_execution_doc_id || '');
    const anchor = document && quote ? findEvidenceAnchor(document, quote) : null;
    const baselineId = String(reconciliationRecord(evidence.contract_reference_authority).reference_chunk_id || row.target_contract_doc_id || '');
    const baseline = documents.get(baselineId), baselineQuote = text(evidence.contract_quote);
    const baselineAnchor = baseline && baselineQuote ? findEvidenceAnchor(baseline, baselineQuote) : null;
    const reason = !document ? 'WORK_DOCUMENT_NOT_FOUND' : !anchor ? 'WORK_QUOTE_NOT_FOUND'
        : !assessDocumentSourceReadiness(document).canCompare ? 'SOURCE_NOT_READY'
            : baselineQuote && !baseline ? 'BASELINE_SOURCE_NOT_AVAILABLE'
                : baselineQuote && !baselineAnchor ? 'BASELINE_QUOTE_NOT_FOUND'
                : baseline && !assessDocumentSourceReadiness(baseline).canCompare ? 'BASELINE_NOT_READY' : null;
    const first = quote.split(/\.{3}|;|\n/u).find(part => readEvidenceMeaning(part).subject !== 'UNKNOWN') || quote;
    const meaning = readEvidenceMeaning(first), full = readEvidenceMeaning(quote);
    // Generated titles do not supply a missing work location or subject.
    const location = locationIn(quote);
    const subject = meaning.subject;
    const object = /(?<!\p{L})(?:[הבלו]?ביוב|sewer)(?!\p{L})/iu.test(quote) ? 'SEWER' : full.object;
    return { row, evidence, quote, document, anchor, baselineAnchor, baselineId, baselineQuote, reason,
        meaning, identity: { subject, location, object, party: meaning.party, scope: meaning.scope } };
}
type Prepared = ReturnType<typeof prepare>;
function sameIssue(a: Prepared, b: Prepared) {
    if (a.row.project_id && b.row.project_id && a.row.project_id !== b.row.project_id) return false;
    if (a.identity.subject === 'UNKNOWN' || a.identity.subject !== b.identity.subject) return false;
    for (const key of ['object', 'party', 'scope'] as const) {
        if (a.identity[key] !== b.identity[key]) return false;
    }
    if (a.identity.location || b.identity.location) return Boolean(a.identity.location && a.identity.location === b.identity.location);
    // An exact checked quote is also an identity anchor for a location-free general requirement.
    return Boolean(a.anchor && b.anchor && a.document?.id === b.document?.id && a.quote === b.quote && a.baselineId === b.baselineId);
}
const syntax = new Set('את על של הוא היא יש לבצע תבוצע יבוצע נדרש נדרשת נדרשים לשנות שינוי מעבר במקום שיטת השיטה השיטת שיטה בשיטת בשיטה דרישה דורש'.split(' '));
const constructionWords = /^(?:ה|ב|ל|מ|ו)?(קידוח|דחיקת|צנרת|פיברגלס|חול|מצומנט|עטיפת|צינור|שיעור|רחוב|כביש)$/u;
function wordBag(value: string) {
    return [...new Set((value.match(/[\p{L}\p{N}%]+/gu) || []).map(word => word.toLowerCase())
        .map(word => word.match(constructionWords)?.[1] || word).filter(word => !syntax.has(word)))].sort();
}
function methodTarget(value: string) {
    const tails = [...value.matchAll(/(?:ל(?:שיטת|קידוח|ביצוע)|מעבר\s+ל|\bto\s+)([^.;]{0,180})/giu)];
    return tails.map(match => match[1].match(/\b[A-Z][A-Z\d-]{1,14}\b|פיברגלס/iu)?.[0]?.toUpperCase()).filter(Boolean).at(-1) || null;
}
function equivalent(a: Prepared, b: Prepared) {
    if (a.reason || b.reason) return false;
    if (a.quote === b.quote) return true;
    // A bag of terms cannot establish which of several figures belongs to which condition.
    const numbers = (quote: string) => quote.replace(/(?:ב)?כביש\s*(?:מספר|מס[׳']?|№)?\s*\d+[א-ת]?(?:[-/]\d+)?/gu, '')
        .match(/\d+(?:[.,]\d+)?/gu) || [];
    if (numbers(a.quote).length > 1 || numbers(b.quote).length > 1) return false;
    const left = a.meaning, right = b.meaning;
    if (left.subject === 'UNKNOWN' || left.attribute === 'OTHER') return false;
    for (const key of ['attribute', 'modality', 'role', 'party', 'scope', 'condition', 'period', 'approvalRequired'] as const) {
        if (left[key] !== right[key]) return false;
    }
    if (left.attribute === 'METHOD') {
        const target = methodTarget(a.quote);
        if (!target || target !== methodTarget(b.quote)) return false;
    }
    // Every remaining word and number counts. Unknown extra wording is retained as a new condition.
    return JSON.stringify(wordBag(a.quote)) === JSON.stringify(wordBag(b.quote));
}
function sameBasis(a: Prepared, b: Prepared) {
    return a.baselineId === b.baselineId && a.baselineQuote === b.baselineQuote;
}
function canonicalRank(value: Prepared, financial: IssueFinancialLink[]) {
    const prior = reconciliationRecord(value.evidence.issue_reconciliation);
    return (value.reason ? -1000 : 0) + (prior.canonicalId === value.row.id ? 200 : 0)
        + (financial.some(link => link.findingId === value.row.id) || value.row.pricing_status === 'PRICED' || value.row.status === 'MOVED_TO_PRICING' ? 100 : 0)
        + (value.row.status === 'OPEN' ? 20 : 0)
        + (value.evidence.manual_review || value.evidence.user_review || value.evidence.approved_by_user ? 5 : 0);
}

/** Pure, deterministic plan. It never deletes records, reassigns finances or repairs quotations. */
export function planIssueReconciliation(input: IssueReconciliationInput): IssueReconciliationPlan {
    const documents = new Map(input.documents.map(document => [document.id, document]));
    const prepared = input.findings.map(row => prepare(row, documents));
    const seed = prepared.find(value => value.row.id === input.seedId);
    const empty: IssueReconciliationPlan = { version: ISSUE_RECONCILIATION_VERSION, canonicalId: null,
        attachHistory: [], linkRelatedRecordIds: [], markDuplicates: [], flagInvalidEvidence: [], missingEvidence: [], financialLinks: [] };
    if (!seed) return empty;
    const candidates = prepared.filter(value => value === seed || sameIssue(seed, value));
    const financial = input.financialLinks || [];
    // A broken-only group has no evidentially valid primary question.
    const valid = candidates.filter(value => !value.reason
        && reconciliationRecord(value.evidence.review_disposition).type !== 'INVALID_AUTOMATIC_FINDING');
    // A replacement-scan archive is not a documented resolution. Do not hide a
    // checked open question merely because an archived related row has a price.
    const active = valid.filter(value => value.row.status !== 'ARCHIVED');
    const primary = (active.length ? active : valid).filter(value => !value.reason
        && reconciliationRecord(value.evidence.review_disposition).type !== 'INVALID_AUTOMATIC_FINDING').sort((a, b) => canonicalRank(b, financial) - canonicalRank(a, financial)
        || a.row.id.localeCompare(b.row.id))[0];
    if (!primary) return { ...empty, missingEvidence: candidates.map(value => ({ findingId: value.row.id, reason: value.reason || 'ISSUE_IDENTITY_NOT_ESTABLISHED' })) };
    const group = candidates.filter(value => value === primary || sameIssue(primary, value));
    const result: IssueReconciliationPlan = { ...empty, canonicalId: primary.row.id,
        linkRelatedRecordIds: group.filter(value => value !== primary).map(value => value.row.id).sort(),
        financialLinks: unique(financial.filter(link => group.some(value => value.row.id === link.findingId)), link => `${link.findingId}:${link.ledgerId}`) };
    for (const value of group) {
        if (value.reason) {
            const entry = { findingId: value.row.id, reason: value.reason };
            if (['WORK_DOCUMENT_NOT_FOUND', 'WORK_QUOTE_NOT_FOUND', 'BASELINE_QUOTE_NOT_FOUND'].includes(value.reason)) {
                result.flagInvalidEvidence.push({ ...entry, originalSourceId: value.row.source_execution_doc_id || null,
                    originalBaselineId: value.baselineId || null });
            } else result.missingEvidence.push(entry);
            if (value.anchor && value.document && assessDocumentSourceReadiness(value.document).canCompare) {
                result.attachHistory.push({ findingId: value.row.id, sourceDocumentId: value.document.id,
                    sourceDocumentTitle: value.document.title || '', date: documentEventDate(value.document).date,
                    anchor: value.anchor, baselineAnchor: null, relation: 'SOURCE_EVENT' });
            }
            continue;
        }
        const repeat = equivalent(primary, value), basis = sameBasis(primary, value);
        const relation = value === primary ? 'PRIMARY' : repeat && basis ? 'REPEAT' : repeat ? 'ADDITIONAL_BASIS' : 'CHANGED_CONDITION';
        result.attachHistory.push({ findingId: value.row.id, sourceDocumentId: value.document!.id,
            sourceDocumentTitle: value.document!.title || '', date: documentEventDate(value.document!).date,
            anchor: value.anchor!, baselineAnchor: value.baselineAnchor, relation });
        if (value !== primary && repeat && basis && value.row.scan_signature
            && !financial.some(link => link.findingId === value.row.id)
            && !value.evidence.manual_review && !value.evidence.user_review && !value.evidence.approved_by_user
            && value.row.pricing_status !== 'PRICED' && value.row.status !== 'MOVED_TO_PRICING') result.markDuplicates.push(value.row.id);
    }
    // Retain source events collected before an earlier automatic duplicate was removed.
    for (const value of group) {
        const previous = reconciliationRecord(value.evidence.issue_reconciliation);
        const priorEntries = Array.isArray(previous.attachHistory) ? previous.attachHistory : [];
        for (const item of priorEntries) {
            const entry = item as ReconciledHistoryEntry, document = documents.get(entry.sourceDocumentId);
            const valid = (source: ReconciliationDocument | undefined, anchor: EvidenceAnchor | null) => source && anchor
                && assessDocumentSourceReadiness(source).canCompare && anchor.documentId === source.id
                && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 && anchor.end > anchor.start
                && source.extracted_text?.slice(anchor.start, anchor.end) === anchor.quote;
            if (!valid(document, entry.anchor) || (entry.baselineAnchor && !valid(documents.get(entry.baselineAnchor.documentId), entry.baselineAnchor))) {
                result.missingEvidence.push({ findingId: entry.findingId, reason: 'PRIOR_SOURCE_EVENT_NOT_VERIFIED' });
                continue;
            }
            const prior = prepare({ id: entry.findingId, project_id: primary.row.project_id,
                source_execution_doc_id: entry.sourceDocumentId,
                evidence_data: { work_quote: entry.anchor.quote } }, documents);
            if (sameIssue(primary, prior) && !result.attachHistory.some(current => current.findingId === entry.findingId
                && current.sourceDocumentId === entry.sourceDocumentId && current.anchor.start === entry.anchor.start)) result.attachHistory.push(entry);
        }
    }
    result.attachHistory = unique(result.attachHistory, entry => `${entry.findingId}:${entry.sourceDocumentId}:${entry.anchor.start}:${entry.baselineAnchor?.documentId || ''}`);
    result.flagInvalidEvidence.sort((a, b) => a.findingId.localeCompare(b.findingId));
    result.missingEvidence = unique(result.missingEvidence, entry => `${entry.findingId}:${entry.reason}`);
    result.markDuplicates.sort();
    return result;
}
