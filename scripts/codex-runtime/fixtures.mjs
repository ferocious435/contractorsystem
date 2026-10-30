import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export const ownerId='10000000-0000-4000-8000-000000000001';
export const otherId='20000000-0000-4000-8000-000000000002';
export const selectedModel='owner-picked-model';
export const account={type:'chatgpt',email:'owner@example.invalid',planType:'pro'};
export const models=[{id:selectedModel,model:selectedModel,displayName:'Owner selection',hidden:false,
  defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Low'}],
  inputModalities:['text','image'],supportsPersonality:false,isDefault:true}];
export const finalText='{"message":"שלום, התקבלה בקשתך."}';

export async function temporaryRuntime(t,beforeCleanup){
  const root=await mkdtemp(path.join(os.tmpdir(),'contractor-codex-test-'));
  t.after(async()=>{await beforeCleanup?.();const resolved=path.resolve(root),base=path.resolve(os.tmpdir());
    if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('contractor-codex-test-'))throw Error('Unsafe test cleanup');
    await rm(resolved,{recursive:true,force:true});});
  return root;
}
export function manualClock(){
  let now=0,next=1;const pending=new Map();
  return {api:{now:()=>now,setTimeout(fn,ms){const id=next++;pending.set(id,{fn,at:now+ms});return id;},clearTimeout(id){pending.delete(id);}},
    advance(ms){now+=ms;for(const [id,entry] of [...pending])if(entry.at<=now){pending.delete(id);entry.fn();}}};
}
export const flush=()=>new Promise(resolve=>setImmediate(resolve));

export function fakeCodex({onRequest,fragmentBytes=0,configLayers,threadSources=[]}={}){
  const frames=[],processes=[],spawns=[];let nextPid=700000;
  const fx={frames,processes,spawns,account:structuredClone(account),models:structuredClone(models),mcpStarts:0,
    get turnStartCalls(){return frames.filter(frame=>frame.method==='turn/start').length;},
    async until(method){const deadline=Date.now()+5000;while(Date.now()<deadline){if(frames.some(frame=>frame.method===method))return;await delay(5);}throw Error('No request '+method);},
    spawnProcess(command,args,options){
      const child=new EventEmitter();child.pid=nextPid++;child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
      child.kill=()=>{if(!child.killed){child.killed=true;child.stdout.end();child.stderr.end();queueMicrotask(()=>child.emit('exit',null,'SIGTERM'));}return true;};
      let incoming='';child.stdin=new PassThrough();
      child.send=message=>{const bytes=Buffer.from(JSON.stringify(message)+'\n');
        if(child.killed){child.stdout.emit('data',bytes);return;}
        if(fragmentBytes)for(let pos=0;pos<bytes.length;pos+=fragmentBytes)child.stdout.write(bytes.subarray(pos,pos+fragmentBytes));else child.stdout.write(bytes);};
      child.reply=(request,result)=>child.send({id:request.id,result});
      child.finish=(threadId='business-thread',turnId='business-turn',text=finalText,status='completed')=>{
        const item={type:'agentMessage',id:'answer',text,phase:'final_answer'};
        child.send({method:'item/completed',params:{threadId,turnId,item}});
        child.send({method:'turn/completed',params:{threadId,turn:{id:turnId,items:[item],status,error:null}}});
      };
      child.stdin.on('data',bytes=>{incoming+=bytes.toString('utf8');let end;
        while((end=incoming.indexOf('\n'))>=0){const line=incoming.slice(0,end);incoming=incoming.slice(end+1);if(!line)continue;
          const request=JSON.parse(line);frames.push(request);
          queueMicrotask(()=>{if(child.killed)return;if(onRequest?.(request,child,fx)===false)return;
            if(request.id===undefined)return;
            switch(request.method){
              case 'initialize':child.reply(request,{userAgent:'codex-fixture/0.162.1'});break;
              case 'account/read':child.reply(request,{account:fx.account,requiresOpenaiAuth:true});break;
              case 'model/list':child.reply(request,{data:fx.models,nextCursor:null});break;
              case 'config/read':child.reply(request,{config:{model_provider:'openai'},layers:configLayers??[],origins:{}});break;
              case 'thread/start':{
                for(const layer of configLayers??[])for(const name of Object.keys(layer.config?.mcp_servers??{}))if(request.params.config?.mcp_servers?.[name]?.enabled!==false)fx.mcpStarts++;
                child.reply(request,{thread:{id:'business-thread',sessionId:'business-thread',preview:'',ephemeral:true,modelProvider:'openai',createdAt:1,updatedAt:1,cwd:options.cwd,path:null,status:{type:'idle'},source:'appServer',cliVersion:'0.162.1',gitInfo:null,turns:[],name:null},instructionSources:threadSources});break;}
              case 'turn/start':child.reply(request,{turn:{id:'business-turn',items:[],status:'inProgress',error:null}});queueMicrotask(()=>child.finish());break;
              case 'turn/interrupt':child.reply(request,{});break;
              default:child.send({id:request.id,error:{code:-32601,message:'Method not supported by fixture'}});
            }
          });
        }
      });
      processes.push(child);spawns.push({command,args,options});return child;
    }
  };return fx;
}
