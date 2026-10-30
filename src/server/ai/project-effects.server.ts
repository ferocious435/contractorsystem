import 'server-only';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BusinessAiError,record,validUuid,type AiExecutionContext,type JsonObject,type VerifiedAiEffect} from './contracts';
import {isAiExecutionContext} from './worker.server';
import {getAiJobStore} from './jobs.server';
import {findingNeedsHistory} from '@/utils/scan-finding-retention-policy';

type Row=Record<string,unknown>&{id:string};
type Reply={data:unknown;count:number;error:{message:string;code?:string}|null};
const fields:Record<string,{type:VerifiedAiEffect['type'];columns:string[]}>= {
    documents:{type:'DOCUMENT_ANALYSIS',columns:['parsed_json','ai_status','ocr_status','extracted_text','content_hash','extracted_text_hash','processed_at']},
    contradictions:{type:'SCAN_FINDING',columns:['title','description','strategy_advice','severity','status','source_execution_doc_id','target_contract_doc_id','related_contradiction_id','pricing_status','evidence_data','category','scan_signature']},
    document_scan_state:{type:'SCAN_STATE',columns:['contract_doc_ids','work_doc_id','contract_signature','work_signature','scan_signature','status','findings_count','scanned_at','total_work_docs','processed_work_docs','current_step','error_message','started_at','updated_at','completed_at']},
    pricing_ledger:{type:'PRICING_EVIDENCE',columns:['ai_rationale','governing_notes','expert_strategy','evidence_data']},
};
const invalid=()=>new BusinessAiError('AI_EFFECT_INVALID',undefined,400);
function stable(value:unknown):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(record(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value)??'undefined';}
function field(row:Row,key:string):unknown {return key.replace(/->>/g,'->').split('->').reduce<unknown>((value,part)=>record(value)?value[part.replace(/^['"]|['"]$/g,'')]:undefined,row);}
const values=(value:unknown):unknown[]=>Array.isArray(value)?value:String(value).replace(/^\(|\)$/g,'').split(',').map(item=>item.trim().replace(/^"|"$/g,''));
function compare(row:Row,key:string,operator:string,wanted:unknown):boolean {const value=field(row,key);if(operator==='is')return wanted===null||wanted==='null'?value==null:value===wanted;
    if(operator==='eq')return value===wanted;if(operator==='neq')return value!=null&&value!==wanted;if(operator==='in')return value!=null&&values(wanted).includes(value);
    if(operator==='contains')return record(value)&&record(wanted)?Object.entries(wanted).every(([name,part])=>stable(value[name])===stable(part)):Array.isArray(value)&&values(wanted).every(part=>value.includes(part));
    if(operator==='ilike'||operator==='like'){const escaped=String(wanted).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');return new RegExp('^'+escaped+'$',operator==='ilike'?'iu':'u').test(String(value??''));}
    if(value==null)return false;const a=String(value),b=String(wanted);if(operator==='gt')return a>b;if(operator==='gte')return a>=b;if(operator==='lt')return a<b;if(operator==='lte')return a<=b;throw invalid();
}
async function countedRows(client:SupabaseClient,table:string,configure:(query:unknown)=>unknown):Promise<Row[]> {
    const rows:Row[]=[];let expected:number|null=null;
    for(let start=0;;start+=500){const base=client.from(table).select('*,xmin',{count:'exact'}).order('id').range(start,start+499);
        const response=await configure(base) as {data:unknown;error:unknown;count:number|null};if(response.error)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
        if(!Array.isArray(response.data)||!Number.isSafeInteger(response.count)||Number(response.count)<0||expected!==null&&expected!==response.count||response.data.some(row=>!record(row)||!validUuid(row.id))||response.data.length===0&&rows.length<Number(response.count))throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
        expected=Number(response.count);rows.push(...response.data as Row[]);if(rows.length>=expected)break;
    }
    if(rows.length!==expected||new Set(rows.map(row=>row.id)).size!==rows.length)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');return rows;
}
/** Runs the existing validators against an isolated project snapshot. Only effects() can leave it,
 * and only the job store may commit those effects with the current lease and source revisions. */
export async function createProjectEffectClient(database:SupabaseClient,execution:AiExecutionContext):Promise<{client:SupabaseClient;effects():Promise<VerifiedAiEffect[]>}> {
    if(!isAiExecutionContext(execution)||execution.signal.aborted)throw new BusinessAiError('AI_EXECUTION_REQUIRED',undefined,409);await execution.checkActive();
    const owned=await database.from('projects').select('*').eq('id',execution.projectId).eq('contractor_id',execution.ownerId).maybeSingle();if(owned.error||!owned.data)throw new BusinessAiError('AI_ACCESS_DENIED',undefined,403);
    const tables=Object.keys(fields),loaded=await Promise.all(tables.map(table=>countedRows(database,table,query=>(query as unknown as {eq(key:string,value:string):unknown}).eq('project_id',execution.projectId))));
    const [references,prices,incorporations]=await Promise.all([
        countedRows(database,'reference_documents',query=>(query as unknown as {eq(key:string,value:string):unknown}).eq('contractor_id',execution.ownerId)),
        countedRows(database,'pricelists',query=>(query as unknown as {or(value:string):unknown}).or(`contractor_id.eq.${execution.ownerId},is_global.eq.true`)),
        countedRows(database,'reference_document_incorporations',query=>(query as {eq(key:string,value:string):unknown}).eq('project_id',execution.projectId)),
    ]);
    const original=new Map<string,Map<string,Row>>(),current=new Map<string,Map<string,Row>>();
    tables.forEach((table,index)=>{if(loaded[index].some(row=>row.project_id!==execution.projectId))throw new BusinessAiError('AI_ACCESS_DENIED',undefined,403);original.set(table,new Map(loaded[index].map(row=>[row.id,structuredClone(row)])));current.set(table,new Map(loaded[index].map(row=>[row.id,structuredClone(row)])));});
    current.set('projects',new Map([[owned.data.id,structuredClone(owned.data)]]));
    const referenceRows=references.filter(row=>row.project_id===execution.projectId||row.project_id==null),priceRows=prices.filter(row=>row.is_global===true||row.contractor_id===execution.ownerId&&(row.project_id===execution.projectId||row.project_id==null));
    current.set('reference_documents',new Map(referenceRows.map(row=>[row.id,row])));current.set('pricelists',new Map(priceRows.map(row=>[row.id,row])));
    current.set('reference_document_incorporations',new Map(incorporations.filter(row=>referenceRows.some(reference=>reference.id===row.reference_document_id)).map(row=>[row.id,row])));
    const letters=(await countedRows(database,'vo_letters',query=>(query as {eq(key:string,value:string):unknown}).eq('project_id',execution.projectId))).filter(row=>row.project_id===execution.projectId);
    const ledgerIds=loaded[tables.indexOf('pricing_ledger')].map(row=>row.id),letterIds=letters.map(row=>row.id);
    const items=letterIds.length&&ledgerIds.length?await countedRows(database,'vo_letter_items',query=>(query as {in(key:string,ids:string[]):{in(key:string,ids:string[]):unknown}}).in('letter_id',letterIds).in('ledger_item_id',ledgerIds)):[];
    current.set('vo_letters',new Map(letters.map(row=>[row.id,row])));
    current.set('vo_letter_items',new Map(items.filter(row=>letterIds.includes(String(row.letter_id))&&ledgerIds.includes(String(row.ledger_item_id))).map(row=>[row.id,row])));
    const protectedFinding=(row:Row)=>!row.scan_signature||findingNeedsHistory(row)||Boolean(record(row.evidence_data)&&(['manual_review','user_review','approved_by_user','issue_link','issue_reconciliation'].some(key=>Object.hasOwn(row.evidence_data as object,key))||record(row.evidence_data.archive_meta)&&row.evidence_data.archive_meta.resolution_document_id))
        ||[...current.get('pricing_ledger')!.values()].some(item=>item.contradiction_id===row.id)
        ||[...current.get('contradictions')!.values()].some(item=>item.related_contradiction_id===row.id);
    class Query implements PromiseLike<Reply> {
        private filters:Array<(row:Row)=>boolean>=[];private orders:Array<{key:string;ascending:boolean}>=[];private start=0;private end=Infinity;private mode:'many'|'single'|'maybe'='many';private head=false;
        private operation='select';private payload:unknown;private conflict='id';private response:Promise<Reply>|null=null;
        constructor(private table:string){}
        select(_columns?:string,options?:{head?:boolean}){this.head=options?.head===true;return this;}
        eq(key:string,value:unknown){this.filters.push(row=>compare(row,key,'eq',value));return this;}
        neq(key:string,value:unknown){this.filters.push(row=>compare(row,key,'neq',value));return this;}
        is(key:string,value:unknown){this.filters.push(row=>compare(row,key,'is',value));return this;}
        in(key:string,value:unknown[]){this.filters.push(row=>compare(row,key,'in',value));return this;}
        contains(key:string,value:unknown){this.filters.push(row=>compare(row,key,'contains',value));return this;}
        not(key:string,operator:string,value:unknown){this.filters.push(row=>field(row,key)!=null||operator==='is'? !compare(row,key,operator,value):false);return this;}
        or(expression:string){this.filters.push(row=>expression.split(',').some(term=>{const [key,operator,...rest]=term.split('.');return compare(row,key,operator,rest.join('.')==='null'?null:rest.join('.'));}));return this;}
        order(key:string,options?:{ascending?:boolean}){this.orders.push({key,ascending:options?.ascending!==false});return this;}
        range(start:number,end:number){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw invalid();this.start=start;this.end=end;return this;}
        limit(count:number){return this.range(this.start,this.start+count-1);}
        single(){this.mode='single';return this;}
        maybeSingle(){this.mode='maybe';return this;}
        insert(value:unknown){this.operation='insert';this.payload=value;return this;}
        update(value:unknown){this.operation='update';this.payload=value;return this;}
        upsert(value:unknown,options?:{onConflict?:string}){this.operation='upsert';this.payload=value;this.conflict=options?.onConflict??'id';return this;}
        delete(){this.operation='delete';return this;}
        private async execute():Promise<Reply>{
            if(execution.signal.aborted)throw new BusinessAiError('AI_CANCELLED',undefined,409);const rows=current.get(this.table)!;
            if(this.operation!=='select'&&!fields[this.table])throw invalid();
            const incoming=this.operation==='delete'||this.operation==='select'?[]:(Array.isArray(this.payload)?this.payload:[this.payload]).map(value=>{
                if(!record(value))throw invalid();
                // Match the existing Supabase JSON transport, including omitted optional nested
                // fields. A prepared effect must remain JSON at the durable-job boundary.
                const data=JSON.parse(JSON.stringify(value,(_key,part)=>{if(typeof part==='number'&&!Number.isFinite(part))throw invalid();return part;})) as Row;
                if(Object.keys(data).some(key=>!fields[this.table].columns.includes(key)&&!(this.operation!=='update'&&['id','project_id','created_at'].includes(key))))throw invalid();
                if('project_id'in data&&data.project_id!==execution.projectId)throw new BusinessAiError('AI_ACCESS_DENIED',undefined,403);return data;
            });
            let selected=[...rows.values()].filter(row=>this.filters.every(filter=>filter(row)));
            if(this.operation==='update')selected=selected.map(row=>{const next={...row,...structuredClone(incoming[0]),xmin:(BigInt(String(row.xmin||0))+BigInt(1)).toString()};rows.set(row.id,next);return next;});
            if(this.operation==='insert'||this.operation==='upsert')selected=incoming.map(data=>{
                const previous=this.operation==='upsert'?[...rows.values()].find(row=>this.conflict.split(',').every(key=>row[key]===data[key])):undefined;
                const id=previous?.id??(validUuid(data.id)?data.id:randomUUID());if(this.operation==='insert'&&rows.has(id))throw invalid();
                const next={...(this.table==='contradictions'?{status:'OPEN',pricing_status:'PENDING',created_at:new Date().toISOString()}:{}),...previous,...structuredClone(data),id,project_id:execution.projectId,xmin:(BigInt(String(previous?.xmin||0))+BigInt(1)).toString()};rows.set(id,next);return next;
            });
            if(this.operation==='delete'){
                if(!['contradictions','document_scan_state'].includes(this.table))throw invalid();
                selected=selected.filter(row=>this.table!=='contradictions'||!protectedFinding(row));for(const row of selected)rows.delete(row.id);
            }
            const count=selected.length;selected.sort((a,b)=>{for(const order of this.orders){const compared=String(field(a,order.key)??'').localeCompare(String(field(b,order.key)??''));if(compared)return compared*(order.ascending?1:-1);}return 0;});
            const page=structuredClone(selected.slice(this.start,this.end+1));if(this.mode==='single'&&page.length!==1||this.mode==='maybe'&&page.length>1)return {data:null,count,error:{message:'Expected one row',code:'PGRST116'}};
            return {data:this.head?null:this.mode==='many'?page:page[0]??null,count,error:null};
        }
        then<TResult1=Reply,TResult2=never>(fulfilled?:((value:Reply)=>TResult1|PromiseLike<TResult1>)|null,rejected?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null):PromiseLike<TResult1|TResult2>{return (this.response??=this.execute()).then(fulfilled,rejected);}
    }
    function readOnly(target:object,constrain?:(query:object)=>object):object {return new Proxy(target,{get(value,key){if(['insert','upsert','update','delete'].includes(String(key)))return()=>{throw invalid();};const part=Reflect.get(value,key);if(typeof part!=='function')return part;if(['then','catch','finally'].includes(String(key)))return part.bind(value);return(...args:unknown[])=>{const next=part.apply(value,args);return key==='select'&&constrain?readOnly(constrain(next)):readOnly(next,constrain);};}});}
    const client=new Proxy(database,{get(target,key){
        if(key==='from')return(table:string)=>{if(current.has(table))return new Query(table);if(table==='reference_document_chunks')return readOnly(database.from(table),query=>(query as {in(key:string,ids:string[]):object}).in('reference_document_id',referenceRows.map(row=>row.id)));if(table==='pricelist_items')return readOnly(database.from(table),query=>(query as {in(key:string,ids:string[]):object}).in('pricelist_id',priceRows.map(row=>row.id)));throw invalid();};
        if(key==='rpc')return()=>{throw invalid();};
        if(key==='storage')return new Proxy(database.storage,{get(storage,property){if(property==='from')return(bucket:string)=>new Proxy(storage.from(bucket),{get(api,method){if(!['download','createSignedUrl','createSignedUrls','getPublicUrl'].includes(String(method)))throw invalid();const fn=Reflect.get(api,method);return typeof fn==='function'?fn.bind(api):fn;}});return Reflect.get(storage,property);}});
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }}) as SupabaseClient;
    async function effects():Promise<VerifiedAiEffect[]>{await execution.checkActive();const prepared:VerifiedAiEffect[]=[];
        for(const [table,description]of Object.entries(fields)){
            const before=original.get(table)!,after=current.get(table)!;
            for(const [id,row]of after){const previous=before.get(id),data=Object.fromEntries(description.columns.filter(column=>Object.hasOwn(row,column)&&stable(row[column])!==stable(previous?.[column])).map(column=>[column,row[column]])) as JsonObject;if(!Object.keys(data).length)continue;
                const revision=previous?typeof previous.xmin==='string'?previous.xmin:await getAiJobStore().sourceRevision(execution.projectId,description.type,id):'new';prepared.push({type:description.type,targetId:id,expectedRevision:revision,data});
            }
            if(table==='contradictions')for(const [id,row]of before)if(!after.has(id)&&!protectedFinding(row)){const revision=typeof row.xmin==='string'?row.xmin:await getAiJobStore().sourceRevision(execution.projectId,description.type,id);prepared.push({type:'SCAN_FINDING',targetId:id,expectedRevision:revision,data:{delete_automatic:true}});}
        }
        await execution.checkActive();return prepared;
    }
    return {client,effects};
}
