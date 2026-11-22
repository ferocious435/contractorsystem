import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as backups from './maintenance/backups.mjs';

test('schemaOrFormatChangeRequiresRestore', () => {
  assert.equal(typeof backups.restoreDue, 'function');
  const lastVerified = { proof: { at: '2026-06-01T00:00:00Z', schemaHash: 's', format: 'f', passed: true, status: 'passed' } };
  assert.equal(backups.restoreDue({now:'2026-06-02T00:00:00Z',lastVerified,schemaHash:'changed',format:'f'}),true);
  assert.equal(backups.restoreDue({now:'2026-06-02T00:00:00Z',lastVerified,schemaHash:'s',format:'new'}),true);
  assert.equal(backups.restoreDue({now:'2026-06-02T00:00:00Z',lastVerified,schemaHash:'s',format:'f'}),false);
});
test('thirtyActiveDaysRequiresRestore uses conservative calendar fallback', () => {
  assert.equal(typeof backups.restoreDue, 'function');
  const lastVerified={proof:{at:'2026-06-01T00:00:00Z',schemaHash:'s',format:'f',passed:true,status:'passed'}};
  assert.equal(backups.restoreDue({now:'2026-07-01T00:00:00Z',lastVerified,schemaHash:'s',format:'f'}),true);
});
test('untrustedPassedReceiptIsRefused', async () => {
  let restores; await assert.doesNotReject(async()=>{restores=await import('./local-system-restore.mjs');},'restore library must import without running CLI');
  assert.equal(typeof restores.recordRestore,'function');
  await assert.rejects(()=>restores.recordRestore('unused',{passed:true,status:'passed'}),/trusted/i);
});

