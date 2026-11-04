import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const file=option('--target');
if(!file)throw Error('Use --target with an existing isolated ContractorSystem recovery target.json.');
const expected=JSON.parse(fs.readFileSync(file,'utf8'));
assert.match(expected.container,/^contractorsystem-recovery-\d+$/);
assert.match(expected.id,/^[a-f0-9]{64}$/);
assert.equal(expected.database,'restored');
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});if(r.error)throw r.error;return r;}
const inspected=docker(['inspect',expected.id]);assert.equal(inspected.status,0,'The recorded recovery container must exist');
const target=JSON.parse(inspected.stdout)[0];
assert.equal(target.Id,expected.id);assert.equal(target.Image,expected.imageId);
assert.equal(target.Config.Labels?.['contractorsystem.recovery'],'true');
assert.equal(target.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(target.HostConfig.PortBindings||{}).length,0);
assert.ok(!target.Mounts.some(m=>m.Type==='bind'));
const wasRunning=target.State.Running;
try{
 if(!wasRunning)assert.equal(docker(['start',expected.id]).status,0,'The isolated recovery target must start');
 let ready=false;for(let attempt=0;attempt<40;attempt++){if(docker(['exec',expected.id,'pg_isready','-U','postgres','-d',expected.database]).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}
 assert.equal(ready,true,'The isolated PostgreSQL must be ready');
 // Document reading reports progress through this RPC. A recovery that omits
 // the routine cannot resume the installed reader, even if row counts match.
 // An empty payload must be rejected before any locking or mutation; a
 // read-only transaction additionally prevents a regression from writing data.
 const result=docker(['exec','-i',expected.id,'psql','-X','-qAt','-U','postgres','-d',expected.database,'--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose'],"begin read only;set local role service_role;select public.contractor_ai_progress('{}'::jsonb);rollback;\n");
 assert.notEqual(result.status,0,'Invalid progress input must be rejected');
 assert.match(result.stderr,/AI_INPUT_INVALID/,'Restored reader progress RPC must exist, be callable by its service role and reject invalid input');
 assert.doesNotMatch(result.stderr,/42883|does not exist|permission denied/i,'The current reader routine and its grants must survive recovery');
 console.log(JSON.stringify({restoredRuntimeRpcVerified:true,readerProgressRpcCallable:true,invalidInputRejected:true,transactionReadOnly:true,businessDataWritten:false}));
}finally{if(!wasRunning)assert.equal(docker(['stop',expected.id]).status,0,'Restore the target to its original stopped state');}
