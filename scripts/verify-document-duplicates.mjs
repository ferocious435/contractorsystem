import assert from 'node:assert/strict';
import test from 'node:test';

const duplicates = await import('../src/utils/document-duplicates.ts');

function protocolText(changedWords = []) {
  const words = Array.from({ length: 900 }, (_, index) => `מילה${index % 140}`);
  for (const [index, value] of changedWords) words[index] = value;
  return words.join(' ');
}

test('title normalization treats PDF and copied DOCX names as the same protocol', () => {
  assert.equal(
    duplicates.normalizeDuplicateTitle('סיכום ישיבה 30.07.25.pdf'),
    duplicates.normalizeDuplicateTitle('סיכום ישיבה 30.07.25 (1).docx'),
  );
});

test('same protocol text in PDF and DOCX selects PDF as canonical', () => {
  const text = protocolText();
  const matches = duplicates.findPreferredPdfDuplicates([
    { id: 'docx', title: 'פרוטוקול 30.07.25.docx', extracted_text: text },
    { id: 'pdf', title: 'פרוטוקול 30.07.25.pdf', extracted_text: text },
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].canonical.id, 'pdf');
  assert.equal(matches[0].duplicate.id, 'docx');
  assert.equal(matches[0].similarity, 1);
});

test('minor extraction noise above 97 percent is accepted', () => {
  const source = protocolText();
  const noisy = `${source} ${Array.from({ length: 20 }, (_, index) => `עמוד${index}`).join(' ')}`;
  assert.ok(duplicates.measureDocumentTextSimilarity(source, noisy) >= 0.97);
});

test('PDF word joins do not hide an otherwise identical Hebrew document', () => {
  const words = Array.from({ length: 500 }, (_, index) => `מסמך${index % 80}`);
  const docxText = words.join(' ');
  const pdfWords = [];
  for (let index = 0; index < words.length; index += 1) {
    if (index % 4 === 0 && words[index + 1]) {
      pdfWords.push(`${words[index]}${words[index + 1]}`);
      index += 1;
    } else {
      pdfWords.push(words[index]);
    }
  }
  const pdfText = pdfWords.join(' ');

  assert.ok(duplicates.measureDocumentTextSimilarity(docxText, pdfText) >= 0.97);
});

test('same protocol text selects PDF even when filenames differ', () => {
  const text = protocolText();
  const matches = duplicates.findPreferredPdfDuplicates([
    { id: 'pdf', title: 'מכתב לקבלן - אישור מובלים פנימיים 22.06.2025.pdf', extracted_text: text },
    { id: 'docx', title: 'מכתב לקבלן - אישור מובלים פנימיים.docx', extracted_text: text },
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].canonical.id, 'pdf');
  assert.equal(matches[0].duplicate.id, 'docx');
});

test('different content is never removed even when filenames match', () => {
  const first = protocolText();
  const second = protocolText(Array.from({ length: 250 }, (_, index) => [index, `שינוי${index}`]));

  assert.ok(duplicates.measureDocumentTextSimilarity(first, second) < 0.97);
  assert.equal(duplicates.findPreferredPdfDuplicates([
    { id: 'pdf', title: 'פרוטוקול 01.01.25.pdf', extracted_text: first },
    { id: 'docx', title: 'פרוטוקול 01.01.25.docx', extracted_text: second },
  ]).length, 0);
});

test('same content in different document categories is preserved', () => {
  const text = protocolText();
  assert.equal(duplicates.findPreferredPdfDuplicates([
    { id: 'contract-pdf', title: 'נספח.pdf', category: 'CONTRACT', extracted_text: text },
    { id: 'execution-docx', title: 'עותק עבודה.docx', category: 'EXECUTION', extracted_text: text },
  ]).length, 0);
});

test('short text is not enough for automatic deletion', () => {
  assert.equal(duplicates.measureDocumentTextSimilarity('אותו טקסט', 'אותו טקסט'), 0);
});

test('exact file copies are grouped inside the same document category', () => {
  const matches = duplicates.findExactContentHashDuplicates([
    { id: 'numeric', title: '200.106.001.019.pdf', category: 'EXECUTION', content_hash: 'same-hash' },
    { id: 'descriptive', title: 'תגובה יועצת קרקע.pdf', category: 'EXECUTION', content_hash: 'same-hash' },
    { id: 'contract-copy', title: 'תגובה יועצת קרקע.pdf', category: 'CONTRACT', content_hash: 'same-hash' },
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].canonical.id, 'descriptive');
  assert.equal(matches[0].duplicate.id, 'numeric');
});
