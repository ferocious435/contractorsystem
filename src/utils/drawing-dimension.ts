import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { anchorSourceRange, findEvidenceAnchor, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import type { PricingScopeContext, PricingScopeSource } from './pricing-scope-review.ts';
import { VISUAL_READING_VERSION, type Rect, type VisualReadingVerification } from './visual-source-reading.ts';

export type DrawingUnit = 'm' | 'cm' | 'mm';
export type DrawingDimension = {
    label: string;
    value: number | null;
    unit: DrawingUnit | null;
    basis: 'DIMENSION' | 'DETAIL' | 'SHEET' | 'DESCRIPTION' | 'CONVENTION' | 'UNKNOWN';
    evidence: EvidenceAnchor[];
    region?: Rect;
    reason?: 'ambiguous_dimension' | 'conflicting_units' | 'unknown_unit';
};
export type VerifiedDrawingCaption = {
    documentId: string; page: number; label: string; printed: string; targetQuote?: string; rect: Rect;
    context: 'SITE_PLAN' | 'CONCRETE_DETAIL' | 'STEEL_DETAIL' | 'WOOD_DETAIL' | 'UNKNOWN';
};

const metricUnits: ReadonlyArray<[DrawingUnit, string]> = [
    ['mm', 'mm|millimet(?:er|re)s?|מ[״"]?מ|מילימטר(?:ים)?'],
    ['cm', 'cm|centimet(?:er|re)s?|ס[״"]?מ|סנטימטר(?:ים)?'],
    ['m', "m|met(?:er|re)s?|מטר(?:ים)?|מ[׳']"],
];
export const METRES_PER_UNIT: Record<DrawingUnit, number> = { mm: 0.001, cm: 0.01, m: 1 };
const unitPattern = '(?:' + metricUnits.map(([, pattern]) => pattern).join('|') + ')';
const titleUnits: ReadonlyArray<[RegExp, DrawingUnit]> = [
    [/^(?:ת[ו]?כנית\s+(?:פיתוח|תנוחה|תוואי|דרכים|תשתיות)|(?:site development|road layout|route|utility layout) plan)(?!\p{L})/iu, 'm'],
    [/^(?:פרט(?:י)?\s+בטון|(?:reinforced )?concrete detail)(?!\p{L})/iu, 'cm'],
    [/^(?:פרט(?:י)?\s+(?:פלדה|מסגרות|עץ|נגרות)|(?:steel|wood|timber|joinery) detail)(?!\p{L})/iu, 'mm'],
];
const detailPattern = /^(?:detail|פרט)\s+([A-Z0-9א-ת]+(?:[-/][A-Z0-9א-ת]+)*)(?=\s*(?:[:—–-]|$))/iu;
const dimensionLabel = /^(?:קו\s+מידה|מידת\s+אורך|dimension(?:\s+line)?|length\s+dimension)(?![\p{L}\d])/iu;
const dimensionPattern = new RegExp(dimensionLabel.source + '(?:\\s+(?:for\\s+|ל)[^:\\n]+?)?\\s*:\\s*', 'iu');
const nonLengthLabel = /^(?:elevation|level|scale|slope|coordinate(?:s)?|tolerance|מפלס|גובה|קנה\s+מידה|קנ["״]מ|שיפוע|קואורדינטות)(?![\p{L}\d])/iu;
const sheetPattern = /^(?:(?:description|specification|notes)\s+for\s+|(?:מפרט|תיאור|הערות)\s+(?:עבור|ל)\s*)?(?:sheet|drawing|גיליון|גליון|שרטוט)\s+(?:מס(?:פר|[׳'])?\s*)?([a-z0-9]+(?:[-./][a-z0-9]+)*)\s*[,;]?\s*(?:rev(?:ision)?\.?|מהדורה|גרסה)\s*[:.]?\s*([a-z0-9]+(?:[-./][a-z0-9]+)*)\s*\.?$/gimu;
const unitDeclarationHead = '^(?:(?:all\\s+)?(?:(?:sheet|drawing|linear)\\s+)?dimensions\\s+(?:are\\s+)?in\\s+|(?:כל\\s+)?ה?מידות\\s+(?:(?:הן|הינן|נתונות|בשרטוט|בתכנית|בתוכנית)\\s+)*ב\\s*)';
const unitDeclaration = new RegExp(unitDeclarationHead, 'iu');
const neutralException = '(?:unless (?:otherwise (?:specified|noted|indicated)|(?:specified|noted|indicated) otherwise)|אלא אם (?:צוין|מצוין|נרשם) אחרת)';
const unitNotes = new RegExp(unitDeclarationHead + '(' + unitPattern + ')'
    + '(?:\\s+(?:for detail|לפרט)\\s+([a-z\\dא-ת]+(?:[-/][a-z\\dא-ת]+)*))?'
    + '(?:\\s*,?\\s+(?:' + neutralException + '|\\(' + neutralException + '\\)))?\\s*\\.?$', 'iu');
const numericCaption = new RegExp('^(\\d+(?:[.,]\\d+)?)(?:[ \\t]*(' + unitPattern + '))?$','iu');
const withdrawnDescription = /^(?:(?:status\s*:\s*)?(?:superseded|withdrawn|cancelled|canceled)(?=\s|[.:]|$)|do not use this (?:description|specification|document|drawing|sheet)\s+for\s+(?:execution|construction)\b|(?:מסמך זה|מפרט זה|שרטוט זה|גיליון זה)\s+(?:בוטל|הוחלף|אינו בתוקף|לא לביצוע)|מבוטל|לא לביצוע(?=\s|[.:]|$))/iu;

export function drawingUnit(value: string): DrawingUnit | null {
    const normalized = value.trim().replace(/[“”]/gu, '"');
    if (/^(?:מ["״']?א|מטר(?:ים)?\s+ר[ץצ](?:ים)?|linear\s+met(?:er|re)s?)$/iu.test(normalized)) return 'm';
    return metricUnits.find(([, pattern]) => new RegExp('^(?:' + pattern + ')$', 'iu').test(normalized))?.[0] ?? null;
}

export function isDrawingLabel(value: string) {
    const line = value.trimStart();
    return dimensionLabel.test(line) || nonLengthLabel.test(line) || detailPattern.test(line)
        || /^\s*[+−-]\s*\d/u.test(line);
}

type SourceLine = { text: string; start: number; end: number; page: number | null; detail?: string };

function sourceLines(source: PricingScopeSource): SourceLine[] {
    const body = source.extracted_text || '';
    // Visual assemblies delimit each page at its start. The native PDF
    // extraction format puts a page marker at its end.
    const registry = (source.parsed_json as { source_reading?: VisualReadingVerification } | null)?.source_reading;
    const visualPages = registry?.version === VISUAL_READING_VERSION && registry.format === 'PDF' && readable(source)
        ? new Set(registry.expectedUnits.filter(unit => unit.status === 'READ').flatMap(unit => unit.locations.map(location => location.page))) : null;
    const endings = [...body.matchAll(/^--[ \t]*(\d+)[ \t]+of[ \t]+(\d+)[ \t]*--[ \t]*\r?$/gmu)];
    const markers = [...body.matchAll(/^\[PAGE[ \t]+(\d+)\][ \t]*\r?$/gmu)];
    if (visualPages && (markers.length !== visualPages.size
        || markers.some((marker, index) => Number(marker[1]) !== index + 1 || !visualPages.has(index + 1)))) return [];
    const nativePages = (registry as { totalPages?: number } | undefined)?.totalPages;
    if (!visualPages && typeof nativePages === 'number' && nativePages > 1 && (endings.length !== nativePages
        || endings.some((marker, index) => Number(marker[1]) !== index + 1 || Number(marker[2]) !== nativePages))) return [];
    let page: number | null = null;
    let nextEnding = 0;
    let detail: string | undefined;
    return [...body.matchAll(/^[^\n]+/gmu)].flatMap(match => {
        const line = match[0].trim();
        const start = match.index + match[0].indexOf(line);
        const nextPage = line.match(/^\[PAGE[ \t]+(\d+)\]$/u);
        if (nextPage) {
            detail = undefined;
            page = visualPages?.has(Number(nextPage[1])) ? Number(nextPage[1]) : null;
            return [];
        }
        if (endings[nextEnding]?.index === start) {
            nextEnding += 1;
            detail = undefined;
            return [];
        }
        if (!line) return [];
        const heading = line.match(detailPattern);
        const remainder = heading ? line.slice(heading[0].length).replace(/^[\s:—–-]+/u, '') : line;
        if (heading && !remainder) detail = heading[1].toUpperCase();
        if (!heading && !dimensionPattern.test(remainder) && !unitDeclaration.test(remainder)) detail = undefined;
        const end = start + line.length;
        return [{ text: line, start, end, page: page ?? (endings[nextEnding] ? anchorSourceRange(source, start, end).page : null),
            detail: heading?.[1].toUpperCase() || detail }];
    });
}

function sheetKeys(lines: SourceLine[]) {
    return [...new Set(lines.flatMap(line => [...line.text.matchAll(sheetPattern)]
        .map(match => (match[1] + '/' + match[2]).toUpperCase())))];
}

export function applicableDrawingDescription(source: PricingScopeSource, description: PricingScopeSource): boolean {
    if (!source.extracted_text || !description.extracted_text || source.id === description.id || !readable(source) || !readable(description)) return false;
    if (!description.extracted_text.match(sheetPattern)) return false;
    const drawing = sheetKeys(sourceLines(source));
    const lines = sourceLines(description);
    const related = sheetKeys(lines);
    return related.length === 1 && drawing.includes(related[0]) && !lines.some(line => withdrawnDescription.test(line.text))
        && declarations(lines).length > 0;
}

function anchor(source: PricingScopeSource, line: SourceLine): EvidenceAnchor {
    const evidence = anchorSourceRange(source, line.start, line.end);
    return { ...evidence, page: evidence.page ?? line.page };
}

function readable(source: PricingScopeSource) {
    return source.allowed && source.role !== 'PRICE' && assessDocumentSourceReadiness(source).canCompare;
}

function rangesForQuote(source: PricingScopeSource, quote: string, range?: { start: number; end: number }) {
    const matches: EvidenceAnchor[] = [];
    const end = range?.end ?? source.extracted_text?.length ?? 0;
    let start = range?.start ?? 0;
    while (start < end) {
        const found = findEvidenceAnchor(source, quote, { start, end });
        if (!found) break;
        matches.push(found);
        start = found.start + 1;
    }
    return matches;
}

function focusedWork(context: PricingScopeContext, source: PricingScopeSource, lines: SourceLine[]) {
    if (!context.workQuote) return [];
    const pageLines = context.workPage ? lines.filter(line => line.page === context.workPage) : lines;
    if (!pageLines.length) return [];
    return rangesForQuote(source, context.workQuote, { start: pageLines[0].start, end: pageLines.at(-1)!.end });
}

export function selectedWorkAnchor(context: PricingScopeContext, source: PricingScopeSource) {
    if (!readable(source) || !context.workSourceIds.includes(source.id)) return null;
    const work = focusedWork(context, source, sourceLines(source));
    return work.length === 1 ? work[0] : null;
}

export function selectedDrawingWork(context: PricingScopeContext, dimension: DrawingDimension) {
    const source = context.sources.find(item => item.id === dimension.evidence[0]?.documentId);
    if (!source) return null;
    const chosen = selectedWorkAnchor(context, source);
    if (!chosen) return null;
    const size = dimension.evidence[0];
    if (!dimension.region) {
        if (size.start <= chosen.start || size.end !== chosen.end) return null;
        const work = chosen.quote.slice(0, size.start - chosen.start).trim();
        if (!work || /[\r\n;,]/u.test(work) || new RegExp(dimensionLabel.source + '\\s*:', 'iu').test(size.quote) === false) return null;
        return findEvidenceAnchor(source, work, chosen);
    }
    const target = context.verifiedDrawingCaptions?.find(caption => caption.documentId === source.id
        && caption.page === dimension.evidence[0].page && caption.label === dimension.label && caption.rect === dimension.region);
    return target?.targetQuote ? findEvidenceAnchor(source, target.targetQuote, chosen) : null;
}

function matchingDimensions(context: PricingScopeContext) {
    return context.sources.filter(source => context.workSourceIds.includes(source.id) && readable(source)).flatMap(source => {
        const lines = sourceLines(source);
        const selections = focusedWork(context, source, lines);
        const textual = lines.flatMap(line => {
            const selected = selections.find(selection => line.start < selection.end && line.end > selection.start);
            if (!selected || context.workPage != null && line.page !== context.workPage) return [];
            const detail = line.text.match(detailPattern);
            const caption = detail ? line.text.slice(detail[0].length).replace(/^[\s:—–-]+/u, '') : line.text;
            const marker = caption.match(dimensionPattern);
            const parsed = marker && caption.slice(marker[0].length).match(numericCaption);
            if (!parsed || !findEvidenceAnchor(source, parsed[1], { start: Math.max(selected.start, line.start), end: Math.min(selected.end, line.end) })) return [];
            const value = Number(parsed[1].replace(',', '.'));
            if (!Number.isFinite(value) || value <= 0) return [];
            return [{ source, line, lines, detail: line.detail, label: parsed[1], value,
                unit: parsed[2] ? drawingUnit(parsed[2]) : null, visualContext: null, rect: null }];
        });
        const visual = (context.verifiedDrawingCaptions || []).filter(caption => caption.documentId === source.id
            && (context.workPage === undefined || caption.page === context.workPage)).flatMap(caption => {
            const page = lines.filter(line => line.page === caption.page);
            if (!page.length) return [];
            const range = { start: page[0].start, end: page.at(-1)!.end };
            if (caption.targetQuote) {
                const targets = rangesForQuote(source, caption.targetQuote, range);
                const [target] = targets;
                if (targets.length !== 1 || !page.some(line => target.start === line.start && target.end === line.end)
                    || !selections.some(selection => target.start >= selection.start && target.end <= selection.end)) return [];
            }
            const locations = rangesForQuote(source, caption.printed, range).filter(location => {
                const before = source.extracted_text?.[location.start - 1] || '';
                const after = source.extracted_text?.[location.end] || '';
                return !/[\p{L}\p{N}.,+/−-]/u.test(before) && !/[\p{L}\p{N}.,/²³]/u.test(after);
            });
            const parsed = caption.printed.match(numericCaption);
            if (!parsed || parsed[1] !== caption.label || !locations.length) return [];
            if (!caption.targetQuote && !locations.some(location => selections.some(selection =>
                selection.start <= location.start && selection.end >= location.end))) return [];
            const value = Number(parsed[1].replace(',', '.'));
            if (!Number.isFinite(value) || value <= 0) return [];
            return locations.filter(location => !textual.some(entry => entry.line.start <= location.start && entry.line.end >= location.end))
                .map(location => ({ source, line: { ...location, page: caption.page, text: location.quote }, lines,
                    detail: page.find(item => item.start <= location.start && item.end >= location.end)?.detail,
                    label: caption.label, value, unit: parsed[2] ? drawingUnit(parsed[2]) : null, visualContext: caption.context, rect: caption.rect }));
        });
        return [...textual, ...visual].filter((match, index, all) =>
            all.findIndex(item => item.line.start === match.line.start && item.line.end === match.line.end) === index);
    });
}

function declarations(lines: SourceLine[]) {
    const result: Array<{ unit: DrawingUnit | null; line: SourceLine; detail: string | null }> = [];
    for (const line of lines) {
        const heading = line.text.match(detailPattern);
        const rest = heading ? line.text.slice(heading[0].length).replace(/^[\s:—–-]+/u, '') : line.text;
        if (!unitDeclaration.test(rest)) continue;
        const match = rest.match(unitNotes);
        const unit = match ? drawingUnit(match[1]) : null;
        const detail = match?.[2]?.toUpperCase() ?? line.detail ?? null;
        result.push({ unit, line, detail });
    }
    return result;
}

/** Resolves one located linear caption, retaining original source anchors for every decision. */
export function resolveDrawingDimension(context: PricingScopeContext): DrawingDimension | null {
    const matches = matchingDimensions(context);
    if (!matches.length) return null;
    const { source, line, lines, detail, label, value, unit, visualContext, rect } = matches[0];
    const size = anchor(source, line);
    const region = rect ? { region: rect } : {};
    if (matches.length > 1) return { label, value: null, unit: null, basis: 'UNKNOWN',
        reason: 'ambiguous_dimension', evidence: matches.map(match => anchor(match.source, match.line)) };
    if (unit) return { label, value, unit, basis: 'DIMENSION', evidence: [size], ...region };

    const page = lines.filter(item => item.page === line.page);
    const identity = sheetKeys(page);
    const local = declarations(page);
    const descriptions = identity.length === 1 ? context.sources.filter(item => readable(item) && item.id !== source.id)
        .flatMap(item => {
            const body = sourceLines(item);
            const revisions = sheetKeys(body);
            if (revisions.length !== 1 || revisions[0] !== identity[0] || body.some(line => withdrawnDescription.test(line.text))) return [];
            return declarations(body).map(note => ({ ...note, source: item }));
        }) : [];
    const allNotes = [...local.map(note => ({ ...note, source })), ...descriptions];
    const unlocatedDetail = !detail && visualContext && !['SITE_PLAN', 'UNKNOWN'].includes(visualContext)
        && allNotes.some(note => note.detail);
    if (unlocatedDetail) return { label, value, unit: null, basis: 'UNKNOWN', reason: 'unknown_unit', evidence: [size], ...region };
    const notes = allNotes.filter(note => !note.detail || note.detail === detail);
    const applicable = notes.some(note => note.detail) ? notes.filter(note => note.detail) : notes;
    if (applicable.length) {
        const declared = applicable[0];
        const evidence = [size, ...applicable.map(note => anchor(note.source, note.line))];
        if (applicable.some(note => !note.unit)) return { label, value, unit: null, basis: 'UNKNOWN', reason: 'unknown_unit', evidence, ...region };
        if (applicable.some(note => note.unit !== declared.unit)) {
            return { label, value, unit: null, basis: 'UNKNOWN', reason: 'conflicting_units', evidence, ...region };
        }
        return { label, value, unit: declared.unit, evidence, ...region,
            basis: declared.source.id !== source.id ? 'DESCRIPTION' : declared.detail ? 'DETAIL' : 'SHEET' };
    }

    const visualUnit = visualContext === 'SITE_PLAN' ? 'm' : visualContext === 'CONCRETE_DETAIL' ? 'cm'
        : visualContext === 'STEEL_DETAIL' || visualContext === 'WOOD_DETAIL' ? 'mm' : null;
    const hints = page.flatMap(item => titleUnits.filter(([pattern, suggestedUnit]) => pattern.test(item.text) && (!visualUnit || suggestedUnit === visualUnit))
        .map(([, suggestedUnit]) => ({ unit: suggestedUnit, line: item })));
    if (hints.length && hints.every(hint => hint.unit === hints[0].unit)) {
        return { label, value, unit: hints[0].unit, basis: 'CONVENTION', evidence: [size, anchor(source, hints[0].line)], ...region };
    }
    if (visualUnit) return { label, value, unit: visualUnit, basis: 'CONVENTION', evidence: [size], ...region };
    return { label, value, unit: null, basis: 'UNKNOWN', reason: 'unknown_unit', evidence: [size], ...region };
}
