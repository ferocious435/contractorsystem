export type ReferenceAuthorityClause = {
    text: string;
    id?: string | null;
    sectionCode?: string | null;
    edition?: string | null;
    page?: number | null;
};

export type ReferenceAuthorityDocument = {
    id: string;
    title: string;
    role: 'PROJECT_CONTRACT' | 'REFERENCE' | 'WORK_EVIDENCE';
    referenceType?: string | null;
    standardNumber?: string | null;
    aliases?: string[];
    clauses: ReferenceAuthorityClause[];
};

export type DeclaredReferenceLink = {
    sourceDocumentId: string;
    targetDocumentId: string;
    quote: string;
    status?: string | null;
};

export type DocumentReferenceLink = DeclaredReferenceLink & {
    sourceTitle: string;
    targetTitle: string;
    sourceClauseId: string | null;
    sourceSection: string | null;
    sourceEdition: string | null;
    sourcePage: number | null;
    targetSection: string | null;
    targetSections: string[];
    scopeUnknown: boolean;
    targetEdition: string | null;
};

export type DocumentReferenceIssue = {
    reason: string;
    sourceDocumentId: string;
    targetDocumentId?: string;
    targetLabel: string;
    quote: string;
};

export type DocumentReferenceGraph = {
    documents: ReferenceAuthorityDocument[];
    links: DocumentReferenceLink[];
    issues: DocumentReferenceIssue[];
    precedenceEvidence: Array<{ documentId: string; title: string; quote: string }>;
};

export type DocumentReferenceAuthority = {
    applicability: 'CONFIRMED' | 'REFERENCE_ONLY' | 'NEEDS_REVIEW';
    reason: string;
    chain: DocumentReferenceLink[];
};

function clean(value: string) {
    return value.replace(/[\u200e\u200f\u202a-\u202e]/gu, '').replace(/\s+/gu, ' ').trim();
}

function identity(value: string) {
    return value.replace(/\.(?:pdf|docx?)$/iu, '').toLowerCase()
        .replace(/[^\p{L}\d]+/gu, ' ').replace(/(^| )ה(?=[א-ת]{3})/gu, '$1').trim();
}

function statements(value: string) {
    return clean(value).split(/(?<=[.;!?])\s+(?=[\p{L}])/gu)
        .map((text) => text.trim()).filter((text) => text.length >= 15);
}

function namesTarget(quote: string, target: ReferenceAuthorityDocument, normalizedQuote?: string, targetNames?: string[]) {
    if (target.referenceType === 'BLUE_BOOK') return /(?:ה?מפרט\s*ה?כללי|ה?ספר\s*ה?כחול|ה?אוגדן\s*ה?כחול|blue\s+book)/iu.test(quote);
    if (target.referenceType === 'SHELF_CONTRACT_3210') return /(?<!\d)3210(?!\d)/u.test(quote);
    if (target.referenceType === 'ISRAELI_STANDARD') {
        const number = target.standardNumber || target.title.match(/\d+(?:\.\d+)*/u)?.[0];
        return Boolean(number && standardNumbers(quote).includes(number));
    }
    const candidate = normalizedQuote ?? identity(quote);
    return (targetNames || [target.title, ...(target.aliases || [])].map(identity)).some((name) => {
        return name.length >= 8 && ` ${candidate} `.includes(` ${name} `);
    });
}

