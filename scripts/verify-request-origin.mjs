import test from 'node:test';import assert from 'node:assert/strict';
const feature=await import('../src/utils/request-origin.ts').catch(()=>({}));
const allowed=(method,origin,host='127.0.0.1:3006',site)=>{assert.equal(typeof feature.isSameOriginRequest,'function');return feature.isSameOriginRequest({method,url:'http://localhost:3006/api/correspondence',headers:new Headers({...origin!==undefined?{origin}:{},host,...site?{'sec-fetch-site':site}:{}})});};
test('real browser writes keep the original host even when Next normalizes the request URL',()=>{
 assert.equal(allowed('POST','http://127.0.0.1:3006'),true);assert.equal(allowed('POST','http://localhost:3006','localhost:3006'),true);
});
test('another website, another port and an opaque origin cannot perform a local mutation',()=>{
 for(const origin of ['https://other.example','http://127.0.0.1:3002','null','not a URL'])assert.equal(allowed('POST',origin),false);
 assert.equal(allowed('DELETE',undefined,'127.0.0.1:3006','cross-site'),false);
});
test('same-host CLI checks without a browser origin and read-only navigation remain usable',()=>{
 assert.equal(allowed('POST',undefined),true);assert.equal(allowed('GET','https://other.example'),true);assert.equal(allowed('HEAD',undefined),true);
});
