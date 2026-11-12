import {anchorSourceRange, type EvidenceAnchor} from './radar-evidence-assessment';
import {meaningfulRetrievalTerms} from './contract-context-selection';
import {writingRetrievalQuery} from './writing-context-query';

export type WritingTopicDocument = {id: string; title: string | null; text: string; textHash: string};
export type WritingTopicSelection = {sources: Array<{documentId: string; anchor: EvidenceAnchor}>; warnings: Array<{documentId: string; reason: string}>};
type Range = {start: number; end: number};
type DatedRange = Range & {raw: string; key: string; family: number};
type Block = Range & {document: WritingTopicDocument; score: number};
type Query = Array<{aliases: Set<string>; weight: number}>;
const LIMIT = 2400;
const GENERIC = meaningfulRetrievalTerms('הסבר מתועד בנושא נושא מצב איך התקדמו התקדמות הנחיות הנחיה הוכח בוצע הבדל טענת מקורות הפניות פניות בסיס סגור הושלם אפשר להמשיך הקשר זמן מפעל חברה חברת מסמך מסמכים פרט עדכון ביצוע עדיין בין לבין לראות האם ותן ליד status explain history latest current company factory document documents topic progress closed');
function terms(text: string): Set<string> {
    const result = meaningfulRetrievalTerms(writingRetrievalQuery(text));
    // Hebrew construct nouns: מדידת / מדידה. These are retrieval hints only.
    for (const term of result) if (/^[א-ת]{2,}דת$/u.test(term)) result.add(term.slice(0, -1) + 'ה');
    return result;
}
function queryGroups(text: string): Set<string>[] {
    let groups: Set<string>[] = [];
    const words = text.normalize('NFKC').toLowerCase().match(/[a-z\u0590-\u05ff]+(?:["'][a-z\u0590-\u05ff]+)*/gu) || [];
    for (const word of words) {
        const aliases = terms(word);
        if (!aliases.size || [...aliases].some(term => GENERIC.has(term))) continue;
        const shared = groups.filter(group => [...aliases].some(term => group.has(term)));
        for (const group of shared) for (const term of group) aliases.add(term);
        groups = [...groups.filter(group => !shared.includes(group)), aliases];
    }
    return groups;
}
function relevance(text: string, query: Query): number {
    const found = terms(text), matched = query.filter(group => [...group.aliases].some(term => found.has(term)));
    if (matched.length < Math.min(2, query.length)) return 0;
    // Alternative spellings/stems are one concept, not multiple independent votes.
    return matched.reduce((sum, group) => sum + group.weight, 0) / Math.sqrt(1 + text.length / 400);
}
function dateParts(raw: string): {key: string; family: number} | null {
    const match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/u.exec(raw);
    if (!match) return null;
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    const leap = year % 4 === 0 && (match[3].length === 2 || year % 100 !== 0 || year % 400 === 0);
    if (month < 1 || month > 12 || day < 1 || match[3].length === 4 && year === 0 || day > [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month - 1]) return null;
    return {key: [match[3], String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-'), family: match[3].length};
}
function headerDate(text: string): DatedRange | null {
    const header = text.slice(0, 1800), lines = [...header.matchAll(/[^\n]+/gu)];
    for (const line of lines) {
        const clean = line[0].replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
        const alone = /^\d{1,2}[/.]\d{1,2}[/.](?:\d{2}|\d{4})$/u.test(clean);
        const labelled = /^(?:תאריך(?:\s+(?:הדיון|הישיבה))?|מועד\s+הישיבה|מיום|date|dated)\s*[:\t ]/iu.test(clean);
        if (!alone && !labelled) continue;
        const match = line[0].match(/\d{1,2}[/.]\d{1,2}[/.](?:\d{4}|\d{2})(?!\d)/u);
        if (!match) continue;
        const parts = dateParts(match[0]);
        if (parts) return {start: line.index, end: line.index + line[0].length, raw: match[0], ...parts};
    }
    return null;
}
function blocks(document: WritingTopicDocument): Range[] {
    const lines = [...document.text.matchAll(/[^\n]+/gu)], starts = new Set([0]);
    for (const [index, line] of lines.entries()) {
        const clean = line[0].replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
        // A complete calendar date is never a contract section number here.
        if (/^\d{1,2}[/.]\d{1,2}[/.](?:\d{2}|\d{4})(?:\s|$)/u.test(clean)) continue;
        const heading = /^#{1,6}\s+\S/u.test(clean) || clean.length <= 100 && !/^[•*-]/u.test(clean) && /[\p{L}][\s]*:$/u.test(clean)
            || /^\d{1,3}(?:\.\d{1,3})*[.)]?\s+\p{L}/u.test(clean) && clean.length <= 140;
        if (!heading) continue;
        const prior = lines[index - 1];
        starts.add(prior && /^\s*\d{1,3}\s*[.)]\s*$/u.test(prior[0]) ? prior.index : line.index);
    }
    const sorted = [...starts].sort((a,b) => a - b);
    return sorted.map((start, index) => ({start, end: sorted[index + 1] ?? document.text.length}));
}
function boundedBlock(block: Block, query: Query): Range[] {
    if (block.end - block.start <= LIMIT) return [block];
    const text = block.document.text.slice(block.start, block.end);
    // Keep complete lines/sentences, never a fabricated stitched quotation.
    const pieces = [...text.matchAll(/[^\n.!?]+(?:[.!?](?=\s|$)|(?=\n|$))/gu)]
        .map(match => ({start: block.start + match.index, end: block.start + match.index + match[0].length}))
        .filter(range => range.end - range.start <= LIMIT)
        .map(range => ({...range, score: relevance(block.document.text.slice(range.start, range.end), query)}))
        .filter(range => range.score > 0).sort((a,b) => b.score - a.score || a.start - b.start);
    const best = pieces[0];
    if (!best) return [];
    let end = best.end;
    for (const next of pieces.filter(piece => piece.start >= best.end).sort((a,b) => a.start - b.start)) {
        if (next.end - best.start > LIMIT) break;
        end = next.end;
    }
    const firstEnd = block.document.text.indexOf('\n', block.start);
    const heading = firstEnd > block.start && firstEnd - block.start <= 100 && best.start > firstEnd
        && query.some(group => [...terms(block.document.text.slice(block.start, firstEnd))].some(term => group.aliases.has(term)));
    return [...(heading ? [{start: block.start, end: firstEnd}] : []), {start: best.start, end}];
}

/** Deterministic topic/history retrieval. Dates order evidence; they confer no authority. */
export function selectWritingTopicContext(documents: readonly WritingTopicDocument[], question: string, previousQuestion = ''): WritingTopicSelection {
    const result: WritingTopicSelection = {sources: [], warnings: []}, seen = new Set<string>(), warned = new Set<string>();
    const corpusTerms = documents.map(document => terms(document.text));
    const warn = (documentId: string, reason: string) => {
        const key = JSON.stringify([documentId, reason]);
        if (!warned.has(key)) {result.warnings.push({documentId, reason}); warned.add(key);}
    };
    for (const queryText of [question, ...(previousQuestion.trim() ? [previousQuestion] : [])]) {
        const query: Query = queryGroups(queryText).map(aliases => ({aliases, weight: 1 + Math.log(1 + documents.length /
            (1 + corpusTerms.filter(found => [...aliases].some(term => found.has(term))).length))}));
        if (!query.length) continue;
        const groups = documents.flatMap(document => {
            const ranked = blocks(document).map(range => ({...range, document, score: relevance(document.text.slice(range.start, range.end), query)}))
                .filter(block => block.score > 0).sort((a,b) => b.score - a.score || a.start - b.start);
            if (!ranked.length) return [];
            const date = headerDate(document.text);
            const filenameDates = [...(document.title || '').matchAll(/\d{1,2}[/.]\d{1,2}[/.](?:\d{4}|\d{2})(?!\d)/gu)]
                .map(match => ({raw: match[0], ...dateParts(match[0])})).filter(value => value.key);
            // Different day/month/year suffixes conflict even when the century is unspecified.
            const conflict = date && filenameDates.find(value => value.family === date.family ? value.key !== date.key : value.key!.slice(-8) !== date.key.slice(-8));
            const uncertain = !date || !!conflict;
            if (!date) warn(document.id, 'לא נמצא תאריך מפורש בכותרת התוכן; שם הקובץ וזמן ההעלאה אינם קובעים את סדר ההנחיות.');
            if (conflict) warn(document.id, `התאריך בשם הקובץ ${conflict.raw} אינו תואם לתאריך בכותרת ${date!.raw}; מועד המקור דורש בדיקה ואין להסיק שהוא ההנחיה האחרונה.`);
            const ranges = ranked.slice(0, 2).flatMap(block => {
                if (block.end - block.start > LIMIT) warn(document.id, 'הקטע הקשור ארוך מההקשר הזמין; נבחר רק חלק ואין בכך בדיקה מלאה של ההנחיה.');
                return boundedBlock(block, query);
            });
            return ranges.length ? [{document, date, uncertain, ranges, score: ranked[0].score}] : [];
        }).sort((a,b) => b.score - a.score || a.document.id.localeCompare(b.document.id));
        // Cover both ends of each explicit year format. A short year is not
        // silently expanded into a guessed century, nor is a filename a date.
        const endpoints: typeof groups = [];
        for (const family of [2, 4]) {
            const dated = groups.filter(group => group.date?.family === family && !group.uncertain)
                .sort((a,b) => a.date!.key.localeCompare(b.date!.key) || b.score - a.score || a.document.id.localeCompare(b.document.id));
            if (dated.length) endpoints.push(dated[dated.length - 1], dated[0]);
        }
        const ordered = [...new Set([...endpoints, ...groups])];
        for (const group of ordered) {
            const ranges = [...group.ranges, ...(group.date ? [group.date] : [])];
            for (const range of ranges) {
                const key = JSON.stringify([group.document.id, range.start, range.end]);
                if (seen.has(key) || !group.document.text.slice(range.start, range.end).trim()) continue;
                seen.add(key);
                result.sources.push({documentId: group.document.id, anchor: anchorSourceRange({id: group.document.id, extracted_text: group.document.text}, range.start, range.end)});
            }
        }
    }
    return result;
}
