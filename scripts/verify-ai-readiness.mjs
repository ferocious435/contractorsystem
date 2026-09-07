import assert from 'node:assert/strict';
import test from 'node:test';

let readinessModule = null;
try {
    readinessModule = await import('../src/utils/ai-readiness.ts');
} catch {
    // The first run should fail clearly until the readiness helper exists.
}

test('missing Gemini key is reported as unavailable', () => {
    assert.ok(readinessModule, 'AI readiness helper must exist');
    assert.deepEqual(readinessModule.getAiReadiness({}), {
        available: false,
        provider: 'Gemini 3.5 Flash',
        reason: 'AI_NOT_CONFIGURED',
    });
});

test('configured Gemini key is reported without exposing the key', () => {
    assert.ok(readinessModule, 'AI readiness helper must exist');
    const state = readinessModule.getAiReadiness({ GEMINI_API_KEY: 'secret-value' });

    assert.deepEqual(state, {
        available: true,
        provider: 'Gemini 3.5 Flash',
        reason: null,
    });
    assert.equal(JSON.stringify(state).includes('secret-value'), false);
});
