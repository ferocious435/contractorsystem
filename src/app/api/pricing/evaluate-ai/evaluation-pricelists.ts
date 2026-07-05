import { isLikelyContractBoqPricelist } from '../../../../utils/pricing-ledger-contract-sync';

type AnyRecord = Record<string, unknown>;

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

function getPricelistMetadata(record: AnyRecord) {
    const pricelist = firstRecord(record.pricelists);

    return {
        id: "",
        name: typeof pricelist.name === 'string' ? pricelist.name : null,
        description: typeof pricelist.description === 'string' ? pricelist.description : null,
        is_global: Boolean(pricelist.is_global),
        project_id: typeof pricelist.project_id === 'string' ? pricelist.project_id : null,
    };
}

export function isExternalPricingReference(record: AnyRecord) {
    const pricelist = firstRecord(record.pricelists);
    return Boolean(pricelist.is_global || !isLikelyContractBoqPricelist(getPricelistMetadata(record)));
}

export function filterExternalPricingReferences<T extends AnyRecord>(records: T[] | null | undefined): T[] {
    return (records || []).filter(isExternalPricingReference);
}

export function buildParentItemCodePrefixes(itemMatches: AnyRecord[]) {
    const parentPrefixes = new Set<string>();

    itemMatches.forEach(m => {
        const parts = String(m.item_code || '').split('.').filter(Boolean);
        if (parts.length >= 1) parentPrefixes.add(`${parts[0]}`);
        if (parts.length >= 2) parentPrefixes.add(`${parts[0]}.${parts[1]}`);
        if (parts.length >= 3) parentPrefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    });

    return parentPrefixes;
}

export function buildParentNoteOrFilter(parentPrefixes: Set<string>) {
    return Array.from(parentPrefixes).map(p => `item_code.ilike.${p}%`).join(',');
}

export function appendUniqueParentNotes<T extends AnyRecord>(pricelistMatches: T[], parentNotes: T[] | null | undefined) {
    const existingIds = new Set(pricelistMatches.map(m => m.id));
    const filteredParentNotes = filterExternalPricingReferences(parentNotes);

    filteredParentNotes.forEach(note => {
        if (!existingIds.has(note.id)) {
            pricelistMatches.push(note);
        }
    });
}
