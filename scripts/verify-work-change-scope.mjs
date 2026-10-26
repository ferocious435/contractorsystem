import test from 'node:test';
import assert from 'node:assert/strict';
import { document, finding, registerWorkChangeModules } from './fixtures/work-change-fixtures.mjs';
const hook = registerWorkChangeModules();
const { buildWorkChangePacket } = await import('../src/utils/work-change-sources.ts');
const { validateWorkChangeReview } = await import('../src/utils/work-change-review.ts');
hook.deregister();

// Synthetic contracts for program behaviour. They are not model-quality scores.
const change = 'הוצע לשנות את שיטת הביצוע מדחיקת צנרת GRP לשיטת קידוח אופקי בצינורות PP.\nראו סעיפים 62.04.0002 - 62.04.0010 בכתב הכמויות.';
export function scopePacket() {
    const item = finding(); item.target_contract_doc_id = 'old';
    item.evidence_data.work_quote = change;
    return buildWorkChangePacket(item, [
        document('primary', change),
        document('old', 'כתב הכמויות המקורי\n'
            + '62.04.0002 דחיקת צנרת GRP מתוך פיר. אספקת הצינורות נמדדת בנפרד.\nמטר 50 100 5000\n'
            + '62.04.0004 אספקה בלבד של צינורות GRP.\nמטר 50 80 4000\n'
            + '62.04.0006 פיר דחיקה מבטון, כולל מכסה וסולם.\nיחידות 2 1000 2000\n'
            + '62.04.0010 מד מים למשרד האתר.\nיחידות 1 90 90\nהמחירים ללא מע"מ.', { category: 'CONTRACT' }),
        document('offer', 'הצעת מחיר לחלופה: קידוח אופקי בצינורות PP ברחוב הרימון\n'
            + '71.02.0002 קידוח אופקי ומשיכת צינורות PP, אספקה בנפרד.\nמטר 40 200 8000\n'
            + '71.02.0004 אספקה בלבד של צינורות PP.\nיחידות 80 100 8000\n'
            + '71.02.0006 פיר קידוח מבטון, כולל מכסה וסולם.\nיחידות 3 1000 3000\nהמחירים ללא מע"מ.'),
    ]);
}
const scopeDraft = () => ({ facts: [], comparisons: [], scopeComparisons: [
    { component: 'METHOD_WORK', baselineIds: ['T1'], proposalIds: ['T5'], basisIds: ['R1'], composition: 'DIFFERENT' },
    { component: 'MATERIAL_SUPPLY', baselineIds: ['T2'], proposalIds: ['T6'], basisIds: ['R1'], composition: 'DIFFERENT' },
    { component: 'SHAFT', baselineIds: ['T3'], proposalIds: ['T7'], basisIds: ['R1'], composition: 'UNKNOWN' },
] });

test('compares sourced physical scopes before a quantity or a payment can be reconciled', () => {
    const result = validateWorkChangeReview(scopePacket(), scopeDraft());
    assert.ok(Array.isArray(result.scopeComparisons), 'The product must expose a grounded scope comparison');
    assert.deepEqual(result.scopeComparisons.map(pair => pair.component), ['METHOD_WORK', 'MATERIAL_SUPPLY', 'SHAFT']);
    assert.deepEqual(result.scopeComparisons[0].baselineIds, ['T1']);
    assert.deepEqual(result.scopeComparisons[0].proposalIds, ['T5']);
    assert.equal(result.scopeComparisons[0].evidence[0].documentId, 'primary');
    assert.ok(result.scopeComparisons[0].issues.includes('quantity_differs'));
    assert.ok(result.scopeComparisons[1].issues.includes('unit_differs'));
    assert.ok(result.scopeComparisons.every(pair => pair.arithmeticDeltaExclVat === null));
    assert.equal(result.paymentEntitlementConfirmed, false);
});

test('a model cannot swap an original bill row and a replacement offer row', () => {
    const draft = scopeDraft();
    draft.scopeComparisons = [{ ...draft.scopeComparisons[0], baselineIds: ['T5'], proposalIds: ['T1'] }];
    const result = validateWorkChangeReview(scopePacket(), draft);
    assert.deepEqual(result.scopeComparisons, []);
    assert.ok(result.limitations.includes('scope_roles_unverified'));
});

test('a repeated item reference does not turn an unrelated water meter into a replaced pipe', () => {
    const draft = scopeDraft();
    draft.scopeComparisons = [{ ...draft.scopeComparisons[0], baselineIds: ['T4'] }];
    const result = validateWorkChangeReview(scopePacket(), draft);
    assert.deepEqual(result.scopeComparisons, []);
    assert.ok(result.limitations.includes('scope_component_unverified'));
});

