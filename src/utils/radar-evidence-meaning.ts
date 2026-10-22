// Source-backed construction facts. Unknown wording stays unknown; model labels
// never establish an obligation, a value, or a conflict by themselves.
export const STATEMENT_ROLES = ['INSTRUCTION', 'CONTRACT_RULE', 'REQUEST', 'PROPOSAL', 'PRICE', 'MEASUREMENT',
    'PAYMENT_CLAIM', 'RESPONSE', 'DECISION', 'EVENT', 'UNKNOWN'] as const;
export const COMPARISON_ATTRIBUTES = ['CEMENT_CONTENT', 'MATERIAL', 'DIAMETER', 'WARRANTY_DURATION', 'NOTICE_PERIOD',
    'CONTRACT_DURATION', 'DELAY_DURATION', 'COMPLETION_DEADLINE', 'INITIAL_SCHEDULE_SUBMISSION', 'SCHEDULE_UPDATE',
    'APPROVAL_REQUIREMENT', 'PAYMENT_MEASUREMENT', 'PRICE', 'METHOD', 'QUALITY_CONTROL', 'UTILITY_SURVEY',
    'SITE_CUSTODY', 'ROAD_DEMOLITION', 'ASPHALT_JOINT', 'INSURANCE_LIMIT', 'INSURANCE_RETROACTIVE_DATE', 'FIELD_PROGRESS', 'OTHER'] as const;
export type StatementRole = typeof STATEMENT_ROLES[number];
export type ComparisonAttribute = typeof COMPARISON_ATTRIBUTES[number];
export type EvidenceClaimExtraction = {
    role: StatementRole;
    subject: string;
    attribute: ComparisonAttribute;
    value: string | null;
    scope: string | null;
    location: string | null;
    party: string | null;
    condition: string | null;
    period: string | null;
};
export const EVIDENCE_CLAIM_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['role', 'subject', 'attribute', 'value', 'scope', 'location', 'party', 'condition', 'period'],
    properties: {
        role: { type: 'string', enum: STATEMENT_ROLES }, subject: { type: 'string', minLength: 1, maxLength: 100 },
        attribute: { type: 'string', enum: COMPARISON_ATTRIBUTES },
        ...Object.fromEntries(['value', 'scope', 'location', 'party', 'condition', 'period']
            .map(key => [key, { type: ['string', 'null'], maxLength: 120 }])),
    },
} as const;

export type NumericConstraint = { min: number | null; max: number | null; unit: string; quote: string };
export type EvidenceMeaning = {
    role: StatementRole;
    subject: string;
    subjectQuote: string;
    object: string | null;
    modality: 'REQUIRE' | 'FORBID' | 'REPORT';
    attribute: ComparisonAttribute;
    constraint: NumericConstraint | null;
    materialOptions: string[];
    scope: string | null;
    location: string | null;
    party: string | null;
    condition: string | null;
    period: string | null;
    approvalRequired: boolean | null;
    inlineReplacement: boolean;
    ambiguous: boolean;
    statement: string;
};

const INSTRUCTION = /דורש|דורשת|דרש|נדרש|נדרשת|מחויב|מחוייב|חייב|מתחייב|על הקבלן|יש לבצע|תבוצע|יבוצע|יהיה|תהיה|יהיו|יגיש|יוגש|תוגש|ימסור|נאסר|אסור|אין צורך|לא נדרש|\b(?:must|shall|requires?|instructed|prohibited|no approval)\b/iu;
const REQUEST = /(?:פנה|פנתה).{0,25}בבקשה|מבקש|מבקשת|ביקש|ביקשה|\brequest(?:ed|s)?\b/iu;
const PROPOSAL = /מוכן לשקול|מוכנה לשקול|נשקלה|הוצע|מוצע|הצעה|תיבחן|לשקול|\b(?:propos(?:ed|al)|willing to consider|may consider)\b/iu;
const REPLACEMENT = /(?:לשנות|שונתה|להחליף|הוחלף|הוחלפה).{0,90}\sמ[\p{L}\p{N}].{3,300}\sל[\p{L}\p{N}]|\b(?:change|replace)(?:d)?.{0,70}\bfrom\s+.+\s+to\s+/iu;

