interface ContradictionStatusRow {
    status?: string | null;
    severity?: string | null;
}

export function summarizeOpenContradictions(items: ContradictionStatusRow[] | null | undefined) {
    const openItems = (items || []).filter((item) => item.status === 'OPEN');

    return {
        openCount: openItems.length,
        highRiskOpenCount: openItems.filter((item) => item.severity === 'HIGH').length,
    };
}
