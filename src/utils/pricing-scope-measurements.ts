import type { PricingScopeContext, PricingScopeNumber } from './pricing-scope-review.ts';
import { findEvidenceAnchor } from './radar-evidence-assessment.ts';
import { assessDocumentSourceReadiness } from './document-source-readiness.ts';

const UNKNOWN = (): PricingScopeNumber => ({ value: null, basis: 'UNKNOWN', evidence: [] });
const UNITS: Array<[RegExp, string]> = [
    [/^(?:מ["״]?ק|m[³3]|cubic\s*met(?:er|re)s?)$/iu, '(?:מ["״]?ק|m[³3]|cubic\\s*met(?:er|re)s?)'],
    [/^(?:מ["״]?ר|m[²2]|sqm|square\s*met(?:er|re)s?)$/iu, '(?:מ["״]?ר|m[²2]|sqm|square\\s*met(?:er|re)s?)'],
    [/^(?:מטר(?:ים)?|m|met(?:er|re)s?)$/iu, '(?:מטר(?:ים)?|m|met(?:er|re)s?)'],
    [/^(?:יח[.׳']?|יחידה|יחידות|pcs?|each|units?|pieces?)$/iu, 'PIECE'],
    [/^(?:ק["״]?ג|kg|kilograms?)$/iu, '(?:ק["״]?ג|kg|kilograms?)'],
    [/^(?:טון|tons?|tonnes?)$/iu, '(?:טון|tons?|tonnes?)'],
    [/^(?:שעה|שעות|hours?|hr)$/iu, '(?:שעה|שעות|hours?|hr)'],
];

/** Parse only an unambiguous printed measurement; a band or a missing value stays unknown. */
export function explicitPricingQuantity(context: PricingScopeContext, unit: string | null | undefined): PricingScopeNumber {
    const pattern = UNITS.find(([test]) => test.test(String(unit || '').trim()))?.[1];
    if (!pattern) return UNKNOWN();
    const found: Array<{ value: number; evidence: PricingScopeNumber['evidence'] }> = [];
    for (const source of context.sources.filter(item => context.workSourceIds.includes(item.id))) {
        if (!source.allowed || !assessDocumentSourceReadiness(source).canCompare) continue;
        const focused = context.workQuote ? findEvidenceAnchor(source, context.workQuote) : findEvidenceAnchor(source, source.extracted_text || '');
        if (!focused) continue;
        const body = focused.quote;
        const matches = pattern === 'PIECE'
            ? [...body.matchAll(/(?<![\p{L}\d.\-/])\d+(?:[.,]\d+)?(?![\p{L}\d.\-/])/gu)]
                .filter(match => /יחידת\s+מדידה\s*:?\s*יחידה|יחידה|יחידות|\b(?:units?|pieces?|each)\b/iu.test(body)
                    && !/^\s*(?:%|אחוז|ש["״]?ח|₪|NIS)/iu.test(body.slice(match.index + match[0].length)))
            : [...body.matchAll(new RegExp(`(?<![\\p{L}\\d.\\-/])(\\d+(?:[.,]\\d+)?)\\s*${pattern}(?![\\p{L}\\d])`, 'giu'))];
        for (const match of matches) {
            const before = body.slice(Math.max(0, match.index - 22), match.index);
            if (pattern === 'PIECE' && /(?:מספר|מס[.׳']|סעיף|טופס|גרסה|שנת|\b(?:number|no\.?|section|form|version|year))\s*[:#־-]?\s*$/iu.test(before)) continue;
            if (/(?:עד|לכל היותר|בערך|כ[־-]|up to|at most|about|max(?:imum)?)\s*$/iu.test(before)) continue;
            const value = Number((match[1] || match[0]).replace(',', '.'));
            if (Number.isFinite(value) && value > 0) found.push({ value, evidence: [focused] });
        }
    }
    if (found.length !== 1) return UNKNOWN();
    return { value: found[0].value, basis: 'SOURCE', evidence: found[0].evidence };
}
