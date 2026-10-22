import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerHooks } from 'node:module';

import { jsPDF } from "jspdf";
import sharp from "sharp";

import {
  extractScannedPdfTextLocally,
  shouldAttemptLocalOcr,
} from "../src/utils/local-document-ocr.ts";

const projectHook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { prepareDocumentAnalysisInput } = await import('../src/utils/document-text-extraction.ts');
projectHook.deregister();

assert.equal(shouldAttemptLocalOcr(""), true);
assert.equal(shouldAttemptLocalOcr("12 short characters"), true);
assert.equal(shouldAttemptLocalOcr("x".repeat(300)), false);

const svg = Buffer.from(`
  <svg width="1600" height="500" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="100" y="220" font-family="Arial" font-size="160" font-weight="700" fill="black">
      CONTRACT 42
    </text>
    <text x="100" y="410" font-family="Arial" font-size="120" fill="black">
      PAYMENT APPROVED
    </text>
  </svg>
`);
const png = await sharp(svg).png().toBuffer();
const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1600, 500] });
pdf.addImage(png, "PNG", 0, 0, 1600, 500);
pdf.addPage([1600, 500], "landscape");
pdf.addImage(png, "PNG", 0, 0, 1600, 500);
const pdfBuffer = Buffer.from(pdf.output("arraybuffer"));

const tempRoot = path.join(os.tmpdir(), "contractorsystem-ocr-verification");
try {
  const result = await extractScannedPdfTextLocally(pdfBuffer, { tempRoot, batchSize: 1 });
  const normalized = result.text.toUpperCase();
  assert.match(normalized, /CONTRACT/);
  assert.match(normalized, /PAYMENT/);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.pageResults.map((page) => page.page), [1, 2]);
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
  console.log(`PASS local OCR read ${result.text.length} characters from an image-only PDF`);

  const mixed = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1600, 500] });
  for (let line = 0; line < 20; line += 1) mixed.text(`NATIVE DOCUMENT PAGE: complete original instruction, line ${line}.`, 50, 30 + line * 20);
  mixed.addPage([1600, 500], 'landscape');
  mixed.addImage(png, 'PNG', 0, 0, 1600, 500);
  const prepared = await prepareDocumentAnalysisInput(Buffer.from(mixed.output('arraybuffer')), 'mixed-pages.pdf');
  assert.equal(prepared.kind, 'text');
  assert.match(prepared.extractedText, /NATIVE DOCUMENT PAGE/);
  assert.match(prepared.extractedText.toUpperCase(), /PAYMENT APPROVED/);
  assert.deepEqual(prepared.readingVerification.readPages, [1, 2]);
  assert.equal(prepared.readingVerification.complete, true);
  assert.equal(prepared.requiresReview, false);
  console.log('PASS mixed PDF keeps the native page and recognizes its image-only second page');

  const completeLongSource = `${'Full source text. '.repeat(32_000)}END OF ORIGINAL SOURCE`;
  const longDocument = await prepareDocumentAnalysisInput(Buffer.from(completeLongSource), 'long-source.txt');
  assert.equal(longDocument.extractedText, completeLongSource);
  assert.equal(longDocument.wasTruncated, true);
  assert.match(longDocument.aiText, /truncated/);
  const shortDocument = await prepareDocumentAnalysisInput(Buffer.from('יש להשאיר את המעבר פתוח.'), 'short-instruction.txt');
  assert.equal(shortDocument.extractedText, 'יש להשאיר את המעבר פתוח.');
  const shortReply = await prepareDocumentAnalysisInput(Buffer.from('כן'), 'reply.txt');
  assert.equal(shortReply.extractedText, 'כן');
  console.log('PASS complete short and long originals remain intact in stored source text');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
