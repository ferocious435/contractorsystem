// Restore only into an owned isolated target. Importing this module has no CLI side effects.
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyArchive, extractVerifiedArchive, nativeArchiveOperation, readGuardedRecords, readGuardedBackupFile } from './maintenance/archive.mjs';
import { verifyBackupBytes, updateBackupIndex, backupStatus, restoreDue, rotationEvidenceMatches } from './maintenance/backups.mjs';
import { inheritedMaintenanceLease, requireHeldLease, requirePlainPath, probePaths, resolveMaintenanceHome, withLifecycleLock } from './maintenance/guard.mjs';
import { pathKey, refusal, pathInMaintenanceHome, relativeWithin, assertNarrowRoot } from './maintenance/policy.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ident=s=>'"'+String(s).replaceAll('"','""')+'"',literal=s=>"'"+String(s).replaceAll("'","''")+"'";
const trusted = new WeakMap();
const managedFormat='backup-v2+zip-v1';

async function ownScratch(scratchRoot) {
  scratchRoot=assertNarrowRoot(path.resolve(scratchRoot));
  if(path.basename(scratchRoot)!=='restore-scratch'||path.basename(path.dirname(scratchRoot))!=='maintenance-state')throw refusal('Invalid restore scratch root');
  await nativeArchiveOperation('ensure-directories',{records:[scratchRoot]});
  const directory=path.join(scratchRoot,'restore-'+crypto.randomUUID());
  const initial=await nativeArchiveOperation('restore-scratch-create',{target:directory,destination:scratchRoot});
  const entries=new Map([['',{path:'artifact',directory:true,size:0,sha256:null}]]);
  const admit=rows=>{for(const row of rows){if(typeof row.path!=='string'||!row.path||row.path.startsWith('/')||row.path.split('/').some(part=>!part||part==='..'||part==='.'))throw refusal('Invalid owned scratch entry');
    entries.set(row.path,{...row,path:'artifact/'+row.path});}};
  return {directory,identity:initial.identity,admit,
    async objects(){await nativeArchiveOperation('restore-scratch-objects',{target:directory,targetIdentity:initial.identity});admit([{path:'objects',directory:true,size:0,sha256:null}]);},
    async copyObject(file,name,sha256){const row=await nativeArchiveOperation('restore-copy',{target:directory,targetIdentity:initial.identity,file,destination:path.join(directory,name),archiveSha256:sha256});
      if(row.sha256!==sha256||!Number.isSafeInteger(row.bytes))throw refusal('Owned copy echo differs');admit([{path:name,directory:false,size:row.bytes,sha256}]);},
    async dispose(){const removed=await nativeArchiveOperation('restore-scratch-delete',{target:directory,destination:scratchRoot,targetIdentity:initial.identity,ownedEntries:[...entries.values()]},async()=>true);
      if(removed.status!=='completed')throw refusal('Owned restore scratch cleanup failed');return {directory,identity:initial.identity,fingerprint:removed.fingerprint,removed:true};}
  };
}

export async function resolveBackupInput(input,{scratchRoot}={}) {
  const source=path.resolve(input);
  await requirePlainPath(source);
  const stat=await fsp.lstat(source);
  if(stat.isDirectory())return {directory:source,archiveReceipt:null,dispose:async()=>{}};
  if(!stat.isFile()||stat.nlink!==1||!source.toLowerCase().endsWith('.zip'))throw refusal('Expected a plain backup directory or verified ZIP');
  const verified=await verifyArchive(source); // All archive bytes precede any engine access.
  if(verified.format!=='zip-v1'||verified.references?.length||verified.generatedOmissions?.length||verified.managedProofSha256||verified.rebuildBasis||verified.omittedJunctions?.length||
    !verified.entries.some(row=>row.path==='artifact/manifest.json'&&!row.directory)||
    verified.entries.some(row=>row.path!=='artifact'&&!row.path.startsWith('artifact/')))throw refusal('Expected a standalone business backup ZIP');
  const scratch=await ownScratch(scratchRoot);
  try {
    const receipt=await extractVerifiedArchive(source,path.join(scratch.directory,'input'),{target:scratch.directory,targetIdentity:scratch.identity});
    if(!Array.isArray(receipt.ownedEntries))throw refusal('Native extraction omitted its owned manifest');
    scratch.admit(receipt.ownedEntries);
    if(receipt.sha256!==verified.sha256||receipt.contentFingerprint!==verified.contentFingerprint||receipt.metadataSha256!==verified.metadataSha256)throw refusal('Archive changed during extraction');
    const directory=path.join(scratch.directory,'input','artifact');
    await verifyBackupBytes(directory);
    return {directory,archiveReceipt:verified,dispose:()=>scratch.dispose()};
  } catch(error){await scratch.dispose();throw error;}
}

