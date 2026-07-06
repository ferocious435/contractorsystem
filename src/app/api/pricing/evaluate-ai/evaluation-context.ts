import { sortContractDocumentsByPrecedence } from '@/utils/contract-document-hierarchy';

type AnyRecord = Record<string, unknown>;

function getPricelistSourceLabel(pricelistName: unknown, description: unknown, sourceType: unknown) {
    const normalizedSourceType = String(sourceType || '').toUpperCase();
    const searchableText = `${pricelistName || ''} ${description || ''} ${sourceType || ''}`.toLowerCase();

    if (normalizedSourceType === 'HOUSING_MINISTRY' ||
        searchableText.includes('משהב') ||
        searchableText.includes('משבה') ||
        searchableText.includes('משרד הבינוי') ||
        searchableText.includes('שיכון') ||
        searchableText.includes('housing ministry') ||
        searchableText.includes('ministry housing') ||
        searchableText.includes('ministry of housing')
    ) {
        return 'HOUSING_MINISTRY';
    }

    if (normalizedSourceType === 'DEKEL' || searchableText.includes('דקל') || searchableText.includes('dekel')) {
        return 'DEKEL';
    }

    if (searchableText.includes('הצעת מחיר') || searchableText.includes('quote')) {
        return 'CONTRACTOR';
    }

    return 'CUSTOM_ANALYSIS';
}

function asRecord(value: unknown): AnyRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as AnyRecord
        : {};
}

function firstRecord(value: unknown): AnyRecord {
    if (Array.isArray(value)) {
        return asRecord(value[0]);
    }
    return asRecord(value);
}

export const MAX_BOQ_RAW_CONTEXT_CHARS = 12000;
export const MAX_BOQ_RAW_CONTEXT_DOCS = 8;

export function buildBoqContext(ledgerMatches: AnyRecord[]) {
    return ledgerMatches.length
        ? ledgerMatches
            .map(m => `[CONTRACT ITEM] Code: ${m.item_code}, Desc: ${m.description}, Price: ${m.unit_price_excl_vat}, Unit: ${m.unit}`)
            .join('\n')
        : 'No direct contract matches found in Ledger.';
}

export function buildBoqRawContext(contractDocs: AnyRecord[] | null | undefined) {
    if (!contractDocs?.length) {
        return 'No existing BOQ found.';
    }

    const chunks: string[] = [];
    let usedChars = 0;

    for (const doc of sortContractDocumentsByPrecedence(contractDocs).slice(0, MAX_BOQ_RAW_CONTEXT_DOCS)) {
        if (!doc?.parsed_json) {
            continue;
        }

        const title = String(doc.title || 'Untitled BOQ document');
        const serialized = JSON.stringify(doc.parsed_json);
        const availableChars = MAX_BOQ_RAW_CONTEXT_CHARS - usedChars;

        if (availableChars <= 0) {
            break;
        }

        const docChunk = `[BOQ RAW: ${title}]\n${serialized}`;
        const cappedChunk = docChunk.length > availableChars
            ? `${docChunk.slice(0, Math.max(0, availableChars - 18))}\n[TRUNCATED BOQ]`
            : docChunk;

        chunks.push(cappedChunk);
        usedChars += cappedChunk.length;

        if (usedChars >= MAX_BOQ_RAW_CONTEXT_CHARS) {
            break;
        }
    }

    return chunks.length ? chunks.join('\n') : 'No existing BOQ found.';
}

export function buildPricelistContext(pricelistMatches: AnyRecord[]) {
    const itemsContext = pricelistMatches
        .filter(m => m.item_type === 'ITEM')
        .map(m => {
            const pricelist = firstRecord(m.pricelists);
            const sourceLabel = getPricelistSourceLabel(pricelist.name, pricelist.description, pricelist.source_type);
            return `[${sourceLabel}] [${pricelist.name || 'Unknown'}] Code: ${m.item_code}, Desc: ${m.description}, Price: ${m.rate}, Unit: ${m.unit}`;
        })
        .join('\n');

    const notesContext = pricelistMatches
        .filter(m => m.item_type === 'NOTE')
        .map(m => `[GOVERNING NOTE] Code: ${m.item_code}, Note: ${m.description}`)
        .join('\n');

    return `
        --- ACTIONABLE ITEMS (EXTERNAL) ---
        ${itemsContext || 'No direct external matches found.'}

        --- GOVERNING INSTRUCTIONS (CRITICAL) ---
        ${notesContext || 'No specific governing notes found.'}
        `;
}

export function hasSourceMatches(ledgerMatches: AnyRecord[] | null | undefined, pricelistMatches: AnyRecord[]) {
    return Boolean(ledgerMatches?.length || pricelistMatches.some(m => m.item_type === 'ITEM'));
}

export function buildSourceTrace(
    ledgerMatches: AnyRecord[] | null | undefined,
    pricelistMatches: AnyRecord[],
    keywords: string[],
) {
    return {
        contract_matches: ledgerMatches?.length || 0,
        pricelist_item_matches: pricelistMatches.filter(m => m.item_type === 'ITEM').length,
        governing_note_matches: pricelistMatches.filter(m => m.item_type === 'NOTE').length,
        keywords,
    };
}

export function buildMatchedItems(ledgerMatches: AnyRecord[] | null | undefined, pricelistMatches: AnyRecord[]) {
    return {
        contract: ledgerMatches || [],
        pricelist: pricelistMatches.filter(m => m.item_type === 'ITEM').slice(0, 10),
        notes: pricelistMatches.filter(m => m.item_type === 'NOTE').slice(0, 10),
    };
}

export function buildPricingEvidenceData(
    currentEvidence: AnyRecord,
    evaluation: AnyRecord,
    expertStrategy: unknown,
) {
    return {
        ...currentEvidence,
        pricing_evaluation: {
            match_found: evaluation.match_found,
            source: evaluation.source,
            confidence: evaluation.confidence,
            confidence_score: evaluation.confidence,
            match_quality: evaluation.match_quality,
            quantity_basis: evaluation.quantity_basis,
            quantity_review_required: evaluation.quantity_review_required,
            ancillary_scope: evaluation.ancillary_scope,
            source_trace: evaluation.source_trace,
            matched_items: evaluation.matched_items,
            source_basis: evaluation.source_basis || [],
            document_precedence_assessment: evaluation.document_precedence_assessment || null,
            pricing_breakdown: evaluation.pricing_breakdown || [],
            needed_documents: evaluation.needed_documents || [],
            questions: evaluation.questions || [],
            requires_user_answer_before_approval: Boolean(evaluation.requires_user_answer_before_approval),
            ancillary_notes: evaluation.ancillary_notes || [],
            zero_match_reason: evaluation.zero_match_reason || null,
        },
        ...(expertStrategy ? { expert_strategy: expertStrategy } : {}),
    };
}
