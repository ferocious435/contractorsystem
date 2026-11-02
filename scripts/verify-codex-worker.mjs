import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {queueFixture,projectId} from './codex-runtime/queue-fixtures.mjs';
import {ownerId,otherId} from './codex-runtime/fixtures.mjs';
const workerModule=existsSync(new URL('../src/server/ai/worker.server.ts',import.meta.url))?await import('../src/server/ai/worker.server.ts'):{};
function worker(fx,options={}){assert.equal(typeof workerModule.createAiWorker,'function','Guarded worker is missing');return workerModule.createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0,...options});}
test('duplicate wakeups and two workers never execute more than one simultaneous model turn',async()=>{
  const fx=queueFixture();await fx.enqueue();await fx.enqueue('second');const a=worker(fx),b=worker(fx);await Promise.all([a.run(),a.run(),b.run()]);
  assert.equal(fx.modelTurns,2);assert.equal(fx.maxParallel,1);assert.deepEqual([...fx.rows.values()].map(j=>j.state),['SUCCEEDED','SUCCEEDED']);
});
test('nested comparisons run serially within the same owned parent job',async()=>{
  const fx=queueFixture();fx.handler.execute=async(payload,execution)=>{assert.equal(workerModule.isAiExecutionContext(execution),true);const first=await execution.generate({text:'one',outputSchema:{type:'object'}}),second=await execution.generate({text:'two',outputSchema:{type:'object'}});return {result:{first:JSON.parse(first),second:JSON.parse(second)},effects:[]};};
  await fx.enqueue();await worker(fx).run();assert.equal(fx.rows.size,1);assert.equal(fx.modelTurns,2);assert.equal(fx.maxParallel,1);assert.equal([...fx.rows.values()][0].state,'SUCCEEDED');
});
test('saved jobs with a foreign profile never reach the model',async()=>{
  const fx=queueFixture(),job=await fx.enqueue();fx.rows.get(job.id).profile.ownerId=otherId;await worker(fx).run();assert.equal(fx.modelTurns,0);assert.equal(fx.rows.get(job.id).state,'FAILED');
});
test('cancelled work discards a late final answer and preserves the cancelled state',async()=>{
  let finish,started;const entered=new Promise(resolve=>started=resolve),answer=new Promise(resolve=>finish=resolve);const fx=queueFixture({onGenerate:async()=>{started();return answer;}}),job=await fx.enqueue(),api=worker(fx),running=api.run();await entered;
  const current=await fx.store.readOwned(ownerId,projectId,job.id);await fx.store.cancel(ownerId,job.id,current.revision);api.abort(job.id);finish('{"answer":"late"}');await running;
  assert.equal(fx.rows.get(job.id).state,'CANCELLED');assert.equal(fx.rows.get(job.id).result,null);assert.equal(fx.modelTurns,1);
});
test('a model failure or incomplete stream is recorded without automatic replay',async()=>{
  for(const code of ['AI_TIMEOUT','AI_RESPONSE_INCOMPLETE']){const fx=queueFixture({onGenerate:async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_DATA'),{code});}}),job=await fx.enqueue();await worker(fx).run();assert.equal(fx.modelTurns,1);assert.equal(fx.rows.get(job.id).state,'FAILED');assert.ok(!JSON.stringify(fx.rows.get(job.id).error).includes('PRIVATE_PROVIDER_DATA'));}
});
test('a rejected business answer retains a safe reason without saving private provider output',async()=>{
  for(const code of ['AI_FACT_UNVERIFIED','AI_AMOUNT_UNVERIFIED','AI_QUOTE_UNVERIFIED','AI_SOURCE_UNVERIFIED','AI_WRITING_INVALID']){
    const fx=queueFixture(),job=await fx.enqueue();fx.handler.execute=async()=>{throw Object.assign(Error('PRIVATE_REJECTED_ANSWER'),{code});};
    await worker(fx).run();const failed=fx.rows.get(job.id);assert.equal(failed.state,'FAILED');assert.equal(failed.error.code,code);assert.ok(!JSON.stringify(failed.error).includes('PRIVATE_REJECTED_ANSWER'));
  }
});
test('a failure between final model output and database commit never repeats generation',async()=>{
  const fx=queueFixture(),job=await fx.enqueue();fx.store.complete=async()=>{throw Error('synthetic connection lost');};await worker(fx).run();assert.equal(fx.modelTurns,1);assert.equal(fx.rows.get(job.id).state,'FAILED');assert.equal(fx.rows.get(job.id).result,null);
});
test('initialization interrupts previous queued work without generating it',async()=>{
  const fx=queueFixture({now:()=>1}),job=await fx.enqueue(),api=worker(fx,{startedAt:2});await api.initialize();await api.run();assert.equal(fx.modelTurns,0);assert.equal(fx.rows.get(job.id).state,'INTERRUPTED');
});
test('a browser-shaped execution object has no trusted server authority',async()=>{
  assert.equal(typeof workerModule.isAiExecutionContext,'function');assert.equal(workerModule.isAiExecutionContext({ownerId,projectId,generate:()=>{}}),false);
});
test('a startup database failure settles without an automatic retry spin',async()=>{
  const source=`import {createAiWorker} from './src/server/ai/worker.server.ts';import {queueFixture} from './scripts/codex-runtime/queue-fixtures.mjs';console.log('ready');const fx=queueFixture();fx.store.interruptStale=async()=>{throw Error('offline');};const w=createAiWorker({store:fx.store,client:fx.client,handlerFor:()=>fx.handler,clock:fx.clock,startedAt:0});try{await w.run();}catch{}setTimeout(()=>console.log('settled'),0);`;
  const child=spawn(process.execPath,['--import','./scripts/codex-runtime/load-server.mjs','--input-type=module','--eval',source],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const output=await new Promise((resolve,reject)=>{let text='',ready=false;const expire=()=>{child.kill();reject(Error('Startup failure did not settle after the module loader became ready'));};let timer=setTimeout(expire,30000);
    child.stdout.on('data',part=>{text+=part.toString();if(!ready&&text.includes('ready\n')){ready=true;clearTimeout(timer);timer=setTimeout(expire,4000);}});child.stderr.on('data',()=>{});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve(text);else reject(Error('Isolated worker exited with '+code));});
  });assert.equal(output.trim(),'ready\nsettled');
});

function controlledClock(){
  let stamp=1000,sequence=0;const timers=new Map();
  const clock={now:()=>stamp,setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,at:stamp+ms});return id;},clearTimeout(id){timers.delete(id);}};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  async function advance(ms){const end=stamp+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;stamp=Math.max(stamp,next[1].at);timers.delete(next[0]);next[1].fn();await flush();}stamp=Math.max(stamp,end);await flush();}
  return {clock,flush,advance,jump(ms){stamp+=ms;},pending:()=>timers.size};
}
const unavailable=()=>Object.assign(Error('synthetic transport failure'),{code:'AI_UNAVAILABLE'});

