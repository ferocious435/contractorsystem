import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWritingResult} from '../src/utils/business-writing-result.ts';

const source=(sourceId,pageLabel,title)=>({sourceId,pageLabel,title,documentId:sourceId,
 quote:'סעיף 5 מתאר את העבודה.',basis:'DOCUMENT',status:'VERIFIED',manualNote:null});
const facts={kind:'consultant',projectName:'פרויקט',userText:'בדוק את המקורות.',sources:[
 source('S9','137','A.pdf'),source('S11','138','A.pdf'),source('S14','18','B.pdf'),
 {...source('S27',null,'677365.pdf'),quote:'מספר המסמך הוא 677365-668; סעיף 5 עוסק בבדיקה.'}]};
const raw=(body,extra={})=>({body,sourceIds:['S9','S11','S14','S27'],unknowns:[],nextActions:[],...extra});
const validate=(value,context=facts)=>validateWritingResult(JSON.stringify(value),context);

test('NFKC separators with spaces cannot split a page list before a separately known number',()=>{
 for(const separator of [',','，','．','／','：','－']){
  assert.throws(()=>validate(raw(`ניתן לבדוק בעמודים 138${separator} 5 [S11].`)),error=>/^AI_/.test(error.code),separator);
 }
 const value=raw('ניתן לבדוק בעמודים 138， 18 [S11, S14].');
 assert.deepEqual(validate(value),value);
});
for(const currency of ['₪','ש״ח','NIS','ILS','USD','EUR','$','€','%'])test(`an exact filename cannot stand for an amount next to ${currency}`,()=>{
 for(const gap of ['',' ','\u200f \u200e','\u2067 \u2069']){
  for(const body of [`677365.pdf${gap}${currency} [S27].`,`נדרש 677365.pdf${gap}${currency} [S27].`,`${currency}${gap}677365.pdf [S27].`]){
   assert.throws(()=>validate(raw(body)),error=>/^AI_/.test(error.code),body);
  }
 }
});

for(const pages of ['138 ו־18','138 ו-18','138 ו18','138, 18','138, ו־18','137, 138 ו־18'])test(`plural page enumeration ${pages} preserves the original response`,()=>{
 const value=raw(`הוא מופיע בעמודים ${pages}, בהתאמה. [S9, S11, S14]`,{
  unknowns:[`מה מעמד המסמך בעמודים ${pages}? [S9, S11, S14]`],
  nextActions:[`יש לבדוק את העמודים ${pages} [S9, S11, S14].`]});
 assert.deepEqual(validate(value),value);
});
test('page enumeration accepts only exact locally cited pages and never new ranges or measurements',()=>{
 for(const pages of ['138 ו־19','138–18','138 עד 18','138,5','138 ו־18,5','138, 5','138 ו־18 מ״מ','138 ו־18 mm','138，5','138 ו־18／5']){
  assert.throws(()=>validate(raw(`ניתן לבדוק בעמודים ${pages} [S11, S14].`)),error=>/^AI_/.test(error.code),pages);
 }
 assert.throws(()=>validate(raw('ניתן לבדוק בעמודים 138 ו־18 [S11].')),error=>/^AI_/.test(error.code));
 assert.throws(()=>validate(raw('ניתן לבדוק בעמודים 138 ו־18.\n\nהמקורות [S11, S14].')),error=>/^AI_/.test(error.code));
});
test('a known second bound cannot validate a new page range by masking its first bound',()=>{
 const context={...facts,sources:[{...facts.sources[1],quote:'סעיף 18 מתאר את העבודה.'}]};
 for(const range of ['138 עד 18','138 עד18','138 ועד 18','138 ועד18']){
  assert.throws(()=>validate(raw(`ניתן לבדוק בעמודים ${range} [S11].`,{sourceIds:['S11']}),context),error=>/^AI_/.test(error.code),range);
 }
});
test('exact locally cited filename and full sourced code preserve the response without sharing their digits',()=>{
 const value=raw('גם 677365.pdf, שמספרו 677365-668, הוא מסמך שנדרש לבדוק. [S27]');
 assert.deepEqual(validate(value),value);
 for(const suffix of ['קוד 677365 חל.','נדרשים 677365 צינורות.','מגרש 677365 נכלל.','יש לשלם 677365 ₪.']){
  assert.throws(()=>validate(raw('ניתן לבדוק את 677365.pdf [S27]. '+suffix)),error=>/^AI_/.test(error.code),suffix);
 }
});
test('a filename must match completely at its boundaries and cannot belong to another local source',()=>{
 for(const title of ['677365','677365.docx','X677365.pdf','9677365.pdf','677365.pdf2','677365.pdf.bak','archive/677365.pdf','677365.pdf-668','5,677365.pdf','5，677365.pdf']){
  assert.throws(()=>validate(raw(`ניתן לבדוק את ${title} [S27].`)),error=>/^AI_/.test(error.code),title);
 }
 assert.throws(()=>validate(raw('ניתן לבדוק את 677365.pdf [S9].')),error=>/^AI_/.test(error.code));
 assert.throws(()=>validate(raw('ניתן לבדוק את 677365.pdf.\n\nהמקור [S27].')),error=>/^AI_/.test(error.code));
 for(const extra of [{status:'REQUIRES_VERIFICATION'},{basis:'MANUAL'},{documentId:null}]){
  assert.throws(()=>validate(raw('ניתן לבדוק את 677365.pdf [S27].',{sourceIds:['S27']}),{
   ...facts,sources:[{...facts.sources[3],...extra}]}),error=>/^AI_/.test(error.code));
 }
});
test('a complete filename with punctuation is matched literally rather than as a pattern',()=>{
 const context={...facts,sources:[{...facts.sources[3],title:'מפרט [677365] (002).pdf'}]};
 const value=raw('ניתן לבדוק את מפרט [677365] (002).pdf [S27].',{sourceIds:['S27']});
 assert.deepEqual(validate(value,context),value);
 assert.throws(()=>validate(raw('ניתן לבדוק את מפרט 677365 002.pdf [S27].',{sourceIds:['S27']}),context),error=>/^AI_/.test(error.code));
});
test('filename metadata cannot disguise a dimension amount code or literal quotation',()=>{
 for(const body of ['הקוטר הוא 677365.pdf מ״מ [S27].','נדרש 677365.pdf mm [S27].','קוד 677365.pdf חל [S27].','יש לשלם 677365.pdf ₪ [S27].']){
  assert.throws(()=>validate(raw(body)),error=>/^AI_/.test(error.code),body);
 }
 assert.throws(()=>validate(raw('נכתב: "677365.pdf" [S27].')),error=>error.code==='AI_QUOTE_UNVERIFIED');
 assert.throws(()=>validate(raw('נכתב: "עמודים 138 ו־18" [S11, S14].')),error=>error.code==='AI_QUOTE_UNVERIFIED');
});
test('plural pages and filename metadata do not expand letters',()=>{
 for(const body of ['ניתן לבדוק בעמודים 138 ו־18 [S11, S14].','ניתן לבדוק את 677365.pdf [S27].']){
  assert.throws(()=>validate({body,sourceIds:['S11','S14','S27']},{...facts,kind:'letter'}),error=>error.code==='AI_FACT_UNVERIFIED');
 }
});
