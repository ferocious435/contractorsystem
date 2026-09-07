export function normalizeDocumentPage(value: number | string | null | undefined): number | null {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : null;
    }

    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;

    const labeledMatch = text.match(/(?:עמוד|page)\s*[:#-]?\s*(\d+)/i);
    const numericMatch = text.match(/^\d+$/);
    const page = Number(labeledMatch?.[1] || numericMatch?.[0]);

    return Number.isInteger(page) && page > 0 ? page : null;
}
