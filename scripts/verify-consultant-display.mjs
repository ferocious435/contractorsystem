import test from 'node:test';import assert from 'node:assert/strict';
import {consultantDisplay} from '../src/utils/consultant-result.ts';
test('a saved legacy answer opens concisely while every quote, limitation and financial figure remains accessible',()=>{
 const value={sourceIds:['S1'],response:'המצב תועד בעבר; יש לברר את האישור העדכני.\n\nמקורות שמורים:\n[S1] מקור ונתון מדויק\n\nמה לא אומת:\nמסמך אחר — קריאה חסרה\n\nנתונים כספיים שמורים — כלל הפרויקט:\n100.00 ₪\n\nצעדים מוצעים:\nלבקש תשובה בכתב.'},original=structuredClone(value),shown=consultantDisplay(value);
 assert.ok(shown.content.includes('האישור העדכני'));assert.ok(shown.content.includes('לבקש תשובה בכתב'));assert.ok(!shown.content.includes('100.00'));for(const fact of ['מקור ונתון מדויק','קריאה חסרה','100.00 ₪'])assert.ok(shown.details.includes(fact));assert.deepEqual(value,original);
});
test('structured replies and untagged text never interpret a user heading as a removable appendix',()=>{
 for(const value of [{displayVersion:'consultant-v2',response:'שאלה\n\nמקורות שמורים:\nניסוח מכוון',details:'מקור מלא'},{response:'שאלה\n\nמקורות שמורים:\nניסוח מכוון'}])assert.equal(consultantDisplay(value).content,value.response);
});
