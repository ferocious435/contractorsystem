import test from 'node:test';import assert from 'node:assert/strict';
const {BusinessAiError}=await import('../src/server/ai/contracts.ts');
const result=await import('../src/utils/correspondence-result.ts').catch(()=>({}));
const source={sourceId:'S1',documentId:'10000000-0000-4000-8000-000000000001',title:'הנחיה',pageLabel:null,quote:'יש לבקש הנחיה כתובה.',basis:'DOCUMENT',status:'VERIFIED',manualNote:null};
test('an old generated source appendix becomes separate evidence while letter wording remains exact',()=>{
 assert.equal(typeof result.checkedCorrespondenceResult,'function');const body='לכבוד: מנהל הפרויקט\n\nנבקש לקבל הנחיה כתובה.';
 const raw={purpose:'correspondence',letter:body+'\n\nמקורות שמורים:\n[S1] · ציטוט מהטקסט השמור · הנחיה · יש לבקש הנחיה כתובה.',sourceRefs:[source]};
 const checked=result.checkedCorrespondenceResult(raw);assert.equal(checked.letter,body);assert.equal(checked.sourceRefs[0].quote,'יש לבקש הנחיה כתובה.');
});
test('new results preserve an explicitly requested quotation instead of editing the user text',()=>{
 assert.equal(typeof result.checkedCorrespondenceResult,'function');const body='נבקש הבהרה.\n\nמקורות שמורים:\n[S1] · ציטוט מהטקסט השמור · הנחיה · יש לבקש הנחיה כתובה.';
 assert.equal(result.checkedCorrespondenceResult({purpose:'correspondence',formatVersion:'correspondence-v2',letter:body,sourceRefs:[source]}).letter,body);
});
test('an uncertain network timeout keeps the request identity but a confirmed terminal timeout permits a new attempt',()=>{
 assert.equal(typeof result.generationIdentityAfterFailure,'function');const pending={signature:'same input',id:'saved-key'};
 assert.deepEqual(result.generationIdentityAfterFailure(pending,new BusinessAiError('AI_TIMEOUT','timeout',408)),pending);
 assert.equal(result.generationIdentityAfterFailure(pending,new BusinessAiError('AI_TIMEOUT','failed job',409)),null);
 assert.equal(result.generationIdentityAfterFailure(pending,new BusinessAiError('AI_CANCELLED','cancelled',409)),null);
});