import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { captureBackupSnapshot } from './local-system-backup.mjs';
import { withMaintenanceLock } from './maintenance/guard.mjs';
import { catalogArchiveGroups, publishEvidenceArchive } from './maintenance/archive.mjs';
import { resolveBackupInput, restoreBackup, maintainAvailableRestore } from './local-system-restore.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
  const parent=await fs.realpath(os.tmpdir()),home=await fs.realpath(await fs.mkdtemp(path.join(parent,'restore-synthetic-')));
  t.after(async()=>{assert.equal(await fs.realpath(home),home);assert.equal(path.dirname(home),parent);assert.match(path.basename(home),/^restore-synthetic-/);await fs.rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const rows={items:[{id:'one',value:'synthetic'}],profiles:[{id:'00000000-0000-4000-8000-000000000001'}],projects:[{id:'p',contractor_id:'00000000-0000-4000-8000-000000000001'}]};
  const schema={tables:Object.keys(rows).map(name=>({schema:'public',name,columns:[{name:'id',type:'text'}],constraints:[{name:name+'_pkey',type:'p',definition:'PRIMARY KEY (id)'}]})),enums:[],functions:[],triggers:[],policies:[],permissions:{tables:[],indexes:[],tableGrants:[]},acl:{functions:[],schemas:[]}};
  const directory=path.join(home,'source');await fs.mkdir(directory);
  const client={from(name){return {select(){return this},order(){return this},async range(start,end){return {data:rows[name].slice(start,end+1),count:rows[name].length}}}},storage:{async listBuckets(){return {data:[{id:'sample'}]}},from(){return {async list(){return {data:[{id:'object',name:'tiny.txt',metadata:{size:3}}]}},async download(){return {data:new Blob(['abc'])}}}}}};
  await captureBackupSnapshot({client,schemaBytes:Buffer.from(JSON.stringify(schema)),sink:async name=>{const file=path.join(directory,name);await fs.mkdir(path.dirname(file),{recursive:true});const out=await fs.open(file,'wx');return {write:bytes=>out.writeFile(bytes),close:()=>out.close()}}}).then(async snapshot=>{await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(snapshot.manifest));});
  const checked=await backups.verifyBackupBytes(directory),id='point-'+randomUUID();
  await fs.mkdir(path.join(home,'backups','archives'),{recursive:true});
  const {groups}=await catalogArchiveGroups([{source:directory,prefix:'artifact'}]);
  const archive=await publishEvidenceArchive({groups,destination:path.join(home,'backups','archives',id+'.zip')});
  const point={id,at:new Date().toISOString(),legacy:false,complete:true,format:'backup-v2+zip-v1',schemaHash:checked.schemaHash,contentFingerprint:checked.contentFingerprint,counts:{tables:3,objects:1},archive:{...archive,format:'zip-v1'},pinned:false};
  await withMaintenanceLock(home,'fixture',lease=>backups.updateBackupIndex(home,lease,async index=>{index.points=[point];index.lastComplete={id,schemaHash:point.schemaHash};}));
  return {home,rows,directory,point,archive,readIndex:async()=>JSON.parse(await fs.readFile(path.join(home,'maintenance-state','backup-index.json')))};
}
function isolatedEngine(f,{unavailable=false,interrupt,failSql=false,foreignAccess=false,cleanupFails=false}={}){
  const calls=[],id='a'.repeat(64),image='sha256:'+'b'.repeat(64);let token,mounted=false,removed=false;
  return {calls,async run(argv,input){calls.push({argv,input});
    if(argv[0]==='image'){if(unavailable)throw Error('synthetic unavailable');return JSON.stringify([{Id:image}]);}
    if(argv[0]==='create'){assert.ok(argv.includes('--pull=never'));assert.equal(argv[argv.indexOf('--network')+1],'none');assert.equal(argv.includes('-p'),false);assert.equal(argv.includes('-v'),false);token=argv[argv.indexOf('--label')+1].split('=')[1];mounted=true;return id;}
    if(argv[0]==='inspect'){assert.equal(argv[1],id);return JSON.stringify([{Id:id,Image:image,Config:{Labels:{'contractorsystem.restore-run':token}},HostConfig:{NetworkMode:'none',Binds:[],PortBindings:{}},Mounts:[{Type:'volume',Destination:'/var/lib/postgresql/data',Name:'c'.repeat(64)}]}]);}
    if(argv[0]==='start')return id;
    if(argv[0]==='rm'){assert.deepEqual(argv,['rm','-f','-v',id]);if(cleanupFails)throw Error('synthetic cleanup failed');removed=true;mounted=false;return id;}
    if(argv[0]==='ps')return removed?'':id;
    if(argv[0]==='volume'){assert.deepEqual(argv,['volume','ls','-q','--filter','name='+'c'.repeat(64)]);return removed?'':'c'.repeat(64);}
    if(argv[0]==='exec'&&argv.includes('pg_isready'))return '';
    assert.ok(argv.includes('psql'));
    if(input.startsWith('begin;create schema')){assert.match(input,/create role "authenticated"/);assert.match(input,/insert into private\.contractor_ai_lease/);assert.match(input,/create table "public"\."items"/);assert.match(input,/insert into public\."items"/);if(failSql)throw Error('synthetic SQL failure');interrupt?.abort();return '';}
    if(input.includes('to_jsonb(t)')){const table=input.match(/from public\."([^"]+)" t/)[1];return JSON.stringify(f.rows[table]);}
    if(input.includes('from pg_proc'))return '[]';
    if(input.includes('00000000-0000-4000-8000-000000000099'))return foreignAccess?'1':'0';
    if(input.includes('select count(*) from public.projects'))return '1';
    throw Error('unexpected synthetic SQL');
  },get removed(){return removed},get mounted(){return mounted}};
}

