import assert from 'node:assert/strict';
import test from 'node:test';
const display = await import('../src/components/features/contradiction-radar/utils/issueTimingDisplay.ts').catch(() => ({}));
function explain(text) {
  assert.equal(typeof display.explainLetterResponseClock, 'function');
  return display.explainLetterResponseClock(text);
}
test('a response counted from the letter date must not invent a missing receipt date', () => {
  const result = explain('נשמח לקבל את תגובתכם ועדכון התייחסותכם בתוך 3 ימי עבודה ממועד מכתב זה.');
  assert.ok(result.includes('מועד המכתב'));
  assert.ok(!result.includes('קבלת'));
});
test('a receipt trigger is distinguished from the letter date without inventing a receipt fact', () => {
  const result = explain('נבקש תגובתכם בתוך 3 ימי עבודה ממועד קבלת המכתב.');
  assert.ok(result.includes('קבלת המכתב'));
  assert.ok(!result.includes('לא הוכח'));
});
test('an unspecified clock remains explicitly unspecified', () => {
  assert.ok(explain('נבקש תשובה בתוך 3 ימי עבודה.').includes('אינה מפורשת'));
});
