import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { extractPdfPagesWithLocalMcp, localOcrMcpAvailable } = await import('../src/utils/local-ocr-mcp.ts');
const { prepareDocumentAnalysisInput } = await import('../src/utils/document-text-extraction.ts');
hook.deregister();
assert.equal(await localOcrMcpAvailable(), true, 'Run npm run setup:ocr-mcp first');
const image = await sharp(Buffer.from('<svg width="1800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="1700" y="170" direction="rtl" font-family="Arial" font-size="85" fill="black">זה מסמך מלא וקצר בעברית</text><text x="1700" y="330" direction="rtl" font-family="Arial" font-size="80" fill="black">הקבלן יגיש תשובה בתוך 14 ימים</text></svg>')).png().toBuffer();
const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
pdf.text('NATIVE PAGE ONE: a different contractual instruction.', 60, 100);
pdf.addPage('a4', 'landscape');
pdf.addImage(image, 'PNG', 0, 100, 842, 234);
const fixture = Buffer.from(pdf.output('arraybuffer'));
const pages = await extractPdfPagesWithLocalMcp(fixture, [2]);
assert.equal(pages.length, 1);
assert.equal(pages[0].page, 2);
assert.match(pages[0].text, /הקבלן יגיש תשובה בתוך 14 ימים/);
assert.doesNotMatch(pages[0].text, /NATIVE PAGE ONE/);
assert.ok(pages[0].confidence >= 65);
console.log(`PASS product MCP reader recognized Hebrew on physical page 2 (${pages[0].confidence.toFixed(1)}%)`);
const previousRenderer = process.env.PDFTOPPM_PATH;
try {
  process.env.PDFTOPPM_PATH = 'deliberately-unavailable-ocr-renderer';
  const prepared = await prepareDocumentAnalysisInput(fixture, 'mixed-native-hebrew.pdf');
  assert.equal(prepared.kind, 'text');
  assert.match(prepared.extractedText, /הקבלן יגיש תשובה בתוך 14 ימים/);
  assert.equal(prepared.readingVerification.complete, true);
  assert.deepEqual(prepared.readingVerification.readPages, [1, 2]);
  console.log('PASS product falls back to MCP when the primary page renderer is unavailable');
} finally {
  if (previousRenderer === undefined) delete process.env.PDFTOPPM_PATH;
  else process.env.PDFTOPPM_PATH = previousRenderer;
}
