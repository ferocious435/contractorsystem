import { VAT_RATE } from '../../../../utils/constants';
import { normalizeLedgerEvidenceData } from './ledger-evidence';
import { buildLedgerMutationPayload } from './ledger-mutation-payload';

const ALLOWED_SOURCES = new Set(['BOQ', 'DEKEL', 'CONTRACTOR', 'CUSTOM_ANALYSIS']);
const ALLOWED_TYPES = new Set(['BASE_CONTRACT', 'APPROVED_VO', 'PENDING_VO']);

interface NormalizeSaveLedgerInputResult {
    ok: true;
    value: {
        itemId: unknown;
        activeContradictionId: unknown;
        ledgerMutationPayload: Record<string, unknown>;
    };
}

interface NormalizeSaveLedgerInputError {
    ok: false;
    error: string;
    status: number;
}

function toNumber(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}

function normalizeMarkupPercentage(value: unknown) {
    const parsed = toNumber(value, 0);
    return parsed > 1 ? parsed / 100 : parsed;
}

export function normalizeSaveLedgerInput(data: Record<string, unknown>): NormalizeSaveLedgerInputResult | NormalizeSaveLedgerInputError {
    const {
        queue_id,
        item_id,
        contradiction_id,
        item_name,
        ai_explanation,
        user_notes,
        item_code,
        description,
        unit,
        quantity,
        unit_price_excl_vat,
        markup_percentage,
        ai_rationale,
        governing_notes,
        expert_strategy,
        evidence_data,
        source = 'CUSTOM_ANALYSIS',
        type = 'PENDING_VO',
        vat_rate = VAT_RATE,
    } = data;

    const activeContradictionId = contradiction_id || queue_id;
    const safeSource = typeof source === 'string' && ALLOWED_SOURCES.has(source) ? source : 'CUSTOM_ANALYSIS';
    const requestedType = typeof type === 'string' && ALLOWED_TYPES.has(type) ? type : 'PENDING_VO';
    const safeType = requestedType === 'BASE_CONTRACT' ? 'PENDING_VO' : requestedType;
    const parsedQuantity = toNumber(quantity, Number.NaN);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
        return { ok: false, error: 'quantity must be a positive number', status: 400 };
    }

    const parsedUnitPrice = toNumber(unit_price_excl_vat, Number.NaN);

    if (!Number.isFinite(parsedUnitPrice)) {
        return { ok: false, error: 'unit_price_excl_vat is required', status: 400 };
    }

    const rationale = ai_rationale || ai_explanation || '';
    const notes = governing_notes || (user_notes ? [user_notes] : []);
    const safeDescription = description || item_name || user_notes || ai_explanation;

    if (!safeDescription || String(safeDescription).trim().length < 3) {
        return { ok: false, error: 'description is required before saving a ledger item', status: 400 };
    }

    const safeEvidenceData = normalizeLedgerEvidenceData(evidence_data);
    const ledgerMutationPayload = buildLedgerMutationPayload({
        safeType,
        safeSource,
        itemCode: item_code,
        safeDescription,
        unit,
        safeQuantity: parsedQuantity,
        safeUnitPrice: roundMoney(parsedUnitPrice),
        normalizedMarkupPercentage: normalizeMarkupPercentage(markup_percentage),
        rationale,
        notes,
        expertStrategy: expert_strategy,
        safeEvidenceData,
        safeVatRate: toNumber(vat_rate, VAT_RATE) === VAT_RATE ? VAT_RATE : VAT_RATE,
    });

    return {
        ok: true,
        value: {
            itemId: item_id,
            activeContradictionId,
            ledgerMutationPayload,
        },
    };
}
