import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const projectHook = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });

let statusModule = null;
try {
    statusModule = await import('../src/components/documents/documentDisplayStatus.ts');
} catch {
    // The first run should fail clearly until the status helper exists.
}
projectHook.deregister();

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

    assert.equal(state.key, 'SOURCE_INCOMPLETE');
    assert.equal(state.humanValidated, true);
    assert.equal(state.textRead, false);
    assert.equal(state.aiCompleted, false);
    assert.equal(state.needsAction, true);
});

test('a real reviewed analysis remains validated', () => {
    assert.ok(statusModule, 'document display status helper must exist');

    const state = statusModule.getDocumentDisplayState({
        id: 'reviewed',
        ai_status: 'VALIDATED',
        ocr_status: 'COMPLETED',
        extracted_text: 'הנחיה מלאה שנבדקה במקור.',
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
        extracted_text: 'נא להשאיר את המעבר פתוח.',
        parsed_json: {
            analysis_source: 'text_fallback',
            system_errors: [{ code: 'AI_RATE_LIMIT' }],
        },
    });

    assert.equal(state.key, 'AI_INCOMPLETE');
    assert.equal(state.textRead, true);
    assert.equal(state.aiCompleted, false);
});

test('saved page counters and a completed legacy flag do not claim that a PDF was read', () => {
    const state = statusModule.getDocumentDisplayState({ id: 'counters', title: 'schedule.pdf', ai_status: 'SCANNED',
        ocr_status: 'COMPLETED', extracted_text_hash: 'hash', extracted_text: '-- 1 of 30 --\n-- 2 of 30 --' });
    assert.equal(state.key, 'SOURCE_INCOMPLETE');
    assert.equal(state.textRead, false);
    assert.equal(state.aiCompleted, false);
    assert.equal(state.needsAction, true);
});

test('a long PDF with an unread page remains visibly incomplete', () => {
    const state = statusModule.getDocumentDisplayState({ id: 'mixed', title: 'mixed.pdf', ai_status: 'VALIDATED',
        ocr_status: 'COMPLETED', extracted_text: 'Readable original page. '.repeat(100),
        parsed_json: { source_reading: { version: 'page-coverage-v1', complete: false, totalPages: 3, readPages: [1, 3], unreadablePages: [2] } } });
    assert.equal(state.key, 'SOURCE_INCOMPLETE');
    assert.equal(state.textRead, false);
    assert.equal(state.humanValidated, true);
});
