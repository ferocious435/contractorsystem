import test from 'node:test';
import assert from 'node:assert/strict';
const {getCodexReadiness}=await import('../src/utils/ai-readiness.ts');
test('a ready writing action does not depend on unrelated handlers',()=>{
 const state={authenticated:true,configured:true,kinds:['letter','consultant']};
 assert.equal(getCodexReadiness(state,'letter').available,true);
 assert.equal(getCodexReadiness(state,'consultant').available,true);
 assert.equal(getCodexReadiness(state,'scan').available,false);
});
test('missing login and configuration cannot be hidden by a registered action',()=>{
 assert.equal(getCodexReadiness({authenticated:false,configured:true,kinds:['letter']},'letter').available,false);
 assert.equal(getCodexReadiness({authenticated:true,configured:false,kinds:['letter']},'letter').available,false);
});