function numericConstraint(text: string, attribute: ComparisonAttribute): NumericConstraint | null {
    const pattern = attribute === 'CEMENT_CONTENT' ? /(\d+(?:[.,]\d+)?)\s*(%|percent)/giu
        : attribute === 'DIAMETER' ? /(\d+(?:[.,]\d+)?)\s*(מ["״]?מ|ס["״]?מ|מטר(?:ים)?|mm|cm|met(?:er|re)s?)/giu
            : /(\d+(?:[.,]\d+)?)\s*(?:\([^)]*\)\s*)?(שנים|שנה|חודשים|חודש|ימים|יום|years?|months?|days?)(?!\p{L})/giu;
    const constraints: NumericConstraint[] = [];
    for (const match of text.matchAll(pattern)) {
        if (/\d\s+$/u.test(text.slice(Math.max(0, match.index - 5), match.index))) continue; // e.g. OCR "9 1 חודשים"
        const amount = Number(match[1].replace(',', '.'));
        const unitText = match[2].toLowerCase();
        const years = /שנים|שנה|years?/u.test(unitText);
        const months = /חודשים|חודש|months?/u.test(unitText);
        const millimetres = /מ["״]?מ|^mm$/u.test(unitText);
        const centimetres = /ס["״]?מ|^cm$/u.test(unitText);
        const metres = /מטר|met(?:er|re)/u.test(unitText);
        const unit = /%|percent/u.test(unitText) ? 'percent' : years || months ? 'months'
            : millimetres || centimetres || metres ? 'mm' : 'days';
        const factor = years ? 12 : centimetres ? 10 : metres ? 1000 : 1;
        const value = amount * factor;
        const before = text.slice(Math.max(0, match.index - 35), match.index);
        const range = before.match(/(\d+(?:[.,]\d+)?)\s*(?:[-–—־]|עד|to)\s*$/iu);
        if (range) {
            const lower = Number(range[1].replace(',', '.')) * factor;
            if (lower > value) return null;
            constraints.push({ min: lower, max: value, unit, quote: `${range[0]}${match[0]}` });
            continue;
        }
        const minimum = /לפחות\s*$|לא פחות מ[־-]?\s*$|\bat least\s*$/iu.test(before);
        const maximum = /עד\s*$|לכל היותר\s*$|לא יותר מ[־-]?\s*$|(?:בתוך|תוך)\s*$|\b(?:at most|within)\s*$/iu.test(before);
        constraints.push({ min: maximum ? null : value, max: minimum ? null : value, unit, quote: match[0] });
    }
    const unique = constraints.filter((item, index) => constraints.findIndex(other =>
        item.min === other.min && item.max === other.max && item.unit === other.unit) === index);
    return unique.length === 1 ? unique[0] : null;
}

function materialOptions(text: string) {
    const materials: string[] = [];
    if (/\bCLSM\b/iu.test(text)) materials.push('CLSM');
    if (/חול\s+(?:מצומנט|מיוצב)|cement(?:ed|[- ]stabili[sz]ed) sand/iu.test(text)) materials.push('CEMENTED_SAND');
    else if (/חול|\bsand\b/iu.test(text)) materials.push('SAND');
    if (/חומר\s+(?:מילוי\s+)?אינרטי|inert (?:fill|material)/iu.test(text)) materials.push('INERT_FILL');
    return materials;
}

function scopeOf(text: string) {
    if (/מעל\s+(?:ל)?עטיפת\s+(?:ה)?צינור|above (?:the )?pipe surround/iu.test(text)) return 'UPPER_BACKFILL';
    if (/סביב\s+(?:ה)?צינור|עטיפת\s+(?:ה)?צינור|pipe surround|pipe bedding/iu.test(text)) return 'PIPE_SURROUND';
    if (/מילוי\s+תחתון|lower (?:bulk )?fill/iu.test(text)) return 'LOWER_FILL';
    if (/(?<!\p{L})(?:[הבלו]?זמני(?:ת|ים|ות)?|temporary)(?!\p{L})/iu.test(text)) return 'TEMPORARY';
    if (/(?<!\p{L})(?:[הבלו]?קבוע(?:ה|ים|ות)?|permanent)(?!\p{L})/iu.test(text)) return 'PERMANENT';
    return null;
}

function obligatedParty(text: string) {
    // The author of a demand is not necessarily the party who must perform it.
    const recipient = text.match(/(?:דורש|דורשת|דרש|דרשה)\s+מ(הקבלן|המפקח|המתכנן|המזמין)/u)?.[1];
    const subject = text.match(/(הקבלן|המפקח|המתכנן|המזמין)\s+(?:נדרש|נדרשת|מחויב|מחוייב|חייב|מתחייב|יגיש|ימסור)/u)?.[1];
    return recipient || subject || text.match(/(?:על|מאת|מיום קבלת הבקשה אצל)\s+(הקבלן|המפקח|המתכנן|המזמין)/u)?.[1] || null;
}

function subjectOf(text: string): { id: string; quote: string } {
    const patterns: Array<[string, RegExp]> = [
        ['SCHEDULE', /לוח(?:ות)?\s+(?:ה)?זמנים|לו["״]ז|תקופת\s+(?:ה)?ביצוע|השלמת\s+(?:ה)?עבודות|להשלים.{0,35}(?:עבודות|פרויקט)|schedule|contract duration/iu],
        ['FILL', /חומר\s+(?:ה)?מילוי|חומר\s+אינרטי|מילוי\s+(?:ה)?תעלות|מילוי\s+חוזר|עטיפת\s+(?:ה)?צינור|סביב\s+(?:ה)?צינור|pipe surround|pipe bedding|(?:trench|inert|bulk) fill/iu],
        ['QUALITY', /הבטחת\s+איכות|quality assurance|quality control/iu],
        ['UTILITIES', /תשתיות\s+(?:ה)?קיימות|existing utilities/iu],
        ['CURB_MACHINE', /מכונה.{0,45}אבן שפה|מכונה|curb.{0,30}machine/iu],
        ['HYDRANTS', /הידרנט(?:ים)?|hydrants?/iu],
        ['DRILLING', /קידוח|שיטת\s+(?:ה)?חפירה|drilling/iu],
        ['INSURANCE', /ביטוח|ביטוחים|insurance/iu],
        ['WARRANTY', /אחריות.{0,60}אביזרי|אחריות.{0,60}מתוצרת|אחריות.{0,60}מוצר|warranty/iu],
        ['SITE', /שמירת\s+(?:ה)?אתר|אתר.{0,30}גניב|site safekeeping/iu],
        ['ROAD', /פירוק.{0,35}כביש|מישק.{0,30}אספלט|road demolition|asphalt.{0,20}joint/iu],
        ['DAYWORK', /עבודות יומיות|עבודות חריגות|dayworks?|extra works?/iu],
        ['WATER_WORK', /הנחת צינורות|עבודות.{0,25}(?:ה)?מים|water works?/iu],
        ['PIPE', /(?:ה)?צינור|\bpipe\b/iu],
    ];
    for (const [id, pattern] of patterns) {
        const match = text.match(pattern);
        if (match) return { id, quote: match[0] };
    }
    return { id: 'UNKNOWN', quote: '' };
}

function attributeOf(text: string, subject: string): ComparisonAttribute {
    if (/רטרואקטיב|retroactive/iu.test(text)) return 'INSURANCE_RETROACTIVE_DATE';
    if (/גבול(?:ות)?\s+(?:ה)?אחריות|liability limit|coverage limit/iu.test(text)) return 'INSURANCE_LIMIT';
    if (/הודעה|נודיע|notice/iu.test(text) && /יום|ימים|days?/iu.test(text)) return 'NOTICE_PERIOD';
    if (/שמירת\s+(?:ה)?אתר|site safekeeping/iu.test(text)) return 'SITE_CUSTODY';
    if (/מישק.{0,30}התחברות|asphalt.{0,20}joint/iu.test(text)) return 'ASPHALT_JOINT';
    if (/פירוק.{0,50}(?:כביש|מדרכות|אספלט)|road demolition/iu.test(text)) return 'ROAD_DEMOLITION';
    if (subject === 'SCHEDULE') {
        if (/הסכם המקדמה|מועד להשלמת|completion deadline/iu.test(text)) return 'COMPLETION_DEADLINE';
        if (/עיכוב|איחור|delay/iu.test(text)) return 'DELAY_DURATION';
        if (/תקופת\s+(?:ה)?ביצוע|contract duration/iu.test(text)) return 'CONTRACT_DURATION';
        if (/מעודכן|עדכון|בכל חודש|monthly|update/iu.test(text)) return 'SCHEDULE_UPDATE';
        if (/יגיש|להגיש|הגשת|submit/iu.test(text)) return 'INITIAL_SCHEDULE_SUBMISSION';
    }
    if (subject === 'QUALITY') return 'QUALITY_CONTROL';
    if (subject === 'UTILITIES') return 'UTILITY_SURVEY';
    if (subject === 'WARRANTY' && /שנים|שנה|חודש|years?|months?/iu.test(text)) return 'WARRANTY_DURATION';
    if (/יחידת\s+(?:ה)?מידה|אופני מדידה|unit of measure|measurement/iu.test(text)) return 'PAYMENT_MEASUREMENT';
    if (/קוטר|diameter/iu.test(text)) return 'DIAMETER';
    if (subject === 'FILL' && /\d\s*%|\d\s*percent/iu.test(text) && /מצומנט|מיוצב|cement/iu.test(text)) return 'CEMENT_CONTENT';
    if (/לאישור|אישור|שיאושר|שייפסל|approval/iu.test(text) && ['FILL', 'CURB_MACHINE', 'HYDRANTS'].includes(subject)) return 'APPROVAL_REQUIREMENT';
    if (subject === 'FILL' && materialOptions(text).length) return 'MATERIAL';
    if (subject === 'DRILLING') return 'METHOD';
    if (subject === 'DAYWORK') return 'PRICE';
    if (/עצירה|הופסק|stopp(?:ed|age)/iu.test(text)) return 'FIELD_PROGRESS';
    return 'OTHER';
}

export function readEvidenceMeaning(text: string, baseline = false): EvidenceMeaning {
    const parts = text.split(/;|\n+|,\s*(?:אך|אבל|אולם|but)\s+|(?<=[^\d])\.\s+/iu).map(value => value.trim()).filter(Boolean);
    const instructed = parts.filter(part => INSTRUCTION.test(part) && !REQUEST.test(part) && !PROPOSAL.test(part));
    const identified = instructed.filter(part => subjectOf(part).id !== 'UNKNOWN');
    const statement = identified.at(-1) || parts.find(part => subjectOf(part).id !== 'UNKNOWN') || instructed.at(-1) || text;
    const subject = subjectOf(statement);
    const attribute = attributeOf(statement, subject.id);
    const isPrice = /(?:המחיר|מחיר|price).{0,80}\d[\d.,\s]*|\d[\d.,\s]*(?:ש["״]ח|₪|NIS)/iu.test(statement)
        && !INSTRUCTION.test(statement);
    const waivedRequirement = /לא נדרש|אין צורך|\bnot required\b/iu.test(statement) && attribute !== 'APPROVAL_REQUIREMENT';
    const role: StatementRole = REQUEST.test(statement) ? 'REQUEST' : PROPOSAL.test(statement) && !instructed.length ? 'PROPOSAL'
        : waivedRequirement ? 'UNKNOWN' : /דרישת תשלום|חשבון לתשלום|payment claim/iu.test(statement) ? 'PAYMENT_CLAIM'
            : attribute === 'PAYMENT_MEASUREMENT' || /מדידה|כמות שבוצעה|measured quantity/iu.test(statement) ? 'MEASUREMENT'
                : isPrice ? 'PRICE'
                    : /(?:עיכוב|איחור|עצירה).{0,50}|(?:לא|טרם) הושלמו|בבדיקה נמצא|נמצא כי|תועד כי|\b(?:delay|stoppage|observed|measured)\b/iu.test(statement) && !INSTRUCTION.test(statement) ? 'EVENT'
                        : INSTRUCTION.test(statement) ? baseline ? 'CONTRACT_RULE' : 'INSTRUCTION'
                            : /אושר|אושרה|הוחלט|approved|decided/iu.test(statement) && !/טרם|לא |יאושר|בכפוף/iu.test(statement) ? 'DECISION'
                                : /בתשובה|במענה|נמסר בתגובה|\bin (?:reply|response)\b/iu.test(statement) ? 'RESPONSE'
                                    : baseline && attribute !== 'OTHER' ? 'CONTRACT_RULE' : 'UNKNOWN';
    const approvalRequired = /אין צורך.{0,20}אישור|לא נדרש.{0,20}אישור|no approval.{0,20}required/iu.test(statement) ? false
        : /לאישור|שיאושר|שייפסל|אישור|approval/iu.test(statement) ? true : null;
    const numeric = ['CEMENT_CONTENT', 'DIAMETER', 'WARRANTY_DURATION', 'NOTICE_PERIOD', 'CONTRACT_DURATION', 'DELAY_DURATION', 'INITIAL_SCHEDULE_SUBMISSION'].includes(attribute);
    const warrantyProduct = statement.match(/(?:אביזרי|fittings)\s+([\p{L}\d_-]+)/iu)?.[1]?.toLowerCase() || null;
    const object = subject.id === 'WARRANTY' ? warrantyProduct && !/^(?:ה?צנרת|ה?צינורות|כל|the|all|for|and)$/iu.test(warrantyProduct) ? warrantyProduct : null
        : /(?<!\p{L})(?:[הבלו]?ביוב|sewer)(?!\p{L})/iu.test(statement) && !/(?<!\p{L})(?:ה?מים|water)(?!\p{L})/iu.test(statement) ? 'SEWER'
            : /(?<!\p{L})(?:ה?מים|water)(?!\p{L})/iu.test(statement) && !/(?<!\p{L})(?:[הבלו]?ביוב|sewer)(?!\p{L})/iu.test(statement) ? 'WATER' : null;
    return { role, subject: subject.id, subjectQuote: subject.quote, object,
        modality: /אסור|נאסר|אין להשתמש|must not|shall not|prohibit/iu.test(statement) ? 'FORBID'
            : ['INSTRUCTION', 'CONTRACT_RULE', 'DECISION'].includes(role) ? 'REQUIRE' : 'REPORT', attribute,
        constraint: numeric ? numericConstraint(statement, attribute) : null, materialOptions: materialOptions(statement),
        scope: scopeOf(statement), location: statement.match(/(?:ב)?רחוב\s+["״]?([\p{L}-]+)/u)?.[1]?.replace(/^ה/u, '') || null,
        party: obligatedParty(statement),
        condition: statement.match(/(?:בכפוף|בתנאי|ובלבד|subject to|provided that|(?<!\p{L})ו?אם(?!\p{L})|\bif\b).{0,100}/iu)?.[0] || null,
        period: /ממועד\s+(?:ה)?מסירה|from (?:the )?handover/iu.test(statement) ? 'FROM_HANDOVER'
            : /ממועד\s+צו\s+התחלת\s+(?:ה)?עבודה|from (?:the )?work order/iu.test(statement) ? 'FROM_WORK_ORDER'
                : statement.match(/(?:בשנת|לשנת|during)\s+\d{4}/iu)?.[0] || null,
        approvalRequired, inlineReplacement: REPLACEMENT.test(text),
        ambiguous: numeric && numericConstraint(statement, attribute) === null,
        statement,
    };
}