function standardNumbers(quote: string) {
    return [...quote.matchAll(/(?<![\p{L}\d])(?:[ובכלמ]?ת[״"']{1,2}י|תקן\s+ישראלי|israeli\s+standard)[\s:]*([0-9]+(?:\.[0-9]+)*)/giu)]
        .map((match) => match[1]);
}

function bindingProblem(quote: string) {
    if (/דוגמאות|דוגמ[הא]|למשל|for\s+example/iu.test(quote)) return 'informational_reference';
    if (/סתירה|אי\s*בהירות/iu.test(quote) && /יקבע|יגבר|גובר|עדיפות|עדיפויות/iu.test(quote)) return 'precedence_clause';
    if (/לא\s+יחול|אינ[וה]\s+(?:חלק|חל|מחייב|מהוו)|does\s+not\s+apply|not\s+incorporated/iu.test(quote)) return 'excluded_reference';
    if (/האם|\?|(?:^|\s)אם\s|בתנאי|ובלבד|למעט|בכפוף\s+לאישור|provided\s+that|except/iu.test(quote)) return 'conditional_reference';
    if (!/(?:יחול(?:ו)?|כפוף|כפופה|בכפיפות|חלק\s+בלתי\s+נפרד|מהוו[הת]\s+חלק|מחייב|תעמוד\s+בדרישות|יעמוד\s+בדרישות|בהתאם\s+ל|לפי\s+|יש\s+לקראו\s+ולפרשו\s+יחד\s+עם|shall\s+apply|incorporated|governed\s+by)/iu.test(quote)) return 'reference_is_only_mentioned';
    return null;
}

export function referenceEditionFromText(value: string) {
    const editions = new Set([...value.matchAll(/(?:מהדור[הת]|edition|גרס[הת])\s*[:\-]?\s*((?:19|20)\d{2})(?:[-/.](0?[1-9]|1[0-2])(?!\d))?(?!\d)/giu)]
        .map((match) => match[2] ? `${match[1]}-${match[2].padStart(2, '0')}` : match[1]));
    return editions.size === 1 ? [...editions][0] : null;
}

function targetScopeFromQuote(quote: string, target: ReferenceAuthorityDocument) {
    if (target.referenceType !== 'BLUE_BOOK') return { targetSection: null, targetSections: [], scopeUnknown: false };
    const list = quote.match(/ה?פרקים\s*:?\s*([\s\S]+?)(?=וכן\s+כל\s+פרק|של\s+ה?מפרט|מהדורת|$)/u)?.[1];
    const listed = list ? [...list.matchAll(/(?<![\d.])(\d{1,3})(?![\d.])(?=\s*[-–—,:])/gu)].map((match) => match[1]) : [];
    const single = quote.match(/(?:פרק|chapter)\s+(\d+(?:\.\d+)*)/iu)?.[1] || null;
    const targetSections = listed.length ? [...new Set(listed)] : single ? [single] : [];
    const scopeUnknown = Boolean((list && listed.length === 0)
        || /(?:סעיפים|פרקים)\s+(?:הנ["״']?ל|שנקבעו|הנזכרים|המתאימים|הרלוונטיים)/u.test(quote));
    return { targetSection: targetSections[0] || null, targetSections, scopeUnknown };
}

function addLink(graph: DocumentReferenceGraph, source: ReferenceAuthorityDocument, target: ReferenceAuthorityDocument,
    clause: ReferenceAuthorityClause, quote: string) {
    if (quote.length > 1_600) {
        graph.issues.push({ reason: 'reference_context_too_long', sourceDocumentId: source.id,
            targetDocumentId: target.id, targetLabel: target.title, quote });
        return;
    }
    const problem = bindingProblem(quote);
    if (problem) {
        if (problem !== 'reference_is_only_mentioned' && problem !== 'precedence_clause') graph.issues.push({
            reason: problem, sourceDocumentId: source.id, targetDocumentId: target.id, targetLabel: target.title, quote,
        });
        return;
    }
    const link: DocumentReferenceLink = {
        sourceDocumentId: source.id, sourceTitle: source.title, targetDocumentId: target.id, targetTitle: target.title,
        quote, sourceClauseId: clause.id || null, sourceSection: clause.sectionCode || null,
        sourceEdition: clause.edition || null, sourcePage: clause.page || null,
        ...targetScopeFromQuote(quote, target), targetEdition: referenceEditionFromText(quote),
    };
    if (!graph.links.some((existing) => existing.sourceDocumentId === link.sourceDocumentId
        && existing.targetDocumentId === link.targetDocumentId && existing.quote === link.quote
        && existing.sourceSection === link.sourceSection && existing.sourceEdition === link.sourceEdition)) graph.links.push(link);
}

function markCycles(graph: DocumentReferenceGraph) {
    const visited = new Set<string>();
    const active = new Set<string>();
    const walk = (id: string) => {
        if (visited.has(id)) return;
        active.add(id);
        for (const link of graph.links.filter((edge) => edge.sourceDocumentId === id)) {
            if (active.has(link.targetDocumentId)) graph.issues.push({
                reason: 'reference_cycle', sourceDocumentId: id, targetDocumentId: link.targetDocumentId,
                targetLabel: link.targetTitle, quote: link.quote,
            });
            else walk(link.targetDocumentId);
        }
        active.delete(id);
        visited.add(id);
    };
    for (const document of graph.documents) walk(document.id);
}

export function buildDocumentReferenceGraph(params: {
    documents: ReferenceAuthorityDocument[];
    declaredLinks?: DeclaredReferenceLink[];
}): DocumentReferenceGraph {
    const graph: DocumentReferenceGraph = { documents: params.documents, links: [], issues: [], precedenceEvidence: [] };
    const namesById = new Map(params.documents.map((document) => [document.id, [document.title, ...(document.aliases || [])].map(identity)]));
    for (const source of params.documents) {
        if (!source.id.trim()) {
            graph.issues.push({ reason: 'source_document_id_missing', sourceDocumentId: '', targetLabel: source.title, quote: '' });
            continue;
        }
        if (source.role === 'WORK_EVIDENCE') continue;
        for (const clause of source.clauses) {
            for (const quote of statements(clause.text)) {
                const problem = bindingProblem(quote);
                if (problem === 'precedence_clause') {
                    graph.precedenceEvidence.push({ documentId: source.id, title: source.title, quote });
                    continue;
                }
                if (problem === 'reference_is_only_mentioned') continue;
                const normalizedQuote = identity(quote);
                for (const target of params.documents) {
                    if (source.id !== target.id && namesTarget(quote, target, normalizedQuote, namesById.get(target.id))) addLink(graph, source, target, clause, quote);
                }
                if (!problem) {
                    for (const number of standardNumbers(quote)) {
                        const available = params.documents.some((target) => target.referenceType === 'ISRAELI_STANDARD'
                            && (target.standardNumber || target.title.match(/\d+(?:\.\d+)*/u)?.[0]) === number);
                        if (!available) graph.issues.push({ reason: quote.length > 1_600 ? 'reference_context_too_long' : 'referenced_document_missing',
                            sourceDocumentId: source.id, targetLabel: `תקן ישראלי ${number}`, quote });
                    }
                    for (const family of [
                        { referenceType: 'SHELF_CONTRACT_3210', title: 'חוזה מדף 3210' },
                        { referenceType: 'BLUE_BOOK', title: 'המפרט הכללי / הספר הכחול' },
                    ]) {
                        if (namesTarget(quote, { id: '', role: 'REFERENCE', clauses: [], ...family })
                            && !params.documents.some((document) => document.referenceType === family.referenceType)) {
                            graph.issues.push({ reason: quote.length > 1_600 ? 'reference_context_too_long' : 'referenced_document_missing',
                                sourceDocumentId: source.id, targetLabel: family.title, quote });
                        }
                    }
                }
            }
        }
    }
    for (const declared of params.declaredLinks || []) {
        const source = params.documents.find((document) => document.id === declared.sourceDocumentId);
        const target = params.documents.find((document) => document.id === declared.targetDocumentId);
        const quote = clean(declared.quote);
        const clause = quote.length > 20 ? source?.clauses.find((item) => clean(item.text).includes(quote)) : undefined;
        if (!source || !target || !clause) {
            graph.issues.push({ reason: 'incorporation_quote_not_found', sourceDocumentId: declared.sourceDocumentId,
                targetDocumentId: declared.targetDocumentId, targetLabel: target?.title || declared.targetDocumentId, quote });
        } else if (source.role !== 'WORK_EVIDENCE' && namesTarget(quote, target)) {
            const context = statements(clause.text).find((statement) => statement.includes(quote));
            if (context) addLink(graph, source, target, clause, context);
            else graph.issues.push({ reason: 'incorporation_quote_context_unresolved', sourceDocumentId: source.id,
                targetDocumentId: target.id, targetLabel: target.title, quote });
        }
    }
    markCycles(graph);
    return graph;
}

export function resolveDocumentReferenceAuthority(graph: DocumentReferenceGraph, query: {
    targetDocumentId: string;
    sectionCode?: string | null;
    edition?: string | null;
    requireEdition?: boolean;
}): DocumentReferenceAuthority {
    const byId = new Map(graph.documents.map((document) => [document.id, document]));
    const visit = (id: string, section: string | null, edition: string | null, requireEdition: boolean, visited: Set<string>): DocumentReferenceAuthority => {
        if (!id.trim()) return { applicability: 'REFERENCE_ONLY', reason: 'source_document_id_missing', chain: [] };
        if (visited.has(id)) return { applicability: 'NEEDS_REVIEW', reason: 'reference_cycle', chain: [] };
        const document = byId.get(id);
        if (!document || document.role === 'WORK_EVIDENCE') return { applicability: 'REFERENCE_ONLY', reason: 'no_contractual_root', chain: [] };
        if (document.role === 'PROJECT_CONTRACT') return { applicability: 'CONFIRMED', reason: 'project_contract_document', chain: [] };
        const nextVisited = new Set([...visited, id]);
        let uncertain: DocumentReferenceAuthority | null = null;
        let confirmed: DocumentReferenceAuthority | null = null;
        const requiredEditions = new Set<string>();
        for (const link of graph.links.filter((edge) => edge.targetDocumentId === id)) {
            const parentType = byId.get(link.sourceDocumentId)?.referenceType;
            const parent = visit(link.sourceDocumentId, link.sourceSection, link.sourceEdition,
                ['BLUE_BOOK', 'SHELF_CONTRACT_3210', 'ISRAELI_STANDARD'].includes(parentType || ''), nextVisited);
            if (parent.applicability !== 'CONFIRMED') {
                if (parent.applicability === 'NEEDS_REVIEW') uncertain ||= { ...parent, chain: [...parent.chain, link] };
                continue;
            }
            const normalizeSection = (value: string) => value.split('.').map(Number).join('.');
            if (link.targetSections.length > 0 && section && !link.targetSections.some((required) =>
                normalizeSection(section) === normalizeSection(required)
                || normalizeSection(section).startsWith(`${normalizeSection(required)}.`))) continue;
            if (link.targetEdition) requiredEditions.add(link.targetEdition);
            const chain = [...parent.chain, link];
            let reason: string | null = null;
            if (link.scopeUnknown || (link.targetSections.length > 0 && !section)) reason = 'referenced_section_not_proven';
            else if ((link.targetEdition && link.targetEdition !== edition) || (requireEdition && (!link.targetEdition || !edition))) reason = 'referenced_edition_not_proven';
            if (reason) uncertain ||= { applicability: 'NEEDS_REVIEW', reason, chain };
            else confirmed ||= { applicability: 'CONFIRMED', reason: 'grounded_incorporation_chain', chain };
        }
        if (requiredEditions.size > 1) return { applicability: 'NEEDS_REVIEW', reason: 'conflicting_reference_editions',
            chain: confirmed?.chain || uncertain?.chain || [] };
        return confirmed || uncertain || { applicability: 'REFERENCE_ONLY', reason: 'no_applicable_contractual_chain', chain: [] };
    };
    return visit(query.targetDocumentId, query.sectionCode || null, query.edition || null, Boolean(query.requireEdition), new Set());
}

export function buildDocumentReferenceCheckReport(graph: DocumentReferenceGraph) {
    const byId = new Map(graph.documents.map((document) => [document.id, document]));
    const uniqueIssues = [...new Map(graph.issues.map((issue) => [
        JSON.stringify([issue.reason, issue.sourceDocumentId, issue.targetLabel, issue.quote]), issue,
    ])).values()];
    const issues = uniqueIssues.map((issue) => {
        const source = byId.get(issue.sourceDocumentId);
        const clause = source?.role === 'REFERENCE' ? source.clauses.find((item) => clean(item.text).includes(issue.quote)) : undefined;
        const bindingStatus = source?.role === 'PROJECT_CONTRACT' ? 'CONFIRMED'
            : resolveDocumentReferenceAuthority(graph, { targetDocumentId: issue.sourceDocumentId,
                sectionCode: clause?.sectionCode, edition: clause?.edition, requireEdition: true }).applicability;
        return { ...issue, sourceTitle: source?.title || null, bindingStatus };
    });
    return {
        version: 'references-v1',
        projectContractDocuments: graph.documents.filter((document) => document.role === 'PROJECT_CONTRACT').length,
        checkedLinks: graph.links.length,
        references: graph.documents.filter((document) => document.role === 'REFERENCE').map((document) => {
            const result = resolveDocumentReferenceAuthority(graph, { targetDocumentId: document.id });
            return { id: document.id, title: document.title, available: document.clauses.length > 0,
                applicability: result.applicability, reason: result.reason, chain: result.chain,
                editionAndSectionMustBeCheckedPerClause: true };
        }),
        missingRequiredDocuments: [...new Map(issues.filter((issue) => issue.reason === 'referenced_document_missing'
            && issue.bindingStatus === 'CONFIRMED').map((issue) => [issue.targetLabel, issue])).values()],
        issues,
        precedenceEvidence: graph.precedenceEvidence,
    };
}
