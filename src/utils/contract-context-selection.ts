import { anchorSourceRange, type EvidenceAnchor } from './radar-evidence-assessment.ts';

export type ContractContextSelection = {
    reason: string;
    matched_terms: string[];
    source_anchors: EvidenceAnchor[];
    complete: boolean;
    limitations: string[];
    relevance_score?: number;
};

export type ComparisonContextSelection = {
    version: 'source-context-v1';
    complete: boolean;
    limitations: string[];
    sources: Array<{ documentId: string; selection: ContractContextSelection }>;
};

const GENERIC = new Set(['the', 'and', 'for', 'with', 'shall', 'must', 'contract', 'contractor', 'project', 'work', 'works',
    'required', 'הקבלן', 'קבלן', 'המזמין', 'מזמין', 'העבודות', 'עבודות', 'עבודה', 'לבצע', 'יבצע', 'בהתאם',
    'החוזה', 'חוזה', 'הסכם', 'מפרט', 'המפרט', 'פרויקט', 'הפרויקט', 'נדרש', 'חייב', 'בתוך', 'לפי', 'אשר', 'יהיה', 'תהיה',
    'אינו', 'אינה', 'אינם', 'אינן', 'אין', 'לא', 'טרם', 'אלא', 'הדבר', 'הוא', 'היא', 'הינם', 'כמו', 'זאת', 'באם', 'כאשר',
    'מיום', 'לאחר', 'ללא', 'עליו', 'ככל', 'באופן', 'אופן', 'שינוי', 'חריג', 'אירוע', 'דרישה', 'להגיש', 'הגיש', 'להעביר', 'העביר',
    'עביר', 'אישור', 'עבור', 'באמצעות', 'לרבות', 'כולל', 'המחיר', 'מחיר', 'כמות', 'יחידה', 'יחידות',
    'not', 'after', 'before', 'this', 'that', 'from', 'into', 'under', 'according']);

export function meaningfulRetrievalTerms(value: string) {
    const searchable = value.replace(
        /(?<![\u0590-\u05ff])[\u0590-\u05ff](?:[ \u200e\u200f]*\t+[ \u200e\u200f]*[\u0590-\u05ff])+(?![\u0590-\u05ff])/gu,
        sequence => sequence.replace(/[ \t\u200e\u200f]+/g, ''),
    );
    const words = searchable.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').toLowerCase().match(/[a-z\u0590-\u05ff]{3,}/g) || [];
    const expanded = new Set<string>();
    for (const word of words) {
        if (GENERIC.has(word)) continue;
        const variants = [word];
        let stem = word;
        for (let index = 0; index < 2 && stem.length >= 5 && /^[והבלכמש]/u.test(stem); index += 1) {
            stem = stem.slice(1);
            if (stem.length >= 3) variants.push(stem);
        }
        if (variants.some(variant => GENERIC.has(variant))) continue;
        for (const variant of variants) expanded.add(variant);
    }
    return expanded;
}

type Section = { code: string; start: number; end: number };
type ContextDocument = { id: string; extracted_text: string };
const GAP = '\n[… source gap …]\n';
function sectionsIn(source: string): Section[] {
    const headings = [...source.matchAll(/^[\p{Zs}\t\u200e\u200f\u202a-\u202e\u2066-\u2069]*(\d+(?:[ \t]*\.[ \t]*\d+)+)\.?[ \t]+/gmu)]
        .filter(match => !/(?:\.\s*){4,}/u.test(source.slice(match.index, source.indexOf('\n', match.index) < 0 ? source.length : source.indexOf('\n', match.index))));
    return headings.length === 0 ? [{ code: '', start: 0, end: source.length }]
        : headings.map((match, index) => ({ code: match[1].replace(/\s/g, ''), start: match.index,
            end: headings[index + 1]?.index ?? source.length }));
}

function score(text: string, terms: Set<string>, weights: Map<string, number>, phrases: string[]) {
    const found = meaningfulRetrievalTerms(text);
    const lexical = [...terms].filter(term => found.has(term))
        .reduce((sum, term) => sum + (weights.get(term) || 1), 0);
    const searchable = text.replace(/\s+/g, ' ').toLowerCase();
    const phraseMatches = phrases.filter(phrase => searchable.includes(phrase)).length;
    return (lexical + phraseMatches * 12) / Math.sqrt(1 + found.size / 80);
}
function isMeasurement(text: string) {
    return /יחידת\s+(?:ה)?מידה|אופני\s+מדידה|המחיר\s+יכלול|unit of measure|measurement|payment/iu.test(text);
}
function headingText(source: string, section: Section) {
    const end = source.indexOf('\n', section.start);
    return source.slice(section.start, end >= 0 && end < section.end ? end : section.end);
}

export function contractRetrievalWeights(texts: string[], terms: Set<string>) {
    const tokenSets = texts.map(meaningfulRetrievalTerms);
    return new Map([...terms].map(term => [term,
        Math.pow(Math.log(1 + texts.length / (1 + tokenSets.filter(found => found.has(term)).length)), 2),
    ]));
}
function clippedRange(source: string, section: Section, terms: Set<string>, limit: number, weights: Map<string, number>, phrases: string[]) {
    if (section.end - section.start <= limit) return { start: section.start, end: section.end };
    let start = section.start;
    let bestScore = -1;
    const lastStart = Math.max(section.start, section.end - limit);
    const step = Math.max(64, Math.floor(limit / 2));
    for (let cursor = section.start; ; cursor = Math.min(lastStart, cursor + step)) {
        const value = score(source.slice(cursor, cursor + limit), terms, weights, phrases);
        if (value > bestScore) { start = cursor; bestScore = value; }
        if (cursor >= lastStart) break;
    }
    const lineStart = source.lastIndexOf('\n', start);
    if (lineStart >= section.start && start - lineStart < limit / 3) start = lineStart + 1;
    let end = Math.min(section.end, start + limit);
    const wordEnd = source.lastIndexOf(' ', end);
    if (wordEnd > start + limit * 0.8) end = wordEnd;
    return { start, end };
}