test('a scope match requires a real replacement statement, not a model-invented link', () => {
    const draft = scopeDraft(); draft.scopeComparisons[0].basisIds = ['made-up'];
    const result = validateWorkChangeReview(scopePacket(), draft);
    assert.ok(Array.isArray(result.scopeComparisons));
    assert.equal(result.scopeComparisons.length, 2);
    assert.ok(result.limitations.includes('scope_basis_unverified'));
});

test('incomplete reading remains explicit when the quoted work roles can be described', () => {
    const packet = scopePacket();
    const source = packet.sources.find(source => source.id === 'primary');
    source.readiness = { ...source.readiness, canCompare: false, extractionComplete: false, documentStatus: 'DRAFT' };
    const result = validateWorkChangeReview(packet, scopeDraft());
    assert.equal(result.scopeComparisons?.length, 3);
    assert.ok(result.scopeComparisons.every(pair => pair.issues.includes('source_reading_unverified')));
    assert.ok(result.scopeComparisons.every(pair => pair.issues.includes('document_status_unverified')));
    assert.equal(result.requiresReview, true);
    assert.equal(result.paymentEntitlementConfirmed, false);
});

test('a correct-looking quantity does not validate a reversed legacy work label', () => {
    const packet = scopePacket();
    const quote = '62.04.0002 דחיקת צנרת GRP מתוך פיר. אספקת הצינורות נמדדת בנפרד.\nמטר 50 100 5000';
    const result = validateWorkChangeReview(packet, { facts: [
        { sourceId: 'old', kind: 'PROPOSED_WORK', quote, quantity: 50, unit: 'מטר', amountExclVat: 5000 },
    ], comparisons: [] });
    assert.equal(result.facts[0].confirmed, false);
    assert.ok(result.facts[0].issues.includes('work_role_unverified'));
});

test('right-to-left table descriptions retain supply and shaft roles when words precede their noun', () => {
    const packet = scopePacket(), source = packet.sources.find(source => source.id === 'offer');
    source.extracted_text = source.extracted_text
        .replace('אספקה בלבד של צינורות PP.', 'PP של צינורות )בלבד( אספקה')
        .replace('פיר קידוח מבטון, כולל מכסה וסולם.', '150 בקוטר קידוח ביצוע פיר מבטון כולל מכסה וסולם.');
    const result = validateWorkChangeReview(packet, scopeDraft());
    assert.equal(result.scopeComparisons.length, 3);
    assert.deepEqual(result.scopeComparisons[1].proposalIds, ['T6']);
    assert.deepEqual(result.scopeComparisons[2].proposalIds, ['T7']);
});

test('multiple depth variants form one scope group rather than purported one-to-one replacements', () => {
    const packet = scopePacket(), source = packet.sources.find(source => source.id === 'offer');
    source.extracted_text += '\n71.02.0008 פיר קידוח עמוק מבטון.\nיחידות 1 2000 2000';
    const draft = scopeDraft();
    draft.scopeComparisons.push({ ...draft.scopeComparisons[2], proposalIds: ['T8'], composition: 'DIFFERENT' });
    const result = validateWorkChangeReview(packet, draft);
    const shafts = result.scopeComparisons.filter(pair => pair.component === 'SHAFT');
    assert.equal(shafts.length, 1);
    assert.deepEqual(shafts[0].baselineIds, ['T3']);
    assert.deepEqual(shafts[0].proposalIds, ['T7', 'T8']);
    assert.ok(shafts[0].issues.includes('quantities_not_reconciled'));
});

test('omitted eligible rows are explicit instead of implying that the whole scope was matched', () => {
    const draft = scopeDraft(); draft.scopeComparisons.splice(1, 1);
    const result = validateWorkChangeReview(scopePacket(), draft);
    assert.deepEqual(result.scopeUnmatchedIds, ['T2', 'T6']);
    assert.ok(result.limitations.includes('scope_rows_unmatched'));
    assert.equal(result.requiresReview, true);
});

test('different units or quantities invalidate a model claim of equivalent paid scope', () => {
    const draft = scopeDraft(); draft.scopeComparisons.forEach(pair => { pair.composition = 'SAME'; });
    const result = validateWorkChangeReview(scopePacket(), draft);
    assert.ok(result.scopeComparisons.every(pair => pair.composition !== 'SAME'));
    assert.ok(!result.limitations.includes('no_grounded_facts'));
    assert.ok(result.scopeComparisons.every(pair => pair.arithmeticDeltaExclVat === null));
});
