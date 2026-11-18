import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { anchorSourceRange, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { parsePrintedBoqRows } from './printed-boq-rows.ts';
import { readConsultantBoqRevision, selectConsultantBoqRows, type ConsultantBoqDocument, type ConsultantBoqRow } from './consultant-boq.ts';

export type BoqEditionChange = 'PRICE' | 'UNIT' | 'SCOPE';
export type BoqReplacement = { from: ConsultantBoqRow; to: ConsultantBoqRow; evidence: EvidenceAnchor };
export type BoqEditionComparison = {
    status: 'REPLACED' | 'UNKNOWN' | 'CONFLICT'; originalRow: ConsultantBoqRow; currentRow: ConsultantBoqRow;
    chain: BoqReplacement[]; changes: BoqEditionChange[]; description: string; reason: string | null; warnings: string[];
};
const sameText = (value: string) => normalizeEvidenceSource(value).replace(/\s+/gu, ' ').trim();
const section = (code: string) => code.split('.').slice(0, -1).join('.');
const identity = (row: ConsultantBoqRow) => row.revision.identifier;
const sameIdentity = (a: ConsultantBoqRow, b: ConsultantBoqRow) => {
    const x = identity(a), y = identity(b);
    return !!x && !!y && x.boq === y.boq && x.edition === y.edition;
};

/** Affirmative complete statements only. A date, generic designation, title or item code
 * never establishes replacement. Unknown phrasing is intentionally left unresolved. */
function replacementEvidence(document: ConsultantBoqDocument, from: ConsultantBoqRow, to: ConsultantBoqRow) {
    const a = identity(from), b = identity(to);
    if (!a || !b) return null;
    for (const line of String(document.extracted_text || '').matchAll(/[^\r\n]+/gu)) {
        const statement = line[0].trim().match(/^כתב כמויות ([\p{L}\d_-]+) מהדורה ([\p{L}\d_-]+) מחליף את כתב כמויות ([\p{L}\d_-]+) מהדורה ([\p{L}\d_-]+)[.]?$/u);
        if (statement && statement[1] === b.boq && statement[2] === b.edition
            && statement[3] === a.boq && statement[4] === a.edition) {
            return anchorSourceRange(document, line.index, line.index + line[0].length);
        }
    }
    return null;
}

/** Pure comparison. sourceHash identifies file bytes; a later OCR textHash is not a revision. */
export function compareBoqEdition(savedRow: ConsultantBoqRow, documents: ConsultantBoqDocument[]): BoqEditionComparison {
    const out: BoqEditionComparison = { status: 'UNKNOWN', originalRow: savedRow, currentRow: savedRow,
        chain: [], changes: [], description: '', reason: 'לא נמצא מסמך שמוכיח החלפת מהדורה מסוימת.', warnings: [] };
    const original = documents.find(document => document.id === savedRow.documentId);
    if (!original || !original.project_id || original.deleted_at || !assessDocumentSourceReadiness(original).canCompare
        || !savedRow.sourceHash || original.content_hash !== savedRow.sourceHash
        || original.extracted_text_hash !== savedRow.textHash
        || String(original.extracted_text || '').slice(savedRow.start, savedRow.end) !== savedRow.quote) {
        out.reason = 'מקור השורה השמורה אינו זמין לאימות או השתנה מאז הקריאה.';
        return out;
    }
    // Re-extract identities and rows from currently readable sources, rather than trusting
    // an unverified identifier supplied on a stored object.
    const eligible = documents.filter(document => document.project_id === original.project_id
        && !document.deleted_at && assessDocumentSourceReadiness(document).canCompare
        && !/הצעת\s*מחיר|הצעת\s*הקבלן|contractor\s+(?:offer|proposal)/iu.test(
            `${document.title || ''} ${String(document.extracted_text || '').slice(0, 2500)}`));
    const baseline = selectConsultantBoqRows([original], savedRow.scope, []).find(row => row.start === savedRow.start
        && row.end === savedRow.end && row.itemCode === savedRow.itemCode && row.unit === savedRow.unit
        && row.unitPrice === savedRow.unitPrice && row.total === savedRow.total && row.scope === savedRow.scope);
    if (!baseline || baseline.ambiguousItemCode || !identity(baseline)) {
        out.reason = 'לא זוהה באופן חד משמעי כתב הכמויות ומהדורת המקור.';
        return out;
    }
    const candidates = eligible.flatMap(document => {
        if (!document.content_hash) return [];
        // Reuse the shared parser and source authority checks; query each candidate's own
        // scope so a changed material/unit remains visible as a change, not a hidden price.
        const row = parsePrintedBoqRows(String(document.extracted_text || '')).find(row => row.itemCode === savedRow.itemCode);
        return row ? selectConsultantBoqRows([document], row.scope, []).filter(candidate => candidate.itemCode === savedRow.itemCode
            && section(candidate.itemCode) === section(savedRow.itemCode) && !candidate.ambiguousItemCode) : [];
    });
    let current = baseline;
    const visited = new Set([current.sourceHash]);
    for (;;) {
        const successors: BoqReplacement[] = [];
        for (const candidate of candidates) {
            if (!identity(candidate) || sameIdentity(current, candidate) || candidate.sourceHash === current.sourceHash) continue;
            const source = eligible.find(document => document.id === candidate.documentId)!;
            const evidence = eligible.filter(document => document.id === source.id
                || (!readConsultantBoqRevision(document) && document.id !== current.documentId
                    && !/^(?:מספר כתב כמויות:|כתב כמויות\s*(?:לביצוע|חוזי)?\s*$)/mu.test(String(document.extracted_text || ''))))
                .map(document => replacementEvidence(document, current, candidate)).find(Boolean);
            if (evidence && !successors.some(hop => hop.to.sourceHash === candidate.sourceHash)) {
                successors.push({ from: current, to: candidate, evidence });
            }
        }
        if (!successors.length) break;
        if (successors.length > 1 || visited.has(successors[0].to.sourceHash)) {
            out.status = 'CONFLICT'; out.reason = 'נמצאו מהדורות מתחרות או שרשרת החלפה מעגלית; אין מהדורה אחרונה חד משמעית.';
            break;
        }
        const hop = successors[0];
        out.chain.push(hop); current = hop.to; out.currentRow = current; visited.add(current.sourceHash);
        out.status = 'REPLACED'; out.reason = null;
    }
    if (out.chain.length) {
        if (savedRow.unitPrice !== current.unitPrice) out.changes.push('PRICE');
        if (savedRow.unit !== current.unit) out.changes.push('UNIT');
        if (sameText(savedRow.scope) !== sameText(current.scope)) out.changes.push('SCOPE');
        out.description = [savedRow.unitPrice !== current.unitPrice ? `מחיר: ${savedRow.unitPrice} ← ${current.unitPrice}` : 'המחיר לא השתנה',
            savedRow.unit !== current.unit ? `יחידה: ${savedRow.unit} ← ${current.unit}` : '',
            sameText(savedRow.scope) !== sameText(current.scope) ? `תכולה: ${savedRow.scope} ← ${current.scope}` : ''].filter(Boolean).join('; ');
    }
    for (const row of [savedRow, ...out.chain.map(hop => hop.to)]) {
        if (row.revision.conflictingDateEvidence?.length) out.warnings.push(`${row.title}: תאריכים סותרים במסמך; מועד המהדורה לא הוכרע.`);
        if (!row.revision.date) out.warnings.push(`${row.title}: תאריך לא צוין; תאריך הדפסה או העלאה אינו תאריך מהדורה.`);
    }
    return out;
}
