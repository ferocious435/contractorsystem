import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
export const containerName='contractorsystem-codex-runtime-test';
const label='codex-program-runtime-2026-10-30';
let expectedImage;
let boundTarget;
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw Object.assign(Error(r.stderr||r.stdout),{code:(r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)??[])[1]??'TEST_DB_ERROR'});return r.stdout.trim();}
export function verifyTarget(){expectedImage??=JSON.parse(docker(['image','inspect','postgres:17.6']))[0].Id;const item=JSON.parse(docker(['inspect',containerName]))[0];if(item.Image!==expectedImage||item.Config.Labels?.['contractorsystem.test-task']!==label||item.Config.Labels?.['contractorsystem.synthetic-only']!=='true'||item.HostConfig.NetworkMode!=='none'||Object.keys(item.HostConfig.PortBindings??{}).length||item.Mounts.some(m=>m.Type==='bind'))throw Error('Refusing non-isolated test database');return item;}
function statement(sql,{role='postgres',userId='',params={}}={}){
  if(!['postgres','service_role','authenticated','anon'].includes(role))throw Error('Unexpected database role');
  boundTarget??=verifyTarget(); // Keep using the checked immutable ID, never a replacement reusing its name.
  const args=['exec','-i',boundTarget.Id,'psql','-X','-qAt','-U','postgres','-d','runtime','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose','--set=test_user_id='+userId];
  for(const [key,value] of Object.entries(params)){if(!/^[a-z_]+$/.test(key))throw Error('Invalid SQL variable');args.push('--set='+key+'='+String(value));}
  return {args,input:`begin; ${role==='postgres'?'':`set local role ${role}; set local request.jwt.claim.sub = :'test_user_id';`}\n${sql}\ncommit;`};
}
export function runSql(sql,options){const {args,input}=statement(sql,options);return docker(args,input);}
export async function runSqlAsync(sql,options){const {args,input}=statement(sql,options);return new Promise((resolve,reject)=>{const p=spawn('docker',args,{windowsHide:true,stdio:'pipe'});let out='',err='';p.stdout.on('data',data=>{out+=data;options?.onOutput?.(out);});p.stderr.on('data',data=>err+=data);p.on('error',reject);p.on('exit',code=>code===0?resolve(out.trim()):reject(Object.assign(Error(err),{code:(err.match(/ERROR:\s+([A-Z0-9]{5}):/)??[])[1]??'TEST_DB_ERROR'})));p.stdin.end(input);});}
export const jsonSql=(sql,options)=>{const raw=runSql(sql,options);return raw?JSON.parse(raw.split('\n').at(-1)):null;};
const rpcNames=new Set(['contractor_ai_enqueue','contractor_ai_claim','contractor_ai_heartbeat','contractor_ai_complete','contractor_ai_fail','contractor_ai_cancel','contractor_ai_interrupt_stale','contractor_ai_read','contractor_ai_list','contractor_ai_source_revision']);
export function databaseTransport(){return {async rpc(name,{p}){if(!rpcNames.has(name))throw Error('Unexpected test RPC');try{const raw=await runSqlAsync(`select public.${name}(:'body'::jsonb);`,{role:'service_role',params:{body:JSON.stringify(p)}});return {data:raw?JSON.parse(raw):null,error:null};}catch(error){return {data:null,error:{code:error.code,message:error.message}};}}};}
export function migrationPath(){const paths=readdirSync('supabase/migrations').filter(p=>/^\d+_codex_runtime_jobs\.sql$/.test(p));if(paths.length>1)throw Error('Ambiguous runtime migration');return paths[0]?'supabase/migrations/'+paths[0]:null;}
export async function prepare(){
  docker(['image','inspect','postgres:17.6']); // An absent image is an error, never a request to download one.
  let present=false;try{docker(['inspect',containerName]);present=true;}catch{}
  if(!present)docker(['run','-d','--rm','--pull=never','--name',containerName,'--label','contractorsystem.test-task='+label,'--label','contractorsystem.synthetic-only=true','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=runtime','postgres:17.6']);
  const target=verifyTarget();for(let i=0;i<50;i++){try{docker(['exec',containerName,'pg_isready','-U','postgres','-d','runtime']);break;}catch(error){if(i===49)throw error;await delay(200);}}
  if(runSql("select to_regclass('public.projects') is not null;")!=='t')runSql(readFileSync('scripts/fixtures/codex-runtime-db.sql','utf8'));
  runSql(readFileSync('scripts/fixtures/codex-runtime-source-tables.sql','utf8'));
  const migration=migrationPath();if(migration&&readFileSync(migration,'utf8').trim())runSql(readFileSync(migration,'utf8'));
  const directory='.superpowers/sdd/2026-10-30-codex-program-runtime';mkdirSync(directory,{recursive:true});writeFileSync(directory+'/test-db.json',JSON.stringify({id:target.Id,name:containerName,image:target.Image,migration,network:'none',ports:[],bindMounts:[]},null,2));
  console.log(JSON.stringify({name:containerName,migration,syntheticOnly:true}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='prepare')await prepare();else if(process.argv[2]==='verify')console.log(JSON.stringify({id:verifyTarget().Id}));else if(process.argv[2]==='stop'){verifyTarget();console.log(docker(['stop',containerName]));}else throw Error('Use prepare|verify|stop');}
