import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

let previewModule = null;
try {
  previewModule = await import("../src/utils/local-ai-preview.ts");
} catch {
  // The first run should fail clearly until preview helpers exist.
}

function read(relativePath) {
  return fs.readFileSync(relativePath, "utf8").replace(/\r\n/g, "\n");
}

test("evidence window keeps the matching source passage", () => {
  assert.ok(previewModule?.extractEvidenceWindow, "preview helper must exist");
  const source = `${"prefix ".repeat(300)}ברז כבוי אש הידרנט תוצרת רפאל${" suffix".repeat(300)}`;
  const excerpt = previewModule.extractEvidenceWindow(source, "ברז כבוי אש הידרנט תוצרת רפאל", 160);

  assert.ok(excerpt.includes("ברז כבוי אש הידרנט תוצרת רפאל"));
  assert.ok(excerpt.length <= 360);
});

test("quote verification tolerates harmless whitespace differences", () => {
  assert.ok(previewModule?.quoteExistsInSource, "quote verifier must exist");
  assert.equal(
    previewModule.quoteExistsInSource("נדרש   לקבל אישור\nבכתב", "נדרש לקבל אישור בכתב"),
    true
  );
  assert.equal(previewModule.quoteExistsInSource("טקסט אחר", "ציטוט חסר"), false);
});

test("default evidence window stays small enough for the local model", () => {
  assert.ok(previewModule?.extractEvidenceWindow, "preview helper must exist");
  const quote = "ציטוט מדויק";
  const source = `${"לפני ".repeat(2000)}${quote}${" אחרי".repeat(2000)}`;
  const excerpt = previewModule.extractEvidenceWindow(source, quote);

  assert.ok(excerpt.includes(quote));
  assert.ok(excerpt.length <= 1200);
});

test("known-finding preview route is read-only and uses the selected AI provider", () => {
  const route = read("src/app/api/scan/preview/route.ts");

  assert.ok(route.includes("generateComparisonText"));
  assert.ok(route.includes("quoteExistsInSource"));
  assert.ok(route.includes("contractQuote: storedContractQuote"));
  assert.ok(route.includes("workQuote: storedWorkQuote"));
  assert.ok(route.includes("storedContractQuoteExists"));
  assert.ok(route.includes("storedWorkQuoteExists"));
  assert.ok(route.includes("numPredict: 256"));
  assert.ok(route.includes("numCtx: 4_096"));
  assert.equal(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(route), false);
});

test("normal scan uses the selected provider and records its identity", () => {
  const route = read("src/app/api/scan/route.ts");

  assert.ok(route.includes("generateComparisonText"));
  assert.equal(route.includes("geminiModel.generateContent"), false);
  assert.ok(route.includes("analysis_provider"));
  assert.ok(route.includes("analysis_model"));
});

test("authenticated diagnostic page runs the read-only preview", () => {
  const page = read("src/app/local-ai-check/LocalAiCheckClient.tsx");

  assert.ok(page.includes("/api/scan/preview?findingRef="));
  assert.ok(page.includes("databaseChanged"));
  assert.ok(page.includes("readOnly"));
});