export function selectContractContext(document: ContextDocument, query: string, budget: number,
    corpusWeights?: Map<string, number>): ContractContextSelection {
    const source = document.extracted_text;
    const terms = meaningfulRetrievalTerms(query);
    const sections = sectionsIn(source);
    const weights = corpusWeights || contractRetrievalWeights(sections.map(section => source.slice(section.start, section.end)), terms);
    const queryWords = query.replace(/\s+/g, ' ').toLowerCase().match(/[a-z\u0590-\u05ff]+/gu) || [];
    const phrases = queryWords.slice(0, -1).flatMap((word, index) => {
        const next = queryWords[index + 1];
        return meaningfulRetrievalTerms(word).size && meaningfulRetrievalTerms(next).size ? [`${word} ${next}`] : [];
    });
    const ranked = sections.map(section => ({ section, score: score(source.slice(section.start, section.end), terms, weights, phrases)
        + 2 * score(headingText(source, section), terms, weights, phrases) }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.section.start - b.section.start);
    if (ranked.length === 0 || budget <= 0) return { reason: 'no_subject_match', matched_terms: [], source_anchors: [], complete: false, limitations: ['no_subject_match'] };
    const primary = ranked[0].section;
    const primaryText = source.slice(primary.start, primary.end);
    const wanted = [primary];
    const limitations: string[] = [];
    const add = (section: Section | undefined) => {
        if (section && !wanted.includes(section)) wanted.push(section);
    };
    // Follow concrete references within this saved source. External incorporation
    // and contractual precedence remain the responsibility of the reference loader.
    for (const match of primaryText.matchAll(/(?:סעיף|בסעיף|סעיפים|section|clause)\s+(\d+(?:\.\d+)+)/giu)) {
        if (/^\s*(?:שב|ב)?מפרט\s+הכללי/u.test(primaryText.slice(match.index + match[0].length))) {
            limitations.push(`external_reference_requires_authority:${match[1]}`);
            continue;
        }
        const target = sections.filter(section => section.code === match[1])
            .sort((a, b) => Math.abs(a.start - primary.start) - Math.abs(b.start - primary.start))[0];
        if (target) add(target); else limitations.push(`unresolved_local_reference:${match[1]}`);
    }
    const parent = primary.code.slice(0, primary.code.lastIndexOf('.'));
    const position = sections.indexOf(primary);
    const sibling = (section: Section | undefined) => section && primary.code
        && section.code.slice(0, section.code.lastIndexOf('.')) === parent
        && ranked.some(item => item.section === section) ? section : undefined;
    add(sibling(sections[position + 1]));
    const primaryIsMeasurement = isMeasurement(primaryText);
    const complementary = ranked.find(item => item.section !== primary
        && item.section.code.split('.')[0] === primary.code.split('.')[0]
        && isMeasurement(source.slice(item.section.start, item.section.end)) !== primaryIsMeasurement
        && (primaryIsMeasurement || score(headingText(source, item.section), terms, weights, phrases) > 0));
    add(complementary?.section);
    add(sibling(sections[position - 1]));
    // A connected topic can span several clauses (submission, updates, effects),
    // including when the best initial match is the clause about their effects.
    add(sibling(sections[position - 2]));
    add(sibling(sections[position + 2]));
    if (wanted.length > 6) limitations.push('reference_context_limit');
    const included = wanted.slice(0, 6);
    const gapBudget = Math.max(0, included.length - 1) * GAP.length;
    let remaining = Math.max(0, budget - gapBudget);
    const ranges: Array<{ start: number; end: number }> = [];
    for (const [index, section] of included.entries()) {
        const others = included.slice(index + 1);
        const reserve = others.reduce((sum, item) => sum + Math.min(item.end - item.start, Math.floor(remaining / (others.length + 1))), 0);
        const limit = Math.max(0, remaining - reserve);
        if (limit === 0) { limitations.push('context_budget_exhausted'); continue; }
        const range = clippedRange(source, section, terms, limit, weights, phrases);
        if (range.start !== section.start || range.end !== section.end) limitations.push(`clause_truncated:${section.code || 'unstructured'}`);
        if (range.end > range.start) { ranges.push(range); remaining -= range.end - range.start; }
    }
    ranges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
    }
    const primaryTerms = meaningfulRetrievalTerms(primaryText);
    return { reason: 'matched_subject_with_local_context', matched_terms: [...terms].filter(term => primaryTerms.has(term)),
        relevance_score: ranked[0].score,
        source_anchors: merged.map(range => anchorSourceRange(document, range.start, range.end)),
        complete: limitations.length === 0, limitations: [...new Set(limitations)] };
}

export function contractContextText(selection: ContractContextSelection) {
    return selection.source_anchors.map(anchor => anchor.quote).join(GAP);
}
