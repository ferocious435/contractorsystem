export function explainLetterResponseClock(quote: string) {
    const text = quote.replace(/[\u200e\u200f]/gu, '').replace(/\s+/gu, ' ');
    if (/ממועד קבלת (?:המכתב|מכתב זה)|מיום קבלת (?:המכתב|מכתב זה)/u.test(text)) {
        return 'התקופה מתחילה במועד קבלת המכתב.';
    }
    if (/ממועד (?:המכתב|מכתב זה)|מיום (?:המכתב|מכתב זה)/u.test(text)) {
        return 'התקופה מתחילה במועד המכתב.';
    }
    return 'נקודת תחילת התקופה אינה מפורשת במובאה.';
}
