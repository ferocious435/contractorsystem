// Pairwise meaning checks. Source applicability and evidence anchors are checked
// by the caller; a shared word or a proposed label is never a permission.
export type RequirementKind = 'METHOD_CHANGE' | 'SIGN_ANNEX' | 'BINDING_ANNEX' | 'NO_EXTRA_PAYMENT' | 'SUBMIT_PRICE' | 'RESPOND' | 'WAIVE_CLAIMS';
export type RequirementStatementResult = { relation: 'INCOMPATIBLE' | 'COMPATIBLE' | 'UNESTABLISHED'; reason: string };
const clean = (value: string) => value.replace(/[\u200e\u200f\u202a-\u202e]/gu, '').replace(/\s+/gu, ' ').trim();
export function isUnexecutedAnnexForm(value: string) {
    const header = clean(value.slice(0, 650));
    return /^[:\s]*נספח ל(?:חוזה|הסכם)/u.test(header) && /שנחתם.{0,55}_{3,}|ביום\s*_{3,}/u.test(header);
}
export const isConditionalRequirement = (value: string) => /ככל|בכפוף|בתנאי|במידה (?:ו|ש)|אם (?:לא|כן|ה|י)|לפי בחירת|רשאי לבחור/u.test(clean(value));

export function requirementKinds(value: string): RequirementKind[] {
    const text = clean(value), kinds: RequirementKind[] = [];
    if (/(?:לבצע|יבצע|לביצוע|בשיטת|שיטת הביצוע|שיטת הקידוח|המעבר משיטת)/u.test(text)
        && /(?<!\p{L})(?:מורה|הורה|נדרש|עליו|על הקבלן|יבצע|יש לבצע|חייב|מתחייב|ככל שהקבלן מעוניין)(?!\p{L})/u.test(text)) kinds.push('METHOD_CHANGE');
    if (/לחתום|להשלים.{0,25}חתימ|נדרש.{0,15}חתימ|נדרשת חתימ/u.test(text)) kinds.push('SIGN_ANNEX');
    if (/(?:נספח|מסמכ).{0,100}מחייב/u.test(text)) kinds.push('BINDING_ANNEX');
    if (/לא תשולם.{0,15}תוספת|ללא תוספת (?:מחיר|תשלום)|לא יחול כל שינוי בתמורה/u.test(text)) kinds.push('NO_EXTRA_PAYMENT');
    if (/(?:להגיש|להעביר|יגיש|נדרש).{0,35}ניתוח מחיר/u.test(text)) kinds.push('SUBMIT_PRICE');
    if (/(?:להעביר|יעביר|נבקש|נשמח|להשיב).{0,55}(?:תשוב|תגוב|מענה|אישור מפורש)/u.test(text)) kinds.push('RESPOND');
    if (/מוותר.{0,25}(?:טענ|תביע|דריש)|ויתור על.{0,25}(?:טענ|תביע)/u.test(text)) kinds.push('WAIVE_CLAIMS');
    return kinds;
}

export function ruleConcerns(kind: RequirementKind, value: string) {
    const text = clean(value);
    // Tender securities, completion certificates, and unrelated material tests
    // are not general authority to impose a construction-method requirement.
    if (/ערבות|ערבויות|המציע|מגיש ההצעה|הצעת משתתף במכרז|תעודת (?:השלמה|גמר)/u.test(text)
        && !/שיטת|עבודה נוספת|עבודות נוספות|שינויים בעבוד/u.test(text)) return false;
    if (['SIGN_ANNEX', 'BINDING_ANNEX', 'WAIVE_CLAIMS'].includes(kind)
        && /נספח (?:ה)?(?:בטיחות|ביטוח|ערבות)|אישור (?:הבטיחות|על קיום ביטוחים)|המבטח|זכות תחלוף/u.test(text)) return false;
    if (kind === 'RESPOND' && /זמ(?:ן|ני) תגובה/u.test(text) && /תקלות|מוקד|SLA|אחזקה|תחזוקה/iu.test(text)
        && !/(?:תשוב|מענה|תגוב).{0,35}מכתב|מ(?:מועד|יום|תאריך).{0,20}מכתב/u.test(text)) return false;
    switch (kind) {
        case 'METHOD_CHANGE': return /שיט[תה].{0,25}(?:ביצוע|עבודה|קידוח)|שינוי.{0,20}(?:העבוד|בעבוד)|כל עבודה נוספת|הוראות המפקח/u.test(text);
        case 'SIGN_ANNEX': return /(?:נספח|שינוי).{0,130}(?:חתימ|לחתום|מחייב)|(?:חתימ|לחתום).{0,100}(?:נספח|שינוי)/u.test(text)
            && /כל נספח|נספח (?:ה?שינוי|ה?קידוח|MTM|ל?עבודות נוספות|לעבודה נוספת)|נספח.{0,50}שיטת (?:הביצוע|הקידוח)|כל שינוי.{0,50}נספח/iu.test(text);
        case 'BINDING_ANNEX': return /(?:נספח|שינוי).{0,130}(?:חתימ|לחתום|מחייב)|חתימ.{0,100}(?:נספח|שינוי)|כל עבודה נוספת|פקודת שינויים|הזמנת עבודה/u.test(text);
        case 'NO_EXTRA_PAYMENT': return /מחיר|תמורה|תשלום/u.test(text) && /שינו|עבודה נוספת|עבודות נוספות|תוספ|חריג/u.test(text);
        case 'SUBMIT_PRICE': return /ניתוח מחיר/u.test(text);
        case 'RESPOND': {
            const period = responseWindow(text);
            return /תשוב|מענה|תגוב/u.test(text) && Boolean(period
                && (period.origin !== 'UNESTABLISHED' || /אין לדרוש.{0,45}(?:תשוב|מענה)|לא (?:יהיה|יהא) רשאי.{0,30}לדרוש/u.test(text)));
        }
        case 'WAIVE_CLAIMS': return /טענ|תביע|ויתור|מוותר/u.test(text) && /שינו|נוספ|הקבלן/u.test(text);
    }
}

