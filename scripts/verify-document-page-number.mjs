import assert from 'node:assert/strict';
import test from 'node:test';

let pageModule = null;
try {
    pageModule = await import('../src/components/features/contradiction-radar/utils/documentPage.ts');
} catch {
    // The first run should fail clearly until the page helper exists.
}

test('extracts the actual PDF page from Hebrew evidence text', () => {
    assert.ok(pageModule, 'document page helper must exist');
    assert.equal(pageModule.normalizeDocumentPage('עמוד 12 מתוך 47'), 12);
});

test('accepts numeric and English page references', () => {
    assert.ok(pageModule, 'document page helper must exist');
    assert.equal(pageModule.normalizeDocumentPage(8), 8);
    assert.equal(pageModule.normalizeDocumentPage('Page 7 of 19'), 7);
});

test('rejects unknown page descriptions', () => {
    assert.ok(pageModule, 'document page helper must exist');
    assert.equal(pageModule.normalizeDocumentPage('section A-14'), null);
    assert.equal(pageModule.normalizeDocumentPage(0), null);
});
