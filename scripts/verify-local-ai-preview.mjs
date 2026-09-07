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

test("PDF text normalization rejoins Hebrew letters split by table tabs", () => {
  assert.ok(previewModule?.normalizePdfLetterSpacing, "PDF text normalizer must exist");
  const source = "ב\tר\tז כ\tי\tב\tו\tי א\tש ה\tי\tד\tר\tנ\tט ת\tו\tצ\tר\tת ר\tפ\tא\tל";
  const normalized = previewModule.normalizePdfLetterSpacing(source);

  assert.equal(normalized, "ברז כיבוי אש הידרנט תוצרת רפאל");
});

test("contract item reference can locate a quote with OCR formatting differences", () => {
  assert.ok(previewModule?.findEvidenceReferenceMatch, "reference matcher must exist");
  const source = '57.90.0018 ברז כיבוי אש הידרנט כפול 3x2 תוצרת רפאל או שווה ערך';
  const quote = 'ברז כבוי אש (הידרנט) כפול בקוטר "3*2 תוצרת "רפאל" בהתאם לסעיף 57.90.0018';
  const match = previewModule.findEvidenceReferenceMatch(source, quote);

  assert.equal(match?.reference, "57.90.0018");
  assert.ok(match?.excerpt.includes("תוצרת רפאל"));
});

test("contract item reference tolerates spaces and direction marks between number groups", () => {
  const source = 'סעיף 5 7 \u200f. 9 0 . 0 0 1 8 כולל הידרנט תוצרת רפאל';
  const quote = 'סעיף 57\u200b.90.\u20600018 בכתב הכמויות';
  const match = previewModule.findEvidenceReferenceMatch(source, quote);

  assert.equal(match?.reference, "57.90.0018");
  assert.ok(match?.excerpt.includes("הידרנט תוצרת רפאל"));
});

test("contract item reference can fall back to the shared item suffix", () => {
  const source = 'סעיף 57.90.0018 כולל הידרנט תוצרת רפאל';
  const quote = 'פריט חוזי 0018 עבור הידרנט רפאל';
  const match = previewModule.findEvidenceReferenceMatch(source, quote);

  assert.equal(match?.reference, "57.90.0018");
});

test("distinctive evidence terms locate a nearby OCR passage", () => {
  const source = 'טקסט קודם. ברז כיבוי אש הידרנט כפול תוצרת רפאל או שווה ערך. טקסט אחרי.';
  const quote = 'ברז כבוי אש (הידרנט) כפול תוצרת "רפאל"';
  const matches = previewModule.findEvidenceTermMatches(source, quote);

  assert.ok(matches.some((item) => item.term === "הידרנט"));
  assert.ok(matches.some((item) => item.term === "רפאל"));
  assert.ok(matches[0].excerpt.includes("תוצרת רפאל"));
});

test("evidence window prefers a rare contract term over a generic early passage", () => {
  const source = `${"הידרנט לפי הוראות כלליות ".repeat(100)}פריט מיוחד הידרנט תוצרת רפאל או הכוכב${" סיום".repeat(100)}`;
  const quote = 'ברז הידרנט תוצרת "רפאל" או "הכוכב"';
  const excerpt = previewModule.extractEvidenceWindow(source, quote, 120);

  assert.ok(excerpt.includes("תוצרת רפאל או הכוכב"));
});

test("default evidence window stays small enough for the local model", () => {
  assert.ok(previewModule?.extractEvidenceWindow, "preview helper must exist");
  const quote = "ציטוט מדויק";
  const source = `${"לפני ".repeat(2000)}${quote}${" אחרי".repeat(2000)}`;
  const excerpt = previewModule.extractEvidenceWindow(source, quote);

  assert.ok(excerpt.includes(quote));
  assert.ok(excerpt.length <= 1200);
});

test("evidence window falls back to a contract item reference", () => {
  const source = `${"ברז כבוי אש לפי הוראות כלליות ".repeat(80)}57.90.0018 ב\tר\tז כ\tי\tב\tו\tי א\tש ה\tי\tד\tר\tנ\tט ת\tו\tצ\tר\tת ר\tפ\tא\tל${" סיום".repeat(500)}`;
  const quote = 'ברז כבוי אש לפי סעיף 57.90.0018 תוצרת "רפאל"';
  const excerpt = previewModule.extractEvidenceWindow(source, quote, 160);

  assert.ok(excerpt.includes("57.90.0018"));
  assert.ok(excerpt.includes("הידרנט תוצרת רפאל"));
  assert.ok(excerpt.length <= 360);
});

test("known-finding preview route is read-only and uses the selected AI provider", () => {
  const route = read("src/app/api/scan/preview/route.ts");

  assert.ok(route.includes("generateComparisonText"));
  assert.ok(route.includes("quoteExistsInSource"));
  assert.ok(route.includes("contractQuote: storedContractQuote"));
  assert.ok(route.includes("workQuote: storedWorkQuote"));
  assert.ok(route.includes("storedContractQuoteExists"));
  assert.ok(route.includes("storedWorkQuoteExists"));
  assert.ok(route.includes("contractEvidenceQuery"));
  assert.ok(route.includes("Pending approval alone is not a contract contradiction"));
  assert.ok(route.includes("sourcePairVerified && modelResult.contradiction_confirmed === true"));
  assert.ok(route.includes("confidence: sourcePairVerified ? modelConfidence : 0"));
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
  assert.ok(page.includes("/api/documents/extract-text"));
  assert.ok(page.includes("force: true"));
});
