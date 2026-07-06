export const CONTRACT_DOCUMENT_HIERARCHY_GUIDE = `
DOCUMENT HIERARCHY AND PRECEDENCE:
- First follow the project-specific contract clauses. If a contract clause defines document priority, use that clause before any generic rule.
- Project contract documents are usually complementary: signed contract, signed/project BOQ, special specifications, drawings, approved change orders, and written approvals can work together.
- Shelf contracts, the Blue Book/general specifications, and standards are reference/incorporated sources. They are not ordinary project contract documents by themselves.
- Use reference/incorporated sources only when a project contract, tender, special specification, or written instruction incorporates them, or when the user explicitly asks for reference guidance.
- A project-specific special specification can control the project. A general specification/Blue Book chapter is a fallback/reference layer unless the project documents make it binding for that scope.
- Execution documents, site diaries, protocols, letters, photos, invoices, and supplier quotes are evidence of events or approvals. They do not override the contract baseline by themselves.
- If contract documents conflict, are unclear, or can be read in more than one way, mark the issue as a document-precedence conflict and require supervisor/manager decision according to the contract.
- When the contract says the stricter or more restrictive requirement governs, apply that as the working rule until the supervisor/manager decides otherwise.
- For variations and extra works, price sources must follow the contract mechanism: signed BOQ/direct or closest item first, then the official pricelist named by the contract, then Dekel when the contract allows it, and only then price analysis/materials/labor/quotes with required written approval.
- Supplier or contractor quotes are supporting evidence for price analysis only. They must not be ranked above BOQ, Ministry Housing/משהב"ש/משכ"ל, Netivei Israel, Dekel, or another official contract/pricelist source unless a specific contract clause explicitly says so.
- If no usable contract or official source exists, produce a draft only and clearly state what document, approval, measurement, or manager decision is still needed.
`.trim();

export const DOCUMENT_PRECEDENCE_SUMMARY_HE = [
    "קודם בודקים סעיף חוזי ספציפי לפרויקט.",
    "מסמכי החוזה של הפרויקט משלימים זה את זה, אך סתירה או אי-בהירות דורשות הכרעת מנהל/מפקח לפי החוזה.",
    "חוזה מדף, המפרט הכללי והספר הכחול הם שכבת ייחוס/מקור מחייב לפי הפניה; הם לא מחליפים את מסמכי הפרויקט ללא הפניה חוזית.",
    "כאשר החוזה קובע שהדרישה המחמירה/המגבילה גוברת, משתמשים בה ככלל עבודה עד להכרעה אחרת.",
    "פרוטוקול, יומן, מכתב, תמונה או הצעת מחיר הם ראיה או אסמכתא; הם אינם מחליפים את החוזה בלי אישור/פקודת שינוי בכתב.",
    "בתמחור חריגים: כתב כמויות/סעיף קרוב -> מחירון רשמי לפי החוזה -> דקל אם מותר -> ניתוח מחיר/הצעות מחיר רק כמוצא אחרון ובאישור נדרש.",
];

type ParsedDocumentMeta = {
    category?: unknown;
    type?: unknown;
    is_reference?: unknown;
    reference_family?: unknown;
    authority_scope?: unknown;
};

type DocumentLike = {
    title?: unknown;
    category?: unknown;
    doc_type?: unknown;
    parsed_json?: unknown;
};

function asParsedDocumentMeta(value: unknown): ParsedDocumentMeta {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
        ? value as ParsedDocumentMeta
        : {};
}

export function normalizeDocumentSearchText(value: unknown) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\dA-Za-z\u0590-\u05FF]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function getDocumentSearchText(document: DocumentLike) {
    const parsedJson = asParsedDocumentMeta(document.parsed_json);
    return normalizeDocumentSearchText([
        document.category,
        parsedJson.category,
        document.doc_type,
        parsedJson.type,
        parsedJson.reference_family,
        parsedJson.authority_scope,
        document.title,
    ].filter(Boolean).join(" "));
}

export function isReferenceDocument(document: DocumentLike) {
    const parsedJson = asParsedDocumentMeta(document.parsed_json);
    if (parsedJson.is_reference === true) return true;
    if (String(parsedJson.authority_scope || "").toUpperCase().includes("REFERENCE")) return true;

    const searchText = getDocumentSearchText(document);
    return (
        /reference|incorporated|blue book|shelf contract|general specification|mifrat clali/.test(searchText)
        || /\b3210\b/.test(searchText)
        || /חוזה\s*מדף/.test(searchText)
        || /\bמדף\b/.test(searchText)
        || /ספר\s*כחול/.test(searchText)
        || /הספר\s*הכחול/.test(searchText)
        || /מפרט\s*כללי/.test(searchText)
    );
}

export function isProjectSpecialSpecification(document: DocumentLike) {
    const searchText = getDocumentSearchText(document);
    return (
        /מפרט/.test(searchText)
        && (/מיוחד/.test(searchText) || /special\s+spec/.test(searchText) || /technical\s+special/.test(searchText))
        && !isReferenceDocument(document)
    );
}

export function isProjectContractBaseDocument(document: DocumentLike) {
    if (isReferenceDocument(document)) return false;

    const searchText = getDocumentSearchText(document);
    return (
        /contract|agreement|boq|tender|spec/.test(searchText)
        || /חוזה|הסכם|כתב\s*כמויות|כמויות|מפרט|מכרז/.test(searchText)
        || isProjectSpecialSpecification(document)
    );
}

export function getContractDocumentPrecedenceRank(document: DocumentLike) {
    const searchText = getDocumentSearchText(document);

    if (isReferenceDocument(document)) return 7;
    if (/contract|agreement|חוזה|הסכם/.test(searchText)) return 0;
    if (/boq|כתב\s*כמויות|כמויות/.test(searchText)) return 1;
    if (/spec|מפרט|מיוחד/.test(searchText)) return 2;
    if (/tender|מכרז/.test(searchText)) return 3;
    if (/pricelist|price\s*list|מחירון|דקל|משב|משהב|משכ/.test(searchText)) return 4;
    return 9;
}

export function sortContractDocumentsByPrecedence<T extends DocumentLike>(documents: T[]) {
    return [...documents].sort((left, right) => {
        const rankDiff = getContractDocumentPrecedenceRank(left) - getContractDocumentPrecedenceRank(right);
        if (rankDiff !== 0) return rankDiff;
        return String(left.title || "").localeCompare(String(right.title || ""));
    });
}
