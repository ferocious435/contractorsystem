type LedgerLikeRow = {
    type?: string | null;
    source?: string | null;
    quantity?: number | null;
    unit_price_excl_vat?: number | null;
    total_price_excl_vat?: number | null;
};

const normalizeAmount = (value: number | null | undefined) => Number(value || 0);

function isTrustedBaseContractRow(row: LedgerLikeRow): boolean {
    if (row.type !== "BASE_CONTRACT") {
        return false;
    }

    // A contract base must come from a real contract / BOQ source, not from a synthetic AI draft.
    return row.source !== "CUSTOM_ANALYSIS";
}

export function getLedgerRowAmount(row: LedgerLikeRow): number {
    const directTotal = normalizeAmount(row.total_price_excl_vat);
    if (directTotal > 0) {
        return directTotal;
    }

    return normalizeAmount(row.quantity) * normalizeAmount(row.unit_price_excl_vat);
}

export function getBaseContractAmount(rows: LedgerLikeRow[] | null | undefined): number {
    if (!rows?.length) {
        return 0;
    }

    return rows
        .filter(isTrustedBaseContractRow)
        .reduce((sum, row) => sum + getLedgerRowAmount(row), 0);
}

export function getPreferredProjectAmount(
    manualBudget: number | null | undefined,
    ledgerRows: LedgerLikeRow[] | null | undefined
): number {
    const contractAmount = getBaseContractAmount(ledgerRows);
    return contractAmount > 0 ? contractAmount : normalizeAmount(manualBudget);
}
