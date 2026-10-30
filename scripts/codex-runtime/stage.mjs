import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,lstat,symlink,unlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve(import.meta.dirname,'../..');
const task=Number(process.argv[process.argv.indexOf('--task')+1]);
if(!Number.isInteger(task)||task<1||task>11)throw Error('Expected --task 1..11');
const workspace=path.join(root,'.superpowers/sdd/2026-10-30-codex-program-runtime');
// Keep the owner's Task4 model-picker preview on 3003 intact while they choose.
const control=path.join(root,'.superpowers/codex-program-runtime-2026-10-30',task>=5?'verification-source':'control-source');
const controlPort=task>=5?3005:3003,controlUrl=`http://127.0.0.1:${controlPort}`;
const dist='.next-codex-runtime-control';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
const indexTree=git('write-tree').trim();
const files=git('ls-files','-z').split('\0').filter(Boolean);
const node=process.execPath;
const results=[];
await mkdir(workspace,{recursive:true});await mkdir(control,{recursive:true});
const previous=await readFile(path.join(control,'.published-files.json'),'utf8').then(JSON.parse).catch(()=>[]);
for(const file of previous)if(!files.includes(file)){
  const target=path.resolve(control,file);if(!target.startsWith(control+path.sep))throw Error('Unsafe export path');
  await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
// Export the index, including only the explicitly prepared publication candidates.
git('checkout-index','--all','--force','--prefix='+control.replaceAll('\\','/')+'/');
await writeFile(path.join(control,'.published-files.json'),JSON.stringify(files));
await copyFile(path.join(root,'.env.local'),path.join(control,'.env.local'));
if(!await lstat(path.join(control,'node_modules')).catch(()=>null))await symlink(path.join(root,'node_modules'),path.join(control,'node_modules'),'junction');
const env={...process.env,CONTRACTOR_NEXT_DIST_DIR:dist,NEXT_TELEMETRY_DISABLED:'1'};
async function run(name,args,{cwd=control,environment=env}={}){
  const log=path.join(workspace,`task-${task}-${name}.log`),out=createWriteStream(log);
  const child=spawn(node,args,{cwd,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  await new Promise(resolve=>out.end(resolve));results.push({name,code,log});
  console.log(`${name}: ${code===0?'PASS':'FAIL'} (${path.relative(root,log)})`);
  if(code!==0){console.log((await readFile(log,'utf8')).split(/\r?\n/).slice(-16).join('\n'));throw Error(name+' failed');}
}
const profiles={1:['protocol','metadata'],2:['jobs-db'],3:['worker','job-routes'],4:['ui'],5:['writing','letter-preview-db','job-routes','worker','ui'],6:['comparison'],7:['radar'],8:['pricing'],9:['documents']};
const names=task>=10?files.filter(file=>/^scripts\/verify-codex-[^/]+\.mjs$/.test(file)).map(file=>file.slice('scripts/verify-codex-'.length,-4)):profiles[task];
if(!names?.length)throw Error('No verification profile');
for(const name of names)if(!files.includes(`scripts/verify-codex-${name}.mjs`))throw Error('Unprepared verification file: '+name);
if(task>=2)await run('synthetic-db',['scripts/codex-runtime/db.mjs','prepare']);
if(task>=5)await run('synthetic-writing-db',['scripts/codex-runtime/writing-db.mjs']);
await run('profile',['--import','./scripts/codex-runtime/load-server.mjs','--test','--test-concurrency=1',...names.map(name=>`scripts/verify-codex-${name}.mjs`)]);
if(task===5)await run('writing-regression',['--import','./scripts/codex-runtime/load-server.mjs','--test','--test-concurrency=1','scripts/verify-local-writing.mjs','scripts/verify-letter-transactions.mjs','scripts/verify-letter-routes.mjs','scripts/verify-letter-export.mjs','scripts/verify-letter-financials.mjs','scripts/redesign/verify-letter-drafts.mjs','scripts/redesign/verify-consultant.mjs']);
await run('typescript',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']);
await run('financials',['scripts/verify-financial-invariants.mjs']);
await run('lint',['node_modules/eslint/bin/eslint.js','.','--ignore-pattern',dist+'/**','--cache','--cache-location','.eslintcache','--cache-strategy','content']);
await run('production',['node_modules/next/dist/bin/next','build']);
await run('typescript-built',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']);
await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error(`Control port ${controlPort} is occupied`)));server.listen(controlPort,'127.0.0.1',()=>server.close(resolve));});
const serverLog=createWriteStream(path.join(workspace,`task-${task}-control-server.log`));
const server=spawn(node,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(controlPort)],{cwd:control,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stdout.pipe(serverLog,{end:false});server.stderr.pipe(serverLog,{end:false});
await writeFile(path.join(workspace,'control-process.json'),JSON.stringify({pid:server.pid,cwd:control,port:controlPort}));
try{
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline){if(server.exitCode!==null)throw Error('Control server exited');try{const response=await fetch(controlUrl+'/login',{redirect:'manual',signal:AbortSignal.timeout(2000)});if(response.status<500){ready=true;break;}}catch{}await delay(200);}
  if(!ready)throw Error('Control server did not become ready');
  await run('control-runtime',['scripts/verify-open-workspace-runtime.mjs'],{environment:{...env,VERIFY_RUNTIME_BASE_URL:controlUrl}});
  await run('installed-runtime',['scripts/verify-open-workspace-runtime.mjs'],{environment:{...env,VERIFY_RUNTIME_BASE_URL:'http://127.0.0.1:3002'}});
  const buildId=(await readFile(path.join(control,dist,'BUILD_ID'),'utf8')).trim();
  if(git('write-tree').trim()!==indexTree)throw Error('Publication index changed during G');
  await writeFile(path.join(workspace,`task-${task}-G.json`),JSON.stringify({task,buildId,controlUrl,results,indexTree,time:new Date().toISOString()},null,2));
  console.log(`G task ${task}: PASS; build ${buildId}; installed A preserved`);
}finally{
  if(server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await Promise.race([exited,delay(3000)]);}
  await new Promise(resolve=>serverLog.end(resolve));
}
