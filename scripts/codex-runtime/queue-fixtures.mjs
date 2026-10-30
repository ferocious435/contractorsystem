import {randomUUID} from 'node:crypto';
import {ownerId,selectedModel} from './fixtures.mjs';
export const projectId='30000000-0000-4000-8000-000000000003';
export const savedProfile={ownerId,model:selectedModel,effort:null,revision:1,accountFingerprint:'a'.repeat(64)};
const publicJob=j=>Object.fromEntries(['id','projectId','kind','state','revision','conversationId','clientContextId','result','error'].map(key=>[key,structuredClone(j[key])]));
const failure=code=>Object.assign(Error('synthetic'),{code});
export function queueFixture({now=()=>1000,onGenerate}={}){
  const rows=new Map();let active=null;const fx={rows,modelTurns:0,parallel:0,maxParallel:0};
  const store={
    async enqueue(owner,project,kind,payload,key,profile,context={}){const previous=[...rows.values()].find(j=>j.requestKey===key&&j.ownerId===owner&&j.projectId===project);if(previous)return publicJob(previous);
      const j={id:randomUUID(),ownerId:owner,projectId:project,kind,payload,requestKey:key,inputHash:'hash',profile:structuredClone(profile),contextSnapshot:{},state:'QUEUED',revision:1,attempt:0,leaseToken:null,leaseExpiresAt:null,createdAt:now(),conversationId:context.conversationId??null,clientContextId:context.clientContextId??null,result:null,error:null};rows.set(j.id,j);return publicJob(j);},
    async claim(){if(active)return null;const j=[...rows.values()].find(j=>j.state==='QUEUED');if(!j)return null;j.state='RUNNING';j.revision++;j.attempt++;j.leaseToken=randomUUID();j.leaseExpiresAt=new Date(now()+30000).toISOString();active=j.id;return structuredClone(j);},
    async heartbeat(id,lease){const j=rows.get(id);if(active!==id||j.state!=='RUNNING'||j.leaseToken!==lease)throw failure('AI_LEASE_LOST');},
    async complete(id,lease,prepared){const j=rows.get(id);if(active!==id||j.state!=='RUNNING'||j.leaseToken!==lease)return false;j.result=structuredClone(prepared.result);j.state='SUCCEEDED';j.revision++;active=null;return true;},
    async fail(id,lease,error){const j=rows.get(id);if(active!==id||j.state!=='RUNNING'||j.leaseToken!==lease)return false;j.state='FAILED';j.error=structuredClone(error);j.revision++;active=null;return true;},
    async cancel(owner,id,revision){const j=rows.get(id);if(!j||j.ownerId!==owner)throw failure('AI_ACCESS_DENIED');if(j.revision!==revision)throw failure('AI_JOB_CONFLICT');j.state='CANCELLED';j.revision++;j.leaseToken=null;if(active===id)active=null;return publicJob(j);},
    async interruptStale(stamp,pendingBefore){let count=0;for(const j of rows.values())if((j.state==='RUNNING'&&Date.parse(j.leaseExpiresAt)<=stamp)||(j.state==='QUEUED'&&pendingBefore!==undefined&&j.createdAt<pendingBefore)){j.state='INTERRUPTED';j.revision++;if(active===j.id)active=null;count++;}return count;},
    async readOwned(owner,project,id){const j=rows.get(id);return j?.ownerId===owner&&j.projectId===project?publicJob(j):null;},
    async listOwned(owner,project,kind,context){return [...rows.values()].filter(j=>j.ownerId===owner&&j.projectId===project&&j.kind===kind&&(!context||j.clientContextId===context)).map(publicJob);}
  };
  const client={async runTurn(input,profile,signal){fx.modelTurns++;fx.parallel++;fx.maxParallel=Math.max(fx.maxParallel,fx.parallel);try{return onGenerate?await onGenerate(input,profile,signal):'{"answer":"saved business result"}';}finally{fx.parallel--;}}};
  const handler={validate(value){if(!value||typeof value.question!=='string'||Object.keys(value).some(key=>key!=='question'))throw failure('AI_INPUT_INVALID');return value;},async execute(payload,execution){return {result:JSON.parse(await execution.generate({text:payload.question,outputSchema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}})),effects:[]};}};
  const enqueue=(key='button-1')=>store.enqueue(ownerId,projectId,'letter',{question:'business context'},key,savedProfile,{});
  return Object.assign(fx,{store,client,handler,enqueue,clock:{now,setTimeout,clearTimeout}});
}
