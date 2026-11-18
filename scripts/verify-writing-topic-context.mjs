import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const api=existsSync(new URL('../src/utils/writing-topic-context.ts',import.meta.url))?await import('../src/utils/writing-topic-context.ts'):{};
const document=(id,text,title='פרוטוקול.txt')=>({id,title,text,textHash:createHash('sha256').update(text).digest('hex')});
const question='מה מצב מדידת סחף קרקע ליד קיר כלונסאות במפעל נגב? האם הנושא הושלם?';
function select(documents,current=question,previous=''){
 assert.equal(typeof api.selectWritingTopicContext,'function');
 const result=api.selectWritingTopicContext(documents,current,previous);
 for(const source of result.sources){const original=documents.find(document=>document.id===source.documentId);assert.equal(original.text.slice(source.anchor.start,source.anchor.end),source.anchor.quote);assert.equal(source.anchor.documentId,original.id);}
 return result;
}

test('long numbered payment clauses retain the opening proposal and conditional response',()=>{
 const preamble='נספח\nתאריך: ______\n'+('פרטי הצדדים וכתובותיהם למסירת הודעות.\n'.repeat(18))+'הואיל: הקבלן ביקש שינוי שיטת קידוח צינורות ברחוב ספיר באמצעות מכונת MTM.\nוהואיל: המזמינה מוכנה לקבל את הבקשה בכפוף לתנאים הבאים.\n';
 const method='2. מוסכם שינוי שיטת קידוח צינורות ברחוב ספיר באמצעות מכונת MTM בתנאי הנספח.\n';
 const payment='5. התמורה בגין קידוח צינורות באמצעות מכונת MTM תישאר כפי שנקבע בחוזה. '+('הקבלן יישא בעלויות התכנון וההתאמות. '.repeat(6))+'\nלא תשולם תוספת בעבור שינוי השיטה.\n';
 const text=preamble+'1. יתר התנאים עומדים בעינם.\n'+method+'3. בטיחות:\n'+('יש לשמור על הגדרות והציוד באתר.\n'.repeat(70))+'4. תיאום:\n'+payment+'6. יש לעמוד בלוח הזמנים.\n';
 const current='מה התבקש הקבלן לבצע בנוגע לקידוח צינורות ברחוב ספיר? האם המעבר למכונת MTM משנה את התמורה?';
 const result=select([document('appendix',text)],current);
 assert.ok(result.sources.some(source=>source.anchor.quote.includes(payment)));
 assert.ok(result.sources.some(source=>source.anchor.quote.includes(preamble)&&source.anchor.quote.includes(method)));
 assert.ok(result.sources.every(source=>source.anchor.quote.length<=2400));
 assert.ok(result.warnings.some(warning=>warning.documentId==='appendix'&&warning.reason.includes('לא נמצא תאריך')));
});

