import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const containerName='contractorsystem-r02-r04-letters-test';
const taskLabel='r02-r04-2026-10-29';
const output='.superpowers/sdd/2026-10-29-draft-letters-money-local';
function docker(args,input) {
  const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0){const error=new Error(result.stderr||result.stdout||'Docker failed');
    error.code=(error.message.match(/ERROR:\s+([A-Z0-9]{5}):/)||[])[1]||'TEST_DB_ERROR';throw error;}
  return result.stdout.trim();
}
export function verifyTestTarget(name=containerName) {
  const target=JSON.parse(docker(['inspect',name]))[0];
  if(target.Config.Labels?.['contractorsystem.test-task']!==taskLabel
    ||target.Config.Labels?.['contractorsystem.synthetic-only']!=='true'
    ||Object.keys(target.HostConfig.PortBindings||{}).length
    ||target.Mounts.some(mount=>mount.Type==='bind')
    ||target.HostConfig.NetworkMode!=='none')throw Error('Refusing non-isolated synthetic PostgreSQL target');
  return target;
}
export function runLettersSql(sql,{name=containerName,params={},role='postgres',userId=''}={}) {
  verifyTestTarget(name);
  if(!['postgres','authenticated','anon'].includes(role))throw Error('Role not allowed');
  const args=['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','letters','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose'];
  for(const [key,value] of Object.entries({...params,test_user_id:userId})){
    if(!/^[a-z_]+$/.test(key))throw Error('Unsafe parameter name');
    args.push('--set='+key+'='+String(value));
  }
  const prefix=role==='postgres'?'':`set local role ${role}; set local request.jwt.claim.sub = :'test_user_id';`;
  return docker(args,`begin; ${prefix}\n${sql}\ncommit;\n`);
}
export function jsonSql(sql,options) {const text=runLettersSql(sql,options);return text?JSON.parse(text.split('\n').at(-1)):null;}
export function letterMigrationPath() {
  return readdirSync('supabase/migrations').filter(name=>/^\d+_letter_drafts_snapshot\.sql$/.test(name)).map(name=>'supabase/migrations/'+name).at(-1);
}
export async function prepareLettersDb() {
  let present=false;try{docker(['inspect',containerName]);present=true;}catch{}
  if(!present)docker(['run','-d','--rm','--name',containerName,'--label','contractorsystem.test-task='+taskLabel,
    '--label','contractorsystem.synthetic-only=true','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust',
    '-e','POSTGRES_DB=letters','postgres:17.6']);
  const target=verifyTestTarget();
  for(let attempt=0;attempt<40;attempt++){
    try{docker(['exec',containerName,'pg_isready','-U','postgres','-d','letters']);break;}
    catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  const initialized=runLettersSql("select to_regclass('public.projects') is not null;")==='t';
  if(!initialized)runLettersSql(readFileSync('scripts/fixtures/letters-db-schema.sql','utf8'));
  const migration=letterMigrationPath();
  if(migration&&readFileSync(migration,'utf8').trim())runLettersSql(readFileSync(migration,'utf8'));
  mkdirSync(output,{recursive:true});
  const digest=JSON.parse(docker(['image','inspect',target.Config.Image]))[0].RepoDigests;
  const evidence={containerName,image:target.Config.Image,imageId:target.Image,digest,network:'none',ports:[],bindMounts:[],migration:migration||null};
  writeFileSync(output+'/test-db.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const command=process.argv[2];
  if(command==='prepare')await prepareLettersDb();
  else if(command==='verify')console.log(JSON.stringify({id:verifyTestTarget().Id,version:runLettersSql('show server_version;')}));
  else if(command==='stop'){verifyTestTarget();console.log(docker(['stop',containerName]));}
  else throw Error('Use prepare|verify|stop');
}
