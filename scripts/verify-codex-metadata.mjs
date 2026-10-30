import './codex-runtime/load-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createCodexClient} from '../src/server/ai/codex-client.server.ts';
import {temporaryRuntime} from './codex-runtime/fixtures.mjs';

// Real transport characterization, including Windows process and working-directory cleanup.
// This contacts only Codex metadata; it never starts a model thread/turn or selects a model.
test('installed Codex starts hidden over real stdio and reports ChatGPT metadata without inference',async t=>{
  let api;const runtimeDir=await temporaryRuntime(t,()=>api?.close());let spawnErrorCode=null;
  api=createCodexClient({runtimeDir,spawnProcess(command,args,options){
    const child=spawn(command,args,{...options,stdio:'pipe'});
    child.on('error',error=>{spawnErrorCode=error.code;});return child;
  }});
  try{
    const account=await api.request('account/read',{refreshToken:false});assert.equal(account.account?.type,'chatgpt');
    const config=await api.request('config/read',{includeLayers:true});assert.equal(typeof config.config,'object');
    console.log(JSON.stringify({metadataOnly:true,chatgpt:true,configLayers:Array.isArray(config.layers)?config.layers.length:0,modelTurns:0}));
  }catch(error){console.log(JSON.stringify({metadataOnly:true,spawnErrorCode,errorCode:error.code,modelTurns:0}));throw error;}
});
