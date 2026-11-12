import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const api=existsSync(new URL('../src/utils/writing-number-evidence.ts',import.meta.url))?await import('../src/utils/writing-number-evidence.ts'):{};
function missing(text,evidence){assert.equal(typeof api.unverifiedWritingNumbers,'function');return api.unverifiedWritingNumbers(text,evidence);}

test('equivalent date and range are known without changing numeric value',()=>{
 assert.deepEqual(missing('ביום 01.01.25 מגרשים 1450–1499','ביום 1.1.25 מגרשים 1450-1499'),[]);
 assert.deepEqual(missing('ביום 01.01.2025','ביום 1.1.2025'),[]);
 assert.deepEqual(missing('ביום 1.1.25','ביום 01.01.25'),[]);
 assert.deepEqual(missing('חתכים 1450—1499','חתכים 1450-1499'),[]);
});
test('date identity preserves separator, year, calendar and day-month order',()=>{
 for(const [text,evidence] of [
  ['ביום 02.01.25','ביום 1.1.25'],['ביום 01.02.25','ביום 2.1.25'],
  ['ביום 01.01.2025','ביום 1.1.25'],['ביום 01/01/25','ביום 1.1.25'],
  ['ביום 31.02.25','ביום 31.2.25'],['ביום 29.02.25','ביום 29.2.25'],
  ['ביום 00.01.25','ביום 0.1.25'],['ביום 01.13.25','ביום 1.13.25'],
 ])assert.notDeepEqual(missing(text,evidence),[],text);
 assert.deepEqual(missing('ביום 29.02.24','ביום 29.2.24'),[]);
});
test('clause numbers and document codes are not dates or ranges',()=>{
 for(const [text,evidence] of [
  ['סעיף 01.01.25','סעיף 1.1.25'],['clause 01.01.25','clause 1.1.25'],
  ['קוד A01.01.25','קוד A1.1.25'],['מסמך R1450–1499','מסמך R1450-1499'],
  ['מק"ט 1450–1499','מק"ט 1450-1499'],
 ])assert.notDeepEqual(missing(text,evidence),[],text);
 assert.deepEqual(missing('סעיף 1.1.25 וקוד R1450-1499','סעיף 1.1.25 וקוד R1450-1499'),[]);
});
test('range bounds and negative signs remain evidence-bound',()=>{
 for(const [text,evidence] of [
  ['חתכים 1450–1500','חתכים 1450-1499'],['חתכים 1499–1450','חתכים 1450-1499'],
  ['גובה 5','גובה -5'],['גובה -5','גובה 5'],
  ['טווח 5–10','טווח -5-10'],['גובה 5.00','גובה 5'],
 ])assert.notDeepEqual(missing(text,evidence),[],text);
 assert.deepEqual(missing('גובה -5','גובה -5'),[]);
 assert.notDeepEqual(missing('חתך 1450','חתכים 1450-1499'),[]);
});
test('a known full date is masked only outside a currency or amount expression',()=>{
 assert.equal(typeof api.maskKnownWritingDates,'function');
 assert.doesNotMatch(api.maskKnownWritingDates('ביום 01.01.25 נמסר עדכון','ביום 1.1.25'),/01\.01\.25/);
 assert.match(api.maskKnownWritingDates('ביום 02.01.25','ביום 1.1.25'),/02\.01\.25/);
 for(const text of ['1.1.25 ₪','₪ 1.1.25','1.1.25 USD','1.1.25%','מחיר 1.1.25','סעיף 1.1.25']){
  assert.equal(api.maskKnownWritingDates(text,'ביום 1.1.25'),text);
 }
});
