const quote = (documentId, text) => ({ documentId, quote: text });
export const dimensions = () => ({ work: 'MATCH', material: 'MATCH', method: 'MATCH', unit: 'MATCH', conditions: 'NOT_APPLICABLE' });

export function pricingFixture() {
  const work = 'יש לבצע אספקה ופיזור 2 מ"ק חומר מילוי נברר מסוג C.';
  const price = 'אספקה ופיזור חומר מילוי נברר מסוג C. יחידה מ"ק. מחיר 75 ש"ח ללא מע"מ.';
  const context = { workSourceIds: ['work'], sources: [
    { id: 'work', title: 'הוראת ביצוע', role: 'WORK', allowed: true, extracted_text: work, ocr_status: 'COMPLETED' },
    { id: 'price', title: 'מחירון בדיקה', role: 'PRICE', allowed: true, extracted_text: price, ocr_status: 'COMPLETED' },
  ], candidates: [{ id: 'fill-price', sourceId: 'price', text: price, itemCode: '51.003.0110', unit: 'מ"ק', rate: 75,
    noteSourceIds: [], priceBasis: 'EXCL_VAT' }] };
  const evidence = [quote('work', work), quote('price', price)];
  const draft = { requirements: [{ id: 'fill', description: 'אספקה ופיזור חומר C', role: 'INSTRUCTION', evidence: [quote('work', work)] }],
    positions: [{ candidateId: 'fill-price', status: 'FULL', requirementIds: ['fill'], reason: 'העבודה, החומר והיחידה תואמים.',
      dimensions: dimensions(), evidence }],
    lines: [{ candidateId: 'fill-price', requirementIds: ['fill'], quantity: { value: 2, basis: 'SOURCE', evidence: [quote('work', work)] },
      coefficients: [] }] };
  return { context, draft };
}

export function partialFixture() {
  const work = 'יש לבצע אספקה והתקנה של 2 שסתומים. יחידת מדידה: יחידה.';
  const supply = 'אספקת שסתום בלבד ללא התקנה. יחידה. מחיר 60 ש"ח ללא מע"מ.';
  const installation = 'התקנת שסתום שסופק בנפרד. יחידה. מחיר 15 ש"ח ללא מע"מ.';
  const context = { workSourceIds: ['work'], sources: [
    { id: 'work', title: 'הוראת שסתומים', role: 'WORK', allowed: true, extracted_text: work },
    ...[['supply', supply], ['installation', installation]].map(([id, text]) => ({ id, title: id, role: 'PRICE', allowed: true, extracted_text: text })),
  ], candidates: [['supply', supply, 60], ['installation', installation, 15]].map(([id, text, rate]) => ({
    id, sourceId: id, text, itemCode: id === 'supply' ? '70.1' : '70.2', unit: 'יחידה', rate, noteSourceIds: [], priceBasis: 'EXCL_VAT',
  })) };
  const draft = { requirements: ['supply', 'installation'].map(id => ({ id, description: id === 'supply' ? 'אספקת שסתומים' : 'התקנת שסתומים',
    role: 'INSTRUCTION', evidence: [quote('work', work)] })),
    positions: [['supply', supply], ['installation', installation]].map(([id, text]) => ({ candidateId: id, status: 'PARTIAL',
      requirementIds: [id], reason: 'המחיר מכסה רק את הפעולה המצוינת.', dimensions: dimensions(), evidence: [quote('work', work), quote(id, text)] })),
    lines: ['supply', 'installation'].map(id => ({ candidateId: id, requirementIds: [id],
      quantity: { value: 2, basis: 'SOURCE', evidence: [quote('work', work)] }, coefficients: [] })) };
  return { context, draft };
}

export function mismatchFixture(kind = 'material') {
  const fixture = pricingFixture();
  if (kind === 'material') {
    fixture.context.sources[0].extracted_text = 'יש לבצע מילוי של 2 מ"ק חול מיוצב עם 8% צמנט מסוג S-8.';
    fixture.draft.requirements[0].evidence[0].quote = fixture.context.sources[0].extracted_text;
    fixture.draft.positions[0].evidence[0].quote = fixture.context.sources[0].extracted_text;
    fixture.draft.lines[0].quantity.evidence[0].quote = fixture.context.sources[0].extracted_text;
    fixture.draft.positions[0].dimensions.material = 'MISMATCH';
  } else {
    fixture.context.sources[0].extracted_text = 'תועדה עצירה בעבודות הנחת צינורות מים ואביזרים.';
    fixture.context.sources[1].extracted_text = 'הקמת עירוב מצינורות מגולוונים. יחידה מטר. מחיר 18.95 ש"ח ללא מע"מ.';
    Object.assign(fixture.context.candidates[0], { text: fixture.context.sources[1].extracted_text, itemCode: '44.001.0130', unit: 'מטר', rate: 18.95 });
    fixture.draft.requirements[0].evidence[0].quote = fixture.context.sources[0].extracted_text;
    fixture.draft.positions[0].evidence = fixture.context.sources.map(s => quote(s.id, s.extracted_text));
    fixture.draft.positions[0].dimensions.work = 'MISMATCH';
  }
  fixture.draft.positions[0].status = 'REJECTED';
  return fixture;
}
