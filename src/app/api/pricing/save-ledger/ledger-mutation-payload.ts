interface BuildLedgerMutationPayloadParams {
    safeType: string;
    safeSource: string;
    itemCode: unknown;
    safeDescription: unknown;
    unit: unknown;
    safeQuantity: number;
    safeUnitPrice: number;
    normalizedMarkupPercentage: number;
    rationale: unknown;
    notes: unknown;
    expertStrategy: unknown;
    safeEvidenceData: Record<string, unknown>;
    safeVatRate: number;
}

export function buildLedgerMutationPayload({
    safeType,
    safeSource,
    itemCode,
    safeDescription,
    unit,
    safeQuantity,
    safeUnitPrice,
    normalizedMarkupPercentage,
    rationale,
    notes,
    expertStrategy,
    safeEvidenceData,
    safeVatRate,
}: BuildLedgerMutationPayloadParams) {
    return {
        type: safeType,
        source: safeSource,
        item_code: itemCode || null,
        description: safeDescription,
        unit: unit || 'יח',
        quantity: safeQuantity,
        unit_price_excl_vat: safeUnitPrice,
        markup_percentage: normalizedMarkupPercentage,
        ai_rationale: rationale,
        governing_notes: notes,
        expert_strategy: expertStrategy,
        evidence_data: safeEvidenceData,
        vat_rate: safeVatRate,
    };
}
