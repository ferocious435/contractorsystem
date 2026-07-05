const PRICING_KEYWORD_EXPANSIONS: Record<string, string[]> = {
    פירוק: ['פירוק', 'פינוי', 'הריסה', 'ניתוק', 'הסרה'],
    הרכבה: ['הרכבה', 'התקנה', 'החזרה', 'קיבוע', 'חיבור'],
    מדידה: ['מדידה', 'בדיקה', 'סימון', 'פיקוח'],
    קוטר: ['קוטר', 'צינור', 'שרוול', 'מוביל'],
    מים: ['מים', 'ביוב', 'ניקוז', 'צנרת'],
    חשמל: ['חשמל', 'כבל', 'תקשורת', 'מוליך'],
    אביזר: ['אביזר', 'מחבר', 'קופסה', 'שוחה'],
};

function normalizeKeyword(value: unknown) {
    return String(value || '')
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\s+/g, ' ');
}

function splitFallbackKeywords(value: unknown) {
    return String(value || '')
        .split(/[\s,.;:()[\]\-–—/\\]+/)
        .map(normalizeKeyword)
        .filter((word) => word.length > 2);
}

export function extractPricingKeywords(keywordResponseText: string, fallbackText: unknown) {
    const extractedKeywords = keywordResponseText
        .split(',')
        .map(normalizeKeyword)
        .filter(s => s.length > 2);

    const fallbackKeywords = splitFallbackKeywords(fallbackText);
    const expandedKeywords = [...extractedKeywords, ...fallbackKeywords];

    for (const keyword of [...expandedKeywords]) {
        for (const [trigger, additions] of Object.entries(PRICING_KEYWORD_EXPANSIONS)) {
            if (keyword.includes(trigger)) {
                expandedKeywords.push(...additions);
            }
        }
    }

    return Array.from(new Set(expandedKeywords)).slice(0, 16);
}