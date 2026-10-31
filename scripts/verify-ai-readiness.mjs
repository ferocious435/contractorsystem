import assert from 'node:assert/strict';
import test from 'node:test';

let readinessModule = null;
try {
    readinessModule = await import('../src/utils/ai-readiness.ts');
} catch {
    // The first run should fail clearly until the readiness helper exists.
}

test('an unconfigured local comparison is unavailable', () => {
    assert.ok(readinessModule, 'AI readiness helper must exist');
    assert.deepEqual(readinessModule.getAiReadiness({}), {
        available: false,
        provider: 'Local AI',
        reason: 'AI_NOT_CONFIGURED',
    });
});

test('an unrelated external key never enables a hidden fallback or exposes its value', () => {
    assert.ok(readinessModule, 'AI readiness helper must exist');
    const state = readinessModule.getAiReadiness({ GEMINI_API_KEY: 'secret-value' });

    assert.deepEqual(state, {
        available: false,
        provider: 'Local AI',
        reason: 'AI_NOT_CONFIGURED',
    });
    assert.equal(JSON.stringify(state).includes('secret-value'), false);
});
