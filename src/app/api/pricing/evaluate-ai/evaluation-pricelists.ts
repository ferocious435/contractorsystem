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

export function getPricelistMetadata(record: AnyRecord) {
    const pricelist = firstRecord(record.pricelists);

    return {
        id: "",
        name: typeof pricelist.name === 'string' ? pricelist.name : null,
        description: typeof pricelist.description === 'string' ? pricelist.description : null,
        source_type: typeof pricelist.source_type === 'string' ? pricelist.source_type : null,
        is_global: Boolean(pricelist.is_global),
        project_id: typeof pricelist.project_id === 'string' ? pricelist.project_id : null,
    };
}

export function getPricelistSourcePriority(record: AnyRecord) {
    const metadata = getPricelistMetadata(record);
    const sourceType = String(metadata.source_type || '').toUpperCase();
    const searchableText = `${metadata.name || ''} ${metadata.description || ''} ${metadata.source_type || ''}`.toLowerCase();

    if (sourceType === 'HOUSING_MINISTRY' ||
        searchableText.includes('משהב') ||
        searchableText.includes('משבה') ||
        searchableText.includes('משרד הבינוי') ||
        searchableText.includes('שיכון') ||
        searchableText.includes('housing ministry') ||
        searchableText.includes('ministry housing') ||
        searchableText.includes('ministry of housing')
    ) {
        return { source: 'HOUSING_MINISTRY', rank: 2 };
    }

    if (sourceType === 'DEKEL' || searchableText.includes('דקל') || searchableText.includes('dekel')) {
        return { source: 'DEKEL', rank: 3 };
    }

    if (searchableText.includes('הצעת מחיר') || searchableText.includes('quote')) {
        return { source: 'CONTRACTOR', rank: 4 };
    }

    return { source: 'CUSTOM_ANALYSIS', rank: 5 };
}

export function sortExternalPricingReferences<T extends AnyRecord>(records: T[]) {
    return [...records].sort((a, b) => {
        const priorityDiff = getPricelistSourcePriority(a).rank - getPricelistSourcePriority(b).rank;
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        const itemTypeDiff = (a.item_type === 'ITEM' ? 0 : 1) - (b.item_type === 'ITEM' ? 0 : 1);
        if (itemTypeDiff !== 0) {
            return itemTypeDiff;
        }

        return String(a.item_code || '').localeCompare(String(b.item_code || ''));
    });
}

export function isExternalPricingReference(record: AnyRecord) {
    const pricelist = firstRecord(record.pricelists);
    return Boolean(pricelist.is_global || !isLikelyContractBoqPricelist(getPricelistMetadata(record)));
}

export function filterExternalPricingReferences<T extends AnyRecord>(records: T[] | null | undefined): T[] {
    return sortExternalPricingReferences((records || []).filter(isExternalPricingReference));
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

    pricelistMatches.sort((a, b) => getPricelistSourcePriority(a).rank - getPricelistSourcePriority(b).rank);
}
