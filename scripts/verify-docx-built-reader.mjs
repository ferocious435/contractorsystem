// Execute the actual public reader exported by a production Next bundle.
// The synthetic DOCX exercises native Node loading, Office parsing and real offline OCR.
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { docx, image, paragraph } from './fixtures/docx-image-fixtures.mjs';

const require = createRequire(import.meta.url);
const dist = path.resolve(process.argv[2] || '.next');
const runtime = require(path.join(dist, 'server/webpack-runtime.js'));
require(path.join(dist, 'server/app/api/documents/extract-text/route.js'));
let prepare;
for (const [id, module] of Object.entries(runtime.m)) {
  if (!String(module).includes('DOCX_MAIN_PART_MISSING')) continue;
  for (const exported of Object.values(runtime(id))) {
    if (typeof exported === 'function' && String(exported).includes('docx_text_plus_local_image_ocr')) prepare = exported;
  }
}
assert.equal(typeof prepare, 'function', 'Compiled public document reader must exist');
const png = await sharp(Buffer.from('<svg width="1600" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="60" y="200" font-family="Arial" font-size="120">BUILT OCR TOTAL 1234</text></svg>')).png().toBuffer();
const result = await prepare(docx({ body: paragraph('Before') + image() + paragraph('After'), media: { 'image1.png': png } }), 'built-reader.docx');
assert.match(result.extractedText, /BUILT OCR TOTAL 1234/);
assert.equal(result.readingVerification.images.length, 1);
assert.equal(result.readingVerification.images[0].numericReviewRequired, true);
assert.equal(result.requiresReview, true);
console.log('PASS: compiled public DOCX reader, real local image OCR and numeric review metadata.');
