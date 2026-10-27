import type { PricingScopeCandidate, PricingScopeContext, PricingScopeResult } from './pricing-scope-review.ts';
import { getLedgerRowAmount, getMoneySum } from './project-financials.ts';

type Row = Record<string, unknown>;
const sourceLabel = (candidate?: PricingScopeCandidate) => ['BOQ', 'HOUSING_MINISTRY', 'DEKEL', 'CONTRACTOR'].includes(candidate?.sourceType || '')
    ? candidate!.sourceType! : 'CUSTOM_ANALYSIS';

/** Project a checked result; never copy a model's invented monetary suggestion. */
export function buildPricingScopeEvaluation(context: PricingScopeContext, review: PricingScopeResult): Row {
    const selected = review.lines.flatMap(line => {
        const candidate = context.candidates.find(item => item.id === line.candidateId);
        return candidate ? [{ line, candidate }] : [];
    });
    const commonUnit = selected.length > 0 && selected.every(item => item.candidate.unit === selected[0].candidate.unit);
    const commonQuantity = commonUnit && selected.every(item => item.line.quantity.value === selected[0].line.quantity.value);
    const quantity = commonQuantity ? selected[0].line.quantity.value : null;
    const unitPrices = selected.map(({ line }) => line.unitPriceExclVat.value !== null && line.coefficients.every(item => item.value !== null)
        ? getLedgerRowAmount({ quantity: 1, unit_price_excl_vat: line.unitPriceExclVat.value * line.coefficients.reduce((factor, item) => factor * item.value!, 1) }) : null);
    const unitPrice = commonUnit && unitPrices.every(value => value !== null) ? getMoneySum(unitPrices) : null;
    const source = selected.length && selected.every(item => sourceLabel(item.candidate) === sourceLabel(selected[0].candidate))
        ? sourceLabel(selected[0].candidate) : 'CUSTOM_ANALYSIS';
    const breakdown = selected.map(({ candidate, line }, index) => ({
        item_code: candidate.itemCode || '', source: sourceLabel(candidate), source_name: candidate.title || '',
        description: candidate.text, unit: candidate.unit || '', quantity: line.quantity.value,
        unit_price_excl_vat: unitPrices[index], amount_excl_vat: line.amountExclVat,
        basis: review.positions.find(item => item.candidateId === candidate.id)?.reason || '', is_inference: false,
        pricelist_id: candidate.pricelistId || null, pricelist_item_id: candidate.pricelistId ? candidate.id : null,
        document_id: candidate.documentId || null, page: candidate.page ?? null,
        covered_requirement_ids: line.requirementIds,
    }));
    const item = (candidate: PricingScopeCandidate) => ({ id: candidate.id, item_code: candidate.itemCode, description: candidate.text,
        unit: candidate.unit, rate: candidate.rate, pricelist_id: candidate.pricelistId || null,
        document_id: candidate.documentId || null, page: candidate.page ?? null });
    const selectedNotes = [...new Set(selected.flatMap(({ candidate }) => candidate.noteSourceIds))];
    const notes = context.sources.filter(source => selectedNotes.includes(source.id));
    const questions = review.issues.some(issue => issue.startsWith('quantity_unverified:')) ? ['מה הכמות שבוצעה בפועל לפי המדידה?'] : [];
    return {
        scope_review: review, match_found: selected.some(item => item.line.unitPriceExclVat.value !== null), source,
        confidence: review.requiresReview ? 0.35 : 0.8, confidence_score: review.requiresReview ? 0.35 : 0.8,
        match_quality: review.status === 'FULL' ? 'DIRECT' : review.status === 'PARTIAL' ? 'PARTIAL' : 'ZERO_MATCH',
        suggested_unit_price_excl_vat: unitPrice, suggested_quantity: quantity,
        suggested_unit: commonUnit ? selected[0].candidate.unit || '' : '', total_excl_vat: review.totalExclVat,
        item_code: selected.length === 1 ? selected[0].candidate.itemCode || '' : '',
        suggested_description: review.requirements.map(item => item.description).join(', '),
        ai_rationale: review.positions.map(item => item.reason).filter(Boolean).join('\n'),
        governing_notes: notes.map(note => note.extracted_text || ''),
        source_basis: selected.map(({ candidate }) => `${candidate.title || ''} ${candidate.itemCode || ''}`.trim()),
        pricing_breakdown: breakdown, quantity_basis: quantity === null ? 'ESTIMATED' : 'EXPLICIT',
        quantity_review_required: quantity === null, ancillary_scope: review.uncoveredRequirementIds.length ? 'REVIEW_ONLY' : 'NONE',
        ancillary_notes: review.uncoveredRequirementIds.map(id => review.requirements.find(item => item.id === id)?.description || id),
        requires_user_answer_before_approval: review.requiresReview || quantity === null || unitPrice === null,
        needed_documents: [], questions, zero_match_reason: selected.length ? null : 'לא נמצא סעיף מתאים עם בסיס מאומת לעבודה הנדרשת.',
        source_trace: { contract_matches: selected.filter(({ candidate }) => candidate.sourceType === 'BOQ').length,
            pricelist_item_matches: selected.filter(({ candidate }) => candidate.sourceType !== 'BOQ').length,
            governing_note_matches: notes.length, candidate_count: context.candidates.length, keywords: [] },
        matched_items: { contract: selected.filter(({ candidate }) => candidate.sourceType === 'BOQ').map(({ candidate }) => item(candidate)),
            pricelist: selected.filter(({ candidate }) => candidate.sourceType !== 'BOQ').map(({ candidate }) => item(candidate)),
            notes: notes.map(note => ({ id: note.id, description: note.extracted_text })) },
    };
}
