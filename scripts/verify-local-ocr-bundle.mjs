import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import webpackRuntime from 'next/dist/compiled/webpack/webpack.js';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';

const requireFromProject = createRequire(import.meta.url);
const temp = await mkdtemp(path.join(os.tmpdir(), 'contractorsystem-bundled-ocr-test-'));
webpackRuntime.init();
try {
  const source = await readFile('src/utils/local-document-ocr.ts', 'utf8');
  await writeFile(path.join(temp, 'entry.mjs'), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  const compiler = webpackRuntime.webpack({
    mode: 'production', target: 'node', entry: path.join(temp, 'entry.mjs'),
    optimization: { minimize: false },
    output: { path: temp, filename: 'bundle.cjs', library: { type: 'commonjs2' } },
    externals: { 'tesseract.js': `commonjs ${requireFromProject.resolve('tesseract.js')}` },
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const { extractScannedPdfTextLocally } = requireFromProject(path.join(temp, 'bundle.cjs'));
  const png = await sharp(Buffer.from('<svg width="1400" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="60" y="240" font-family="Arial" font-size="140" fill="black">BUNDLED OCR 42</text></svg>')).png().toBuffer();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1400, 400] });
  pdf.addImage(png, 'PNG', 0, 0, 1400, 400);
  const result = await extractScannedPdfTextLocally(Buffer.from(pdf.output('arraybuffer')), { tempRoot: temp });
  assert.match(result.text.toUpperCase(), /BUNDLED OCR 42/);
  assert.deepEqual(result.pageResults.map(page => page.page), [1]);
  console.log('PASS packaged OCR resolves installed Hebrew/English data and reads a real image-only PDF');
} finally {
  const expectedPrefix = path.join(os.tmpdir(), 'contractorsystem-bundled-ocr-test-');
  assert.ok(temp.startsWith(expectedPrefix));
  await rm(temp, { recursive: true, force: true });
}