export function dockerEngine({spawn:spawnChild=spawn,env=process.env,platform=process.platform}={}) {
  const endpoints=['npipe:////./pipe/dockerDesktopLinuxEngine','npipe:////./pipe/docker_engine'];
  if(platform!=='win32'||env.DOCKER_HOST&&!endpoints.includes(env.DOCKER_HOST)||
    env.DOCKER_CONTEXT&&!['desktop-linux','default'].includes(env.DOCKER_CONTEXT))throw refusal('Only a pinned local Docker endpoint is allowed; remote or unknown contexts are refused');
  const endpoint=env.DOCKER_HOST||endpoints[0];
  const localEnv=Object.fromEntries(Object.entries(env).filter(([key])=>!key.toUpperCase().startsWith('DOCKER_')));
  return {run(argv,input,limit=300000,{maximumOutputBytes=4*1024*1024}={}){return new Promise((resolve,reject)=>{
    const child=spawnChild('docker',['--host',endpoint,...argv],{env:localEnv,windowsHide:true,stdio:['pipe','pipe','pipe'],signal:AbortSignal.timeout(limit)});
    const chunks=[];let length=0,overflow=false;
    child.stdout.on('data',bytes=>{length+=bytes.length;if(length>maximumOutputBytes){overflow=true;child.kill();}else chunks.push(bytes);});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.once('error',()=>reject(Object.assign(Error('Local Docker engine is unavailable'),{code:'ENGINE_UNAVAILABLE'})));
    child.once('close',code=>code===0&&!overflow?resolve(Buffer.concat(chunks,length).toString('utf8').trim()):reject(Error(overflow?'Local Docker response exceeds its verified bound':'Isolated recovery operation failed')));
    child.stdin.end(input);
  });}};
}

function safeTarget(target,id,image,token) {
  return target?.Id===id&&target.Image===image&&target.Config?.Labels?.['contractorsystem.restore-run']===token&&
    target.HostConfig?.NetworkMode==='none'&&!Object.keys(target.HostConfig.PortBindings||{}).length&&
    !(target.HostConfig.Binds||[]).length&&!(target.HostConfig.Mounts||[]).length&&Array.isArray(target.Mounts)&&
    target.Mounts.every(m=>m.Type==='volume'&&m.Destination==='/var/lib/postgresql/data'&&typeof m.Name==='string'&&/^[a-f0-9]{64}$/.test(m.Name));
}

