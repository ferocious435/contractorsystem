import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {prepareWritingDb,writingRpc} from './writing-db.mjs';
import {seedLettersTestData,syntheticIds as id,createSyntheticLetterClient} from '../fixtures/letter-rpc-test-adapter.mjs';
import {runLettersSql,jsonSql} from '../letters-db.mjs';
import {createAiJobStore} from '../../src/server/ai/jobs.server.ts';
import {createAiWorker} from '../../src/server/ai/worker.server.ts';
import {createAiJobService} from '../../src/server/ai/service.server.ts';
import {createLetterHandler} from '../../src/server/ai/handlers/letter.ts';
import {createConsultantHandler} from '../../src/server/ai/handlers/consultant.ts';
import {loadProjectWritingContext} from '../../src/utils/project-writing-context-server.ts';
import {createLetterHttpHandlers} from '../../src/utils/letter-persistence-server.ts';
import {savedProfile} from './queue-fixtures.mjs';

export async function createLegacyWritingFixture(out){
await prepareWritingDb();if(!process.argv.includes('--resume'))seedLettersTestData();runLettersSql(`insert into public.profiles values('${id.userA}','super_admin'),('${id.userB}','member') on conflict(id) do update set role=excluded.role;insert into private.contractor_ai_lease(slot) values(1) on conflict do nothing;`);
const client=createSyntheticLetterClient(),transport=writingRpc(),store=createAiJobStore(transport),letterHttp=createLetterHttpHandlers({createClient:async()=>client});
const handlers={letter:createLetterHandler({load:async execution=>{const response=await transport.rpc('contractor_ai_letter_preview',{p:{jobId:execution.jobId}});if(response.error)throw response.error;return response.data;}}),consultant:createConsultantHandler({load:execution=>loadProjectWritingContext(client,execution.projectId,execution.ownerId,'צינור'),history:async execution=>{const current=await store.readOwned(execution.ownerId,execution.projectId,execution.jobId),jobs=await store.listOwned(execution.ownerId,execution.projectId,'consultant',current.conversationId);return jobs.filter(job=>job.state==='SUCCEEDED').reverse().flatMap(job=>[{role:'user',content:job.result.question},{role:'assistant',content:job.result.response}]);}})};
let gate=null,turns=process.argv.includes('--resume')&&existsSync(path.join(out,'evidence.json'))?JSON.parse(readFileSync(path.join(out,'evidence.json'),'utf8')).turns:0;
const worker=createAiWorker({store,handlerFor:kind=>handlers[kind]??null,client:{async runTurn(input,_profile,signal){turns++;await new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);gate=resolve;signal.addEventListener('abort',()=>{gate=null;reject(signal.reason);},{once:true});});gate=null;return JSON.stringify(input.outputSchema.required.includes('unknowns')?{body:'יש לתאם את העבודה לפי המסמכים השמורים.',sourceIds:[],unknowns:['לא הוצג אישור סופי.'],nextActions:['יש לבקש הנחיה כתובה.']}:{body:'שלום, נבקש לתאם את העבודה לפי הנתונים שנמסרו. תודה על שיתוף הפעולה.',sourceIds:[]});}}});
const service=createAiJobService({store,worker,authenticate:async()=>({id:id.userA}),resolveOwner:async()=>id.userA,ownsProject:async(owner,project)=>Boolean((await client.from('projects').select('id').eq('id',project).eq('contractor_id',owner).maybeSingle()).data),readProfile:async()=>savedProfile,handlerFor:kind=>handlers[kind]??null});
const stats=()=>({syntheticOnly:true,turns,jobs:jsonSql("select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'state',state,'revision',revision)),'[]') from public.project_ai_jobs;"),letters:jsonSql('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\') from public.vo_letters t;')});
return {stats,handle:async(url,request,raw)=>{let response;
    if(url.pathname==='/fixture/release'){gate?.();response=Response.json({success:true});}
    else if(url.pathname==='/fixture/stats')response=Response.json(stats());
    else if(url.pathname==='/fixture/read'){const {table,calls}=JSON.parse(raw);let query=client.from(table);for(const {method,args}of calls){if(!['select','eq','in','is','order','range','single','maybeSingle'].includes(method))throw Error('Fixture read method rejected');query=query[method](...args);}response=Response.json(await query);}
    else if(url.pathname==='/api/system/ai-status')response=Response.json({available:true,provider:'Codex',reason:null});
    else if(url.pathname==='/api/generate-letter')response=await service.createRequest(request,'letter');
    else if(url.pathname==='/api/chat')response=await service.createRequest(request,'consultant');
    else if(url.pathname==='/api/ai/jobs')response=await service.list(request);
    else if(/^\/api\/ai\/jobs\/[a-f\d-]+\/cancel$/.test(url.pathname))response=await service.cancelRequest(request,url.pathname.split('/')[4]);
    else if(/^\/api\/ai\/jobs\/[a-f\d-]+$/.test(url.pathname))response=await service.read(request,url.pathname.split('/')[4]);
    else if(url.pathname==='/api/pricing/vo-letters/preview')response=await letterHttp.preview(request);
    else if(url.pathname==='/api/pricing/vo-letters/sent')response=await letterHttp.markSent(request);
    else if(url.pathname==='/api/pricing/vo-letters')response=await letterHttp.save(request);
    else response=Response.json({error:'Fixture route not available'},{status:404});
return response;
}};
}
