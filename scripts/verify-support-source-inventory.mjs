import assert from 'node:assert/strict';
import test from 'node:test';

const { buildSupportSourceInventory } = await import('../src/utils/support-source-inventory.ts');

test('finds shelf contract in ordinary documents and keeps Blue Book missing', () => {
  const inventory = buildSupportSourceInventory({
    documents: [{ id: 'd-3210', title: 'חוזה מדף 3210', category: 'CONTRACT' }],
    references: [],
    priceLists: [{ id: 'p1', name: 'מחירון דקל', parse_status: 'READY' }],
  });

  assert.equal(inventory.shelfContract3210.available, true);
  assert.equal(inventory.blueBook.available, false);
  assert.equal(inventory.priceLists.length, 1);
  assert.equal(inventory.standards.length, 0);
});

test('ready reference-library row is reported as available', () => {
  const inventory = buildSupportSourceInventory({
    documents: [],
    references: [{
      id: 'blue-1',
      title: 'המפרט הכללי / הספר הכחול',
      reference_type: 'BLUE_BOOK',
      status: 'READY',
    }],
    priceLists: [],
  });

  assert.equal(inventory.blueBook.available, true);
  assert.equal(inventory.blueBook.status, 'READY');
});

test('unfinished reference-library row is visible but not marked available', () => {
  const inventory = buildSupportSourceInventory({
    documents: [],
    references: [{
      id: 'blue-2',
      title: 'ספר כחול',
      reference_type: 'BLUE_BOOK',
      status: 'ERROR',
    }],
    priceLists: [],
  });

  assert.equal(inventory.blueBook.available, false);
  assert.equal(inventory.blueBook.title, 'ספר כחול');
  assert.equal(inventory.blueBook.status, 'ERROR');
});

test('ready document copy is used when a reference-library row failed', () => {
  const inventory = buildSupportSourceInventory({
    documents: [{ id: 'blue-document', title: 'המפרט הכללי הספר הכחול' }],
    references: [{
      id: 'blue-error',
      title: 'ספר כחול — failed import',
      reference_type: 'BLUE_BOOK',
      status: 'ERROR',
    }],
    priceLists: [],
  });

  assert.equal(inventory.blueBook.available, true);
  assert.equal(inventory.blueBook.title, 'המפרט הכללי הספר הכחול');
  assert.equal(inventory.blueBook.status, 'DOCUMENT_LIBRARY');
});

test('price-list identity and parse status are preserved', () => {
  const inventory = buildSupportSourceInventory({
    documents: [],
    references: [],
    priceLists: [{
      id: 'p2',
      name: 'מחירון משרד השיכון',
      source_type: 'MINISTRY_HOUSING',
      version_label: '2025.02',
      parse_status: 'READY',
    }],
  });

  assert.deepEqual(inventory.priceLists[0], {
    id: 'p2',
    name: 'מחירון משרד השיכון',
    sourceType: 'MINISTRY_HOUSING',
    version: '2025.02',
    status: 'READY',
  });
});

test('Israeli standards are listed separately', () => {
  const inventory = buildSupportSourceInventory({
    documents: [],
    references: [{ id: 's1', title: 'תקן 1142', reference_type: 'ISRAELI_STANDARD', status: 'READY' }],
    priceLists: [],
  });
  assert.deepEqual(inventory.standards, [{ id: 's1', title: 'תקן 1142', status: 'READY' }]);
});
