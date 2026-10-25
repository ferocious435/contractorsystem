import type { DocumentReferenceAuthority, DocumentReferenceGraph, ReferenceAuthorityQuery,
    ReferenceContractEvidence } from './document-reference-authority.ts';

type Restriction = {
    mode: 'EXCLUDE' | 'LIMIT' | 'REVIEW';
    sections: string[];
    scopeUnknown: boolean;
    evidence: Omit<ReferenceContractEvidence, 'sectionCode'>;
};
const policyIndex = new WeakMap<DocumentReferenceGraph, Map<string, Restriction[]>>();
const families = new Set(['BLUE_BOOK', 'SHELF_CONTRACT_3210']);
const normalizeSection = (value: string) => value.split('.').map(Number).join('.');
const within = (section: string, parent: string) => section === parent || section.startsWith(`${parent}.`);

function sectionsIn(quote: string) {
    const values = [...quote.matchAll(/(?:פרק|סעיף|chapter|section|clause)\s+(\d+(?:\.\d+)*)/giu)].map(match => match[1]);
    for (const list of quote.matchAll(/(?:פרקים|סעיפים|chapters|sections)\s*:?\s*([\d\s.,ו–—-]+)/giu)) {
        values.push(...[...list[1].matchAll(/\d+(?:\.\d+)*/gu)].map(match => match[0]));
    }
    return [...new Set(values.map(normalizeSection))];
}

function restrictionsFor(graph: DocumentReferenceGraph) {
    const cached = policyIndex.get(graph);
    if (cached) return cached;
    const index = new Map<string, Restriction[]>();
    const targets = graph.documents.filter(document => document.role === 'REFERENCE' && families.has(document.referenceType || ''));
    for (const target of targets) index.set(target.id, []);
    for (const source of graph.documents.filter(document => document.role === 'PROJECT_CONTRACT' && document.id.trim())) {
        for (const clause of source.clauses) {
            const sentences = clause.text.replace(/[\u200e\u200f\u202a-\u202e]/gu, '').replace(/\s+/gu, ' ').trim()
                .split(/(?<=[.;!?])\s+(?=[\p{L}])/gu);
            for (const quote of sentences) {
                if (/דוגמאות|דוגמ[הא]|למשל|for\s+example|האם|\?|נדחת[הו]|בקשת\s+הקבלן|הקבלן\s+ביקש/iu.test(quote)) continue;
                const excluded = /לא\s+יחול(?:ו)?|אינ[וה]\s+(?:חלק|חל|מחייב|מהוו)|does\s+not\s+apply|not\s+incorporated/iu.test(quote);
                const replaced = /יוחלף|יוחלפו|מוחלף|במקום\s+(?:האמור|סעיף|פרק)|replac(?:e[ds]?|ement)|overrid(?:e|den)|amend(?:ed|ment)/iu.test(quote);
                const conditional = /(?:^|\s)אם\s|בתנאי|ובלבד|למעט|בכפוף\s+לאישור|provided\s+that|except|unless|\bonly\s+if\b/iu.test(quote);
                const limited = /יחול(?:ו)?\s+רק\s+(?:פרק|סעיף)|(?:פרק|סעיף)\s+\d+(?:\.\d+)*\s+בלבד|only\s+(?:chapter|section)/iu.test(quote);
                if (!excluded && !replaced && !limited && !(conditional && /יחול|shall\s+apply/iu.test(quote))) continue;
                const sections = sectionsIn(quote);
                const scopeUnknown = /(?:ה?פרקים|ה?סעיפים|ה?פרק|ה?סעיף)\s+(?:הנ["״']?ל|שנקבעו|הנזכרים|המתאימים|הרלוונטיים)/u.test(quote)
                    || (limited && sections.length === 0);
                // Without the work context, a site/material-specific exception
                // cannot be promoted to an unconditional chapter cancellation.
                const workCondition = /ב(?:אזור|תחום|שטח|מקרה)\s|על\s+עבודות\s+(?!הפרויקט|החוזה)/u.test(quote);
                const namesBlue = /(?:ה?מפרט\s*ה?כללי|ה?ספר\s*ה?כחול|ה?אוגדן\s*ה?כחול|blue\s+book)/iu.test(quote);
                const namesShelf = /(?<!\d)3210(?!\d)/u.test(quote);
                for (const target of targets) {
                    const named = target.referenceType === 'BLUE_BOOK' ? namesBlue : namesShelf;
                    if (!named) continue;
                    index.get(target.id)!.push({
                        mode: conditional || workCondition || replaced || scopeUnknown || (namesBlue && namesShelf) || quote.length > 1_600
                            ? 'REVIEW' : excluded ? 'EXCLUDE' : 'LIMIT',
                        sections, scopeUnknown,
                        evidence: { documentId: source.id, title: source.title, quote },
                    });
                }
            }
        }
    }
    policyIndex.set(graph, index);
    return index;
}

/** Document-level business basis; this does not verify a reference clause. */
export function resolveReferenceDefaultPolicy(graph: DocumentReferenceGraph, query: ReferenceAuthorityQuery): DocumentReferenceAuthority | null {
    const restrictions = restrictionsFor(graph).get(query.targetDocumentId);
    if (!restrictions) return null;
    const section = query.sectionCode ? normalizeSection(query.sectionCode) : null;
    const evidence: ReferenceContractEvidence[] = [];
    let excluded = false;
    let review = false;
    for (const restriction of restrictions) {
        const matching = section && restriction.sections.find(scope => within(section, scope));
        const parent = section && restriction.sections.find(scope => within(scope, section));
        const scoped = restriction.sections.length > 0 || restriction.scopeUnknown;
        if (section && scoped && !matching && !parent && !restriction.scopeUnknown && restriction.mode !== 'LIMIT') continue;
        evidence.push({ ...restriction.evidence, sectionCode: matching || restriction.sections[0] || null });
        if (!section && scoped) continue;
        if (restriction.mode === 'REVIEW' || (parent && !matching)) review = true;
        else if (restriction.mode === 'EXCLUDE' || (restriction.mode === 'LIMIT' && !matching)) excluded = true;
    }
    const contractEvidence = [...new Map(evidence.map(item => [JSON.stringify(item), item])).values()];
    if (review) return { applicability: 'NEEDS_REVIEW', reason: 'project_contract_condition_unresolved', chain: [], contractEvidence };
    if (excluded) return { applicability: 'REFERENCE_ONLY', reason: 'project_contract_exclusion', chain: [], contractEvidence };
    return { applicability: 'CONFIRMED', reason: 'system_default_reference', chain: [], ...(contractEvidence.length ? { contractEvidence } : {}) };
}