test('a brief owned-job read outage recovers without repeating generation',async()=>{
  const time=controlledClock(),fx=queueFixture({now:time.clock.now}),read=fx.store.readOwned;let reads=0;
  fx.store.readOwned=async(...args)=>{if(++reads===1)throw unavailable();return read(...args);};
  const job=await fx.enqueue(),running=worker(fx,{clock:time.clock}).run();await time.flush();
  assert.equal(fx.rows.get(job.id).state,'RUNNING');await time.advance(1000);await running;
  assert.equal(fx.rows.get(job.id).state,'SUCCEEDED');assert.equal(fx.modelTurns,1);assert.equal(time.pending(),0);
});

test('a brief progress acknowledgement outage preserves the prepared result',async()=>{
  const time=controlledClock(),fx=queueFixture({now:time.clock.now}),progress=fx.store.reportProgress;let calls=0;
  fx.store.reportProgress=async(...args)=>{await progress(...args);if(++calls===1)throw unavailable();};
  fx.handler.execute=async(payload,execution)=>{const result=JSON.parse(await execution.generate({text:payload.question,outputSchema:{type:'object'}}));await execution.reportProgress({phase:'reading',completedUnits:1,totalUnits:1});return {result,effects:[]};};
  const job=await fx.enqueue(),running=worker(fx,{clock:time.clock}).run();await time.flush();await time.advance(1000);await running;
  assert.equal(fx.rows.get(job.id).state,'SUCCEEDED');assert.deepEqual(fx.rows.get(job.id).progress,{phase:'reading',completedUnits:1,totalUnits:1});assert.equal(fx.modelTurns,1);
});

