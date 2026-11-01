import test from 'node:test';
import assert from 'node:assert/strict';
import * as database from './codex-runtime/db.mjs';

test('test_database_waits_for_the_final_server_instead_of_the_temporary_initialization_socket',async()=>{
 assert.equal(typeof database.waitForTestDatabase,'function');
 let polls=0,finalServerReady=false;
 const invoke=args=>{
  polls++;finalServerReady=polls>=3;
  const tcp=args.includes('-h')&&args[args.indexOf('-h')+1]==='127.0.0.1';
  if(tcp&&!finalServerReady)throw Error('Final server is not ready');
  return 'accepting connections'; // The temporary Unix socket is already accepting.
 };
 await database.waitForTestDatabase('checked-container-id',invoke,async()=>{});
 assert.equal(finalServerReady,true,'Temporary initialization must not authorize schema queries');
});
test('test_database_startup_is_bounded_and_does_not_hide_a_persistent_failure',async()=>{
 assert.equal(typeof database.waitForTestDatabase,'function');
 let polls=0;const failure=Error('Final server unavailable');
 await assert.rejects(()=>database.waitForTestDatabase('checked-container-id',()=>{polls++;throw failure;},async()=>{}),error=>error===failure);
 assert.equal(polls,50);
});
