import test from 'node:test';import assert from 'node:assert/strict';
const runtimePaths=await import('../src/server/ai/reading-runtime-path.server.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const local='C:\\Users\\Example\\AppData\\Local',root=local+'\\ContractorSystem\\ai-runtime',physical=local+'\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\ContractorSystem\\ai-runtime';
const settings={platform:'win32',localAppData:local};
test('a_packaged_child_can_resolve_physically_below_an_unredirected_runtime_ancestor',()=>{
 assert.equal(typeof runtimePaths.sameReadingRuntimePath,'function');const same=runtimePaths.sameReadingRuntimePath;
 for(const child of ['jobs\\job-id','jobs\\job-id\\fragment-read-uuid','reading-cache\\owner\\project\\document\\source\\unit.progress.json']){
  assert.equal(same(root,root+'\\'+child,physical+'\\'+child,settings),true);
  assert.equal(same(root,root+'\\'+child,root+'\\'+child,settings),true);
 }
});
test('a_runtime_redirect_never_accepts_another_package_user_job_or_outside_path',()=>{
 assert.equal(typeof runtimePaths.sameReadingRuntimePath,'function');const same=runtimePaths.sameReadingRuntimePath,expected=root+'\\jobs\\job-a\\image.png';
 for(const actual of [physical+'\\jobs\\job-b\\image.png',physical.replace('OpenAI.Codex_2p2nqsd0c76g0','Other.App_family')+'\\jobs\\job-a\\image.png',physical.replace('Example','Different')+'\\jobs\\job-a\\image.png',local+'\\private\\image.png',physical+'\\..\\private\\image.png'])assert.equal(same(root,expected,actual,settings),false);
 assert.equal(same(root,local+'\\private\\image.png',local+'\\private\\image.png',settings),false);
 assert.equal(same(root,expected,physical+'\\jobs\\job-a\\image.png',{...settings,platform:'linux'}),false);
 assert.equal(same(local+'\\different-runtime',local+'\\different-runtime\\image.png',physical+'\\image.png',settings),false);
});