test('a brief scheduled heartbeat outage does not abort the in-flight model turn',async()=>{
  let finish,entered,signal;const started=new Promise(resolve=>entered=resolve),answer=new Promise(resolve=>finish=resolve),time=controlledClock();
  const fx=queueFixture({now:time.clock.now,onGenerate:async(_input,_profile,currentSignal)=>{signal=currentSignal;entered();return answer;}}),heartbeat=fx.store.heartbeat;
  const job=await fx.enqueue(),running=worker(fx,{clock:time.clock}).run();await started;
  // The observed network interruption lasted about 1.7 seconds, across two attempts.
  fx.store.heartbeat=async(...args)=>{if(time.clock.now()<12700)throw unavailable();return heartbeat(...args);};
  await time.advance(10000);assert.equal(signal.aborted,false);await time.advance(3000);assert.equal(signal.aborted,false);finish('{"answer":"retained"}');await running;
  assert.equal(fx.rows.get(job.id).state,'SUCCEEDED');assert.equal(fx.rows.get(job.id).result.answer,'retained');assert.equal(fx.modelTurns,1);assert.equal(time.pending(),0);
});

test('an ongoing owned-job outage stops after bounded attempts without starting the model',async()=>{
  const time=controlledClock(),fx=queueFixture({now:time.clock.now});let attempts=0;
  fx.store.readOwned=async()=>{attempts++;throw unavailable();};const job=await fx.enqueue(),running=worker(fx,{clock:time.clock}).run();
  await time.flush();await time.advance(1000);await time.advance(2000);await running;
  assert.equal(attempts,3);assert.equal(fx.rows.get(job.id).state,'FAILED');assert.equal(fx.rows.get(job.id).error.code,'AI_UNAVAILABLE');assert.equal(fx.modelTurns,0);assert.equal(time.pending(),0);
});

test('cancellation during a transport recovery stops immediately and keeps the cancelled state',async()=>{
  const time=controlledClock(),fx=queueFixture({now:time.clock.now});let attempts=0;
  fx.store.readOwned=async()=>{attempts++;throw unavailable();};const job=await fx.enqueue(),api=worker(fx,{clock:time.clock}),running=api.run();await time.flush();
  await fx.store.cancel(ownerId,job.id,fx.rows.get(job.id).revision);api.abort(job.id);await running;
  assert.equal(fx.rows.get(job.id).state,'CANCELLED');assert.equal(attempts,1);assert.equal(fx.modelTurns,0);assert.equal(time.pending(),0);
});

test('lease, access, profile and source failures are never retried as transport outages',async()=>{
  for(const code of ['AI_LEASE_LOST','AI_ACCESS_DENIED','AI_PROFILE_INVALID','AI_SOURCE_CHANGED']){
    const time=controlledClock(),fx=queueFixture({now:time.clock.now});let attempts=0;
    fx.store.readOwned=async()=>{attempts++;throw Object.assign(Error('synthetic guard failure'),{code});};const job=await fx.enqueue();await worker(fx,{clock:time.clock}).run();
    assert.equal(attempts,1);assert.equal(fx.rows.get(job.id).state,'FAILED');assert.equal(fx.modelTurns,0);assert.equal(time.pending(),0);
  }
});

test('an expired lease prevents retrying a failed heartbeat',async()=>{
  let entered,finish,signal;const started=new Promise(resolve=>entered=resolve),answer=new Promise(resolve=>finish=resolve),time=controlledClock();
  const fx=queueFixture({now:time.clock.now,onGenerate:async(_input,_profile,currentSignal)=>{signal=currentSignal;entered();return answer;}}),job=await fx.enqueue(),running=worker(fx,{clock:time.clock}).run();await started;let attempts=0;
  fx.store.heartbeat=async()=>{attempts++;time.jump(20000);throw unavailable();};await time.advance(10000);
  assert.equal(signal.aborted,true);finish('{"answer":"late"}');await running;
  assert.equal(attempts,1);assert.notEqual(fx.rows.get(job.id).state,'SUCCEEDED');assert.equal(fx.rows.get(job.id).result,null);assert.equal(fx.modelTurns,1);assert.equal(time.pending(),0);
});

test('a model transport failure is never automatically replayed',async()=>{
  const time=controlledClock(),fx=queueFixture({now:time.clock.now,onGenerate:async()=>{throw unavailable();}}),job=await fx.enqueue();await worker(fx,{clock:time.clock}).run();
  assert.equal(fx.rows.get(job.id).state,'FAILED');assert.equal(fx.modelTurns,1);assert.equal(time.pending(),0);
});
