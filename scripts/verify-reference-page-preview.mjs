import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReferencePage } from '../src/utils/reference-page-preview.ts';

test('the stored source page and its title are escaped as text and cannot execute document markup', () => {
  const html = renderReferencePage({ title: '<script>bad()</script>', text: '<img src=x onerror=bad()> & "quoted"',
    page: 57, totalPages: 100, projectId: 'p', referenceId: 'r' });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img '), false);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('page=56'));
  assert.ok(html.includes('page=58'));
});
