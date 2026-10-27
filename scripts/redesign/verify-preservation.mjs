import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compareProtectedFiles} from './preservation.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'contractor-preservation-'));t.after(()=>{const resolved=path.resolve(dir),parent=path.resolve(tmpdir());assert.equal(path.dirname(resolved),parent);assert.ok(path.basename(resolved).startsWith('contractor-preservation-'));rmSync(resolved,{recursive:true,force:true});});writeFileSync(path.join(dir,'ui.txt'),'before');writeFileSync(path.join(dir,'owner.txt'),'private');return{dir,baseline:[{path:'ui.txt',sha256:hash('before')},{path:'owner.txt',sha256:hash('private')}]};}
test('an explicitly allowed visual change does not hide an unrelated owner change',t=>{
  const {dir,baseline}=fixture(t);writeFileSync(path.join(dir,'ui.txt'),'after');writeFileSync(path.join(dir,'owner.txt'),'changed');
  assert.deepEqual(compareProtectedFiles(dir,baseline,new Set(['ui.txt'])),{unexpected:['owner.txt'],missing:[]});
});
test('an empty allowlist permits no implicit changes',t=>{
  const {dir,baseline}=fixture(t);writeFileSync(path.join(dir,'ui.txt'),'after');
  assert.deepEqual(compareProtectedFiles(dir,baseline,new Set()),{unexpected:['ui.txt'],missing:[]});
});
test('a missing protected source is reported instead of treated as unchanged',t=>{
  const {dir,baseline}=fixture(t);rmSync(path.join(dir,'owner.txt'));
  assert.deepEqual(compareProtectedFiles(dir,baseline,new Set()),{unexpected:[],missing:['owner.txt']});
});
test('manifest traversal cannot inspect or exempt a path outside the selected root',t=>{
  const {dir}=fixture(t);
  assert.throws(()=>compareProtectedFiles(dir,[{path:'../outside.txt',sha256:hash('outside')}],new Set(['../outside.txt'])),/outside|root|path/iu);
});
