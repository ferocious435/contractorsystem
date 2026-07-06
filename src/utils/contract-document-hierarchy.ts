export const CONTRACT_DOCUMENT_HIERARCHY_GUIDE = `
DOCUMENT HIERARCHY AND PRECEDENCE:
- First follow the project-specific contract clauses. If a contract clause defines document priority, use that clause before any generic rule.
- Contract documents are usually complementary: contract, signed BOQ, special specifications, drawings, general specifications, standards, approved change orders, and written approvals can work together.
- Execution documents, site diaries, protocols, letters, photos, invoices, and supplier quotes are evidence of events or approvals. They do not override the contract baseline by themselves.
- If contract documents conflict, are unclear, or can be read in more than one way, mark the issue as a document-precedence conflict and require supervisor/manager decision according to the contract.
- When the contract says the stricter or more restrictive requirement governs, apply that as the working rule until the supervisor/manager decides otherwise.
- For variations and extra works, price sources must follow the contract mechanism: signed BOQ/direct or closest item first, then the official pricelist named by the contract, then Dekel when the contract allows it, and only then price analysis/materials/labor/quotes with required written approval.
- Supplier or contractor quotes are supporting evidence for price analysis only. They must not be ranked above BOQ, Ministry Housing/משב"ש/משכ"ל, Netivei Israel, Dekel, or another official contract/pricelist source unless a specific contract clause explicitly says so.
- If no usable contract or official source exists, produce a draft only and clearly state what document, approval, measurement, or manager decision is still needed.
`.trim();

export const DOCUMENT_PRECEDENCE_SUMMARY_HE = [
    "קודם בודקים סעיף חוזי ספציפי לפרויקט.",
    "מסמכי החוזה משלימים זה את זה, אך סתירה או אי בהירות דורשות הכרעת מנהל/מפקח לפי החוזה.",
    "כאשר החוזה קובע שהדרישה המחמירה/המגבילה גוברת, משתמשים בה ככלל עבודה עד להכרעה אחרת.",
    "פרוטוקול, יומן, מכתב, תמונה או הצעת מחיר הם ראיה או אסמכתא; הם אינם מחליפים את החוזה בלי אישור/פקודת שינוי בכתב.",
    "בתמחור חריגים: כתב כמויות/סעיף קרוב -> מחירון רשמי לפי החוזה -> דקל אם מותר -> ניתוח מחיר/הצעות מחיר רק כמוצא אחרון ובאישור נדרש.",
];

type DocumentLike = {
    title?: unknown;
    category?: unknown;
    doc_type?: unknown;
    parsed_json?: unknown;
};

function asParsedDocumentMeta(value: unknown) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as { category?: unknown; type?: unknown }
        : {};
}

export function getContractDocumentPrecedenceRank(document: DocumentLike) {
    const parsedJson = asParsedDocumentMeta(document.parsed_json);
    const rawCategory = String(document.category || parsedJson.category || '').toUpperCase();
    const rawType = String(document.doc_type || parsedJson.type || '').toUpperCase();
    const title = String(document.title || '').toLowerCase();
    const searchText = `${rawCategory} ${rawType} ${title}`;

    if (/CONTRACT|AGREEMENT|חוזה|הסכם|מדף/.test(searchText)) return 0;
    if (/BOQ|כתב\s*כמויות|כמויות/.test(searchText)) return 1;
    if (/SPECS|SPEC|מפרט|מיוחד/.test(searchText)) return 2;
    if (/TENDER|מכרז/.test(searchText)) return 3;
    if (/PRICELIST|PRICE\s*LIST|מחירון|דקל|משב|משהב|משכ/.test(searchText)) return 4;
    return 9;
}

export function sortContractDocumentsByPrecedence<T extends DocumentLike>(documents: T[]) {
    return [...documents].sort((left, right) => {
        const rankDiff = getContractDocumentPrecedenceRank(left) - getContractDocumentPrecedenceRank(right);
        if (rankDiff !== 0) return rankDiff;
        return String(left.title || '').localeCompare(String(right.title || ''));
    });
}