test('archiveRestoresSameRowsAndObjects and retains immutable proof history',async t=>{
  const f=await fixture(t),engine=isolatedEngine(f);
  await withMaintenanceLock(f.home,'restore',async lease=>{
    const result=await restoreBackup({home:f.home,lease,backup:f.archive.path,engine});
    assert.equal(result.passed,true);assert.deepEqual(result.counts,{tables:3,objects:1});assert.equal(result.backupFingerprint,f.point.contentFingerprint);assert.equal(result.sourceArchiveSha256,f.archive.sha256);
    const first=(await f.readIndex()).lastVerified;
    const evidence=await fs.readFile(first.evidencePath);assert.equal(hash(evidence),first.evidenceSha256);assert.deepEqual(JSON.parse(evidence),first.proof);
    await restoreBackup({home:f.home,lease,backup:f.archive.path,engine:isolatedEngine(f)});
    const index=await f.readIndex();assert.equal(index.restoreHistory.length,2);assert.equal(index.restoreHistory[0].evidencePath,first.evidencePath);assert.deepEqual(await fs.readFile(first.evidencePath),evidence);assert.deepEqual(index.points[0].restorePins,[]);
  });
  assert.equal(engine.removed,true);assert.deepEqual(await fs.readdir(path.join(f.home,'maintenance-state','restore-scratch')),[]);assert.ok(await fs.stat(f.archive.path));assert.ok(await fs.stat(f.directory));
});
test('tamperedArchiveFailsBeforeDocker',async t=>{
  const f=await fixture(t),engine=isolatedEngine(f);const bytes=await fs.readFile(f.archive.path);bytes[Math.floor(bytes.length/2)]^=1;await fs.writeFile(f.archive.path,bytes);
  await withMaintenanceLock(f.home,'restore',lease=>assert.rejects(()=>restoreBackup({home:f.home,lease,backup:f.archive.path,engine})));
  assert.equal(engine.calls.length,0);assert.deepEqual((await f.readIndex()).points[0].restorePins,[]);
});
test('interruptedRestorePreservesLastVerified and cleans only owned target',async t=>{
  const f=await fixture(t),previous={proof:{marker:'previous'},evidencePath:'preserved'};
  await withMaintenanceLock(f.home,'restore',async lease=>{
    await backups.updateBackupIndex(f.home,lease,async index=>{index.lastVerified=previous});
    const controller=new AbortController(),engine=isolatedEngine(f,{interrupt:controller});
    await assert.rejects(()=>restoreBackup({home:f.home,lease,backup:f.archive.path,engine,signal:controller.signal}),/interrupted/);
    assert.equal(engine.removed,true);assert.deepEqual((await f.readIndex()).lastVerified,previous);assert.deepEqual((await f.readIndex()).points[0].restorePins,[]);
  });
});
test('unavailableEngineReturnsUnavailable and preserves prior receipt',async t=>{
  const f=await fixture(t),previous={proof:{marker:'previous'}};
  await withMaintenanceLock(f.home,'restore',async lease=>{
    await backups.updateBackupIndex(f.home,lease,async index=>{index.lastVerified=previous});
    const engine=isolatedEngine(f,{unavailable:true}),result=await maintainAvailableRestore({home:f.home,lease,engine});
    assert.equal(result.status,'unavailable');assert.equal(engine.calls.length,1);assert.deepEqual((await f.readIndex()).lastVerified,previous);assert.equal((await f.readIndex()).lastRestoreAttempt.status,'unavailable');
  });
  assert.deepEqual(await fs.readdir(path.join(f.home,'maintenance-state','restore-scratch')),[]);
});
test('negative permission or SQL failure cannot publish passed proof',async t=>{
  const f=await fixture(t);
  await withMaintenanceLock(f.home,'restore',async lease=>{for(const mode of [{foreignAccess:true},{failSql:true}]){const engine=isolatedEngine(f,mode);await assert.rejects(()=>restoreBackup({home:f.home,lease,backup:f.archive.path,engine}));assert.equal(engine.removed,true);assert.equal((await f.readIndex()).lastVerified,null);}});
});
test('folder input is preserved and cannot impersonate managed archive proof',async t=>{
  const f=await fixture(t);
  const input=await resolveBackupInput(f.directory);assert.equal(input.archiveReceipt,null);await input.dispose();assert.ok(await fs.stat(f.directory));
  await withMaintenanceLock(f.home,'restore',async lease=>{const result=await restoreBackup({home:f.home,lease,backup:f.directory,engine:isolatedEngine(f)});assert.equal(result.passed,true);assert.equal(result.format,'backup-v2-directory');assert.equal((await f.readIndex()).lastVerified,null);});
});
test('explicit destination preserves verified Storage files and manifest while default scratch is removed',async t=>{
  const f=await fixture(t),destination=path.join(f.home,'explicit-output');
  await withMaintenanceLock(f.home,'restore',async lease=>{
    const result=await restoreBackup({home:f.home,lease,backup:f.archive.path,destination,engine:isolatedEngine(f)});
    const manifest=JSON.parse(await fs.readFile(path.join(destination,'storage-paths-and-hashes.json')));
    assert.equal(result.output.objects,1);assert.equal(await fs.readFile(path.join(destination,manifest.objects[0].file),'utf8'),'abc');
    assert.equal(hash(await fs.readFile(path.join(destination,manifest.objects[0].file))),manifest.objects[0].sha256);
    assert.equal(JSON.parse(await fs.readFile(path.join(destination,'recovery-proof.json'))).passed,true);
    const previous=(await f.readIndex()).lastVerified,engine=isolatedEngine(f);
    await assert.rejects(()=>restoreBackup({home:f.home,lease,backup:f.archive.path,destination,engine}));
    assert.deepEqual((await f.readIndex()).lastVerified,previous);
  });
  assert.deepEqual(await fs.readdir(path.join(f.home,'maintenance-state','restore-scratch')),[]);
});
test('due restore runs on unchanged backup day and drops only own temporary pin',async t=>{
  const f=await fixture(t),now=new Date().toISOString(),engine=isolatedEngine(f);
  await withMaintenanceLock(f.home,'available',async lease=>{
    await backups.updateBackupIndex(f.home,lease,async index=>{index.lastAttempt={at:now,passed:true};index.points[0].restorePins=['another-owner'];});
    const result=await backups.maintainAvailableBackups('start',{home:f.home,lease,now,engine,getFreeBytes:async()=>100*1024**3});
    assert.equal(result.due,false);assert.equal(result.restore.passed,true);assert.ok(engine.calls.length>0);
    assert.deepEqual((await f.readIndex()).points[0].restorePins,['another-owner']);
    const idleEngine=isolatedEngine(f),idle=await maintainAvailableRestore({home:f.home,lease,engine:idleEngine});
    assert.equal(idle.status,'not-due');assert.equal(idleEngine.calls.length,0);
  });
});
test('unsafe linked input is refused before engine access',async t=>{
  const f=await fixture(t),linked=path.join(f.home,'linked-input'),engine=isolatedEngine(f);
  await fs.symlink(f.directory,linked,'junction');
  await withMaintenanceLock(f.home,'restore',lease=>assert.rejects(()=>restoreBackup({home:f.home,lease,backup:linked,engine})));
  assert.equal(engine.calls.length,0);
});
test('cleanup failure preserves previous proof and cannot claim success',async t=>{
  const f=await fixture(t),previous={proof:{marker:'old'}},engine=isolatedEngine(f,{cleanupFails:true});
  await withMaintenanceLock(f.home,'restore',async lease=>{
    await backups.updateBackupIndex(f.home,lease,async index=>{index.lastVerified=previous;});
    await assert.rejects(()=>restoreBackup({home:f.home,lease,backup:f.archive.path,engine}),/cleanup/);
    assert.deepEqual((await f.readIndex()).lastVerified,previous);assert.equal((await f.readIndex()).lastRestoreAttempt.status,'failed');
  });
});
import { publishLauncherBundle } from './maintenance/lifecycle.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
test('installed bundle restore accepts corrupt ZIP and refuses before engine outside repository',async t=>{
  const parent=await fs.realpath(os.tmpdir()),home=await fs.realpath(await fs.mkdtemp(path.join(parent,'restore-synthetic-')));
  t.after(async()=>{assert.equal(await fs.realpath(home),home);assert.equal(path.dirname(home),parent);await fs.rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  await withMaintenanceLock(home,'bundle',lease=>publishLauncherBundle({home,lease,source:path.dirname(fileURLToPath(import.meta.url))}));
  const corrupt=path.join(home,'corrupt.zip');await fs.writeFile(corrupt,'synthetic corrupt ZIP');
  const preload=path.join(home,'no-engine.mjs');
  await fs.writeFile(preload,'import cp from "node:child_process";import {syncBuiltinESMExports} from "node:module";const original=cp.spawn;cp.spawn=(command,...args)=>{if(command==="docker")throw Error("FORBIDDEN_REAL_ENGINE");return original(command,...args)};syncBuiltinESMExports();');
  await assert.rejects(promisify(execFile)(process.execPath,['--import',pathToFileURL(preload).href,path.join(home,'launcher.mjs'),'maintenance','restore','--home',home,'--backup',corrupt],{cwd:os.tmpdir(),windowsHide:true,timeout:120000}),error=>{
    assert.doesNotMatch(error.stderr,/Unknown maintenance command|FORBIDDEN_REAL_ENGINE|ERR_MODULE_NOT_FOUND|unsettled/);assert.match(error.stderr,/REFUSED/);return true;
  });
  assert.equal(await fs.readFile(corrupt,'utf8'),'synthetic corrupt ZIP');
});
import { nativeArchiveOperation, measureArchiveTargets } from './maintenance/archive.mjs';
test('owned scratch deletion rejects substitution, ADS and late writes and rolls back without commit',async t=>{
  const parent=await fs.realpath(os.tmpdir()),home=await fs.realpath(await fs.mkdtemp(path.join(parent,'restore-synthetic-')));
  t.after(async()=>{assert.equal(await fs.realpath(home),home);assert.equal(path.dirname(home),parent);await fs.rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const root=path.join(home,'maintenance-state','restore-scratch'),target=path.join(root,'restore-'+randomUUID());await fs.mkdir(target,{recursive:true});
  const file=path.join(target,'tiny.txt');await fs.writeFile(file,'abc');
  const [snapshot]=await measureArchiveTargets([target]);
  const request={target,destination:root,targetIdentity:snapshot.identity,targetFingerprint:snapshot.fingerprint};
  const rolledBack=await nativeArchiveOperation('restore-scratch-delete',request,async phase=>phase!=='commit');
  assert.equal(rolledBack.status,'skipped');assert.equal(await fs.readFile(file,'utf8'),'abc');
  await fs.writeFile(file+':synthetic','stream');
  await assert.rejects(()=>nativeArchiveOperation('restore-scratch-delete',request,async()=>true));await fs.unlink(file+':synthetic');
  let phases=0;
  const removed=await nativeArchiveOperation('restore-scratch-delete',request,async()=>{
    phases++;await assert.rejects(()=>fs.writeFile(file,'changed'));await assert.rejects(()=>fs.writeFile(file+':late','stream'));return true;
  });
  assert.equal(phases,2);assert.equal(removed.status,'completed');await assert.rejects(()=>fs.stat(target),{code:'ENOENT'});
  const other=path.join(root,'restore-'+randomUUID());await fs.mkdir(other);const [old]=await measureArchiveTargets([other]);
  await fs.rename(other,other+'-preserved');await fs.mkdir(other);await fs.writeFile(path.join(other,'sentinel'),'preserve');
  await assert.rejects(()=>nativeArchiveOperation('restore-scratch-delete',{target:other,destination:root,targetIdentity:old.identity,targetFingerprint:old.fingerprint},async()=>true));
  assert.equal(await fs.readFile(path.join(other,'sentinel'),'utf8'),'preserve');
  await assert.rejects(()=>nativeArchiveOperation('restore-scratch-delete',{...request,target:home},async()=>true));
});
test('due and rotation share the exact thirty-day freshness boundary',()=>{
  const point={id:'point-'+randomUUID(),schemaHash:hash('schema'),contentFingerprint:hash('bytes'),format:'backup-v2+zip-v1',counts:{tables:1,objects:0},archive:{format:'zip-v1'}};
  const proof={version:1,status:'passed',passed:true,at:'2026-06-01T00:00:00Z',schemaHash:point.schemaHash,backupId:point.id,backupFingerprint:point.contentFingerprint,format:point.format,counts:point.counts,checks:{tables:true,storage:true,schema:true,permissions:true}};
  for(const [now,due] of [['2026-06-30T23:59:59.999Z',false],['2026-07-01T00:00:00Z',true],['2026-07-02T00:00:00Z',true]]){
    assert.equal(backups.restoreDue({now,lastVerified:{proof},schemaHash:point.schemaHash,format:point.format}),due);
    assert.equal(backups.rotationEvidenceMatches(proof,point,now),!due);
  }
});
