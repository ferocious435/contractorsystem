import assert from 'node:assert/strict';
import test from 'node:test';

let evidenceModule = null;
try {
    evidenceModule = await import('../src/components/features/contradiction-radar/utils/evidenceVerification.ts');
} catch {
    // The first run should fail clearly until the evidence helper exists.
}

test('two stored quotes alone do not claim source verification', () => {
    assert.ok(evidenceModule, 'evidence verification helper must exist');
    assert.equal(evidenceModule.getEvidenceDisplayStatus({
        evidence_status: 'VERIFIED',
        contract_quote: 'contract text',
        work_quote: 'work text',
    }), 'QUOTES_REQUIRE_SOURCE_CHECK');
});

test('explicit matches to both sources allow a verified label', () => {
    assert.ok(evidenceModule, 'evidence verification helper must exist');
    assert.equal(evidenceModule.getEvidenceDisplayStatus({
        evidence_status: 'VERIFIED',
        contract_quote: 'contract text',
        work_quote: 'work text',
        source_verification: {
            contract_quote_matched: true,
            work_quote_matched: true,
        },
    }), 'SOURCE_VERIFIED');
});

test('missing one quote is reported as incomplete evidence', () => {
    assert.ok(evidenceModule, 'evidence verification helper must exist');
    assert.equal(evidenceModule.getEvidenceDisplayStatus({
        evidence_status: 'VERIFIED',
        contract_quote: 'contract text',
    }), 'INCOMPLETE');
});
