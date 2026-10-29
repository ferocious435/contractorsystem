import {jsonSql,containerName as defaultContainer} from '../letters-db.mjs';
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
   const filters={};let remove=false,single=false;
   const query={select(){return query;},eq(key,value){if(!/^[a-z_]+$/.test(key))throw Error('Column invalid');filters[key]=value;return query;},
    delete(){remove=true;return query;},maybeSingle(){single=true;return query;},single(){single=true;return query;},
    then(resolve,reject){try{
     const sql=remove?`with removed as (delete from public.${table} t where to_jsonb(t) @> :'filters'::jsonb returning t.*) select coalesce(jsonb_agg(to_jsonb(removed)),'[]') from removed;`
      :`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${table} t where to_jsonb(t) @> :'filters'::jsonb;`;
     const rows=jsonSql(sql,{...options,params:{filters:JSON.stringify(filters)}});
     return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve,reject);
    }catch(error){return Promise.resolve({data:null,error:{code:error.code,message:error.message}}).then(resolve,reject);}}
   };return query;
  }
 };
}