export function ruleRelevanceScore(kind: RequirementKind, value: string) {
    const text = clean(value);
    let score = 0;
    if (/שינוי|נוספ/u.test(text)) score += 2;
    if (['METHOD_CHANGE', 'BINDING_ANNEX', 'NO_EXTRA_PAYMENT'].includes(kind)
        && /אישור מראש ובכתב|אישור בכתב מראש|פקודת שינויים/u.test(text)) score += 8;
    if (kind === 'METHOD_CHANGE' && /שיטת (?:הביצוע|הקידוח|העבודה)/u.test(text)) score += 8;
    if (kind === 'NO_EXTRA_PAYMENT' && /ניתוח מחיר|מחיר חדש|תמחור|הגדלת כמות/u.test(text)) score += 6;
    if (['SIGN_ANNEX', 'BINDING_ANNEX'].includes(kind) && /נספח (?:ה?שינוי)|שני הצדדים/u.test(text)) score += 7;
    if (kind === 'RESPOND' && /תשובה|מענה/u.test(text) && /ימי עבודה|מועד המכתב|מועד קבלת/u.test(text)) score += 8;
    if (kind === 'WAIVE_CLAIMS' && /ויתור|מוותר/u.test(text)) score += 6;
    return score;
}

export function responseWindow(value: string) {
    const text = clean(value);
    const match = text.match(/(?:בתוך|תוך|פחות מ[-־]?|לפחות)\s*(\d+)\s*(?:\([^)]{1,25}\)\s*)?(ימי עבודה|ימי עסקים|ימים|יום|שעות)/u);
    if (!match) return null;
    return { value: Number(match[1]), unit: /עבודה|עסקים/u.test(match[2]) ? 'WORKING_DAYS' : /שעות/u.test(match[2]) ? 'HOURS' : 'DAYS',
        origin: /מ(?:מועד|יום|תאריך) (?:קבלת|המצאת)|מ(?:קבלת|המצאת) המכתב/u.test(text) ? 'RECEIPT'
            : /מ(?:מועד|יום|תאריך) (?:ה?מכתב|ה?דרישה)/u.test(text) ? 'LETTER_DATE' : 'UNESTABLISHED' };
}