// The optional engine is an in-process test seam. CLI accepts no engine or proof input.
export async function restoreBackup(options={}) {
  if(options.signal)return executeRestore(options);
  const controller=new AbortController(),interrupt=()=>controller.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{return await executeRestore({...options,signal:controller.signal});}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
async function executeRestore({home,lease,backup,destination,engine=dockerEngine(),signal}={}) {
  home=await requireHeldLease(home,lease);
  let sourcePath=path.resolve(backup);
  try{sourcePath=pathInMaintenanceHome(home,sourcePath);}catch{/* Plain external legacy inputs remain read-only sources. */}
  let output;
  if(destination){output=assertNarrowRoot(path.resolve(destination));
    if((await probePaths([output]))[0]!=='missing')throw refusal('Recovery destination already exists or is unsafe; choose a new one');
    for(const name of ['maintenance-state','backups','releases','config','maintenance','logs','cache','data'])if(relativeWithin(path.join(home,name),output)!==null)throw refusal('Recovery output cannot use a managed system slot');
  }
  const token=crypto.randomUUID();
  let pinnedId,input,scratch,containerId,imageId,target,detail,success=false,primary,outcome='failed';
  const cleanupEvidence=[],cleanupProblems=[];let outputEntries,createAttempted=false;
  const containerName='contractorsystem-recovery-'+token;
  const checkInterrupt=()=>{if(signal?.aborted)throw Object.assign(Error('Restore interrupted'),{code:'INTERRUPTED'});};
  try {
    // Pin exact managed source under the same short gate used by pruning.
    await updateBackupIndex(home,lease,async index=>{
      const point=index.points.find(p=>p.archive&&pathKey(p.archive.path)===pathKey(sourcePath));
      if(point){if(!point.complete||point.archiveRemoved||point.archiveUnavailable)throw refusal('Managed source is unavailable');
        if(point.restorePins!==undefined&&!Array.isArray(point.restorePins))throw refusal('Managed restore pins are invalid');
        point.restorePins=[...(point.restorePins||[]),token];pinnedId=point.id;}
    });
    input=await resolveBackupInput(sourcePath,{scratchRoot:path.join(home,'maintenance-state','restore-scratch')});
    const checked=await verifyBackupBytes(input.directory);
    const source=input.directory,manifest=checked.manifest,schemaPath=path.join(source,'schema.json');
    if(output&&relativeWithin(source,output)!==null)throw refusal('Recovery output cannot modify its supplied backup source');
    const schemaBytes=(await readGuardedRecords([schemaPath])).get(schemaPath);
    if(!schemaBytes||digest(schemaBytes)!==checked.schemaHash)throw refusal('Schema changed before restoration');
    const schema=JSON.parse(schemaBytes);
    if(!schema.permissions||!schema.acl)throw refusal('Backup lacks recovery permissions');
    if(![schema.tables,schema.enums,schema.functions,schema.policies,schema.permissions.tables,schema.permissions.indexes,
      schema.permissions.tableGrants,schema.acl.functions,schema.acl.schemas].every(Array.isArray)||
      !schema.tables.every(table=>Array.isArray(table.columns)&&Array.isArray(table.constraints))||
      !schema.enums.every(type=>Array.isArray(type.values))||!schema.functions.every(fn=>typeof fn==='string')||
      !schema.tables.some(table=>table.schema==='public'&&table.name==='profiles')||
      !schema.tables.some(table=>table.schema==='public'&&table.name==='projects'))throw refusal('Unsupported recovery schema structure');
    let point;
    if(pinnedId)await updateBackupIndex(home,lease,async index=>{
      point=index.points.find(p=>p.id===pinnedId);
      if(!point?.restorePins?.includes(token)||point.contentFingerprint!==checked.contentFingerprint||point.schemaHash!==checked.schemaHash||
        point.format!==managedFormat||point.archive?.sha256!==input.archiveReceipt?.sha256||
        point.archive.contentFingerprint!==input.archiveReceipt.contentFingerprint)throw refusal('Managed archive identity differs');
      point.archive.metadataSha256=input.archiveReceipt.metadataSha256;
      point=structuredClone(point);
    });
    checkInterrupt();
    const docker=(argv,stdin,timeout,limits)=>engine.run(argv,stdin,timeout,limits);
    let image;
    try{image=JSON.parse(await docker(['image','inspect','postgres:17.6']))[0];}
    catch{throw Object.assign(Error('Local engine or local image unavailable'),{code:'ENGINE_UNAVAILABLE'});}
    if(!/^sha256:[a-f0-9]{64}$/.test(image?.Id))throw refusal('Invalid local PostgreSQL image identity');
    imageId=image.Id;
    scratch=await ownScratch(path.join(home,'maintenance-state','restore-scratch'));
    const database='restored';
    const inside=file=>{const result=path.resolve(source,file);if(!result.startsWith(source+path.sep))throw refusal('Unsafe backup path');return result;};
    checkInterrupt();
    createAttempted=true;
    containerId=await docker(['create','--pull=never','--name',containerName,
      '--label','contractorsystem.restore-run='+token,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB='+database,imageId]);
    if(!/^[a-f0-9]{64}$/.test(containerId))throw refusal('Container creation did not return an exact ID');
    target=JSON.parse(await docker(['inspect',containerId]))[0];
    if(!safeTarget(target,containerId,imageId,token))throw refusal('Unsafe owned restore target');
    await docker(['start',containerId]);
    const sql=(text,maximumOutputBytes=4*1024*1024)=>{checkInterrupt();return docker(['exec','-i',containerId,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-d',database,'--set=ON_ERROR_STOP=1'],text,300000,{maximumOutputBytes});};
    for(let attempt=0;attempt<40;attempt++){checkInterrupt();try{await docker(['exec',containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d',database]);break;}catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
const permissions=schema.permissions,acl=schema.acl,roles=new Set(['anon','authenticated','service_role',...permissions.tableGrants.map(g=>g.grantee),...acl.functions.map(g=>g.grantee),...acl.schemas.map(g=>g.grantee)]);roles.delete('PUBLIC');roles.delete('postgres');
const statements=['begin;create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;create table auth.users(id uuid primary key);',"create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"];
for(const role of roles)if(!role.startsWith('pg_'))statements.push('create role '+ident(role)+' nologin'+(role==='service_role'?' bypassrls':'')+';');
for(const type of schema.enums)statements.push('create type '+ident(type.schema)+'.'+ident(type.name)+' as enum('+type.values.map(literal).join(',')+');');
for(const table of schema.tables)statements.push('create table '+ident(table.schema)+'.'+ident(table.name)+'('+table.columns.map(col=>ident(col.name)+' '+col.type+(col.generated?' generated always as ('+col.default+') stored':'')+(col.notNull?' not null':'')).join(',')+');');
const expected=new Map();
for(const table of manifest.tables){const definition=schema.tables.find(t=>t.schema==='public'&&t.name===table.name);if(!definition)throw Error('Unknown backed-up table');const cols=definition.columns.filter(col=>!col.generated).map(col=>ident(col.name));const file=inside(table.file),bytes=await readGuardedBackupFile(file,table.sha256);if(!bytes||digest(bytes)!==table.sha256)throw refusal('Table changed before restoration');const rows=JSON.parse(bytes);expected.set(table.name,rows);
 for(let i=0;i<rows.length;i+=300)statements.push('insert into public.'+ident(table.name)+'('+cols.join(',')+') select '+cols.map(col=>'x.'+col).join(',')+' from jsonb_populate_recordset(null::public.'+ident(table.name)+','+literal(JSON.stringify(rows.slice(i,i+300)))+'::jsonb) x;');
}
statements.push('insert into auth.users(id) select id from public.profiles;');
statements.push(...schema.functions.map(fn=>fn.trimEnd()+';'));
for(const stage of ['keys','foreign'])for(const table of schema.tables)for(const constraint of table.constraints||[])if(constraint.type!=='t'&&(constraint.type==='f')===(stage==='foreign'))statements.push('alter table '+ident(table.schema)+'.'+ident(table.name)+' add constraint '+ident(constraint.name)+' '+constraint.definition+';');
for(const table of schema.tables)for(const col of table.columns)if(col.default&&!col.generated)statements.push('alter table '+ident(table.schema)+'.'+ident(table.name)+' alter column '+ident(col.name)+' set default '+col.default+';');
for(const trigger of schema.triggers||[])statements.push(trigger+';');
for(const index of permissions.indexes)statements.push(index.replace(/^CREATE (UNIQUE )?INDEX /,'CREATE $1INDEX IF NOT EXISTS ')+';');
for(const table of permissions.tables)statements.push('alter table '+ident(table.schema)+'.'+ident(table.name)+(table.rls?' enable':' disable')+' row level security;alter table '+ident(table.schema)+'.'+ident(table.name)+(table.forceRls?' force':' no force')+' row level security;');
for(const policy of schema.policies)statements.push('create policy '+ident(policy.policyname)+' on '+ident(policy.schemaname)+'.'+ident(policy.tablename)+' as '+policy.permissive+' for '+policy.cmd+' to '+policy.roles.map(role=>role==='public'?'public':ident(role)).join(',')+(policy.qual?' using('+policy.qual+')':'')+(policy.with_check?' with check('+policy.with_check+')':'')+';');
for(const grant of permissions.tableGrants){const privilege=grant.privilege_type??grant.privilege;if(!/^[A-Z ]+$/.test(privilege))throw Error('Unexpected privilege');statements.push('grant '+privilege+' on table '+ident(grant.table_schema??grant.schema)+'.'+ident(grant.table_name??grant.table)+' to '+(grant.grantee==='PUBLIC'?'public':ident(grant.grantee))+((grant.is_grantable===true||grant.is_grantable==='YES')?' with grant option':'')+';');}
const refs=new Map(acl.functions.map(g=>[g.schema+'.'+g.name+'('+g.identity+')',g]));
for(const fn of refs.values())statements.push('revoke all on function '+ident(fn.schema)+'.'+ident(fn.name)+'('+fn.identity+') from public;');
for(const grant of acl.functions){if(grant.privilege!=='EXECUTE')throw Error('Unexpected routine privilege');statements.push('grant execute on function '+ident(grant.schema)+'.'+ident(grant.name)+'('+grant.identity+') to '+(grant.grantee==='PUBLIC'?'public':ident(grant.grantee))+(grant.grantable?' with grant option':'')+';');}
for(const name of ['public','private','auth','extensions'])statements.push('revoke all on schema '+ident(name)+' from public;');
for(const grant of acl.schemas){if(!['USAGE','CREATE'].includes(grant.privilege))throw Error('Unexpected schema privilege');statements.push('grant '+grant.privilege+' on schema '+ident(grant.schema)+' to '+(grant.grantee==='PUBLIC'?'public':ident(grant.grantee))+(grant.grantable?' with grant option':'')+';');}
statements.push('grant execute on function auth.uid() to authenticated,anon,service_role;insert into private.contractor_ai_lease(slot) values(1);commit;');
await sql(statements.join('\n'));
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x),verified=[];
for(const table of manifest.tables){
 const rows=expected.get(table.name),count=Number(await sql('select count(*) from public.'+ident(table.name)+';'));
 if(count!==rows.length)throw Error('Restored row count differs: '+table.name);
 for(let offset=0;offset<rows.length;){
  let end=offset,weight=0;
  while(end<rows.length&&end-offset<300){const bytes=Buffer.byteLength(JSON.stringify(rows[end]));if(end>offset&&weight+bytes>1024*1024)break;weight+=bytes;end++;}
  const page=rows.slice(offset,end),order=table.primaryKey.map(k=>'t.'+ident(k)).join(',');
  // Finite JSON numbers can expand from exponential notation in numeric columns;
  // 1024 additional bytes per number covers all finite JS number decimal forms.
  let numbers=0;const visit=value=>{if(typeof value==='number')numbers++;else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);};visit(page);
  const bound=Buffer.byteLength(JSON.stringify(page))*8+numbers*1024+65536;
  const actual=JSON.parse(await sql('select coalesce(jsonb_agg(to_jsonb(t) order by '+order+"),'[]') from (select * from public."+ident(table.name)+' t order by '+order+' limit '+page.length+' offset '+offset+') t;',bound));
  if(canonical(actual)!==canonical(page))throw Error('Restored contents differ: '+table.name);
  offset=end;
 }
 verified.push({name:table.name,count,identical:true});
}
const permissionChecks=[];
for(const owner of expected.get('profiles')){const count=expected.get('projects').filter(project=>project.contractor_id===owner.id).length,visible=Number(await sql('begin;set local role authenticated;set local request.jwt.claim.sub='+literal(owner.id)+';select count(*) from public.projects;rollback;'));if(visible!==count)throw Error('Owner access was not restored');permissionChecks.push({owner:owner.id,projects:visible});}
const foreignCount=Number(await sql("begin;set local role authenticated;set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';select count(*) from public.projects;rollback;"));if(foreignCount!==0)throw Error('Foreign access was not denied');
const actualAcl=JSON.parse(await sql("select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');"));
for(const fn of actualAcl)for(const role of ['anon','authenticated','service_role']){const allowed=acl.functions.some(g=>g.schema===fn.schema&&g.name===fn.name&&g.identity===fn.identity&&['PUBLIC',role].includes(g.grantee));if(fn[role]!==allowed)throw Error('Restored function access differs');}
const needsReaderProgress=schema.tables.some(table=>table.schema==='public'&&table.name==='project_ai_jobs'&&table.columns.some(column=>column.name==='progress'));
if(needsReaderProgress){
 if((await sql("select to_regprocedure('public.contractor_ai_progress(jsonb)') is not null;"))!=='t')throw Error('Backup schema is missing the document reader progress routine; capture the current schema before restoring this release.');
 await sql("begin read only;set local role service_role;do $reader_check$ begin perform public.contractor_ai_progress('{}'::jsonb);raise exception 'RECOVERY_READER_ACCEPTED_INVALID_INPUT';exception when others then if sqlerrm<>'AI_INPUT_INVALID' then raise;end if;end;$reader_check$;rollback;");
}
await scratch.objects();for(const object of manifest.objects)await scratch.copyObject(inside(object.file),object.file,object.sha256);


    // Reread input before accepting a long database check. No changing source can receive proof.
    const after=await verifyBackupBytes(source);
    if(after.contentFingerprint!==checked.contentFingerprint||after.tree.identity!==checked.tree.identity||after.tree.fingerprint!==checked.tree.fingerprint)throw refusal('Restore source changed');
    if(input.archiveReceipt){const afterZip=await verifyArchive(sourcePath);if(afterZip.sha256!==input.archiveReceipt.sha256||afterZip.contentFingerprint!==input.archiveReceipt.contentFingerprint||afterZip.metadataSha256!==input.archiveReceipt.metadataSha256)throw refusal('Restore archive changed');}
    detail={version:1,status:'passed',passed:true,backupId:point?.id??null,backupFingerprint:checked.contentFingerprint,
      schemaHash:checked.schemaHash,format:input.archiveReceipt?managedFormat:'backup-v2-directory',at:new Date().toISOString(),
      counts:{tables:verified.length,objects:manifest.objects.length},checks:{tables:true,storage:true,schema:true,permissions:true},
      functions:schema.functions.length,routinePermissionsVerified:actualAcl.length,readerProgressRequired:needsReaderProgress,
      readerRuntimeVerified:needsReaderProgress,ownerChecks:permissionChecks.length,foreignProjects:foreignCount,
      sourceArchiveSha256:input.archiveReceipt?.sha256??null,sourceArchiveFingerprint:input.archiveReceipt?.contentFingerprint??null,sourceSidecarSha256:input.archiveReceipt?.metadataSha256??null,
      scope:'Business rows, original object bytes/keys and implemented schema/access checks; excludes Auth credentials and full Supabase services.'};
    if(output){
      await nativeArchiveOperation('ensure-directories',{records:[path.dirname(output)]});
      const manifestData=JSON.stringify(manifest,null,2)+'\n';
      const written=await nativeArchiveOperation('restore-output',{target:scratch.directory,targetIdentity:scratch.identity,destination:output,
        groups:[{expectedFiles:Object.fromEntries(manifest.objects.map(row=>[path.basename(row.file),row.sha256]))}],
        writes:[{data:manifestData}]});
      detail.output={directory:output,identity:written.identity,objects:written.objects,manifestSha256:digest(manifestData)};
      outputEntries=[{path:'artifact',directory:true,size:0,sha256:null},{path:'artifact/objects',directory:true,size:0,sha256:null},
        ...manifest.objects.map(row=>({path:'artifact/'+row.file,directory:false,size:row.size??row.metadata.metadata.size,sha256:row.sha256})),
        {path:'artifact/storage-paths-and-hashes.json',directory:false,size:Buffer.byteLength(manifestData),sha256:digest(manifestData)}];
    }
    checkInterrupt();
    success=true;
  } catch(error){primary=error;outcome=signal?.aborted||error.code==='INTERRUPTED'?'interrupted':error.code==='ENGINE_UNAVAILABLE'?'unavailable':'failed';}
  finally {
    // An acknowledged name/UUID label can recover an ID lost from create stdout.
    if(createAttempted&&!/^[a-f0-9]{64}$/.test(containerId??'')){
      try{const found=JSON.parse(await engine.run(['inspect',containerName]))[0];
        if(!/^[a-f0-9]{64}$/.test(found?.Id??'')||!safeTarget(found,found.Id,imageId,token))throw refusal('Ambiguous create target is not owned');
        containerId=found.Id;target=found;
      }catch(error){cleanupProblems.push({stage:'identify-container',code:error.code??'UNAVAILABLE'});}
    }
    try{
      if(containerId&&/^[a-f0-9]{64}$/.test(containerId)){
        const current=JSON.parse(await engine.run(['inspect',containerId]))[0];
        if(!safeTarget(current,containerId,imageId,token)||target&&JSON.stringify(current.Mounts)!==JSON.stringify(target.Mounts))throw refusal('Owned container cannot be verified for cleanup');
        await engine.run(['rm','-f','-v',containerId]);
        if(await engine.run(['ps','-aq','--no-trunc','--filter','id='+containerId]))throw refusal('Owned container removal was not confirmed');
        for(const mount of current.Mounts)if(await engine.run(['volume','ls','-q','--filter','name='+mount.Name]))throw refusal('Owned anonymous volume removal was not confirmed');
      }
    }catch(error){cleanupProblems.push({stage:'container',code:error.code??'FAILED'});}
    for(const [stage,owned] of [['work',scratch],['input',input]]){
      try{const evidence=await owned?.dispose();if(evidence)cleanupEvidence.push(evidence);}
      catch(error){cleanupProblems.push({stage,code:error.code??'FAILED'});}
    }
    if(cleanupProblems.length){success=false;primary??=Object.assign(Error('Owned recovery cleanup failed'),{code:'CLEANUP_FAILED'});}
    if(signal?.aborted)outcome='interrupted';
    // Keep source pinned until proof publication. Failed paths retain old proof.
    if(!success)await updateBackupIndex(home,lease,async index=>{
      const p=index.points.find(p=>p.id===pinnedId);if(p)p.restorePins=(p.restorePins||[]).filter(pin=>pin!==token);
      index.lastRestoreAttempt={at:new Date().toISOString(),status:outcome,backupId:pinnedId??null,runId:token,
        code:primary?.code??null,cleanupProblems,ownedResources:{containerName,containerId:containerId??null,imageId:imageId??null,
          workDirectory:scratch?.directory??null,workIdentity:scratch?.identity??null,inputDirectory:input?.archiveReceipt?input.directory:null},cleanupEvidence};
    });
  }
  if(primary){if(signal?.aborted)throw Object.assign(Error('Restore interrupted'),{code:'INTERRUPTED',cause:primary});if(primary.code==='ENGINE_UNAVAILABLE'&&!cleanupProblems.length&&!signal?.aborted)return {status:'unavailable',passed:false,reason:'engine-or-local-image-unavailable'};throw primary;}
  if(!success)throw refusal('Restore did not complete');
  detail.at=new Date().toISOString();
  detail.execution={temporaryTargets:cleanupEvidence,imageId,containerId,network:'none',ports:[],bindMounts:[],containerRemoved:true,anonymousVolumesRemoved:true,anonymousVolumes:(target?.Mounts||[]).map(m=>m.Name),scratchRemoved:true};
  if(pinnedId||detail.output)trusted.set(detail,{proof:structuredClone(detail),source:input.archiveReceipt,outputEntries,signal});
  try {
    checkInterrupt();
    if(pinnedId||detail.output)await recordRestore(home,detail,{lease,pin:token});
    return detail;
  }catch(error){
    primary=error;
    if(error.code!=='RESTORE_PUBLICATION_UNCERTAIN')try{
      await updateBackupIndex(home,lease,async index=>{index.lastRestoreAttempt={at:new Date().toISOString(),status:signal?.aborted?'interrupted':'failed',backupId:pinnedId??null,runId:token,code:error.code??'FAILED',cleanupEvidence};});
    }catch(statusError){
      error.cleanupProblems=[...(error.cleanupProblems||[]),{stage:'restore-attempt-status',code:statusError.code??'FAILED'}];
    }
    throw error;
  }finally{
    if(pinnedId)try{
      await updateBackupIndex(home,lease,async index=>{const p=index.points.find(p=>p.id===pinnedId);if(p)p.restorePins=(p.restorePins||[]).filter(pin=>pin!==token);});
    }catch(error){
      const result=primary??detail;
      result.cleanupProblems=[...(result.cleanupProblems||[]),{stage:'restore-pin',code:error.code??'FAILED',releaseConfirmed:false,backupId:pinnedId,runId:token}];
    }
  }
}

export async function recordRestore(home,receipt,{lease,pin}={}) {
  const execution=trusted.get(receipt);
  if(!execution)throw refusal('Only a trusted successful restore execution can publish proof');
  const {proof,source,outputEntries,signal}=execution;
  const check=()=>{if(signal?.aborted)throw Object.assign(Error('Restore interrupted'),{code:'INTERRUPTED'});};
  home=await requireHeldLease(home,lease);check();
  const expected=Buffer.from(JSON.stringify(proof,null,2)+'\n');
  const evidencePath=proof.backupId?path.join(home,'maintenance-state','restore-evidence',crypto.randomUUID()+'.json'):null;
  if(evidencePath)await nativeArchiveOperation('ensure-directories',{records:[path.dirname(evidencePath)]});
  check();
  let casStarted=false,preCommitError;
  const matchesCommitted=async()=>{
    try{
      const index=await backupStatus({home}),record=index.lastVerified,point=index.points.find(p=>p.id===proof.backupId);
      const matches=row=>row?.evidencePath===evidencePath&&row.evidenceSha256===digest(expected)&&JSON.stringify(row.proof)===JSON.stringify(proof);
      if(!matches(record)||!index.restoreHistory?.some(matches)||index.lastRestoreAttempt?.status!=='passed'||
        index.lastRestoreAttempt.backupId!==proof.backupId||index.lastRestoreAttempt.at!==proof.at||!rotationEvidenceMatches(proof,point,proof.at,home))return false;
      const bytes=(await readGuardedRecords([evidencePath])).get(evidencePath);
      return Boolean(bytes?.equals(expected)&&digest(bytes)===record.evidenceSha256);
    }catch{return false;}
  };
  try{
    const result=await nativeArchiveOperation('restore-publication',{target:home,destination:proof.backupId,
      file:source?.path,archiveSha256:proof.sourceArchiveSha256,targetFingerprint:proof.sourceArchiveFingerprint,
      archiveMetadataSha256:proof.sourceSidecarSha256,outputTarget:proof.output?.directory,
      outputIdentity:proof.output?.identity,ownedEntries:outputEntries??[],
      writes:evidencePath?[{path:evidencePath,data:expected.toString('utf8'),overwrite:false}]:[],proofData:expected.toString('utf8')},async (phase,message)=>{
      if(phase==='publish'){check();return true;}
      if(phase!=='commit')throw refusal('Unexpected restore publication stage');
      try{
        check();
        if(message.proofSha256!==digest(expected))throw refusal('Restore proof echo differs');
        if(evidencePath)await updateBackupIndex(home,lease,async index=>{
          check();const point=index.points.find(p=>p.id===proof.backupId);
          if(!point?.complete||!point.restorePins?.includes(pin)||!rotationEvidenceMatches(proof,point,proof.at,home))throw refusal('Trusted restore source no longer matches');
          const actual=typeof message.evidence==='string'?Buffer.from(message.evidence,'base64'):null;
          if(!actual?.equals(expected)||message.evidenceSha256!==digest(expected))throw refusal('Restore evidence echo differs from its trusted bytes');
          const history=[...(index.restoreHistory||[])];
          if(index.lastVerified&&!history.some(record=>record.evidencePath===index.lastVerified.evidencePath))history.push(index.lastVerified);
          check();casStarted=true;
          index.lastVerified={evidencePath,evidenceSha256:digest(expected),proof};
          index.restoreHistory=[...history,index.lastVerified];
          index.lastRestoreAttempt={at:proof.at,status:'passed',backupId:point.id};
        });
        // The last cancellation check precedes the CAS. A committed index must
        // finish the native protocol even if the signal arrives during its write.
        return true;
      }catch(error){
        if(!casStarted){preCommitError=error;return false;}
        throw error;
      }
    });
    if(preCommitError)throw preCommitError;
    if(result.status!=='completed')throw refusal('Restore publication did not complete');
  }catch(error){
    if(evidencePath&&casStarted){
      if(await matchesCommitted())return;
      throw Object.assign(Error('Restore publication outcome is uncertain; verified proof files are preserved'),{code:'RESTORE_PUBLICATION_UNCERTAIN',cause:error});
    }
    throw error;
  }finally{trusted.delete(receipt);}
}


export async function maintainAvailableRestore({home,lease,engine,signal,now=new Date().toISOString()}={}) {
  home=await requireHeldLease(home,lease);
  const index=await backupStatus({home}),point=index.points.find(p=>p.id===index.lastComplete?.id);
  if(!point?.complete||point.archiveRemoved||point.archiveUnavailable||!point.archive)return {status:'unavailable',passed:false,reason:'complete-archive-required'};
  let previous=index.lastVerified;
  // Freshness is useful only when the immutable evidence still exists unchanged.
  if(previous){
    const root=path.join(home,'maintenance-state','restore-evidence');
    if(typeof previous.evidencePath!=='string'||!path.resolve(previous.evidencePath).startsWith(root+path.sep))previous=null;
    else try{const bytes=(await readGuardedRecords([previous.evidencePath])).get(previous.evidencePath);
      if(!bytes||digest(bytes)!==previous.evidenceSha256||JSON.stringify(JSON.parse(bytes))!==JSON.stringify(previous.proof))previous=null;
    }catch{previous=null;}
  }
  if(previous){
    const restored=index.points.find(p=>p.id===previous.proof?.backupId);
    if(!restored?.complete||restored.archiveRemoved||restored.archiveUnavailable||
      !rotationEvidenceMatches(previous.proof,restored,now,home)||restored.schemaHash!==point.schemaHash||restored.format!==point.format)previous=null;
    else try{const actual=await verifyArchive(restored.archive.path);
      if(actual.sha256!==restored.archive.sha256||actual.sha256!==previous.proof.sourceArchiveSha256||
        actual.contentFingerprint!==restored.archive.contentFingerprint||actual.contentFingerprint!==previous.proof.sourceArchiveFingerprint||actual.metadataSha256!==previous.proof.sourceSidecarSha256)previous=null;
    }catch{previous=null;}
  }
  if(!restoreDue({now,lastVerified:previous,schemaHash:point.schemaHash,format:point.format}))return {status:'not-due',passed:false};
  let result;
  try{result=await restoreBackup({home,lease,backup:point.archive.path,...(engine?{engine}:{}),signal});}
  catch(error){result={status:signal?.aborted||error.code==='INTERRUPTED'?'interrupted':'failed',passed:false,code:error.code??'FAILED',
    ...(error.cleanupProblems?.length?{cleanupProblems:error.cleanupProblems}:{})};}
  if(!result.passed&&result.code!=='RESTORE_PUBLICATION_UNCERTAIN')await updateBackupIndex(home,lease,async fresh=>{fresh.lastRestoreAttempt={...fresh.lastRestoreAttempt,at:now,status:result.status,backupId:point.id,code:result.code??null};});
  return result;
}

export async function restoreMain(args=process.argv.slice(2)) {
  const flags=new Map();
  while(args.length){const name=args.shift(),value=args.shift();if(!['--backup','--destination','--home'].includes(name)||!value||value.startsWith('--')||flags.has(name))throw refusal('Invalid restore options');flags.set(name,value);}
  if(!flags.has('--backup'))throw refusal('Use --backup with a completed directory or verified ZIP');
  const home=await resolveMaintenanceHome({explicitHome:flags.has('--home')?path.resolve(flags.get('--home')):undefined});
  const controller=new AbortController(),interrupt=()=>controller.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{return await withLifecycleLock(home,'restore',lease=>restoreBackup({home,lease,backup:flags.get('--backup'),destination:flags.get('--destination'),signal:controller.signal}),inheritedMaintenanceLease());}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
if(process.argv[1]&&pathKey(path.resolve(process.argv[1]))===pathKey(fileURLToPath(import.meta.url))){
  try{const result=await restoreMain();console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}
  catch(error){console.error(JSON.stringify({code:error.code??'FAILED',message:error.message}));process.exitCode=1;}
}
