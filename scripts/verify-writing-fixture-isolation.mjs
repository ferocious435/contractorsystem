import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

test('BOQ runtime preserves legacy resume evidence and writes diagnostics in its own directory', {timeout:60000}, async()=>{
 const root=process.cwd(),scratch=await mkdtemp(path.join(tmpdir(),'contractor-boq-isolation-'));
 let child,logs='';
 try{
  for(const name of ['src','scripts','node_modules'])await symlink(path.join(root,name),path.join(scratch,name),'junction');
  await writeFile(path.join(scratch,'package.json'),await readFile(path.join(root,'package.json')));
  const legacy=path.join(scratch,'.superpowers/codex-program-runtime-2026-10-30/writing-browser');
  await mkdir(legacy,{recursive:true});
  const saved=JSON.stringify({syntheticOnly:true,turns:7,jobs:[],letters:[]});
  await writeFile(path.join(legacy,'evidence.json'),saved);
  child=spawn(process.execPath,['--preserve-symlinks','--preserve-symlinks-main','--import',pathToFileURL(path.join(scratch,'scripts/codex-runtime/load-server.mjs')).href,'--experimental-strip-types',path.join(scratch,'scripts/codex-runtime/writing-browser.mjs'),'--boq','--port=0'],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
  let port;
  for(let attempt=0;attempt<500;attempt++){
   port=logs.match(/Synthetic writing browser http:\/\/127\.0\.0\.1:(\d+)/u)?.[1];
   if(port)break;
   if(child.exitCode!==null)assert.fail(logs);
   await delay(100);
  }
  assert.ok(port,logs);
  const response=await fetch(`http://127.0.0.1:${port}/fixture/stats`);
  assert.equal(response.status,200);assert.equal((await response.json()).mode,'boq');
  assert.equal(await readFile(path.join(legacy,'evidence.json'),'utf8'),saved,'BOQ must not replace the legacy turn counter');
  const boq=JSON.parse(await readFile(path.join(legacy,'boq/evidence.json'),'utf8'));
  assert.equal(boq.mode,'boq');assert.equal(boq.legacySql,false);
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  // Junctions point outside scratch: remove the links before removing scratch itself.
  for(const name of ['src','scripts','node_modules'])await rm(path.join(scratch,name),{force:true});
  assert.ok(path.resolve(scratch).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(scratch,{recursive:true,force:true});
 }
});
