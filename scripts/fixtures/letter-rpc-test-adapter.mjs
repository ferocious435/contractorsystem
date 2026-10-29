import {runLettersSql,jsonSql,containerName as defaultContainer} from '../letters-db.mjs';
export const syntheticIds={userA:'10000000-0000-4000-8000-000000000001',userB:'10000000-0000-4000-8000-000000000002',
 projectA:'20000000-0000-4000-8000-000000000001',projectB:'20000000-0000-4000-8000-000000000002',
 rowA:'30000000-0000-4000-8000-000000000001',rowB:'30000000-0000-4000-8000-000000000002',rowC:'30000000-0000-4000-8000-000000000003',
 official:'30000000-0000-4000-8000-000000000004',foreign:'30000000-0000-4000-8000-000000000005',
 work:'40000000-0000-4000-8000-000000000001',contract:'40000000-0000-4000-8000-000000000002',finding:'50000000-0000-4000-8000-000000000001',
 legacy:'60000000-0000-4000-8000-000000000001'};
const signatures={
 preview_letter_draft:{p_project_id:'uuid',p_doc_type:'text',p_item_ids:'uuid[]'},
 save_letter_draft:{p_project_id:'uuid',p_client_draft_id:'uuid',p_expected_revision:'integer',p_operation_id:'uuid',
 p_subject:'text',p_recipient_name:'text',p_doc_type:'text',p_content:'text',p_item_ids:'uuid[]',p_expected_sources:'jsonb'},
 mark_letter_sent:{p_project_id:'uuid',p_letter_id:'uuid',p_expected_revision:'integer',p_operation_id:'uuid'},
};
export function createSyntheticLetterClient({userId=syntheticIds.userA,containerName=defaultContainer}={}) {
 const options={name:containerName,role:userId?'authenticated':'anon',userId:userId||''};
 return {auth:{getUser:async()=>({data:{user:userId?{id:userId}:null},error:null})},
  rpc:async(name,input)=>{
   const signature=signatures[name];if(!signature)throw Error('RPC not allowlisted');
   const args=[],params={};let i=0;
   for(const [key,type] of Object.entries(signature)){const parameter='arg_'+String.fromCharCode(97+i++);const value=input[key];
    if(type==='uuid[]'){params[parameter]=JSON.stringify(value);args.push(`${key} => array(select jsonb_array_elements_text(:'${parameter}'::jsonb)::uuid)`);}
    else {params[parameter]=type==='jsonb'?JSON.stringify(value):value??'';args.push(`${key} => ${value===null?'null':`:'${parameter}'::${type}`}`);}
   }
   try{return {data:jsonSql(`select public.${name}(${args.join(',')});`,{...options,params}),error:null};}
   catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  },
  from(table){
   if(!['projects','pricing_ledger','vo_letters','vo_letter_items','documents','contradictions'].includes(table))throw Error('Table not allowlisted');
   const filters={},inFilters={};let remove=false,single=false,orderColumn='id',ascending=true,start=0,end=Infinity;
   const query={select(){return query;},eq(key,value){if(!/^[a-z_]+$/.test(key))throw Error('Column invalid');filters[key]=value;return query;},
    in(key,values){if(!/^[a-z_]+$/.test(key)||!Array.isArray(values))throw Error('Invalid in filter');inFilters[key]=values;return query;},
    is(key,value){if(value!==null)throw Error('Only null is supported in this fixture');return query.eq(key,value);},
    range(a,b){if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<a)throw Error('Invalid range');start=a;end=b;return query;},
    order(key,options={}){if(!/^[a-z_]+$/.test(key))throw Error('Invalid order');orderColumn=key;ascending=options.ascending!==false;return query;},
    delete(){remove=true;return query;},maybeSingle(){single=true;return query;},single(){single=true;return query;},
    then(resolve,reject){try{
     const sql=remove?`with removed as (delete from public.${table} t where to_jsonb(t) @> :'filters'::jsonb returning t.*) select coalesce(jsonb_agg(to_jsonb(removed)),'[]') from removed;`
      :`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)->:'order_column' ${ascending?'asc':'desc'}),'[]') from public.${table} t where to_jsonb(t) @> :'filters'::jsonb and not exists(select 1 from jsonb_each(:'in_filters'::jsonb) f where not f.value @> jsonb_build_array(to_jsonb(t)->f.key));`;
     const rows=jsonSql(sql,{...options,params:{filters:JSON.stringify(filters),in_filters:JSON.stringify(inFilters),order_column:orderColumn}});
     const page=rows.slice(start,end+1);return Promise.resolve({data:single?page[0]??null:page,error:null,count:rows.length}).then(resolve,reject);
    }catch(error){return Promise.resolve({data:null,error:{code:error.code,message:error.message}}).then(resolve,reject);}}
   };return query;
  }
 };
}

export function seedLettersTestData(){
 const id=syntheticIds,quoteWork='לבצע צינור בקוטר 200',quoteContract='לבצע צינור בקוטר 100';
 runLettersSql(`set local session_replication_role=replica;
 truncate public.vo_letter_items,public.vo_letters,public.pricing_ledger,public.contradictions,public.documents,public.projects cascade;
 insert into public.projects(id,name,contractor_id) values('${id.projectA}','Synthetic A','${id.userA}'),('${id.projectB}','Synthetic B','${id.userB}');
 insert into public.documents(id,project_id,title,extracted_text,ocr_status) values('${id.work}','${id.projectA}','Synthetic work.txt','${quoteWork}','COMPLETED'),('${id.contract}','${id.projectA}','Synthetic contract.txt','${quoteContract}','COMPLETED');
 insert into public.contradictions(id,project_id,status,source_execution_doc_id,target_contract_doc_id,evidence_data) values('${id.finding}','${id.projectA}','OPEN','${id.work}','${id.contract}',jsonb_build_object('work_quote','${quoteWork}','contract_quote','${quoteContract}','evidence_status','VERIFIED','source_verification',jsonb_build_object('contract_quote_matched',true,'work_quote_matched',true,'source_reading_complete',true,'comparison_context_complete',true,'quality_gate_passed',true),'semantic_assessment',jsonb_build_object('version','evidence-relation-v1','relation','INCOMPATIBLE','resultType','CONTRADICTION')));
 insert into public.pricing_ledger(id,project_id,type,source,description,quantity,unit_price_excl_vat,vat_rate,contradiction_id,evidence_data)
 select r.id,r.project,'PENDING_VO','CUSTOM_ANALYSIS','תמחור סינתטי',1,.03,.18,r.finding,jsonb_build_object('individual_pricing_terms',jsonb_build_object('version','individual-pricing-v1','basis','MANUAL','includes_adjustments',true,'quantity',1,'unit_price_excl_vat',.03,'vat_rate',.18,'note','כל התנאים כלולים')) from (values('${id.rowA}'::uuid,'${id.projectA}'::uuid,null::uuid),('${id.rowB}'::uuid,'${id.projectA}'::uuid,null::uuid),('${id.rowC}'::uuid,'${id.projectA}'::uuid,null::uuid),('${id.official}'::uuid,'${id.projectA}'::uuid,'${id.finding}'::uuid),('${id.foreign}'::uuid,'${id.projectB}'::uuid,null::uuid)) r(id,project,finding);
 insert into public.vo_letters(id,project_id,letter_number,subject,status,content,total_amount_excl_vat) values('${id.legacy}','${id.projectA}','LEGACY-01','Old synthetic','SENT','Historical text',9.75);`);
}
