import type {LetterDraftSnapshot} from './letter-draft-types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function isLetterDraftSnapshot(value: unknown): value is LetterDraftSnapshot {
  if (!isRecord(value) || value.calculationVersion !== 'letter-individual-v1' || !isRecord(value.totals)
    || !['net', 'vat', 'gross'].every(key => typeof (value.totals as Record<string, unknown>)[key] === 'number'
      && Number.isFinite((value.totals as Record<string, number>)[key])) || !Array.isArray(value.items) || !value.items.length) return false;
  const seen = new Set<string>(), sums = {net: 0, vat: 0, gross: 0};
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.ledgerItemId !== 'string' || !item.ledgerItemId || seen.has(item.ledgerItemId)
      || !['quantity', 'unitPriceExclVat', 'vatRate'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
      || Number(item.quantity) <= 0 || Number(item.vatRate) < 0 || Number(item.vatRate) > 1
      || !['manual', 'source', 'confirmed-zero'].includes(String(item.conditionBasis))
      || typeof item.conditionNote !== 'string' || !item.conditionNote.trim()
      || !Array.isArray(item.sources) || !item.sources.length) return false;
    seen.add(item.ledgerItemId);
    for (const key of ['net', 'vat', 'gross'] as const) {
      if (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || !Number.isSafeInteger(Math.round(item[key] * 100))) return false;
      sums[key] += Math.round(item[key] * 100);
      if (!Number.isSafeInteger(sums[key])) return false;
    }
    for (const source of item.sources) {
      if (!isRecord(source) || !['DOCUMENT', 'MANUAL'].includes(String(source.basis))
        || !['VERIFIED', 'REQUIRES_VERIFICATION'].includes(String(source.status))
        || !['documentId', 'title', 'pageLabel', 'quote', 'manualNote'].every(key => source[key] === null || typeof source[key] === 'string')
        || (source.status === 'VERIFIED' && (source.basis !== 'DOCUMENT' || !source.documentId || !source.quote))
        || (source.basis === 'MANUAL' && (typeof source.manualNote !== 'string' || !source.manualNote.trim()))) return false;
    }
  }
  return (['net', 'vat', 'gross'] as const).every(key => sums[key] === Math.round(Number((value.totals as Record<string, unknown>)[key]) * 100));
}

export function stableLetterValue(value: unknown): string {
  const normalized = (item: unknown): unknown => Array.isArray(item) ? item.map(normalized)
    : isRecord(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalized(child)])) : item;
  return JSON.stringify(normalized(value));
}
