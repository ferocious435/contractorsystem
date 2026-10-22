export type SupportSourceDocument = {
    id: string;
    title?: string | null;
    category?: string | null;
    parsed_json?: Record<string, unknown> | null;
};

export type ReferenceSourceRow = {
    id: string;
    title?: string | null;
    reference_type?: string | null;
    authority_scope?: string | null;
    status?: string | null;
    page_count?: number | null;
};

export type PriceListSourceRow = {
    id: string;
    name?: string | null;
    project_id?: string | null;
    is_global?: boolean | null;
    source_type?: string | null;
    version_label?: string | null;
    publisher?: string | null;
    parse_status?: string | null;
};

export type SupportSourceInventory = {
    blueBook: {
        available: boolean;
        title: string | null;
        status: string | null;
    };
    shelfContract3210: {
        available: boolean;
        title: string | null;
        status: string | null;
    };
    priceLists: Array<{
        id: string;
        name: string;
        sourceType: string | null;
        version: string | null;
        status: string;
    }>;
    standards: Array<{
        id: string;
        title: string;
        status: string;
    }>;
};

function normalized(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

function referenceFamily(document: SupportSourceDocument) {
    const parsedFamily = normalized(document.parsed_json?.reference_family).toUpperCase();
    if (parsedFamily) return parsedFamily;

    const title = normalized(document.title);
    if (/3210|חוזה\s*מדף|shelf\s*contract/.test(title)) return 'SHELF_CONTRACT_3210';
    if (/ספר\s*כחול|הספר\s*הכחול|מפרט\s*כללי|blue\s*book/.test(title)) return 'BLUE_BOOK';
    return null;
}

function findReference(
    family: 'BLUE_BOOK' | 'SHELF_CONTRACT_3210',
    documents: SupportSourceDocument[],
    references: ReferenceSourceRow[],
) {
    const matchingReferences = references.filter(
        (row) => normalized(row.reference_type).toUpperCase() === family,
    );
    const readyReference = matchingReferences.find((row) => normalized(row.status) === 'ready');
    if (readyReference) {
        return {
            available: true,
            title: String(readyReference.title || '').trim() || null,
            status: String(readyReference.status || '').trim() || null,
        };
    }

    const document = documents.find((row) => referenceFamily(row) === family);
    if (document) {
        return {
            available: true,
            title: String(document.title || '').trim() || null,
            status: 'DOCUMENT_LIBRARY',
        };
    }

    const storedReference = matchingReferences[0];
    if (storedReference) {
        return {
            available: false,
            title: String(storedReference.title || '').trim() || null,
            status: String(storedReference.status || '').trim() || null,
        };
    }

    return { available: false, title: null, status: null };
}

export function buildSupportSourceInventory(params: {
    documents: SupportSourceDocument[];
    references: ReferenceSourceRow[];
    priceLists: PriceListSourceRow[];
}): SupportSourceInventory {
    const { documents, references, priceLists } = params;

    return {
        blueBook: findReference('BLUE_BOOK', documents, references),
        shelfContract3210: findReference('SHELF_CONTRACT_3210', documents, references),
        priceLists: priceLists.map((row) => ({
            id: row.id,
            name: String(row.name || '').trim() || 'מחירון ללא שם',
            sourceType: String(row.source_type || '').trim() || null,
            version: String(row.version_label || '').trim() || null,
            status: String(row.parse_status || '').trim() || 'READY',
        })),
        standards: [
            ...references
                .filter((row) => normalized(row.reference_type).toUpperCase() === 'ISRAELI_STANDARD')
                .map((row) => ({
                    id: row.id,
                    title: String(row.title || '').trim() || 'תקן ישראלי',
                    status: String(row.status || '').trim() || 'READY',
                })),
            ...documents
                .filter((row) => normalized(row.parsed_json?.reference_family).toUpperCase() === 'ISRAELI_STANDARD')
                .map((row) => ({
                    id: row.id,
                    title: String(row.title || '').trim() || 'תקן ישראלי',
                    status: 'DOCUMENT_LIBRARY',
                })),
        ],
    };
}
