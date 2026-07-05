export function normalizePricingQueueIds(ids: unknown[] = []): string[] {
    return Array.from(
        new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))
    );
}
