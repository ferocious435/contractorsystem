type NumericRecord = {raw: string; start: number; end: number; date: string | null; shortDate: boolean; equivalent: string | null};

function codeContext(text: string, start: number, end: number): boolean {
    if (/[\p{L}_]/u.test(text[start - 1] || '') || /[\p{L}_]/u.test(text[end] || '')) return true;
    return /(?:סעיף|סעיפים|תת[ -]?סעיף|פרק|קוד|מק["״']?ט|clause|section|code|item)\s*(?:מס[.'״]?\s*)?$/iu.test(text.slice(Math.max(0, start - 48), start));
}

function dateIdentity(raw: string): string | null {
    const match = /^(\d{1,2})([/.])(\d{1,2})\2(\d{2}|\d{4})$/u.exec(raw);
    if (!match) return null;
    const day = Number(match[1]), month = Number(match[3]), year = Number(match[4]);
    if (month < 1 || month > 12 || day < 1 || (match[4].length === 4 && year === 0)) return null;
    // A two-digit year stays two digits; no century is inferred.
    const leap = year % 4 === 0 && (match[4].length === 2 || year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1] ? ['date', match[2], day, month, match[4]].join(':') : null;
}

function numericRecords(text: string): NumericRecord[] {
    return [...text.matchAll(/\p{N}+(?:(?:[.,/:]\p{N}+)|(?:[-\u2010-\u2015][−-]?\p{N}+))*/gu)].map(match => {
        let start = match.index, raw = match[0];
        // A minus in a number's own position is evidence too. A code's hyphen
        // (A-5) is left in its existing identifier context.
        if (/[-−]/u.test(text[start - 1] || '') && !/[\p{L}\p{N}_]/u.test(text[start - 2] || '')) {
            start -= 1; raw = text[start] + raw;
        }
        const end = match.index + match[0].length, code = codeContext(text, start, end);
        const date = code ? null : dateIdentity(raw);
        const short = code ? null : /^(\d{1,2})[/.](\d{1,2})$/u.exec(raw);
        const shortDate = !!short && Number(short[1]) >= 1 && Number(short[2]) >= 1 && Number(short[2]) <= 12
            && Number(short[1]) <= [31,29,31,30,31,30,31,31,30,31,30,31][Number(short[2]) - 1];
        const range = code ? null : /^([−-]?\d+)[-\u2010-\u2015]([−-]?\d+)$/u.exec(raw);
        return {raw, start, end, date, shortDate, equivalent: date || (range ? 'range:' + range[1] + ':' + range[2] : null)};
    });
}

/** Compare value representations only; never rewrite a displayed answer or quote. */
export function unverifiedWritingNumbers(text: string, evidence: string): string[] {
    const known = numericRecords(evidence.normalize('NFKC'));
    const exact = new Set(known.map(value => value.raw));
    const equivalent = new Set(known.flatMap(value => value.equivalent ? [value.equivalent] : []));
    return numericRecords(text.normalize('NFKC')).filter(value =>
        !exact.has(value.raw) && !(value.equivalent && equivalent.has(value.equivalent)),
    ).map(value => value.raw);
}

function amountContext(text: string, value: NumericRecord): boolean {
    const before = text.slice(Math.max(0, value.start - 32), value.start), after = text.slice(value.end);
    return /^\s*(?:₪|ש[״"']?ח|שקלים?|%|ILS|NIS|USD|EUR)/iu.test(after)
        || /(?:[₪$€£]\s*|(?:סכום|מחיר|עלות|לתשלום|לשלם)\s+(?:של\s+)?)$/u.test(before);
}

/** Internal money check only. An amount may not borrow a date's masking. */
export function maskKnownWritingDates(text: string, evidence: string): string {
    const normalized = text.normalize('NFKC'), known = numericRecords(evidence.normalize('NFKC'));
    const dates = new Set(known.flatMap(value => value.date ? [value.date] : []));
    const shortDates = new Set(known.filter(value => value.shortDate).map(value => value.raw));
    let result = normalized;
    for (const value of numericRecords(normalized).reverse()) {
        const knownDate = value.date && dates.has(value.date) || value.shortDate && shortDates.has(value.raw);
        if (knownDate && !amountContext(normalized, value)) {
            result = result.slice(0, value.start) + ' [date] ' + result.slice(value.end);
        }
    }
    return result;
}