export function compareRequirementStatements(kind: RequirementKind, requested: string, governing: string): RequirementStatementResult {
    const work = clean(requested), rule = clean(governing);
    const result = (relation: RequirementStatementResult['relation'], reason: string) => ({ relation, reason });
    if (!ruleConcerns(kind, rule)) return result('UNESTABLISHED',
        ['NO_EXTRA_PAYMENT', 'WAIVE_CLAIMS'].includes(kind) && ruleConcerns('METHOD_CHANGE', rule)
            ? 'method_authority_does_not_establish_price_or_waiver' : 'different_requirement_subject');
    const scopedWork = rule.match(/(?:בעבודות|לעבודות|עבור עבודות|לעניין עבודות)\s+(?:ה)?(אספלט|ריבוד|מילוי|עפר|ביוב|מים|קידוח)/u)?.[1];
    if (scopedWork && /MTM|קידוח|דחיקה/iu.test(work) && ['אספלט', 'ריבוד', 'מילוי', 'עפר'].includes(scopedWork)) {
        return result('UNESTABLISHED', 'different_requirement_subject');
    }
    if (isConditionalRequirement(rule) && !(kind === 'METHOD_CHANGE' && /בכפוף לאישור/u.test(rule)
        && !/ככל|בתנאי|אם |כאשר/u.test(rule))) return result('UNESTABLISHED', 'governing_conditions_not_established');
    if (kind === 'RESPOND') {
        const a = responseWindow(work), b = responseWindow(rule);
        if (a && b && a.unit === b.unit && a.origin !== 'UNESTABLISHED' && a.origin === b.origin
            && /אין לדרוש|לא (?:יהיה|יהא) רשאי.{0,30}לדרוש/u.test(rule) && /פחות מ/u.test(rule) && a.value < b.value) {
            return result('INCOMPATIBLE', 'requested_response_period_below_contractual_minimum');
        }
        // A contractual outer limit does not authorize a shorter employer limit.
        return result('UNESTABLISHED', 'response_period_authority_not_established');
    }
    if (kind === 'METHOD_CHANGE') {
        const method = /שיטת (?:הביצוע|העבודה|הקידוח)|שינוי שיטה/u.test(rule);
        const approvalRequired = rule.split(/[.;]/u).some(statement => /טעון אישור|נדרש אישור|יש לקבל אישור|מחייב אישור|בכפוף לאישור/u.test(statement)
            && !/אינו טעון|לא נדרש|אין צורך|אינו מחייב|ללא צורך/u.test(statement));
        if (method && approvalRequired
            && /ללא אישור|בלי אישור|אין צורך באישור/u.test(work)) {
            return result('INCOMPATIBLE', 'method_instruction_waives_required_approval');
        }
        if (method && /(?:אין|לא).{0,15}(?:רשאי|מוסמך).{0,30}(?:לשנות|להורות)/u.test(rule)
            && !isConditionalRequirement(work)) return result('INCOMPATIBLE', 'method_instruction_exceeds_explicit_authority');
        const actor = rule.match(/(המפקח|המנהל|המזמין)\s+(?:יהיה |יהא )?רשאי.{0,35}להורות.{0,40}שינוי/u)?.[1];
        if (method && actor && work.includes(`${actor} מורה`) && !isConditionalRequirement(work)
            && (!/בכתב/u.test(rule) || /בכתב/u.test(work))) return result('COMPATIBLE', 'explicit_method_authority_matches_instruction');
        return result('UNESTABLISHED', 'method_authority_or_approval_conditions_not_established');
    }
    if (kind === 'BINDING_ANNEX') {
        if (/(?:רק|אלא|טעון|נדרשת|מחייב).{0,45}חתימ.{0,25}(?:שני הצדדים|המזמין והקבלן)/u.test(rule)
            && /טרם.{0,20}חתימ|לא התקבלה חתימ|לא נחתם/u.test(work)) {
            return result('INCOMPATIBLE', 'binding_annex_assertion_without_required_signature');
        }
        return result('UNESTABLISHED', 'operative_annex_basis_not_established');
    }
    if (kind === 'NO_EXTRA_PAYMENT') {
        if (/כל שינוי (?:בשיט[תה]|בשיטת הביצוע).{0,40}(?:מחייב|יחייב).{0,30}(?:עדכון|התאמת|שינוי) (?:התמורה|המחיר)/u.test(rule)) {
            return result('INCOMPATIBLE', 'no_extra_payment_against_explicit_price_adjustment');
        }
        return result('UNESTABLISHED', 'price_change_mechanism_or_work_classification_not_established');
    }
    if (kind === 'WAIVE_CLAIMS' && /אין לדרוש.{0,30}ויתור|לא (?:רשאי|ניתן).{0,30}לדרוש.{0,20}ויתור/u.test(rule)) {
        return result('INCOMPATIBLE', 'waiver_against_explicit_protection');
    }
    if (kind === 'SIGN_ANNEX' && /(?:על הקבלן|הקבלן (?:חייב|מתחייב)).{0,25}לחתום על.{0,25}נספח/u.test(rule)) {
        return result('COMPATIBLE', 'explicit_annex_signature_duty');
    }
    if (kind === 'SUBMIT_PRICE' && /הקבלן.{0,25}(?:יגיש|חייב להגיש|מתחייב להגיש).{0,30}ניתוח מחיר/u.test(rule)) {
        return result('COMPATIBLE', 'explicit_price_analysis_submission_duty');
    }
    return result('UNESTABLISHED', 'requirement_authority_not_established');
}
