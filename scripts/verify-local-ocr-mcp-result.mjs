import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { parseLocalOcrMcpPage } = await import('../src/utils/local-ocr-mcp-result.ts');
const { hasCompleteOcrPageCoverage } = await import('../src/utils/document-source-readiness.ts');
hook.deregister();
const page = { content: 'הקבלן יגיש תשובה בתוך 14 ימים', metadata: { pages: { total_count: 1 } }, quality_score: 1,
  pages: [{ page_number: 1, content: '', is_blank: true }],
  ocr_elements: [{ level: 'word', page_number: 1, text: 'הקבלן', confidence: { recognition: 0.9 } },
    { level: 'word', page_number: 1, text: 'יגיש', confidence: { recognition: 0.8 } }] };
const wrap = payload => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
test('MCP OCR is mapped to the original page and keeps complete recognized text despite a false native blank flag', () => {
  const result = parseLocalOcrMcpPage(wrap(page), 17);
  assert.equal(result.page, 17); assert.equal(result.text, page.content);
  assert.ok(Math.abs(result.confidence - 85) < 1e-8);
});
test('an overall quality score cannot hide poor recognition on a page', () => {
  const bad = structuredClone(page);
  bad.ocr_elements[1].confidence.recognition = 0.1;
  assert.equal(parseLocalOcrMcpPage(wrap(bad), 2).confidence, 50);
});
test('missing or out of range word confidence cannot certify a page', () => {
  for (const value of [undefined, -1, 1.5]) {
    const bad = structuredClone(page); bad.ocr_elements[0].confidence.recognition = value;
    assert.equal(parseLocalOcrMcpPage(wrap(bad), 1).confidence, 0);
  }
});
test('MCP errors, wrong page counts, empty counters, and unlocated words are rejected', () => {
  for (const result of [{ ...wrap(page), isError: true }, wrap({ ...page, metadata: { pages: { total_count: 2 } } }),
    wrap({ ...page, content: '-- 1 of 1 --' }), wrap({ ...page, ocr_elements: [] }),
    wrap({ ...page, ocr_elements: [{ ...page.ocr_elements[0], page_number: 2 }] })]) {
    assert.throws(() => parseLocalOcrMcpPage(result, 1));
  }
});

test('confident words on a large engineering sheet cannot certify the entire page', () => {
  const result = parseLocalOcrMcpPage(wrap(page), 1, { width: 2384, height: 3370 });
  assert.ok(result.confidence >= 65);
  assert.equal(result.requiresVisualReview, true);
  assert.equal(hasCompleteOcrPageCoverage([result], [1]), false);
  const ordinaryPage = parseLocalOcrMcpPage(wrap(page), 1, { width: 595, height: 842 });
  assert.equal(hasCompleteOcrPageCoverage([ordinaryPage], [1]), true);
});
