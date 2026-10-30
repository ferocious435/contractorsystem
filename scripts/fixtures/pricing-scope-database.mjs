import assert from 'node:assert/strict';

// Network boundary only: real source loading, authority, scope and save logic run above this double.
export function pricingDatabase(overrides = {}, { allowWrites = false } = {}) {
  const tables = structuredClone({ documents: [], contradictions: [], reference_documents: [], reference_document_chunks: [],
    reference_document_incorporations: [], pricelists: [], pricelist_items: [], pricelist_item_note_links: [],
    pricing_ledger: [], project_financial_baselines: [], projects: [{ id: 'p', contractor_id: 'owner' }], ...overrides });
  const reads = [], writes = [];
  const database = { tables, reads, writes, from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    const filters = [], ordering = [];
    let columns = '*', bounds = [0, Infinity], mutation = null, one = false;
    const run = () => {
      let rows = tables[table].filter(row => filters.every(f => f(row))).toSorted((a, b) => {
        for (const [key, ascending] of ordering) { if (a[key] < b[key]) return ascending ? -1 : 1; if (a[key] > b[key]) return ascending ? 1 : -1; } return 0;
      });
      const count=rows.length;rows=rows.slice(bounds[0],bounds[1]+1);
      if (mutation) {
        assert.ok(allowWrites, `Unexpected write to ${table}`);
        writes.push({ table, kind: mutation.kind, ids: rows.map(row => row.id), value: structuredClone(mutation.value) });
        if (mutation.kind === 'update') rows.forEach(row => Object.assign(row, structuredClone(mutation.value)));
        else { const inserted = { id: `created-${writes.length}`, ...structuredClone(mutation.value) }; tables[table].push(inserted); rows = [inserted]; }
      }
      const selected = rows.map(row => columns.split(',').some(key=>key.trim()==='*') ? structuredClone(row) : Object.fromEntries(
        columns.split(/,(?![^()]*\))/).map(key => key.trim()).filter(Boolean).map(key => {
          const field = key.replace(/!.*$|\(.*$/g, ''); return [field, structuredClone(row[field] ?? null)];
        })));
      return { data: one ? selected[0] ?? null : selected, count, error: null };
    };
    const query = {
      select(value = '*') { columns = value; reads.push({ table, columns }); return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      neq(key, value) { filters.push(row => row[key] !== value); return query; },
      is(key, value) { filters.push(row => row[key] == value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      not(key, op, value) { assert.equal(op, 'is'); filters.push(row => row[key] != value); return query; },
      or(value) {
        const alternatives = value.split(',').map(part => {
          const match = part.match(/^(\w+)\.(eq|is|ilike)\.(.+)$/); assert.ok(match, `Unsupported filter ${part}`);
          const [, key, op, wanted] = match;
          if (op === 'is') return row => row[key] == null;
          if (op === 'ilike') return row => String(row[key] || '').toLowerCase().includes(wanted.replaceAll('%', '').toLowerCase());
          return row => String(row[key]) === wanted;
        });
        filters.push(row => alternatives.some(f => f(row))); return query;
      },
      order(key, options = {}) { ordering.push([key, options.ascending !== false]); return query; },
      range(start, end) { bounds = [start, end]; return query; },
      limit(count) { bounds[1] = count - 1; return query; },
      single() { one = true; return query; }, maybeSingle() { one = true; return query; },
      update(value) { mutation = { kind: 'update', value }; return query; },
      insert(value) { mutation = { kind: 'insert', value }; return query; },
      upsert(value) { mutation = { kind: 'upsert', value }; return query; },
      delete() { throw new Error('Unexpected deletion'); },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return query;
  } };
  return database;
}

export const sourceTables = () => ({
  contradictions: [{ id: 'finding', project_id: 'p', title: 'אספקה ופיזור חומר מילוי', status: 'OPEN',
    category: 'שינוי/חריג', scan_signature: 'new', source_execution_doc_id: 'work',
    evidence_data: { work_quote: 'יש לבצע אספקה ופיזור 2 מ"ק חומר מילוי מסוג C.' } }],
  documents: [{ id: 'work', project_id: 'p', title: 'הוראת ביצוע', category: 'EXECUTION', doc_type: 'LETTER',
    extracted_text: 'יש לבצע אספקה ופיזור 2 מ"ק חומר מילוי מסוג C.', ocr_status: 'COMPLETED', parsed_json: {} },
  { id: 'contract', project_id: 'p', title: 'תנאי חוזה', category: 'CONTRACT', doc_type: 'CONTRACT',
    extracted_text: 'לעבודות נוספות יחול מחירון דקל. המחירים ללא מע"מ.', ocr_status: 'COMPLETED', parsed_json: {} }],
  pricelists: [{ id: 'dekel', project_id: 'p', contractor_id: 'owner', name: 'דקל', source_type: 'DEKEL', is_global: false,
    parse_status: 'READY', metadata: { price_basis: 'EXCL_VAT' }, terms_text: '', content_hash: 'book-hash' },
  { id: 'housing', project_id: 'p', contractor_id: 'owner', name: 'משרד הבינוי והשיכון', source_type: 'HOUSING_MINISTRY',
    parse_status: 'READY', is_global: false, content_hash: 'other-book-hash' }],
  pricelist_items: [{ id: 'fill-price', pricelist_id: 'dekel', item_type: 'ITEM', item_code: '51.003.0110',
    description: 'אספקה ופיזור חומר מילוי מסוג C.', unit: 'מ"ק', rate: 75, source_excerpt: null, parent_item_id: null,
    page_number: 2, sort_order: 3, metadata: {} },
  { id: 'same-book-section-note', pricelist_id: 'dekel', item_type: 'NOTE', item_code: '51.003', description: 'המחיר כולל פיזור.', sort_order: 1 },
  { id: 'neighbour-note', pricelist_id: 'dekel', item_type: 'NOTE', item_code: '51.0030', description: 'אין תשלום נוסף.', sort_order: 2 },
  { id: 'other-book-note', pricelist_id: 'housing', item_type: 'NOTE', item_code: '51.003', description: 'אספקה ללא פיזור.', sort_order: 1 }],
});
