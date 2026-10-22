import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { isReferenceDocument } from './contract-document-hierarchy.ts';
import { findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { documentEventDate, isMtmIssueText, issueEvidenceParagraphs, type IssueHistoryDocument } from './radar-issue-history.ts';
import { buildRequirementContext, isRequirementContractSource, type RequirementRule } from './radar-requirement-context.ts';
import { compareRequirementStatements, isConditionalRequirement, isUnexecutedAnnexForm, requirementKinds, ruleConcerns, ruleRelevanceScore, type RequirementKind } from './requirement-statement-comparison.ts';
import type { DocumentReferenceGraph } from './document-reference-authority.ts';

export const REQUIREMENT_REVIEW_VERSION = 'requirement-basis-v3';
export type RequirementAssessment = 'CONFLICT' | 'SUPPORTED' | 'PROPOSED_CHANGE' | 'NEEDS_BASIS';
export type ReviewedRequirement = {
    id: string; kind: RequirementKind; documentId: string; documentTitle: string;
    date: string | null; dateAnchor: EvidenceAnchor | null; anchor: EvidenceAnchor;
    requestedObject: 'DRILLING' | 'SHAFTS' | 'WHOLE_LETTER' | 'UNSPECIFIED';
    assessment: RequirementAssessment; reasons: string[];
    basis: Array<RequirementRule & { relation: 'INCOMPATIBLE' | 'COMPATIBLE' | 'UNESTABLISHED'; comparisonReason: string }>;
    basisCount: number;
};
export type IssueRequirementReview = ReturnType<typeof reviewIssueRequirements>;

function differentLocation(text: string, location: string) {
    const named = normalizeEvidenceSource(text).match(/(?:ברחוב|רחוב)\s+([\p{L}״"'-]+)/u)?.[1];
    return Boolean(named && named !== location);
}

function specialOverGeneral(quote: string) {
    const text = normalizeEvidenceSource(quote);
    return /סתיר|עדיפ/u.test(text) && /מפרט.{0,12}מיוחד.{0,60}(?:יגבר|גובר|עדיפ).{0,40}(?:מפרט.{0,12}כללי|ספר הכחול)/u.test(text);
}

export function reviewIssueRequirements(input: { issue: { subject: string; location: string }; documents: IssueHistoryDocument[];
    referenceGraph?: DocumentReferenceGraph; asOf: string }) {
    const context = buildRequirementContext(input), requirements: ReviewedRequirement[] = [];
    for (const document of input.documents) {
        const source = String(document.extracted_text || '');
        if (!isMtmIssueText(source) || !assessDocumentSourceReadiness(document).canCompare || isReferenceDocument(document)
            || isRequirementContractSource(document)) continue;
        const date = documentEventDate(document);
        if (date.date && date.date > input.asOf) continue;
        const unsignedForm = isUnexecutedAnnexForm(source);
        const paragraphs = issueEvidenceParagraphs(document);
        const namedDrillingAnnex = paragraphs.some(paragraph => isMtmIssueText(paragraph) && /נספח/u.test(paragraph));
        for (const paragraph of paragraphs) {
            const text = normalizeEvidenceSource(paragraph);
            if (differentLocation(text, input.issue.location)) continue;
            const kinds = requirementKinds(text);
            // A heading joins its own bullets. Only an annex's price/waiver
            // clauses and a whole-letter response may rely on the issue header.
            const wholeLetterResponse = kinds.includes('RESPOND') && /בתוך|תוך/u.test(text) && /מכתב/u.test(text);
            const linkedAnnex = namedDrillingAnnex && kinds.includes('SIGN_ANNEX') && /נספח (?:הקידוחים|השינוי)/u.test(text);
            if (!isMtmIssueText(text) && !unsignedForm && !wholeLetterResponse && !linkedAnnex) continue;
            const anchor = findEvidenceAnchor(document, paragraph);
            if (!anchor) continue;
            for (const kind of kinds) {
                if (!isMtmIssueText(text) && !unsignedForm && kind !== 'RESPOND' && !linkedAnnex) continue;
                const pricePart = kind === 'SUBMIT_PRICE' ? text.slice(text.search(/ניתוח מחיר/u)) : text;
                const requestedObject: ReviewedRequirement['requestedObject'] = kind === 'RESPOND' && wholeLetterResponse ? 'WHOLE_LETTER'
                    : /שוחות|שוחה/u.test(pricePart) ? 'SHAFTS' : /קידוח|MTM|דחיקה/iu.test(pricePart) ? 'DRILLING' : 'UNSPECIFIED';
                const id = `${document.id}:${anchor.start}:${anchor.end}:${kind}`;
                const relevant = context.rules.filter(rule => (!rule.date || (date.date && rule.date <= date.date)) && ruleConcerns(kind, rule.anchor.quote)
                    && !differentLocation(rule.anchor.quote, input.issue.location));
                const assessed = relevant.map(rule => ({ ...rule,
                    ...(() => { const pair = compareRequirementStatements(kind, anchor.quote, rule.anchor.quote);
                        return { relation: pair.relation, comparisonReason: pair.reason }; })() }));
                const established = assessed.filter(rule => rule.applicability === 'CONFIRMED');
                const conflicts = established.filter(rule => rule.relation === 'INCOMPATIBLE');
                const supports = established.filter(rule => rule.relation === 'COMPATIBLE');
                const priority = context.precedenceEvidence.filter(evidence => specialOverGeneral(evidence.quote));
                // Priority must itself be project evidence, never a fixed order
                // inferred from document titles or from the model's opinion.
                const specialSupports = supports.filter(rule => rule.sourceKind === 'PROJECT_CONTRACT'
                    && (rule.sourceCategory === 'SPECS' || /מפרט.*מיוחד/u.test(rule.documentTitle)));
                const resolved = priority.length > 0 && specialSupports.length > 0 && conflicts.every(rule => rule.sourceKind === 'INCORPORATED_REFERENCE');
                const conditional = unsignedForm || isConditionalRequirement(text);
                let assessment: RequirementAssessment = 'NEEDS_BASIS', reason = 'requirement_authority_not_established';
                if (conditional) { assessment = 'PROPOSED_CHANGE'; reason = unsignedForm ? 'unsigned_annex_terms_are_proposed' : 'conditional_choice_is_not_unconditional_duty'; }
                else if (!date.date) reason = 'requirement_date_not_established';
                else if (conflicts.length && supports.length && !resolved) reason = 'governing_precedence_not_established';
                else if (conflicts.length && !resolved) { assessment = 'CONFLICT'; reason = conflicts[0].comparisonReason; }
                else if (supports.length) { assessment = 'SUPPORTED'; reason = supports[0].comparisonReason; }
                else if (established.length) reason = established[0].comparisonReason;
                else if (assessed.length) reason = 'applicable_reference_clause_not_established';
                if (kind === 'SUBMIT_PRICE' && requestedObject === 'UNSPECIFIED') {
                    assessment = 'NEEDS_BASIS'; reason = 'price_analysis_item_not_established';
                }
                const selected = [...assessed].sort((a, b) => Number(b.applicability === 'CONFIRMED') - Number(a.applicability === 'CONFIRMED')
                    || Number(b.relation !== 'UNESTABLISHED') - Number(a.relation !== 'UNESTABLISHED')
                    || ruleRelevanceScore(kind, b.anchor.quote) - ruleRelevanceScore(kind, a.anchor.quote)
                    || a.anchor.quote.length - b.anchor.quote.length || a.anchor.documentId.localeCompare(b.anchor.documentId));
                // Keep the proof of every decisive result. Other candidate
                // clauses are not promoted into proof by their retrieval rank.
                const proof = selected.filter(rule => rule.applicability === 'CONFIRMED' && rule.relation !== 'UNESTABLISHED');
                const seen = new Set<string>();
                const diverse = selected.filter(rule => {
                    const key = `${rule.applicability}:${normalizeEvidenceSource(rule.anchor.quote)}`;
                    if (seen.has(key)) return false;
                    seen.add(key); return true;
                });
                const basis = [...new Map([...proof, ...diverse.slice(0, 4)].map(rule => [
                    `${rule.anchor.documentId}:${rule.anchor.start}:${rule.anchor.end}`, rule,
                ])).values()];
                requirements.push({ id, kind, documentId: document.id, documentTitle: document.title || '', date: date.date,
                    dateAnchor: date.dateAnchor, anchor, requestedObject, assessment, reasons: [reason], basis, basisCount: assessed.length });
            }
        }
    }
    const unique = [...new Map(requirements.map(item => [item.id, item])).values()]
        .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
    return { version: REQUIREMENT_REVIEW_VERSION, issue: input.issue, asOf: input.asOf, requirements: unique,
        confirmedConflicts: unique.filter(item => item.assessment === 'CONFLICT'), referenceGaps: context.gaps,
        sourceCount: new Set(context.rules.map(rule => rule.referenceDocumentId || rule.anchor.documentId)).size,
        precedenceEvidence: context.precedenceEvidence,
        timingBases: context.rules.filter(rule => rule.applicability === 'CONFIRMED'
            && /כל נספח שינוי|נספח (?:ה?שינוי)|MTM/iu.test(normalizeEvidenceSource(rule.anchor.quote))
            && compareRequirementStatements('SIGN_ANNEX', '', rule.anchor.quote).relation === 'COMPATIBLE') };
}
