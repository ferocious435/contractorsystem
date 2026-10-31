import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {parse} from 'dotenv';import {createClient} from '@supabase/supabase-js';
const args=process.argv.slice(2),arg=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const destination=path.resolve(arg('--destination')||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'ContractorSystem/backups',new Date().toISOString().replaceAll(':','-')));
if(fs.existsSync(path.join(destination,'manifest.json')))throw Error('The completed backup already exists; choose a new destination.');
const schemaPath=arg('--schema')||path.resolve('ops/backup-schema.json');if(!fs.existsSync(schemaPath))throw Error('The versioned database schema metadata is missing.');
const schema=JSON.parse(fs.readFileSync(schemaPath,'utf8'));
if(!Array.isArray(schema.tables)||!schema.tables.length)throw Error('The schema manifest is empty.');
const env={...process.env,...parse(fs.readFileSync(arg('--env')||'.env.local'))};
const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(90000)})}});
fs.mkdirSync(path.join(destination,'tables'),{recursive:true});fs.mkdirSync(path.join(destination,'objects'),{recursive:true});
fs.copyFileSync(schemaPath,path.join(destination,'schema.json'));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const reusePath=arg('--reuse'),reuse=reusePath?JSON.parse(fs.readFileSync(path.join(reusePath,'manifest.json'))):null;
const manifest={version:2,createdAt:new Date().toISOString(),destination,schemaSha256:digest(fs.readFileSync(schemaPath)),tables:[],buckets:[],objects:[],errors:[]};
async function readRows(table,pk){
 const rows=[];let expected=null;
 for(let start=0;;start+=1000){let query=client.from(table).select('*',{count:'exact'});for(const column of pk)query=query.order(column);const {data,error,count}=await query.range(start,start+999);
  if(error)throw Error('Backup read failed for '+table+': '+error.code);
  if(!Array.isArray(data)||!Number.isSafeInteger(count)||expected!==null&&expected!==count||data.length!==Math.min(1000,Math.max(0,count-start)))throw Error('Inconsistent backup page: '+table);
  expected=count;rows.push(...data);if(rows.length>=count)break;
 }return rows;
}
for(const table of schema.tables.filter(table=>table.schema==='public')){
 if(!/^[a-z_]+$/.test(table.name))throw Error('Unsafe table name');
 const pk=table.constraints?.find(c=>c.type==='p')?.definition.match(/\(([^)]+)\)/)?.[1].split(',').map(x=>x.trim().replaceAll('"',''))??['id'];
 const rows=await readRows(table.name,pk);
 const bytes=Buffer.from(JSON.stringify(rows)),file='tables/'+table.name+'.json';fs.writeFileSync(path.join(destination,file),bytes,{mode:0o600});manifest.tables.push({name:table.name,count:rows.length,file,sha256:digest(bytes),primaryKey:pk});
 console.log(JSON.stringify({table:table.name,rows:rows.length}));
}
const buckets=await client.storage.listBuckets();if(buckets.error)throw Error('Storage buckets could not be read');
const pending=[];
for(const bucket of buckets.data){manifest.buckets.push(bucket);const folders=[''];
 for(let cursor=0;cursor<folders.length;cursor++)for(let offset=0;;offset+=1000){const prefix=folders[cursor],{data,error}=await client.storage.from(bucket.id).list(prefix,{limit:1000,offset,sortBy:{column:'name',order:'asc'}});
  if(error)throw Error('Storage listing failed for '+bucket.id);
  for(const item of data??[]){const key=prefix?prefix+'/'+item.name:item.name;if(item.id)pending.push({bucket:bucket.id,key,metadata:item});else folders.push(key);}
  if(!data||data.length<1000)break;
 }
}
let next=0,completed=0;
await Promise.all(Array.from({length:3},async()=>{while(next<pending.length){const object=pending[next++];let bytes=null,reason='';
 const cached=reuse?.objects.find(old=>old.bucket===object.bucket&&old.key===object.key&&old.metadata.id===object.metadata.id&&old.metadata.updated_at===object.metadata.updated_at&&old.metadata.metadata?.size===object.metadata.metadata?.size);
 if(cached){const file=path.join(path.resolve(reusePath),cached.file),candidate=fs.readFileSync(file);if(digest(candidate)===cached.sha256)bytes=candidate;}
 for(let attempt=0;!bytes&&attempt<3;attempt++){try{const response=await client.storage.from(object.bucket).download(object.key);if(response.error)throw response.error;bytes=Buffer.from(await response.data.arrayBuffer());break;}catch(error){reason=String(error?.statusCode||error?.message||'unavailable');}}
 if(!bytes){manifest.errors.push({bucket:object.bucket,key:object.key,error:reason});continue;}
 const file='objects/'+digest(Buffer.from(object.bucket+'\0'+object.key));fs.writeFileSync(path.join(destination,file),bytes,{mode:0o600});manifest.objects.push({...object,file,size:bytes.length,sha256:digest(bytes)});completed++;if(completed%25===0)console.log(JSON.stringify({storageCompleted:completed,storageTotal:pending.length}));
}}));
for(const table of manifest.tables){const again=Buffer.from(JSON.stringify(await readRows(table.name,table.primaryKey)));if(digest(again)!==table.sha256)manifest.errors.push({table:table.name,error:'Rows changed during the backup; repeat when business actions are idle.'});}
manifest.objects.sort((a,b)=>a.bucket.localeCompare(b.bucket)||a.key.localeCompare(b.key));manifest.finishedAt=new Date().toISOString();
const file=manifest.errors.length?'incomplete-manifest.json':'manifest.json';fs.writeFileSync(path.join(destination,file),JSON.stringify(manifest,null,2),{mode:0o600});
console.log(JSON.stringify({complete:!manifest.errors.length,manifest:path.join(destination,file),tables:manifest.tables.length,objects:manifest.objects.length,failed:manifest.errors.length}));
if(manifest.errors.length)process.exitCode=1;
