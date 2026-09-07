import assert from 'node:assert/strict';
import test from 'node:test';

let statusModule = null;
try {
    statusModule = await import('../src/components/documents/documentDisplayStatus.ts');
} catch {
    // The first run should fail clearly until the status helper exists.
}

test('validated filename fallback stays visibly incomplete', () => {
    assert.ok(statusModule, 'document display status helper must exist');

    const state = statusModule.getDocumentDisplayState({
        id: 'legacy-fallback',
        ai_status: 'VALIDATED',
        extracted_text_hash: 'hash',
        parsed_json: {
            analysis_source: 'filename_fallback',
            summary: 'מסמך שנקלט למערכת - סיווג לפי שם הקובץ',
            warnings: ['Gemini quota exceeded'],
        },
    });

    assert.equal(state.key, 'VALIDATED_WITH_AI_WARNING');
    assert.equal(state.humanValidated, true);
    assert.equal(state.aiCompleted, false);
    assert.equal(state.needsAction, true);
});

test('a real reviewed analysis remains validated', () => {
    assert.ok(statusModule, 'document display status helper must exist');

    const state = statusModule.getDocumentDisplayState({
        id: 'reviewed',
        ai_status: 'VALIDATED',
        ocr_status: 'COMPLETED',
        parsed_json: {
            analysis_source: 'gemini',
            document_type: 'חוזה',
            summary: 'סיכום שנבדק',
        },
    });

    assert.equal(state.key, 'VALIDATED');
    assert.equal(state.aiCompleted, true);
    assert.equal(state.needsAction, false);
});

test('text extraction and AI analysis are reported separately', () => {
    assert.ok(statusModule, 'document display status helper must exist');

    const state = statusModule.getDocumentDisplayState({
        id: 'text-only',
        ai_status: 'SCANNED',
        ocr_status: 'COMPLETED',
        parsed_json: {
            analysis_source: 'text_fallback',
            system_errors: [{ code: 'AI_RATE_LIMIT' }],
        },
    });

    assert.equal(state.key, 'AI_INCOMPLETE');
    assert.equal(state.textRead, true);
    assert.equal(state.aiCompleted, false);
});
