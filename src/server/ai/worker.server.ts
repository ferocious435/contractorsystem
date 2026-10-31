import 'server-only';
import {randomUUID} from 'node:crypto';
import {BusinessAiError,record,type AiExecutionContext,type AiJobHandler,type AiJobKind,type AiTurnInput} from './contracts';
import {getAiJobStore,type AiJobRecord,type AiJobStore} from './jobs.server';
import {getCodexClient,type CodexClient} from './codex-client.server';
import {getAiHandler} from './handlers/index';
interface WorkerClock {now():number;setTimeout(callback:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void;}
interface WorkerOptions {store:AiJobStore;client:Pick<CodexClient,'runTurn'>;handlerFor:(kind:AiJobKind)=>AiJobHandler|null;clock?:WorkerClock;startedAt?:number;workerId?:string;}
const executionState=globalThis as typeof globalThis&{contractorAiExecutions?:WeakSet<object>};
const trusted=executionState.contractorAiExecutions??=new WeakSet<object>();
export const isAiExecutionContext=(value:unknown):value is AiExecutionContext=>record(value)&&trusted.has(value);
const safeCodes=new Set(['AI_TIMEOUT','AI_UNAVAILABLE','AI_RESPONSE_INVALID','AI_RESPONSE_INCOMPLETE','AI_CANCELLED','AI_LEASE_LOST','AI_SOURCE_CHANGED','AI_CONTEXT_CHANGED','AI_ACCOUNT_CHANGED','AI_MODEL_UNAVAILABLE','AI_TOOL_FORBIDDEN','AI_PROFILE_INVALID','AI_FACT_UNVERIFIED','AI_AMOUNT_UNVERIFIED','AI_QUOTE_UNVERIFIED','AI_SOURCE_UNVERIFIED','AI_WRITING_INVALID']);
export function createAiWorker(options:WorkerOptions) {
    const clock=options.clock??{now:()=>Date.now(),setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clearTimeout:(timer:unknown)=>clearTimeout(timer as NodeJS.Timeout)};
    const workerId=options.workerId??randomUUID(),startedAt=options.startedAt??clock.now();
    let initialization:Promise<void>|null=null,running:Promise<void>|null=null,requested=false;
    let current:{id:string;controller:AbortController}|null=null;
    function initialize():Promise<void>{if(initialization)return initialization;const attempt=(async()=>{await options.store.interruptStale(clock.now(),startedAt);})();initialization=attempt;void attempt.catch(()=>{if(initialization===attempt)initialization=null;});return attempt;}
    function abort(id:string):void{if(current?.id===id)current.controller.abort();}
    async function execute(job:AiJobRecord):Promise<void>{
        const controller=new AbortController();current={id:job.id,controller};let heartbeat:unknown,closed=false,heartbeatWork=Promise.resolve();
        function schedule(){heartbeat=clock.setTimeout(()=>{heartbeatWork=(async()=>{try{await options.store.heartbeat(job.id,job.leaseToken);}catch{controller.abort();}finally{if(!closed&&!controller.signal.aborted)schedule();}})();},10000);}
        async function checkActive(){if(controller.signal.aborted)throw new BusinessAiError('AI_CANCELLED',undefined,409);
            const current=await options.store.readOwned(job.ownerId,job.projectId,job.id);if(!current||current.state!=='RUNNING'||current.revision!==job.revision){controller.abort();throw new BusinessAiError('AI_CANCELLED',undefined,409);}
            await options.store.heartbeat(job.id,job.leaseToken);
        }
        let generation:Promise<unknown>=Promise.resolve();
        const execution:AiExecutionContext=Object.freeze({jobId:job.id,ownerId:job.ownerId,projectId:job.projectId,profile:Object.freeze({...job.profile}),signal:controller.signal,checkActive,
            generate(input:AiTurnInput):Promise<string>{const next=generation.then(async()=>{await checkActive();const text=await options.client.runTurn(input,execution.profile,controller.signal);await checkActive();return text;});generation=next.catch(()=>{});return next;}});
        trusted.add(execution);
        try{
            if(job.profile.ownerId!==job.ownerId)throw new BusinessAiError('AI_PROFILE_INVALID');
            const handler=options.handlerFor(job.kind);if(!handler)throw new BusinessAiError('AI_HANDLER_INVALID');
            schedule();await checkActive();const prepared=await handler.execute(job.payload,execution);await checkActive();
            await options.store.complete(job.id,job.leaseToken,prepared);
        }catch(error){
            controller.abort();const code=record(error)&&typeof error.code==='string'&&safeCodes.has(error.code)?error.code:'AI_FAILED';
            const message=code.endsWith('_UNVERIFIED')||code==='AI_WRITING_INVALID'?'התשובה כללה פרט שלא ניתן לאמת במקור. הטקסט הקודם נשמר; אפשר לבקש ניסוח מתוקן.':'העוזר לא השלים את הפעולה. הנתונים והטקסט הקודם נשמרו.';
            await options.store.fail(job.id,job.leaseToken,{code,message}).catch(()=>false);
        }finally{
            closed=true;if(heartbeat!==undefined)clock.clearTimeout(heartbeat);await heartbeatWork;trusted.delete(execution);controller.abort();current=null;
            await options.store.interruptStale(clock.now()).catch(()=>0);
        }
    }
    function run():Promise<void>{
        requested=true;if(running)return running;
        running=(async()=>{await initialize();do{requested=false;let job;while((job=await options.store.claim(workerId,clock.now()))!==null)await execute(job);}while(requested);})()
            .catch(error=>{requested=false;throw error;})
            .finally(()=>{running=null;if(requested)void run().catch(()=>{});});return running;
    }
    return {initialize,run,abort};
}
export type AiWorker=ReturnType<typeof createAiWorker>;
const processRuntime=globalThis as typeof globalThis&{contractorAiWorker?:AiWorker};
export function getAiWorker():AiWorker{return processRuntime.contractorAiWorker??=createAiWorker({store:getAiJobStore(),client:getCodexClient(),handlerFor:getAiHandler});}
export const runQueuedAiJobs=():Promise<void>=>getAiWorker().run();
