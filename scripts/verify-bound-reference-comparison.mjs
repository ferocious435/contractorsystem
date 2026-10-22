import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const authority = await import('../src/utils/document-reference-authority.ts');
const comparison = await import('../src/utils/bound-reference-comparison.ts');
hook.deregister();
const quote = 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8 אחוז.';
const graph = () => authority.buildDocumentReferenceGraph({ documents: [
  { id: 'project-spec', title: 'מפרט מיוחד', role: 'PROJECT_CONTRACT', clauses: [{ text: 'על העבודה יחול פרק 57 של המפרט הכללי מהדורת 2023.' }] },
  { id: 'blue', title: 'המפרט הכללי', role: 'REFERENCE', referenceType: 'BLUE_BOOK', clauses: [
    { id: 'page-57', page: 57, sectionCode: '57', edition: '2023', text: quote },
    { id: 'page-34', page: 34, sectionCode: '34', edition: '2023', text: 'מערכות כיבוי אש וגילוי אש בבניין.' },
    { id: 'page-2026', page: 60, sectionCode: '57', edition: '2026', text: 'חול מצומנט בשיעור שונה.' },
  ] },
] });

test('only the actual incorporated chapter and edition can enter the initial comparison', () => {
  const documents = comparison.buildBoundReferenceDocuments(graph());
  assert.deepEqual(documents.map((document) => document.id), ['page-57']);
  assert.equal(documents[0].extracted_text, quote);
  assert.equal(documents[0].reference_authority.reference_document_id, 'blue');
  assert.equal(documents[0].reference_authority.chain[0].sourceDocumentId, 'project-spec');
});

test('a reference source has its own physical source and does not impersonate the incorporating agreement', () => {
  const [document] = comparison.buildBoundReferenceDocuments(graph());
  assert.ok(document);
  assert.deepEqual(comparison.contractSourcePointers(document), {
    targetContractDocumentId: null, displayDocumentId: 'blue', referenceAuthority: document.reference_authority,
  });
  assert.equal(comparison.contractSourcePointers({ id: 'native-spec' }).targetContractDocumentId, 'native-spec');
});

test('irrelevant or unavailable references do not reset successfully checked document memory', () => {
  const sources = comparison.buildBoundReferenceDocuments(graph());
  assert.deepEqual(comparison.selectBoundReferenceDocuments(sources, 'אספקת הידרנטים וגילוי אש'), []);
  assert.equal(comparison.buildReferenceAwareContractSignature('existing-native-signature', []), 'existing-native-signature');
  const selected = comparison.selectBoundReferenceDocuments(sources, 'נדרשת עטיפת הצינור בחול מצומנט בשיעור 4 אחוז');
  assert.equal(selected.length, 1);
  assert.notEqual(comparison.buildReferenceAwareContractSignature('existing-native-signature', selected), 'existing-native-signature');
});
