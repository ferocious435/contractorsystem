import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { anchorSourceRange, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { parsePrintedBoqRows } from './printed-boq-rows.ts';
import { readConsultantBoqRevision, selectConsultantBoqRows, type ConsultantBoqDocument, type ConsultantBoqRow, type ConsultantBoqRevision } from './consultant-boq.ts';

export type BoqEditionChange = 'PRICE' | 'UNIT' | 'SCOPE';
export type BoqReplacement = { from: ConsultantBoqRow; to: ConsultantBoqRow; evidence: EvidenceAnchor };
export type BoqEditionHistory = {
    fromDocumentId: string; toDocumentId: string; fromRevision: ConsultantBoqRevision;
    toRevision: ConsultantBoqRevision; evidence: EvidenceAnchor;
};
export type BoqEditionComparison = {
    status: 'REPLACED' | 'UNKNOWN' | 'CONFLICT'; originalRow: ConsultantBoqRow; currentRow: ConsultantBoqRow;
    chain: BoqReplacement[]; changes: BoqEditionChange[]; description: string; reason: string | null; warnings: string[];
    editionHistory: BoqEditionHistory[];
};
const sameText = (value: string) => normalizeEvidenceSource(value).replace(/\s+/gu, ' ').trim();
const section = (code: string) => code.split('.').slice(0, -1).join('.');
const identity = (row: ConsultantBoqRow) => row.revision.identifier;
type EditionNode = { document: ConsultantBoqDocument; revision: ConsultantBoqRevision; row?: ConsultantBoqRow };
const editionKey = (revision: ConsultantBoqRevision) => JSON.stringify([revision.identifier?.boq, revision.identifier?.edition]);

/** Affirmative complete statements only. A date, generic designation, title or item code
 * never establishes replacement. Unknown phrasing is intentionally left unresolved. */
function replacementEvidence(document: ConsultantBoqDocument, from: ConsultantBoqRevision, to: ConsultantBoqRevision) {
    const a = from.identifier, b = to.identifier;
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
        chain: [], editionHistory: [], changes: [], description: '', reason: 'לא נמצא מסמך שמוכיח החלפת מהדורה מסוימת.', warnings: [] };
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
    // Document succession must survive an absent/ambiguous payable row. Otherwise an
    // explicitly superseded intermediate price would incorrectly look current.
    const candidates: EditionNode[] = eligible.flatMap(document => {
        const revision = readConsultantBoqRevision(document);
        if (!document.content_hash || !revision?.identifier) return [];
        // Reuse the shared parser and source authority checks; query each candidate's own
        // scope so a changed material/unit remains visible as a change, not a hidden price.
        const row = parsePrintedBoqRows(String(document.extracted_text || '')).find(row => row.itemCode === savedRow.itemCode);
        const selected = row ? selectConsultantBoqRows([document], row.scope, []).find(candidate => candidate.itemCode === savedRow.itemCode
            && section(candidate.itemCode) === section(savedRow.itemCode) && !candidate.ambiguousItemCode) : undefined;
        return [{ document, revision, row: selected }];
    });
    const groups = new Map<string, EditionNode[]>();
    for (const node of candidates) {
        const key = editionKey(node.revision), group = groups.get(key) || [];
        if (!group.some(other => other.document.content_hash === node.document.content_hash)) group.push(node);
        groups.set(key, group);
    }
    let currentNode: EditionNode = { document: original, revision: baseline.revision, row: baseline };
    let current = baseline;
    const visited = new Set([original.content_hash]);
    for (;;) {
        if ((groups.get(editionKey(currentNode.revision))?.length || 0) > 1) {
            out.status = 'CONFLICT'; out.reason = 'קיימים קבצים שונים עם אותו זיהוי מהדורה; לא ניתן לבחור קובץ מחייב.';
            break;
        }
        const successors: { node: EditionNode; evidence: EvidenceAnchor; group: EditionNode[] }[] = [];
        for (const [key, group] of groups) {
            if (key === editionKey(currentNode.revision)) continue;
            const evidence = candidates.filter(node => editionKey(node.revision) === key
                && node.document.content_hash !== currentNode.document.content_hash)
                .flatMap(node => eligible.filter(document => document.id === node.document.id
                    || (!readConsultantBoqRevision(document) && document.id !== currentNode.document.id
                        && !/^(?:מספר כתב כמויות:|כתב כמויות\s*(?:לביצוע|חוזי)?\s*$)/mu.test(String(document.extracted_text || ''))))
                    .map(document => replacementEvidence(document, currentNode.revision, node.revision)))
                .find(Boolean);
            if (evidence) {
                successors.push({ node: group[0], evidence, group });
            }
        }
        if (!successors.length) break;
        if (successors.length > 1 || successors[0].group.length > 1 || visited.has(successors[0].node.document.content_hash!)) {
            out.status = 'CONFLICT'; out.reason = 'נמצאו מהדורות מתחרות או שרשרת החלפה מעגלית; אין מהדורה אחרונה חד משמעית.';
            break;
        }
        const hop = successors[0];
        out.editionHistory.push({ fromDocumentId: currentNode.document.id, toDocumentId: hop.node.document.id,
            fromRevision: currentNode.revision, toRevision: hop.node.revision, evidence: hop.evidence });
        if (currentNode.row && hop.node.row) out.chain.push({ from: currentNode.row, to: hop.node.row, evidence: hop.evidence });
        currentNode = hop.node; visited.add(currentNode.document.content_hash!);
        if (currentNode.row) {
            current = currentNode.row; out.currentRow = current;
            out.status = 'REPLACED'; out.reason = null;
        } else {
            out.status = 'UNKNOWN'; out.reason = 'המהדורה המחליפה אינה מכילה שורה חד משמעית לסעיף; המחיר הקודם אינו מאושר כמחיר נוכחי.';
        }
    }
    if (out.editionHistory.length) {
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
