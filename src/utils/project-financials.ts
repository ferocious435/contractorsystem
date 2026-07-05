export type LedgerLikeRow = {
    type?: string | null;
    source?: string | null;
    quantity?: number | null;
    unit_price_excl_vat?: number | null;
    total_price_excl_vat?: number | null;
    vat_rate?: number | null;
    evidence_data?: Record<string, unknown> | unknown[] | null;
};

type LedgerAmountInput = Omit<LedgerLikeRow, "evidence_data"> & {
    evidence_data?: unknown;
};

function normalizeEvidenceData(value: unknown): LedgerLikeRow["evidence_data"] {
    if (Array.isArray(value)) {
        return value;
    }

    return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

const normalizeAmount = (value: number | null | undefined) => Number(value || 0);
const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function isTrustedBaseContractRow(row: LedgerLikeRow): boolean {
    if (row.type !== "BASE_CONTRACT") {
        return false;
    }

    // A trusted contract base must be traceable to a concrete project BOQ line.
    if (!row.evidence_data || Array.isArray(row.evidence_data)) {
        return false;
    }

    return row.source === "BOQ" &&
        row.evidence_data?.source === "pricelist_items" &&
        Boolean(row.evidence_data?.pricelist_item_id);
}

export function isVisibleLedgerRow(row: LedgerLikeRow): boolean {
    return !(row.type === "BASE_CONTRACT" && !isTrustedBaseContractRow(row));
}

export function getLedgerRowAmount(row: LedgerAmountInput): number {
    const normalizedRow: LedgerLikeRow = {
        ...row,
        evidence_data: normalizeEvidenceData(row.evidence_data),
    };

    if (isTrustedBaseContractRow(normalizedRow)) {
        return roundMoney(normalizeAmount(normalizedRow.quantity) * normalizeAmount(normalizedRow.unit_price_excl_vat));
    }

    const directTotal = normalizeAmount(normalizedRow.total_price_excl_vat);
    if (directTotal > 0) {
        return roundMoney(directTotal);
    }

    return roundMoney(normalizeAmount(normalizedRow.quantity) * normalizeAmount(normalizedRow.unit_price_excl_vat));
}

export function getBaseContractAmount(rows: LedgerLikeRow[] | null | undefined): number {
    if (!rows?.length) {
        return 0;
    }

    return rows
        .filter(isTrustedBaseContractRow)
        .reduce((sum, row) => roundMoney(sum + getLedgerRowAmount(row)), 0);
}

export function getVariationOrderAmount(rows: LedgerLikeRow[] | null | undefined): number {
    if (!rows?.length) {
        return 0;
    }

    return rows
        .filter((row) => row.type !== "BASE_CONTRACT")
        .reduce((sum, row) => roundMoney(sum + getLedgerRowAmount(row)), 0);
}

export function getLedgerRowVatAmount(row: LedgerLikeRow, fallbackVatRate = 0.18): number {
    return roundMoney(getLedgerRowAmount(row) * normalizeAmount(row.vat_rate ?? fallbackVatRate));
}

export function getLedgerRowTotalInclVat(row: LedgerLikeRow, fallbackVatRate = 0.18): number {
    return roundMoney(getLedgerRowAmount(row) + getLedgerRowVatAmount(row, fallbackVatRate));
}

export function getAmountVat(amountExclVat: number | null | undefined, vatRate = 0.18): number {
    return roundMoney(normalizeAmount(amountExclVat) * normalizeAmount(vatRate));
}

export function getAmountInclVat(amountExclVat: number | null | undefined, vatRate = 0.18): number {
    return roundMoney(normalizeAmount(amountExclVat) + getAmountVat(amountExclVat, vatRate));
}

export function getMoneySum(values: Array<number | null | undefined>): number {
    return values.reduce<number>((sum, value) => roundMoney(sum + normalizeAmount(value)), 0);
}

export function getPreferredProjectAmount(
    manualBudget: number | null | undefined,
    ledgerRows: LedgerLikeRow[] | null | undefined
): number {
    const contractAmount = getBaseContractAmount(ledgerRows);
    return contractAmount > 0 ? contractAmount : roundMoney(normalizeAmount(manualBudget));
}
