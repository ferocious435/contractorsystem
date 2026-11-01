import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const packager=fileURLToPath(new URL('./local-system-package.mjs',import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const toolPath='data/tools/kreuzberg/4.10.4/bin';

function fixture(t,{assets=true,dll=true}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'contractor-release-assets-'));
  const source=path.join(directory,'source'),workspace=path.join(directory,'workspace'),privateRoot=path.join(directory,'private');
  const write=(root,name,content)=>{const filename=path.join(root,name);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,content);};
  write(source,'package.json','{"private":true}');
  write(source,'package-lock.json','{"name":"package-regression-fixture","lockfileVersion":3}');
  write(source,'.next-fixture/BUILD_ID','fixture-build');
  write(source,'src/utils/local-ocr-mcp.ts',"export const LOCAL_OCR_MCP_VERSION = '4.10.4';\n");
  const reader=fs.readFileSync(path.join(source,'src/utils/local-ocr-mcp.ts'));
  write(directory,'checks.json',JSON.stringify({source,sourceUnchanged:true,checks:[{status:0},{status:0}],builtFiles:[{path:'src/utils/local-ocr-mcp.ts',sha256:digest(reader)}]}));
  write(workspace,'deps/placeholder.txt','fixture dependency');
  for(const name of ['local-system-backup.mjs','local-system-restore.mjs','local-system-launch.mjs'])write(workspace,'scripts/'+name,'// fixture; never executed\n');
  write(workspace,'ops/backup-schema.json','{}');write(workspace,'.env.local','CONTRACTOR_TEST_FIXTURE=1\n');
  if(assets){write(workspace,toolPath+'/kreuzberg.exe','synthetic reader binary; never executed');if(dll)write(workspace,toolPath+'/onnxruntime.dll','synthetic runtime library; never executed');write(workspace,toolPath+'/LICENSE','synthetic license');}
  const env={...process.env,LOCALAPPDATA:privateRoot};
  if(process.platform!=='win32'){
    write(workspace,'test-bin/where.exe','#!/bin/sh\nprintf "%s\\n" "$CONTRACTOR_TEST_CODEX_EXE"\n');
    fs.chmodSync(path.join(workspace,'test-bin/where.exe'),0o700);
    env.CONTRACTOR_TEST_CODEX_EXE=process.execPath;
    env.PATH=path.join(workspace,'test-bin')+path.delimiter+env.PATH;
  }
  t.after(()=>{
    const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),temp);assert.ok(path.basename(resolved).startsWith('contractor-release-assets-'));
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  });
  const run=()=>spawnSync(process.execPath,[packager,'--id','reader-fixture','--source',source,'--dist','.next-fixture','--dependencies',path.join(workspace,'deps'),'--checks',path.join(directory,'checks.json')],{cwd:workspace,env,encoding:'utf8',windowsHide:true,timeout:60000});
  return {directory,source,workspace,privateRoot,release:path.join(privateRoot,'ContractorSystem/releases/reader-fixture'),run};
}

test('a packaged release contains the fallback reader and its runtime in the sealed manifest',t=>{
  const f=fixture(t),result=f.run();assert.equal(result.status,0,result.stderr);
  const release=JSON.parse(fs.readFileSync(path.join(f.release,'release.json')));
  for(const name of ['kreuzberg.exe','onnxruntime.dll','LICENSE']){
    const relative=toolPath+'/'+name,source=fs.readFileSync(path.join(f.workspace,relative));
    assert.equal(fs.existsSync(path.join(f.release,relative)),true,'The installed reader asset must exist: '+name);
    assert.deepEqual(fs.readFileSync(path.join(f.release,relative)),source);
    assert.equal(release.files.find(file=>file.path.replaceAll('\\','/')===relative)?.sha256,digest(source));
  }
});

test('missing fallback reader prevents publishing an incomplete release',t=>{
  const f=fixture(t,{assets:false}),result=f.run();
  assert.notEqual(result.status,0,'A release missing its required OCR reader must fail');
  assert.match(result.stderr,/reader|OCR|kreuzberg/i);
  assert.equal(fs.existsSync(f.release),false,'Reject missing assets before creating the release');
});

test('missing reader runtime library prevents publishing an incomplete release',t=>{
  const f=fixture(t,{dll:false}),result=f.run();
  assert.notEqual(result.status,0,'A release missing the native runtime must fail');
  assert.match(result.stderr,/onnxruntime|runtime|OCR/i);
  assert.equal(fs.existsSync(f.release),false);
});
