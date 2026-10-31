import './codex-runtime/load-server.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {NextRequest,NextResponse} from 'next/server.js';
const feature=await import('../src/utils/workspace-middleware.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const request=(path,method='GET',origin)=>new NextRequest('http://127.0.0.1:3006'+path,{method,headers:{host:'127.0.0.1:3006',...(origin?{origin}:{})}});
function setup(){assert.equal(typeof feature.createWorkspaceMiddleware,'function');let calls=0;return {handle:feature.createWorkspaceMiddleware(async()=>{calls++;return NextResponse.next({headers:{'x-entry-checked':'yes'}});}),calls:()=>calls};}
test('letter and readiness routes reach their own authentication without repeating workspace entry calls',async()=>{
 const fx=setup();for(const path of ['/api/correspondence?projectId=example','/api/system/ai-status?action=letter']){const result=await fx.handle(request(path));assert.equal(result.headers.get('x-middleware-next'),'1');assert.equal(result.headers.get('cache-control'),'private, no-store');}
 assert.equal(fx.calls(),0);
});
test('the entry page and unlisted routes keep their existing workspace authentication',async()=>{
 const fx=setup();for(const path of ['/','/api/correspondence/other','/api/correspondence-copy','/api/system/runtime','/api/documents']){const result=await fx.handle(request(path));assert.equal(result.headers.get('x-entry-checked'),'yes');}assert.equal(fx.calls(),5);
});
test('a cross-origin write is still refused before either authentication path',async()=>{
 const fx=setup();const response=await fx.handle(request('/api/correspondence','POST','https://other.example'));assert.equal(response.status,403);assert.equal(fx.calls(),0);assert.equal((await response.json()).code,'CROSS_ORIGIN_REQUEST');
});
test('the correspondence handler itself still rejects an unauthenticated caller',async()=>{
 const {createCorrespondenceHandlers}=await import('../src/utils/correspondence-server.ts');const handler=createCorrespondenceHandlers(async()=>({auth:{getUser:async()=>({data:{user:null},error:null})},from(){throw Error('Anonymous caller reached data');}}));
 assert.equal((await handler.get(new Request('http://127.0.0.1:3006/api/correspondence?projectId=example'))).status,401);
});
