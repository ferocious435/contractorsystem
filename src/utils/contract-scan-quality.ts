import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { findEvidenceAnchor, normalizeEvidenceSource, evidenceMeaningMarkers, assessEvidenceRelation,
    type EvidenceClaimExtraction, type EvidenceRelationAssessment } from './radar-evidence-assessment.ts';
import type { ComparisonContextSelection } from './contract-context-selection.ts';
import { EVIDENCE_CLAIM_SCHEMA, STATEMENT_ROLES, COMPARISON_ATTRIBUTES, readEvidenceMeaning } from './radar-evidence-meaning.ts';
import { buildIssueHistory, documentEventDate, isMtmIssueText, issueAspectsInText, MTM_ISSUE } from './radar-issue-history.ts';
import { reviewIssueTiming } from './radar-issue-timing.ts';
export { reviewCompletionDeadlineBasis } from './completion-deadline-review.ts';

export const CONTRACT_SCAN_INSTRUCTION_VERSION = 'evidence-comparison-v18';
// Reassessing saved quotes does not require generating them again. Retain the
// existing source-memory identity; the new instruction applies to future inputs.
export const CONTRACT_SCAN_MEMORY_VERSION = 'project-timeline-timeline-evidence-v14-compact-whitespace-v2';
export const CONTRACT_SCAN_QUALITY_VERSION = 'evidence-relation-v7-requirement-basis';

export const CONTRACT_SCAN_RESPONSE_SCHEMA = {
    type: 'array',
    maxItems: 1,
    items: {
        type: 'object',
        additionalProperties: false,
        required: [
            'title',
            'category',
            'contract_quote',
            'work_quote',
            'comparison',
        ],
        properties: {
            work_quote: { type: 'string', minLength: 1, maxLength: 700 },
            contract_quote: { type: ['string', 'null'], minLength: 1, maxLength: 700 },
            comparison: { type: 'object', additionalProperties: false, required: ['work', 'baseline'], properties: {
                work: EVIDENCE_CLAIM_SCHEMA,
                baseline: { anyOf: [EVIDENCE_CLAIM_SCHEMA, { type: 'null' }] },
            } },
            category: {
                type: 'string',
                enum: ['סתירה', 'שינוי/חריג', 'אירוע שטח', 'חוסר נתונים', 'אין התאמה ישירה', 'פעולה לביצוע'],
            },
            title: { type: 'string', minLength: 1, maxLength: 160 },
        },
    },
} as const;

function quoteChoices(text: string) {
    const normalized = normalizeEvidenceSource(text);
    if (normalized.length <= 700 && normalized && !isDocumentHeaderOnlyEvidence(normalized)) return [normalized];
    return [...new Set(text.split(/\n+|(?<=[^\d])\.\s+|;\s*/u).map(normalizeEvidenceSource)
        .filter(value => value.length > 0 && value.length <= 700 && !isDocumentHeaderOnlyEvidence(value)))];
}

export function buildGroundedScanResponseSchema(input: { workText: string; contractTexts: string[] }) {
    const workQuotes = quoteChoices(input.workText);
    const contractQuotes = [...new Set(input.contractTexts.flatMap(quoteChoices))];
    const claimSchema = (quotes: string[]) => {
        const subjects = [...new Set(quotes.map(quote => readEvidenceMeaning(quote).subjectQuote || quote.slice(0, 100)))];
        return { ...EVIDENCE_CLAIM_SCHEMA, properties: { ...EVIDENCE_CLAIM_SCHEMA.properties,
            subject: { ...EVIDENCE_CLAIM_SCHEMA.properties.subject, ...(subjects.length ? { enum: subjects } : {}) } } };
    };
    return { ...CONTRACT_SCAN_RESPONSE_SCHEMA, items: { ...CONTRACT_SCAN_RESPONSE_SCHEMA.items,
        properties: { ...CONTRACT_SCAN_RESPONSE_SCHEMA.items.properties,
            work_quote: { ...CONTRACT_SCAN_RESPONSE_SCHEMA.items.properties.work_quote, ...(workQuotes.length ? { enum: workQuotes } : {}) },
            contract_quote: { ...CONTRACT_SCAN_RESPONSE_SCHEMA.items.properties.contract_quote,
                ...(contractQuotes.length ? { enum: [...contractQuotes, null] } : {}) },
            comparison: { ...CONTRACT_SCAN_RESPONSE_SCHEMA.items.properties.comparison, properties: {
                work: claimSchema(workQuotes), baseline: { anyOf: [claimSchema(contractQuotes), { type: 'null' }] },
            } },
        } } };
}

export type ContractScanDocument = DocumentSourceInput & {
    id: string;
    title?: string | null;
    category?: string | null;
    extracted_text?: string | null;
};

export type ContractScanFinding = Record<string, unknown> & {
    title?: unknown;
    description?: unknown;
    category?: unknown;
    advice?: unknown;
    contract_quote?: unknown;
    work_quote?: unknown;
    contract_document_id?: unknown;
    work_document_id?: unknown;
    comparison_type?: unknown;
    missing_evidence?: unknown;
};

export type ContractScanPromptParams = {
    contractHierarchyGuide: string;
    contractContext: string;
    relatedWorkContext: string;
    workDoc: ContractScanDocument;
    workChunk: {
        index: number;
        total: number;
        start: number;
        end: number;
        text: string;
    };
    contractChunksIndexed: number;
    contractSourceChars: number;
    projectWorkChunksIndexed: number;
};

const PLACEHOLDER_VALUES = new Set([
    'כותרת קצרה בעברית',
    'מה לא מסתדר ומה המשמעות לקבלן',
    'מה הקבלן צריך לבדוק או לעשות עכשיו',
    'short title in hebrew',
]);

const ALLOWED_CATEGORIES = new Set([
    'סתירה',
    'שינוי/חריג',
    'אירוע שטח',
    'חוסר נתונים',
    'אין התאמה ישירה',
    'פעולה לביצוע',
]);

function cleanText(value: unknown) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function defaultAdviceForCategory(category: string, title: string) {
    if (category === 'סתירה') return 'בדוק את הפער מול החוזה ושלח פנייה מתועדת לפני ביצוע או ויתור.';
    if (category === 'שינוי/חריג') return 'תעד את הדרישה והעבר אותה לתמחור ולאישור לפני ביצוע.';
    if (category === 'פעולה לביצוע') return `עקוב אחר המענה לדרישה ותעד את התוצאה: ${title}`;
    if (category === 'חוסר נתונים') return 'אסוף את המסמך החסר לפני קבלת החלטה.';
    if (category === 'אירוע שטח') return 'שמור את הראיה ובדוק אם נדרשת הודעה למזמין.';
    return 'בדוק אם נדרש תיעוד חוזי נוסף.';
}