test('a recital quoted in a late clause does not attach unrelated opening text',()=>{
 const opening='מבוא שאינו קשור לשאיבה.\n1. תיאום תאורה.\n';
 const clause='2. משאבות בתחנת ספיר: החלפת המשאבות ממתינה למסמך אחריות חתום.\nציטוט: הואיל: הוחלף הציוד.\n';
 const result=select([document('late-quote',opening+clause)],'מה הוסכם על החלפת המשאבות בתחנת ספיר ואחריות חתומה?');
 assert.ok(result.sources.some(source=>source.anchor.quote.includes(clause)));
 assert.ok(!result.sources.some(source=>source.anchor.quote.includes(opening)));
 const table=document('table','57.91.0016\t100\tתשלום תאורה וריצוף\t900\n');
 assert.equal(select([table],'מה הוסכם על החלפת המשאבות בתחנת ספיר ואחריות חתומה?').sources.length,0);
});
test('late topic status survives long contract background',()=>{
 const early='מפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.\nאחראי: הקבלן\t21.05.25';
 const late='מפעל נגב:\nמדידה ליד קיר כלונסאות טרם הועברה. הקבלן הבטיח למסור בימים הקרובים.\nאחראי: הקבלן\t13.08.25';
 const other='\n\nתאורה:\n'+('תאורה וריצוף בבדיקה.\n'.repeat(150));
 const docs=[...Array.from({length:30},(_,i)=>document('background-'+i,'חוזה\n'+('מדידת סחף קרקע במפעל נגב ליד קיר כלונסאות, כללי תיאום כלליים. '.repeat(100)))),document('early','פרוטוקול\nתאריך: 14.05.25\n\n'+early+other),document('late','פרוטוקול\nתאריך: 30.07.25\n\n'+late+other)];
 const result=select(docs);
 assert.ok(result.sources.some(source=>source.documentId==='early'&&source.anchor.quote.includes(early)));
 assert.ok(result.sources.some(source=>source.documentId==='late'&&source.anchor.quote.includes(late)));
 assert.ok(result.sources.findIndex(source=>source.documentId==='late')<result.sources.findIndex(source=>source.documentId==='background-0')||!result.sources.some(source=>source.documentId==='background-0'));
});
test('a protocol date is not a clause and its responsibility row stays with the instruction',()=>{
 const row='6\t.\nמפעל נגב:\nיש למסור מדידת סחף קרקע ליד קיר כלונסאות.\nהקבלן\t13.08.25';
 const text='פרוטוקול\nתאריך הדיון\n30.07.25\n\n'+row+'\n7\t.\nתאורה:\nיש לבדוק מנורות.';
 const result=select([document('row',text)]);
 assert.ok(result.sources.some(source=>source.anchor.quote.includes(row)));
 assert.ok(result.sources.some(source=>source.anchor.quote.includes('30.07.25')));
});
test('same company with other work cannot displace the topic',()=>{
 const relevant=document('drain','פרוטוקול\nתאריך: 1.7.25\n\nמפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.');
 const other=document('lights','פרוטוקול\nתאריך: 1.8.25\n\nמפעל נגב:\nהתקנת התאורה הסתיימה ואושרה.');
 const result=select([other,relevant]);
 assert.ok(result.sources.some(source=>source.documentId==='drain'));
 assert.ok(!result.sources.some(source=>source.documentId==='lights'));
});
test('filename and header date conflict is explicit and quoted from the saved header',()=>{
 const text='פרוטוקול\nתאריך הדיון\n30.07.25\n\nמפעל נגב:\nמדידה ליד קיר כלונסאות עדיין חסרה.';
 const result=select([document('conflict',text,'פרוטוקול 06.08.25.txt')]);
 assert.ok(result.warnings.some(warning=>warning.documentId==='conflict'&&warning.reason.includes('30.07.25')&&warning.reason.includes('06.08.25')));
 assert.ok(result.sources.some(source=>source.anchor.quote.includes('30.07.25')));
 const unknown=select([document('unknown','מפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.','פרוטוקול 01.01.2099.txt')]);
 assert.ok(unknown.warnings.some(warning=>warning.documentId==='unknown'&&/תאריך|מועד/u.test(warning.reason)));
});
test('a provable filename date conflict stays visible across short and full year formats',()=>{
 for(const [header,filename] of [['30.07.25','06.08.2025'],['30.07.2025','06.08.25'],['30.07.25','30.07.2024']]){
  const result=select([document('conflict','תאריך: '+header+'\n\nמפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.','פרוטוקול '+filename+'.txt')]);
  assert.ok(result.warnings.some(warning=>warning.reason.includes(header)&&warning.reason.includes(filename)),header+' versus '+filename);
 }
 const same=select([document('same','תאריך: 30.07.25\n\nמפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.','פרוטוקול 30.07.2025.txt')]);
 assert.equal(same.warnings.length,0);
});
test('an impossible four-digit year is not accepted as a dated header',()=>{
 const result=select([document('zero','תאריך: 01.01.0000\n\nמפעל נגב:\nנדרשת מדידת סחף קרקע ליד קיר כלונסאות.')]);
 assert.ok(result.warnings.some(warning=>warning.documentId==='zero'&&warning.reason.includes('לא נמצא תאריך')));
});
test('late explicit receipt is retained alongside the older pending instruction',()=>{
 const pending='נדרשת מדידת סחף קרקע ליד קיר כלונסאות.';
 const received='מדידת קיר כלונסאות התקבלה ואושרה על ידי הפיקוח.';
 const result=select([document('pending','תאריך: 1.7.25\n\nמפעל נגב:\n'+pending),document('received','תאריך: 1.8.25\n\nמפעל נגב:\n'+received)]);
 assert.ok(result.sources.some(source=>source.documentId==='pending'&&source.anchor.quote.includes(pending)));
 assert.ok(result.sources.some(source=>source.documentId==='received'&&source.anchor.quote.includes(received)));
});
test('a long indivisible topic leaves an explicit limitation instead of a claimed complete fragment',()=>{
 const result=select([document('long','תאריך: 1.7.25\n\nמפעל נגב:\nמדידת סחף קרקע ליד קיר כלונסאות '+('מידע ללא סוף משפט '.repeat(400)))]);
 assert.ok(result.warnings.some(warning=>warning.documentId==='long'));
 assert.ok(result.sources.every(source=>source.anchor.quote.length<=2400));
});
test('the latest subject precedes an earlier different topic and follow-up can reuse the old subject',()=>{
 const docs=[document('light','תאורה:\nתכנון התאורה ומיקומי המנורות עדיין בבדיקה.'),document('pump','משאבות:\nהחלפת המשאבות בתחנות שאיבה ממתינה למסמך אחריות חתום.')];
 const current='מה הוסכם על החלפת המשאבות בתחנות שאיבה ואחריות חתומה?',previous='מה מצב תכנון התאורה ומיקומי המנורות?';
 assert.equal(select(docs,current,previous).sources[0].documentId,'pump');
 assert.ok(select(docs,'אפשר להמשיך?',current).sources.some(source=>source.documentId==='pump'));
});
