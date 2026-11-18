import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWritingResult} from '../src/utils/business-writing-result.ts';

const source=(sourceId,pageLabel,extra={})=>({sourceId,pageLabel,documentId:sourceId,title:'מסמך שמור',
 quote:'העבודה והאספקה נמדדות בנפרד.',basis:'DOCUMENT',status:'VERIFIED',manualNote:null,...extra});
const facts={kind:'consultant',projectName:'פרויקט',userText:'בדוק את ההנחיות.',sources:[source('S9','137'),source('S11','138'),source('S12','17')]};
const result=(body,extra={})=>({body,sourceIds:['S9','S11','S12'],unknowns:[],nextActions:[],...extra});
const validate=(raw,context=facts)=>validateWritingResult(JSON.stringify(raw),context);

test('explicit Hebrew page references retain the exact consultant answer and source selection',()=>{
 const raw=result('ניתן לבדוק במסמך, עמ׳ 137, ובמסמך הנוסף, עמ׳ 17. [S9, S12]\n• באותם מסמכים, עמ׳ 138 ועמ׳ 17 בהתאמה. [S11, S12]',
  {unknowns:['יש לברר את המעמד בעמוד 137 [S9].'],nextActions:["מוצע לבדוק בעמ' 138 (S11)."]});
 assert.deepEqual(validate(raw),raw);
});
test('a page reference requires the exact selected verified document source in the same paragraph',()=>{
 for(const raw of [
  result('ניתן לבדוק בעמוד 138 [S9].'),
  result('ניתן לבדוק בעמוד 999 [S9].'),
  result('ניתן לבדוק בעמוד 137.\n\nנדרש בירור [S9].'),
  result('ניתן לבדוק בעמוד 137 [S9].',{sourceIds:['S11']}),
 ])assert.throws(()=>validate(raw),error=>/^AI_/.test(error.code));
 for(const extra of [{status:'REQUIRES_VERIFICATION'},{basis:'MANUAL'},{documentId:null}]){
  assert.throws(()=>validate(result('ניתן לבדוק בעמוד 137 [S9].',{sourceIds:['S9']}),{...facts,sources:[source('S9','137',extra)]}),error=>/^AI_/.test(error.code));
 }
});
test('known pages never whitelist separate quantities amounts locations or codes in the same paragraph',()=>{
 for(const body of [
  'ניתן לבדוק בעמוד 137 [S9]. נדרשים 137 צינורות.',
  'ניתן לבדוק בעמוד 137 [S9]. יש לשלם 137 ₪.',
  'ניתן לבדוק בעמוד 137 [S9]. מגרש 137 נכלל.',
  'ניתן לבדוק בעמוד 137 [S9]. קוד 137 מחייב.',
  'קוד עמ׳ 137 חל [S9].',
  'הכמות היא עמ׳ 137 [S9].',
  'נדרש עמ׳ 137 מטר [S9].',
  'יש לשלם עמ׳ 137 ₪ [S9].',
  'ניתן לבדוק בעמוד 137.5 [S9].',
  'קודעמוד 137 [S9].',
  '9עמוד 137 [S9].',
 ])assert.throws(()=>validate(result(body)),error=>/^AI_/.test(error.code),body);
});
test('literal quotations still require the page reference to occur verbatim in the source quote',()=>{
 assert.throws(()=>validate(result('נכתב: "עמ׳ 137" [S9].')),error=>error.code==='AI_QUOTE_UNVERIFIED');
});
test('page metadata does not change letter fact validation',()=>{
 assert.throws(()=>validate({body:'ניתן לבדוק בעמוד 137 [S9].',sourceIds:['S9']},{...facts,kind:'letter'}),error=>error.code==='AI_FACT_UNVERIFIED');
});