function documentDateFromTitle(title: string) {
    const normalizedTitle = title.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    const match = normalizedTitle.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (!match) return null;
    const yearValue = Number(match[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    const month = Number(match[2]);
    const day = Number(match[1]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? timestamp : null;
}

export function assessContractualReplyDeadline(params: { contractQuote: string; workQuote: string }) {
    const contract = cleanText(params.contractQuote);
    const work = cleanText(params.workQuote);
    const result = {
        applicable: false, proven: false, reason: 'not_response_deadline_comparison',
        daysAllowed: null as number | null, receivedDate: null as string | null,
        dueDate: null as string | null, statusDate: null as string | null,
    };
    const refersToReply = /תשובה|מענה|\b(?:reply|response|respond)\b/iu.test(contract);
    const explicitlyUnanswered = /(?:לא|טרם)\s+(?:נמסרה|נמסר|התקבלה|התקבל|ניתנה|ניתן)\s+(?:כל\s+)?(?:תשובה|מענה)/u.test(work);
    const pending = explicitlyUnanswered || /טרם|עדיין|לא\s+(?:אושר|אושרה|מאושר)/u.test(work);
    if (!refersToReply || !pending) return result;
    result.applicable = true;
    if (/רשאי|רשאית|אינו חייב|אינה חייבת|\b(?:may|optional)\b/iu.test(contract)) {
        return { ...result, reason: 'response_duty_not_proven' };
    }
    if (!explicitlyUnanswered) return { ...result, reason: 'explicit_non_response_missing' };
    // A receipt alone does not prove completeness or any other contractual prerequisite.
    if (/בכפוף|בתנאי|ובלבד|אם\s+(?:הבקשה|הפנייה|הדרישה)|(?:הבקשה|הפנייה|הדרישה)\s+(?:המלאה|התקינה)|subject to|provided that/iu.test(contract)) {
        return { ...result, reason: 'response_conditions_not_proven' };
    }

    // Do not turn undefined periods or working days into a guessed calendar deadline.
    const calendarDays = contract.match(/(?:בתוך|תוך)\s+(\d+)\s+ימים\s+קלנדריים/u)?.[1];
    if (!calendarDays) return { ...result, reason: 'calendar_deadline_missing' };
    result.daysAllowed = Number(calendarDays);
    if (!Number.isSafeInteger(result.daysAllowed) || result.daysAllowed < 0) {
        return { ...result, reason: 'calendar_deadline_invalid' };
    }
    if (!/(?:מיום|ממועד)\s+קבלת\s+(?:הבקשה|הפנייה|הדרישה)/u.test(contract)) {
        return { ...result, reason: 'receipt_trigger_not_proven' };
    }
    const respondent = contract.match(/(המזמין|המזמינה|המפקח|המנהל|המתכנן|הקבלן).{0,50}?(?:ימסור|תמסור|ישיב|תשיב|יענה|תענה)/u)?.[1];
    if (!respondent) return { ...result, reason: 'respondent_not_proven' };
    const datePattern = '(\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{2,4})';
    const receipt = work.match(new RegExp(
        `(?:הבקשה|הפנייה|הדרישה)\\s+(?:התקבלה|נתקבלה|נקלטה)\\s+(?:אצל|בידי)\\s+${respondent}\\s+(?:ביום|בתאריך)\\s+${datePattern}`, 'u',
    ));
    const status = work.match(new RegExp(`(?:נכון ליום|נכון לתאריך|עד ליום)\\s+${datePattern}`, 'u'));
    const receivedAt = receipt ? documentDateFromTitle(receipt[1]) : null;
    const statusAt = status ? documentDateFromTitle(status[1]) : null;
    if (receivedAt === null) return { ...result, reason: 'receipt_not_proven' };
    if (statusAt === null || statusAt < receivedAt) return { ...result, reason: 'status_date_not_proven' };
    const dueAt = receivedAt + result.daysAllowed * 86_400_000;
    if (!Number.isFinite(new Date(dueAt).getTime())) return { ...result, reason: 'calendar_deadline_invalid' };
    result.receivedDate = new Date(receivedAt).toISOString().slice(0, 10);
    result.dueDate = new Date(dueAt).toISOString().slice(0, 10);
    result.statusDate = new Date(statusAt).toISOString().slice(0, 10);
    result.proven = statusAt > dueAt;
    result.reason = result.proven ? 'deadline_elapsed' : 'deadline_not_elapsed';
    return result;
}

function topicTokens(value: string) {
    const stopWords = new Set([
        'אישור', 'אירוע', 'באתר', 'בדיקת', 'בוצע', 'ביצוע', 'דרישה', 'הוגש', 'הסכמה', 'הצגת',
        'המצב', 'העבודה', 'הקבלן', 'חוסר', 'יגיש', 'לאחר', 'לאישור', 'להגיש', 'לפי', 'מסמך',
        'מצב', 'נתונים', 'נדרש', 'נדרשת', 'סיום', 'עבודה', 'עבור', 'פרויקט', 'קבלן', 'צריך',
        'תכנית', 'תכניות', 'תוכניות',
        'document', 'from', 'project', 'required', 'submit', 'with',
        'the', 'this', 'that', 'have', 'has', 'been', 'was', 'were', 'not', 'still', 'will',
        'after', 'before', 'contractor', 'plan', 'approval', 'approved', 'completed', 'resolved',
        'אושרו', 'אושר', 'טרם', 'הושלם', 'הושלמה', 'הושלמו', 'נסגר', 'נסגרו', 'העביר',
        'שינוי', 'שינויים', 'לשנות', 'לשינוי', 'שיטה', 'שיטת', 'change', 'changes', 'method',
    ]);
    const rawTokens = normalizeEvidenceText(value).toLowerCase().match(/[0-9a-z\u0590-\u05ff]+/gu) || [];
    return new Set(rawTokens.flatMap((token) => {
        const isTechnicalCode = /[0-9a-z]/u.test(token);
        if ((!isTechnicalCode && token.length < 4) || stopWords.has(token)) return [];

        const variants = new Set([token]);
        let withoutPrefix = token;
        for (let depth = 0; depth < 3 && /^[והבלכמש]/u.test(withoutPrefix) && withoutPrefix.length >= 6; depth += 1) {
            withoutPrefix = withoutPrefix.slice(1);
            variants.add(withoutPrefix);
        }
        for (const variant of [...variants]) {
            if (variant.length >= 6 && /(?:ים|ות)$/u.test(variant)) {
                variants.add(variant.slice(0, -2));
            }
            if (variant.length >= 5 && /[הת]$/u.test(variant)) {
                variants.add(variant.slice(0, -1));
            }
        }
        return [...variants].filter((variant) =>
            (/[0-9a-z]/u.test(variant) || variant.length >= 4) && !stopWords.has(variant)
        );
    }));
}

function isDocumentHeaderOnlyEvidence(value: string) {
    const text = normalizeEvidenceText(value);
    if (!text) return true;
    if (/(?:לפי|בהתאם)\s+ל?שם\s+הקובץ/u.test(text)) {
        return true;
    }
    if (/^(?:\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\s*)?(?:לכבוד|מאת|אל|הנדון)\s*[:\-–—]?/u.test(text)) {
        return true;
    }
    if (text.length <= 180 && /(?:etransmit|transmittal|autodesk autocad|files included in this transmittal)/iu.test(text)) {
        return true;
    }
    if (
        text.length <= 80
        && /^[\sA-Za-z0-9._:/-]+$/u.test(text)
        && /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/u.test(text)
    ) {
        return true;
    }
    return false;
}

function contractAndWorkEvidenceAreRelated(finding: ContractScanFinding) {
    const contractTopics = topicTokens(cleanText(finding.contract_quote));
    const workTopics = topicTokens(cleanText(finding.work_quote));
    if (contractTopics.size === 0 || workTopics.size === 0) return false;
    return [...contractTopics].some((token) => /\p{L}/u.test(token) && workTopics.has(token));
}

function hasInlineInstructionReplacement(finding: ContractScanFinding) {
    const text = cleanText(finding.work_quote);
    return /(?:לשנות|שונתה|לשינוי|להחליף|הוחלף|הוחלפה).{0,90}?\sמ[\p{L}\p{N}].{4,300}?\sל[\p{L}\p{N}].{4,300}/u.test(text)
        || /\b(?:change|changed|replace|replaced).{0,90}?\bfrom\s+.{4,200}?\s+to\s+.{4,200}/iu.test(text);
}

function comparisonAttributes(text: string) {
    const attributes = new Set<string>();
    if (/רטרואקטיב|retroactive/iu.test(text)) attributes.add('insurance_retroactive_date');
    if (/גבול(?:ות)?\s+(?:ה)?אחריות|סכום\s+(?:ה)?ביטוח|liability limit|coverage limit/iu.test(text)) attributes.add('insurance_limit');
    if (/(?:הודעה|נודיע|notice).{0,100}(?:יום|ימים|days)|(?:יום|ימים|days).{0,50}(?:מראש|לפני|notice)/iu.test(text)) attributes.add('notice_period');
    if (/שמירת\s+(?:ה)?אתר|לשמירת\s+(?:ה)?אתר|גניב|site safekeeping|theft/iu.test(text)) attributes.add('site_custody');
    if (/טיב\s+(?:ה)?מוצר|אחריות.{0,60}אביזרי|אחריות.{0,60}מתוצרת|product warranty|warranty.{0,60}fittings/iu.test(text)) attributes.add('product_warranty');
    if (/(?:פירוק|demolition).{0,50}(?:כביש|מדרכות|אספלט|road|pavement)/iu.test(text)) attributes.add('road_demolition');
    if (/מישק.{0,30}התחברות|asphalt (?:connection )?joint/iu.test(text)) attributes.add('asphalt_joint');
    if (/סביב\s+(?:ה)?צינור|pipe surround|pipe bedding/iu.test(text)) attributes.add('pipe_surround');
    if (/חומר\s+(?:ה)?מילוי/iu.test(text) && /תחתון|lower fill|bulk fill/iu.test(text)) attributes.add('lower_bulk_fill');
    return attributes;
}

function comparisonConcernsDifferentAttributes(finding: ContractScanFinding) {
    const contractAttributes = comparisonAttributes(cleanText(finding.contract_quote));
    const workAttributes = comparisonAttributes(cleanText(finding.work_quote));
    return contractAttributes.size > 0 && workAttributes.size > 0
        && ![...contractAttributes].some((attribute) => workAttributes.has(attribute));
}

function quotesDescribeTheSameNoticePeriod(finding: ContractScanFinding) {
    const notice = (value: unknown) => {
        const text = cleanText(value);
        if (!/ביטוח|insurance/iu.test(text) || !/הודעה|נודיע|notice/iu.test(text)) return null;
        if (!/רשום|registered/iu.test(text)) return null;
        return text.match(/(\d+)\s*(?:\([^)]*\)\s*)?(?:יום|ימים|days)\b/iu)?.[1]
            || text.match(/(\d+)\s*(?:\([^)]*\)\s*)?(?:יום|ימים)(?=$|[^\p{L}])/u)?.[1]
            || null;
    };
    const contractNotice = notice(finding.contract_quote);
    return contractNotice !== null && contractNotice === notice(finding.work_quote);
}

function describesOrdinaryApprovalWorkflow(finding: ContractScanFinding) {
    const contract = cleanText(finding.contract_quote);
    const work = cleanText(finding.work_quote);
    const measures = (value: string) => [...value.matchAll(/(\d+(?:\.\d+)?)\s*(שנים|שנה|חודשים|חודש|%|מ"מ|ס"מ|years?|months?)/giu)]
        .map((match) => {
            const years = /שנים|שנה|years?/iu.test(match[2]);
            const months = /חודשים|חודש|months?/iu.test(match[2]);
            return { amount: Number(match[1]) * (years ? 12 : 1), unit: years || months ? 'months' : match[2] };
        });
    const contractMeasures = measures(contract);
    if (measures(work).some((current) => contractMeasures.some((baseline) =>
        current.unit === baseline.unit && current.amount !== baseline.amount))) return false;
    if (hasInlineInstructionReplacement(finding)) return false;
    if (/אין צורך\s+ב?אישור|לא נדרש\s+אישור|ללא צורך\s+ב?אישור/u.test(contract)) return false;
    const requiresApproval = /(?:יגיש|להגיש|להעביר|נדרש|חייב).{0,60}(?:לאישור|אישור)/u.test(contract);
    const pendingApproval = /טרם\s+אושר|עדיין.{0,20}לא\s+(?:אושר|מאושר)|לא\s+מאושר|(?:עליו|על הקבלן).{0,30}(?:להעביר|להגיש)\s+לאישור/u.test(work);
    return requiresApproval && pendingApproval;
}

function describesConsiderationWithoutInstruction(finding: ContractScanFinding) {
    const work = cleanText(finding.work_quote);
    const consideration = /(?:מוכן|מוכנה|מוכנים|מוכנות)\s+ל(?:שקול|בחון)|(?:נשקלת|נבחנת|תישקל|תיבחן)\s+(?:ה)?אפשרות|\b(?:willing to consider|prepared to consider|may consider|possibility (?:is|will be) (?:considered|examined))\b/iu;
    if (!consideration.test(work)) return false;
    if (/(?:לא|אינו|אינה|אינם|אינן)\s+(?:מוכן|מוכנה|מוכנים|מוכנות)\s+ל(?:שקול|בחון)|\b(?:not|never)\s+(?:willing|prepared)\s+to\s+consider\b/iu.test(work)) return false;
    // Deliberation is not an operative demand. Preserve an actual instruction or
    // decision stated in the same passage; its compatibility still needs comparison.
    return !/(?:דורש|דורשת|נדרש|נדרשת|חייב|חייבת|עליו\s+ל|על\s+הקבלן\s+ל|הורה|הנחה|הוחלט|מורה|אוסר|נאסר|אסור|יש\s+לבצע)|\b(?:requires?|must|shall|instructed|decided|prohibited|ordered)\b/iu.test(work);
}

function titleAndEvidenceAreRelated(finding: ContractScanFinding, includeVerifiedContract: boolean) {
    const titleTopics = topicWordGroups(cleanText(finding.title));
    // A comparison can be titled using the baseline's wording (e.g. defects
    // period versus warranty). Only a verified quotation may supply that wording.
    const evidenceTopics = topicTokens([cleanText(finding.work_quote),
        includeVerifiedContract ? cleanText(finding.contract_quote) : '',
    ].join(' '));
    if (titleTopics.length === 0 || evidenceTopics.size === 0) return false;
    const matched = titleTopics.filter((variants) => [...variants].some((token) => evidenceTopics.has(token))).length;
    return matched >= Math.ceil(titleTopics.length / 2);
}

function topicWordGroups(value: string) {
    return (value.match(/[0-9a-z\u0590-\u05ff]+/giu) || [])
        .map((word) => topicTokens(word))
        .filter((variants) => variants.size > 0);
}

function hasOppositeScope(left: string, right: string) {
    return [
        [/temporary|זמני/iu, /permanent|קבוע/iu],
    ].some(([first, second]) => (first.test(left) && second.test(right) && !first.test(right))
        || (second.test(left) && first.test(right) && !second.test(right)));
}

export function findSupersedingWorkEvidence(params: {
    finding: ContractScanFinding;
    currentWorkDocument: ContractScanDocument;
    relatedWorkDocuments: ContractScanDocument[];
    contractDocuments?: ContractScanDocument[];
}) {
    const { finding, currentWorkDocument, relatedWorkDocuments } = params;
    if (assessContractualReplyDeadline({
        contractQuote: cleanText(finding.contract_quote), workQuote: cleanText(finding.work_quote),
    }).proven) return null;
    const citedWorkQuote = cleanText(finding.work_quote);
    if (isMtmIssueText(citedWorkQuote)) {
        if (!findEvidenceAnchor(currentWorkDocument, citedWorkQuote)
            || !assessDocumentSourceReadiness(currentWorkDocument).canCompare) return null;
        const currentDate = documentEventDate(currentWorkDocument).date;
        if (!currentDate) return null;
        const location = citedWorkQuote.match(/(?:ברחוב|רחוב)\s+([\p{L}״"'-]+)/u)?.[1] || MTM_ISSUE.location;
        const history = buildIssueHistory({ issue: { subject: 'MTM', location },
            documents: [currentWorkDocument, ...relatedWorkDocuments], asOf: new Date().toISOString().slice(0, 10) });
        if (!history.closed) return null;
        if (reviewIssueTiming({ issue: { subject: 'MTM', location },
            documents: [currentWorkDocument, ...relatedWorkDocuments, ...(params.contractDocuments || [])],
            asOf: history.asOf }).confirmedConflicts.length) return null;
        const relevant = issueAspectsInText(citedWorkQuote).map(aspect => history.aspects[aspect]);
        if (!relevant.every(aspect => aspect.date && aspect.date > currentDate
            && ['APPROVED', 'AGREED', 'SIGNED'].includes(aspect.state))) return null;
        const resolutions = relevant.flatMap(aspect => history.events.filter(event => aspect.eventIds.includes(event.id)));
        if (!resolutions.length || resolutions.some(event => !event.location)) return null;
        const last = resolutions.at(-1)!;
        return { documentId: last.anchor.documentId, documentTitle: last.documentTitle, quote: last.anchor.quote };
    }
    const currentDate = documentDateFromTitle(String(currentWorkDocument.title || ''));
    if (currentDate === null) return null;

    // Only the cited fact may identify the issue; an invented title must not close it.
    const workQuote = cleanText(finding.work_quote);
    const findingTopics = topicWordGroups(workQuote);
    if (findingTopics.length === 0) return null;

    let latestState: { date: number; closed: boolean; documentId: string; documentTitle: string; quote: string } | null = null;
    for (const document of relatedWorkDocuments) {
        const relatedDate = documentDateFromTitle(String(document.title || ''));
        if (relatedDate === null || relatedDate <= currentDate) continue;
        const statements = String(document.extracted_text || '')
            .split(/\r?\n+|(?<=[.!?;])\s+|,\s*(?:while|but|whereas|ואילו|אולם)\s+/iu)
            .map((statement) => normalizeEvidenceText(statement));
        const states: boolean[] = [];
        let resolutionQuote = '';
        for (const sourceStatement of statements) {
            const statement = sourceStatement.toLowerCase();
            const relatedTopics = topicTokens(statement);
            const matchedTopics = findingTopics.filter((variants) => [...variants].some((token) => relatedTopics.has(token))).length;
            if (matchedTopics < Math.ceil(findingTopics.length / 2) || hasOppositeScope(workQuote, statement)) continue;
            const isOpen = /[?？]|(?:^|[^\p{L}])(?:לא|טרם|עדיין|האם|בכפוף|בתנאי|אם|יאושר|יאושרו|יהיה|יהיו|יבוצע|יבוצעו|נדרש|נדרשת|צפוי|צפויה|צפויים|אמור|אמורה|מתוכנן|מותנה)(?=$|[^\p{L}])|\b(?:not|never|pending|awaiting|required|will|shall|would|should|could|subject to|conditional|unless)\b/iu.test(statement)
                || /(?:approval|permit|אישור|היתר).{0,30}(?:cancelled|revoked|withdrawn|בוטל|נשלל)/iu.test(statement);
            if (isOpen) {
                states.push(false);
                continue;
            }
            const isClosed = /(?:^|[^\p{L}])(?:אושר|אושרה|אושרו|מאושר|מאושרת|מאושרים|הושלם|הושלמה|הושלמו|בוצע|בוצעה|בוצעו|נסגר|נסגרה|נסגרו|בוטל|בוטלה|בוטלו)(?=$|[^\p{L}])|\b(?:approved|completed|resolved|closed|cancelled)\b/iu.test(statement);
            if (isClosed) {
                states.push(true);
                resolutionQuote = sourceStatement;
            }
        }
        if (states.length === 0) continue;
        const closed = states.every(Boolean);
        if (!latestState || relatedDate > latestState.date) {
            latestState = { date: relatedDate, closed, documentId: document.id, documentTitle: document.title || '', quote: resolutionQuote };
        } else if (relatedDate === latestState.date && !closed) {
            latestState.closed = false;
        }
    }
    return latestState?.closed ? {
        documentId: latestState.documentId, documentTitle: latestState.documentTitle, quote: latestState.quote,
    } : null;
}

export function findingIsSupersededByLaterEvidence(params: Parameters<typeof findSupersedingWorkEvidence>[0]) {
    return findSupersedingWorkEvidence(params) !== null;
}

export function findingHasActionableWorkEvidence(params: {
    finding: ContractScanFinding;
    currentWorkDocument: ContractScanDocument;
    assessment?: { accepted: boolean; evidenceRelation: EvidenceRelationAssessment };
}) {
    const { finding } = params;
    const category = cleanText(finding.category);
    const text = normalizeEvidenceText(cleanText(finding.work_quote)).toLowerCase();
    if (!text) return false;
    if (isDocumentHeaderOnlyEvidence(text)) return false;
    const explicitNeutralPatterns = [
        /לא ניתנו הוראות חדשות/u,
        /לא נרשמו שינויים/u,
        /אין שינוי ואין פעולה/u,
        /ללא שינוי וללא פעולה/u,
        /no new instructions?\b/i,
        /no changes? (?:were )?(?:made|recorded)/i,
    ];
    if (explicitNeutralPatterns.some((pattern) => pattern.test(text))) return false;
    if (params.assessment) {
        if (!params.assessment.accepted) return false;
        if (['CONTRADICTION', 'KNOWN_CHANGE', 'EVENT'].includes(params.assessment.evidenceRelation.resultType)) return true;
        // A source-grounded deadline claim remains an open evidence question
        // after the product has corrected its old contradiction category.
        if (params.assessment.evidenceRelation.reasons.includes('completion_deadline_basis_not_established')) return true;
    }
    if (category === 'סתירה' || category === 'שינוי/חריג') return true;
    // Other labels cannot bypass the comparison requirement by describing a pending task.
    return /(?:אינו|אינה|אינם|אינן|שאינו|שאינה|לא)\s+תוא[מם]|אי[\s־-]*התאמ|בניגוד\s+ל|בסתירה\s+ל|פער\s+בין|\b(?:inconsistent with|does not match|do not match|contradicts|differs from|nonconformity)\b/iu.test(text);
}

function normalizeEvidenceText(value: string) {
    return normalizeEvidenceSource(value);
}

function quoteExistsInSource(sourceText: string, quote: string) {
    const normalizedQuote = normalizeEvidenceText(quote);
    return Boolean(normalizedQuote) && normalizeEvidenceText(sourceText).includes(normalizedQuote);
}

function suppliedSourcePassages(document: ContractScanDocument, finding: ContractScanFinding) {
    const context = finding.context_selection as ComparisonContextSelection | undefined;
    if (context?.version !== 'source-context-v1' || !Array.isArray(context.sources)) {
        return [String(document.extracted_text || '')];
    }
    const anchors = context.sources.find(source => source.documentId === document.id)?.selection?.source_anchors;
    return Array.isArray(anchors) ? anchors.filter(anchor => anchor.documentId === document.id
        && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.end > anchor.start && anchor.start >= 0
        && String(document.extracted_text || '').slice(anchor.start, anchor.end) === anchor.quote).map(anchor => anchor.quote) : [];
}

function editDistance(left: string, right: string) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        let diagonal = previous[0];
        previous[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const above = previous[rightIndex];
            previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
                ? diagonal
                : Math.min(diagonal, above, previous[rightIndex - 1]) + 1;
            diagonal = above;
        }
    }
    return previous[right.length];
}

export function findClosestEvidenceQuote(sourceText: string, proposedQuote: string, minimumScore = 0.88) {
    const normalizedQuote = normalizeEvidenceText(proposedQuote);
    if (!normalizedQuote) return null;
    const normalizedSource = normalizeEvidenceText(sourceText);
    const quoteIndex = normalizedSource.indexOf(normalizedQuote);
    if (quoteIndex >= 0) {
        let start = quoteIndex;
        let end = quoteIndex + normalizedQuote.length;
        const isWordCharacter = (value: string) => /[\p{L}\p{N}]/u.test(value);
        while (start > 0 && isWordCharacter(normalizedSource[start]) && isWordCharacter(normalizedSource[start - 1])) start -= 1;
        while (end < normalizedSource.length && isWordCharacter(normalizedSource[end - 1]) && isWordCharacter(normalizedSource[end])) end += 1;
        const anchor = findEvidenceAnchor({ id: 'quote-source', extracted_text: sourceText }, normalizedSource.slice(start, end));
        return anchor && JSON.stringify(evidenceMeaningMarkers(proposedQuote)) === JSON.stringify(evidenceMeaningMarkers(anchor.quote))
            ? anchor.quote : null;
    }

    const candidates = String(sourceText || '')
        .split(/(?<=[.!?])\s+|\r?\n+/u)
        .map((value) => value.trim())
        .filter((value) => value.length >= Math.max(20, normalizedQuote.length * 0.6))
        .filter((value) => value.length <= normalizedQuote.length * 1.5);
    let best: { quote: string; score: number } | null = null;
    const proposedWordCount = normalizedQuote.match(/[\p{L}\p{N}]+/gu)?.length || 0;

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeEvidenceText(candidate);
        // Repair spelling/layout only; adding or dropping a whole word can
        // change a condition even when its marker is absent from the vocabulary.
        if ((normalizedCandidate.match(/[\p{L}\p{N}]+/gu)?.length || 0) !== proposedWordCount) continue;
        if (JSON.stringify(evidenceMeaningMarkers(proposedQuote)) !== JSON.stringify(evidenceMeaningMarkers(candidate))) continue;
        const longest = Math.max(normalizedQuote.length, normalizedCandidate.length);
        const score = longest > 0
            ? 1 - editDistance(normalizedQuote, normalizedCandidate) / longest
            : 0;
        if (!best || score > best.score) best = { quote: candidate, score };
    }

    return best && best.score >= minimumScore ? best.quote : null;
}

export function groundContractScanFinding(params: {
    finding: ContractScanFinding;
    currentWorkDocument: ContractScanDocument;
    contractDocuments: ContractScanDocument[];
}) {
    const { finding, currentWorkDocument, contractDocuments } = params;
    const grounded: ContractScanFinding = { ...finding };
    const workQuote = typeof finding.work_quote === 'string' ? finding.work_quote.trim() : '';
    const workSourceMatches = !cleanText(finding.work_document_id) || finding.work_document_id === currentWorkDocument.id;
    const exactWorkQuote = workSourceMatches ? findClosestEvidenceQuote(
        String(currentWorkDocument.extracted_text || ''),
        workQuote,
    ) : null;
    if (exactWorkQuote) grounded.work_quote = exactWorkQuote;
    grounded.work_document_id = cleanText(finding.work_document_id) || currentWorkDocument.id;
    grounded.work_source_anchor = exactWorkQuote ? findEvidenceAnchor(currentWorkDocument, exactWorkQuote) : null;
    if (!cleanText(grounded.description)) {
        grounded.description = exactWorkQuote || workQuote;
    }
    if (!cleanText(grounded.advice)) {
        grounded.advice = defaultAdviceForCategory(
            cleanText(grounded.category),
            cleanText(grounded.title),
        );
    }

    const contractDocumentId = cleanText(finding.contract_document_id);
    const contractQuote = typeof finding.contract_quote === 'string' ? finding.contract_quote.trim() : '';
    const suppliedIds = Array.isArray(finding.supplied_contract_document_ids)
        ? new Set(finding.supplied_contract_document_ids.filter((id): id is string => typeof id === 'string')) : null;
    const eligibleDocuments = suppliedIds ? contractDocuments.filter(document => suppliedIds.has(document.id)) : contractDocuments;
    let contractDocument = eligibleDocuments.find((document) => document.id === contractDocumentId);
    let exactContractQuote: string | null = null;

    if (!contractDocumentId && contractQuote) {
        const matches = eligibleDocuments.filter(document => suppliedSourcePassages(document, finding)
            .some(passage => quoteExistsInSource(passage, contractQuote)));
        if (matches.length === 1) contractDocument = matches[0];
        if (matches.length > 1) grounded.source_binding_issues = ['ambiguous_contract_source'];
    }

    if (!contractDocumentId && !contractDocument && contractQuote && !grounded.source_binding_issues) {
        const matches: Array<{ document: ContractScanDocument; quote: string }> = [];
        for (const candidate of eligibleDocuments) {
            const closestQuote = suppliedSourcePassages(candidate, finding)
                .map(passage => findClosestEvidenceQuote(passage, contractQuote)).find(quote => quote !== null);
            if (!closestQuote) continue;
            matches.push({ document: candidate, quote: closestQuote });
        }
        if (matches.length === 1) { contractDocument = matches[0].document; exactContractQuote = matches[0].quote; }
        if (matches.length > 1) grounded.source_binding_issues = ['ambiguous_contract_source'];
    }

    if (contractDocument && contractQuote) {
        exactContractQuote ||= findClosestEvidenceQuote(
            String(contractDocument.extracted_text || ''),
            contractQuote,
        );
        if (exactContractQuote) grounded.contract_quote = exactContractQuote;
        grounded.contract_document_id = contractDocument.id;
        grounded.contract_source_anchor = exactContractQuote ? findEvidenceAnchor(contractDocument, exactContractQuote) : null;
    }
    if (contractDocumentId && contractQuote && !exactContractQuote) {
        grounded.source_repair_suggestions = eligibleDocuments.filter(document => document.id !== contractDocumentId)
            .map(document => findEvidenceAnchor(document, contractQuote)).filter(anchor => anchor !== null).slice(0, 3);
    }

    const replyDeadline = assessContractualReplyDeadline({
        contractQuote: cleanText(grounded.contract_quote), workQuote: cleanText(grounded.work_quote),
    });
    if (replyDeadline.proven && exactWorkQuote && exactContractQuote) {
        grounded.category = 'סתירה';
        grounded.comparison_type = 'contractual_response_deadline';
        if (!cleanText(finding.advice)) {
            grounded.advice = 'תעד את מועד קבלת הבקשה ואת החריגה ממועד המענה. בדוק בנפרד אם החוזה והמסמכים מוכיחים השלכה על התשלום או לוח הזמנים.';
        }
    }

    const canOmitContractQuote = !['סתירה', 'שינוי/חריג'].includes(cleanText(grounded.category))
        || (cleanText(grounded.category) === 'שינוי/חריג' && hasInlineInstructionReplacement(grounded));
    if (canOmitContractQuote && !contractDocumentId
        && !contractAndWorkEvidenceAreRelated(grounded)) {
        grounded.contract_quote = null;
        grounded.contract_document_id = null;
        grounded.contract_source_anchor = null;
    }

    // New model output only: repair an intra-word punctuation artifact in a
    // subject, inside its independently verified quote. Values and quotes stay
    // unchanged; bound saved evidence is never silently rewritten.
    if (!finding.work_document_id && !finding.contract_document_id && finding.comparison) {
        const comparison = structuredClone(finding.comparison) as { work?: EvidenceClaimExtraction; baseline?: EvidenceClaimExtraction };
        const repairs: Array<{ side: string; field: string; original: string; replacement: string }> = [];
        for (const [side, verified, quote] of [['work', exactWorkQuote, grounded.work_quote], ['baseline', exactContractQuote, grounded.contract_quote]] as const) {
            const subject = comparison[side]?.subject;
            if (!verified || typeof subject !== 'string') continue;
            const replacement = subject.replace(/(?<=[\u0590-\u05ff]):(?=[\u0590-\u05ff])/gu, '');
            if (replacement !== subject && quoteExistsInSource(String(quote || ''), replacement)) {
                comparison[side]!.subject = replacement;
                repairs.push({ side, field: 'subject', original: subject, replacement });
            }
        }
        grounded.comparison = comparison;
        if (repairs.length) grounded.comparison_span_repairs = repairs;
    }

    return grounded;
}

export function isTemplatePlaceholderFinding(
    finding: Pick<ContractScanFinding, 'title' | 'description' | 'advice'>,
) {
    return [finding.title, finding.description, finding.advice]
        .map((value) => cleanText(value).toLowerCase())
        .some((value) => PLACEHOLDER_VALUES.has(value));
}

export function buildContractScanPrompt(params: ContractScanPromptParams) {
    const {
        contractHierarchyGuide,
        contractContext,
        relatedWorkContext,
        workDoc,
        workChunk,
        contractChunksIndexed,
        contractSourceChars,
        projectWorkChunksIndexed,
    } = params;

    return `
You are ContractorSystem's construction-claims analyst for an Israeli contractor.
Protect the contractor's payment, margin, schedule, and evidence. Use only the supplied text.

Compare the contractual base against the current work/site passage and its dated project history.
Return only a valid JSON array. All user-facing text must be short, practical Hebrew.

DOCUMENT HIERARCHY / PRECEDENCE GUIDE:
${contractHierarchyGuide}

CONTRACTUAL BASE:
${contractContext}

CURRENT WORK / SITE DOCUMENT:
--- Document ID: ${workDoc.id}
Title: ${workDoc.title || ''}
Category: ${workDoc.category || ''}
Chunk: ${workChunk.index + 1}/${workChunk.total}; source chars ${workChunk.start}-${workChunk.end} ---
${workChunk.text}

RELATED WORK / SITE DOCUMENTS FROM THE SAME PROJECT:
${relatedWorkContext || 'No related work-document passage was found.'}

RULES:
0. First decide whether there is a finding at all. Neutral text, compatible conditions and different properties return exactly []. For example, "no new instructions or changes" returns []; a 17-month delay versus a 19-month contract duration returns []. Do not fill an object with empty or UNKNOWN placeholders for these cases.
1. Read related documents as one dated history. A later record may approve, resolve, replace, or narrow an earlier issue.
2. Report only the latest documented situation. Never present an old open issue when a later record resolved it.
3. A direct contradiction needs incompatible requirements for the same work, property, scope, party, conditions and applicable period. Different numbers alone prove nothing: distinguish total contract duration, delay, submission deadline and monthly updates. Normalize units and check bounds; an exact 8% can satisfy a minimum of 4%.
4. Use פעולה לביצוע only when no contractual statement directly conflicts with the current document and an earlier issue was resolved but the current document contains a new concrete follow-up action.
5. Return a finding only when its decisive work_quote appears verbatim in the CURRENT document above. Related documents provide history; they cannot be cited as the current document.
6. contract_quote must be verbatim from CONTRACTUAL BASE. A contradiction requires it. For a documented from/to method replacement in the current quote it may be null; keep the change as a request/proposal when that is what the source says. Never invent the missing baseline.
7. Choose work_quote FIRST, then contract_quote, exactly from the schema's permitted source phrases. Choose subject from the permitted source phrases too. Never prefix a quote with its filename/title, abbreviate words, remove words, or paraphrase. The system assigns document IDs from the verified quotes.
8. Never invent a clause, page, price, date, party, approval, delay, fault, or financial impact.
9. For סתירה or שינוי/חריג, contract_quote and work_quote must concern the same technical subject. Do not join two exact but unrelated quotations.
10. A date, addressee, subject line, file header, or transmittal header is not evidence of a contradiction, change, delay, cost, or required action.
11. The title must describe the same fact as work_quote. Never infer a safety plan, schedule, approval, or other subject from a quote about something else.
12. When the supplied text does not prove a useful current issue, return []. Missing information is not automatically a contractor failure.
13. Mention cost or delay only when the documents support it; otherwise state the practical step without alleging damage.
14. All ${contractChunksIndexed} contract chunks (${contractSourceChars} characters) and ${projectWorkChunksIndexed} readable project-work chunks were indexed. This current document is processed in ${workChunk.total} chunk(s).
15. Return the single most decisive finding for this chunk, or []. A long document is split into several chunks, so do not list secondary points. Keep the title short. Never copy the field descriptions below as values.
16. Every listed JSON field is mandatory. Do not omit work_quote or comparison. Copy the decisive complete source statement without correcting spelling or removing negation/conditions. Do not add a description, advice, document IDs or a self-certified relation; the system builds the result from verified source facts.
17. For פעולה לביצוע use that category spelling exactly. Unless the action itself conflicts with the contract, set contract_quote=null.
18. Extract each side separately. A price excerpt, measurement, payment claim, request, proposal, response or event is not an operative instruction merely because it contains a material or a number. A measurement/payment rule does not select the material. Initial schedule submission and routine monthly updates can coexist.
19. For each extraction, subject/value/scope/location/party/condition/period must be exact phrases in that side's quote and refer to the same assertion. party means the party obligated, not the author. Use null when absent. Never take a value from a different product or clause. The server verifies these spans and the comparison; do not return a relation or confidence score.
20. An unsigned copy is not automatically a draft, refusal or binding replacement. Distinguish a requested change from a decision; do not infer signatures, dates or final authority. A rejection remains a rejection, not an agreement. A warning is an attributed claim, not admitted fault or proved damage.
21. Compare the demand itself against its governing rule. A general project rule or an incorporated reference may apply without naming MTM or the street. Keep method authority, required written approval, signature, response period and price/waiver conditions separate. Permission to change a method does not prove power to impose a price or waive claims. An instruction explicitly bypassing required approval, or a response demand below an explicit permitted minimum with the same clock and units, can be incompatible. Preserve all qualifications. Source availability alone does not establish applicability or precedence.

Allowed roles: ${STATEMENT_ROLES.join(' | ')}.
Allowed attributes: ${COMPARISON_ATTRIBUTES.join(' | ')}.

Return an array containing zero or one object with exactly these fields:
[
  {
    "title": "brief Hebrew title",
    "category": "סתירה | שינוי/חריג | אירוע שטח | חוסר נתונים | אין התאמה ישירה | פעולה לביצוע",
    "contract_quote": "verbatim contract/BOQ/spec quote or null",
    "work_quote": "verbatim quote from the current work document",
    "comparison": {
      "work": {"role":"INSTRUCTION","subject":"exact subject phrase","attribute":"OTHER","value":null,"scope":null,"location":null,"party":null,"condition":null,"period":null},
      "baseline": null
    }
  }
]
When contract_quote is not null, baseline must be an extraction object with the same nine fields as work, using that contract quote only. Use OTHER/UNKNOWN when the source meaning cannot be established. Empty or partial JSON is an error; only [] explicitly means no finding.`;
}

export function assessContractScanFinding(params: {
    finding: ContractScanFinding;
    currentWorkDocument: ContractScanDocument;
    contractDocuments: ContractScanDocument[];
}) {
    const { finding, currentWorkDocument, contractDocuments } = params;
    const title = cleanText(finding.title);
    const description = cleanText(finding.description);
    const advice = cleanText(finding.advice);
    let category = cleanText(finding.category);
    const workQuote = normalizeEvidenceText(typeof finding.work_quote === 'string' ? finding.work_quote : '');
    const contractQuote = normalizeEvidenceText(typeof finding.contract_quote === 'string' ? finding.contract_quote : '');
    const workDocumentId = cleanText(finding.work_document_id);
    const contractDocumentId = cleanText(finding.contract_document_id);
    const contractDocument = contractDocumentId
        ? contractDocuments.find((document) => document.id === contractDocumentId) || null
        : null;
    const workQuoteMatched = quoteExistsInSource(
        String(currentWorkDocument.extracted_text || ''),
        workQuote,
    );
    const contractQuoteMatched = Boolean(
        contractDocument
        && contractQuote
        && quoteExistsInSource(String(contractDocument.extracted_text || ''), contractQuote)
    );
    const workSourceAnchor = workQuoteMatched && workDocumentId === currentWorkDocument.id
        ? findEvidenceAnchor(currentWorkDocument, workQuote) : null;
    let contractSourceAnchor = contractQuoteMatched && contractDocument
        ? findEvidenceAnchor(contractDocument, contractQuote) : null;
    const isComparisonCategory = category === 'סתירה' || category === 'שינוי/חריג';
    const requiresContractEvidence = category === 'סתירה'
        || (category === 'שינוי/חריג' && !hasInlineInstructionReplacement(finding));
    const reasons: string[] = [];
    const verificationReasons: string[] = [];
    const workReading = assessDocumentSourceReadiness(currentWorkDocument);
    const contractReading = contractDocument ? assessDocumentSourceReadiness(contractDocument) : null;
    if (!workReading.canCompare || (contractReading && !contractReading.canCompare)) verificationReasons.push('source_reading_incomplete');
    if (finding.context_selection && typeof finding.context_selection === 'object') {
        const context = finding.context_selection as { complete?: unknown };
        if (context.complete === false) verificationReasons.push('comparison_context_incomplete');
    }
    if (Array.isArray(finding.source_binding_issues)) reasons.push(...finding.source_binding_issues.filter((value): value is string => typeof value === 'string'));
    if (contractDocumentId && Array.isArray(finding.supplied_contract_document_ids)
        && !finding.supplied_contract_document_ids.includes(contractDocumentId)) reasons.push('contract_source_not_supplied');
    const context = finding.context_selection as ComparisonContextSelection | undefined;
    if (contractDocument && contractQuoteMatched && context?.version === 'source-context-v1' && Array.isArray(context.sources)) {
        const source = context.sources.find(source => source.documentId === contractDocumentId);
        const anchors = source?.selection?.source_anchors;
        const matches = Array.isArray(anchors) ? anchors.filter(anchor => anchor.documentId === contractDocumentId
            && String(contractDocument.extracted_text || '').slice(anchor.start, anchor.end) === anchor.quote)
            .map(anchor => findEvidenceAnchor(contractDocument, contractQuote, anchor)).filter(anchor => anchor !== null) : [];
        if (matches.length === 0) reasons.push('contract_quote_not_in_supplied_context');
        else {
            contractSourceAnchor = matches[0];
            if (matches.length > 1) contractSourceAnchor.page = null;
        }
    }
    const replyDeadline = assessContractualReplyDeadline({ contractQuote, workQuote });
    const comparison = finding.comparison as { work?: EvidenceClaimExtraction; baseline?: EvidenceClaimExtraction } | undefined;
    let evidenceRelation = assessEvidenceRelation({
        work: { document: currentWorkDocument, quote: typeof finding.work_quote === 'string' ? finding.work_quote : '',
            anchor: workSourceAnchor, extraction: comparison?.work },
        baseline: contractDocument && contractQuote ? { document: contractDocument,
            quote: typeof finding.contract_quote === 'string' ? finding.contract_quote : '',
            anchor: contractSourceAnchor, extraction: comparison?.baseline } : null,
    });
    // Calendar breach uses the independent receipt/recipient/deadline proof above,
    // rather than comparing a response date with an unrelated numeric duration.
    const invalidExtraction = evidenceRelation.reasons.some(reason =>
        reason === 'semantic_field_not_grounded' || reason === 'context_dimension_not_established');
    if (replyDeadline.proven && workQuoteMatched && contractQuoteMatched && !invalidExtraction) evidenceRelation = { ...evidenceRelation,
        relation: 'INCOMPATIBLE', resultType: 'CONTRADICTION', attribute: 'REPLY_DEADLINE', reasons: ['documented_response_deadline_breached'] };
    if ((isComparisonCategory || category === 'חוסר נתונים') && evidenceRelation.resultType === 'NEEDS_VERIFICATION') {
        verificationReasons.push(...evidenceRelation.reasons);
        category = 'חוסר נתונים';
    } else if (evidenceRelation.resultType === 'CONTRADICTION') category = 'סתירה';
    else if (evidenceRelation.resultType === 'KNOWN_CHANGE') category = 'שינוי/חריג';
    const presentation = findingPresentation(evidenceRelation, workQuote, contractQuote);

    if (!title || !description || !advice) reasons.push('missing_required_text');
    if (isTemplatePlaceholderFinding(finding)) reasons.push('template_placeholder');
    if (!ALLOWED_CATEGORIES.has(category)) reasons.push('unsupported_category');
    if (workDocumentId !== currentWorkDocument.id) reasons.push('wrong_work_document');
    if (!workQuoteMatched) reasons.push('work_quote_not_found');
    // The product's own source-derived title may use normalized property names.
    // Revalidating that title must not depend on the old word-overlap heuristic.
    const unresolvedCompletionBasis = evidenceRelation.reasons.includes('completion_deadline_basis_not_established');
    if (!isComparisonCategory && !unresolvedCompletionBasis && contractQuoteMatched && !contractAndWorkEvidenceAreRelated(finding)) {
        verificationReasons.push('unrelated_optional_contract_source');
    }
    if (workQuoteMatched && title !== presentation.title && !unresolvedCompletionBasis && evidenceRelation.relation !== 'INCOMPATIBLE'
        && !titleAndEvidenceAreRelated(finding, isComparisonCategory && contractQuoteMatched)) {
        reasons.push('title_evidence_unrelated');
    }
    if (contractDocumentId && !contractDocument) reasons.push('contract_document_not_found');
    if (contractQuote && !contractQuoteMatched) reasons.push('contract_quote_not_found');
    if (requiresContractEvidence && (!contractDocument || !contractQuoteMatched)) {
        reasons.push('contract_evidence_required');
    }
    if (isComparisonCategory && contractQuoteMatched && !contractAndWorkEvidenceAreRelated(finding)
        && evidenceRelation.relation !== 'INCOMPATIBLE' && evidenceRelation.resultType !== 'KNOWN_CHANGE' && !unresolvedCompletionBasis) {
        reasons.push('contract_evidence_unrelated');
    }
    if (isComparisonCategory && contractQuoteMatched && comparisonConcernsDifferentAttributes(finding)
        && evidenceRelation.relation !== 'INCOMPATIBLE') {
        reasons.push('different_comparison_attributes');
    }
    if (isComparisonCategory && contractQuoteMatched
        && /:\s*$|(?:כמפורט|למפורט)\s+(?:מטה|להלן)\s*:?\s*$/u.test(contractQuote)) {
        reasons.push('contract_quote_incomplete');
    }
    if (cleanText(finding.category) === 'סתירה' && contractQuoteMatched && quotesDescribeTheSameNoticePeriod(finding)) {
        reasons.push('same_documented_requirement');
    }
    if (isComparisonCategory && replyDeadline.applicable && !replyDeadline.proven) {
        reasons.push('response_deadline_not_proven');
    }
    if (isComparisonCategory && !replyDeadline.proven && describesOrdinaryApprovalWorkflow(finding)) {
        reasons.push('ordinary_approval_workflow');
    }
    if (isComparisonCategory && !replyDeadline.proven && describesConsiderationWithoutInstruction(finding)) {
        reasons.push('consideration_without_instruction');
    }
    if (isComparisonCategory && ['COMPATIBLE', 'DIFFERENT_SUBJECT'].includes(evidenceRelation.relation)) {
        reasons.push(...evidenceRelation.reasons);
    }
    if (evidenceRelation.reasons.includes('semantic_field_not_grounded')) reasons.push('semantic_field_not_grounded');

    return {
        accepted: reasons.length === 0,
        reasons: [...new Set(reasons)],
        category,
        workQuoteMatched,
        contractQuoteMatched,
        contractDocument,
        workSourceAnchor,
        contractSourceAnchor,
        evidenceRelation,
        presentation,
        evidenceStatus: reasons.length === 0 && verificationReasons.length === 0 && evidenceRelation.relation === 'INCOMPATIBLE'
            && contractQuoteMatched ? 'VERIFIED' : 'REQUIRES_VERIFICATION',
        verificationReasons,
        replyDeadline: replyDeadline.applicable ? replyDeadline : null,
    };
}

function findingPresentation(result: EvidenceRelationAssessment, workQuote: string, contractQuote: string) {
    const labels: Record<string, string> = { CEMENT_CONTENT: 'שיעור הצמנט במילוי', MATERIAL: 'חומר המילוי', DIAMETER: 'קוטר הצינור',
        WARRANTY_DURATION: 'תקופת האחריות', NOTICE_PERIOD: 'תקופת ההודעה', CONTRACT_DURATION: 'תקופת הביצוע',
        DELAY_DURATION: 'טענה לעיכוב בלוח הזמנים', COMPLETION_DEADLINE: 'בסיס מועד השלמת העבודות',
        INITIAL_SCHEDULE_SUBMISSION: 'הגשת לוח הזמנים', SCHEDULE_UPDATE: 'עדכון לוח הזמנים',
        APPROVAL_REQUIREMENT: 'דרישת האישור', METHOD: 'שיטת הביצוע', REPLY_DEADLINE: 'מועד המענה החוזי' };
    const property = labels[result.attribute || result.work.attribute] || 'השוואת הדרישות';
    const label = result.work.subjectQuote ? `${result.work.subjectQuote} — ${property}` : property;
    const title = result.resultType === 'CONTRADICTION' ? `דרישות סותרות: ${label}`
        : result.resultType === 'KNOWN_CHANGE' ? `${result.work.role === 'REQUEST' ? 'בקשה לשינוי' : 'שינוי מתועד'}: ${label}`
            : result.resultType === 'EVENT' ? 'אי התאמה מתועדת במסמך הביצוע'
            : result.work.attribute === 'DELAY_DURATION' ? 'טענה לעיכוב — אין השוואה לתקופת הביצוע'
                : result.resultType === 'NEEDS_VERIFICATION' ? `${label} — נדרש ביסוס להשוואה`
                    : result.relation === 'COMPATIBLE' ? `${label} — תנאים משלימים או תואמים` : 'הציטוטים עוסקים בנושאים או בהיבטים שונים';
    return { title, description: `במסמך הביצוע נכתב: «${workQuote}».${contractQuote ? ` במקור החוזי נכתב: «${contractQuote}».` : ''}` };
}

export function assertGeneratedScanSources(input: {
    findings: ContractScanFinding[]; currentWorkDocument: ContractScanDocument; contractDocuments: ContractScanDocument[];
}) {
    const sourceErrors = new Set(['work_quote_not_found', 'contract_quote_not_found', 'contract_document_not_found',
        'wrong_work_document', 'semantic_field_not_grounded', 'ambiguous_contract_source', 'contract_source_not_supplied',
        'contract_quote_not_in_supplied_context']);
    for (const proposal of input.findings) {
        const finding = groundContractScanFinding({ ...input, finding: proposal });
        const assessment = assessContractScanFinding({ ...input, finding });
        const errors = assessment.reasons.filter(reason => sourceErrors.has(reason));
        if (errors.length) throw new Error(`Invalid generated source evidence: ${errors.join(', ')}`);
    }
}

export function sourceVerificationMissingEvidence(reasons: string[]) {
    const messages: Record<string, string> = {
        source_reading_incomplete: 'קריאת מסמך המקור לא הושלמה או שגרסתו דורשת בירור',
        comparison_context_incomplete: 'הקטעים שנבחרו להשוואה אינם כוללים את מלוא ההקשר הנדרש; יש לבדוק את מגבלות הבחירה',
        unrelated_optional_contract_source: 'ההפניה השמורה למקור החוזי אינה מוכיחה קשר לנושא; לא הוחלפה אוטומטית',
        completion_deadline_basis_not_established: 'יש לבדוק את הסכם המקדמה, צו התחלת העבודה ובסיס מועד הסיום לפני קביעה שקיימת סתירה',
        different_or_unproved_conditions: 'תנאי תחולת הדרישות אינם מוכחים או שונים; לא נקבעה סתירה מאומתת',
        context_dimension_not_established: 'לא הוכחה התאמה של היקף העבודה, המקום, הצד או התקופה בין הדרישות',
        semantic_fields_not_established: 'הציטוטים נמצאו אך תפקיד האמירה או המאפיין שהוצע להשוואה לא הוכחו; נדרשת בדיקה',
        subject_or_attribute_not_established: 'לא הוכח שהמקורות משווים את אותה עבודה ואת אותו מאפיין',
        operative_requirements_not_established: 'לא הוכחו שתי דרישות מחייבות; יש להבחין בין בקשה, הצעה, אירוע והוראה',
        numeric_value_not_unambiguous: 'הערך המספרי או יחידתו אינם חד משמעיים; אין להסיק סתירה ממספרים בלבד',
        units_not_comparable: 'יחידות המדידה אינן ניתנות להשוואה על סמך המקורות הקיימים',
        incompatibility_not_established: 'לא הוכח שלא ניתן לקיים את הדרישות יחד',
        compound_request_conditions_not_established: 'נמצא בסיס לחלק מהדרישה; יתר התנאים, לרבות מחיר או ויתור, לא הוכחו',
        method_authority_does_not_establish_price_or_waiver: 'סמכות לשינוי שיטה אינה מוכיחה סמכות לקבוע מחיר ללא תוספת או לדרוש ויתור; נדרש בסיס נפרד לתנאי המסוים',
    };
    return [...new Set(reasons.flatMap(reason => messages[reason] ? [messages[reason]] : []))];
}

export function evaluateHydrantTimelineResult(findings: ContractScanFinding[]) {
    const forbiddenContradiction = findings.some((finding) => cleanText(finding.category) === 'סתירה');
    const currentAction = findings.find((finding) => {
        const combined = `${cleanText(finding.title)} ${cleanText(finding.description)} ${cleanText(finding.advice)} ${cleanText(finding.work_quote)}`;
        return cleanText(finding.category) === 'פעולה לביצוע'
            && /אזור|אזורים/.test(combined)
            && /ספק|ספקים/.test(combined);
    });

    return {
        passed: !forbiddenContradiction && !currentAction,
        forbiddenContradiction,
        currentActionFound: Boolean(currentAction),
    };
}
