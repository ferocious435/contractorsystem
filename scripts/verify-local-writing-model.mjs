import './redesign/load-ui.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
import {localWritingModelCases} from './fixtures/local-writing-model-cases.mjs';

// Use the existing application's configuration and adapter. Copy only its local
// model variables; never load database/service credentials into this profile.
const acceptedEnv='.superpowers/r02-r04-2026-10-29/control-source/.env.local';
const parsed=existsSync(acceptedEnv)?dotenv.parse(readFileSync(acceptedEnv)):{};
for(const key of ['AI_PROVIDER','OLLAMA_MODEL','OLLAMA_BASE_URL'])if(parsed[key]!==undefined)process.env[key]=parsed[key];
const {generateOllamaText,checkOllamaRuntime}=await import('../src/lib/ollama.ts');
const {isOllamaProvider}=await import('../src/utils/ai-readiness.ts');
const {generateLocalLetter}=await import('../src/utils/local-letter-server.ts');
const {answerLocalConsultant}=await import('../src/utils/local-consultant-server.ts');
assert.equal(isOllamaProvider(process.env),true,'The accepted configuration must already select local processing');
const runtime=await checkOllamaRuntime();assert.equal(runtime.reachable,true,'Existing Ollama service is unavailable');assert.equal(runtime.modelInstalled,true,'Existing configured model is missing');
const cases=await localWritingModelCases(),hash=value=>createHash('sha256').update(value).digest('hex');
const commonRules=['src/lib/ollama.ts','src/utils/ai-readiness.ts','src/utils/local-project-context-server.ts','src/utils/individual-pricing.ts'];
const configuration=Object.fromEntries(['AI_PROVIDER','OLLAMA_MODEL','OLLAMA_BASE_URL'].map(key=>[key,process.env[key]??null]));
const cacheRoot='.superpowers/r02-r04-2026-10-29/local-writing-model';mkdirSync(cacheRoot,{recursive:true});
const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7),kinds=selected?[selected]:['letter','consultant'];
assert.ok(kinds.every(kind=>['letter','consultant'].includes(kind)),'Unknown synthetic model case');
let failed=false;const summary=[];
for(const kind of kinds){
 const ruleFiles=[...commonRules,...(kind==='letter'?['src/utils/local-letter-server.ts','src/utils/letter-snapshot.ts']:['src/utils/local-consultant-server.ts'])];
 const rules=Object.fromEntries(ruleFiles.map(file=>[file,hash(readFileSync(file))]));
 const input=cases[kind],key=hash(JSON.stringify({kind,input,rules,configuration})),path=cacheRoot+'/'+key+'.json';
 const prior=(existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null)??readdirSync(cacheRoot).filter(name=>/^[a-f\d]{64}\.json$/u.test(name)).map(name=>JSON.parse(readFileSync(cacheRoot+'/'+name,'utf8'))).find(value=>value.status==='PASS'&&value.kind===kind&&JSON.stringify(value.input)===JSON.stringify(input)&&JSON.stringify(value.configuration)===JSON.stringify(configuration)&&Object.entries(rules).every(([file,digest])=>value.rules?.[file]===digest));let modelCalls=0,raw=null;
 try{
  const adapter=async(prompt,options)=>{modelCalls++;raw=await generateOllamaText(prompt,options);return raw;};
  const output=prior?.status==='PASS'?prior.output:await (kind==='letter'?generateLocalLetter(input,adapter):answerLocalConsultant(input,adapter));
  const prose=JSON.parse(raw??prior.raw);
  if(kind==='consultant'){
   assert.ok(prose.nextActions.some(value=>/^יש (?:לבדוק|לתעד|לבקש)\s/u.test(value)),'The synthetic question needs a clear practical action');
   assert.ok(prose.unknowns.every(value=>!value.includes('?')),'Reading gaps must be stated rather than echo the question');
  }
  const language=Object.entries(prose).filter(([name])=>!['sourceIds','known'].includes(name)).flatMap(([,value])=>Array.isArray(value)?value:[value]).join(' ');
  const hebrew=(language.match(/[א-ת]/gu)||[]).length,latin=(language.match(/[A-Za-z]/gu)||[]).length;
  assert.ok(hebrew>30&&hebrew/(hebrew+latin)>.9,'The editable prose must be predominantly readable Hebrew');
  if(kind==='letter'){
   assert.deepEqual(output.snapshot,input.preview.snapshot);assert.ok(output.letter.includes(cases.source.quote),'A relevant source must be preserved literally');
   for(const expected of ['נוסח מוצע לבדיקה','בקשה לפעולה','אין אישור לתשלום','0.09','0.03','0.12'])assert.ok(output.letter.includes(expected),expected);
   assert.ok(output.letter.length>300&&output.letter.length<12000);
  }else{
   assert.deepEqual(output.sourceIds,['S1']);for(const expected of [cases.source.quote,'מה ידוע','מסקנה מוצעת','מה לא אומת','פעולה הבאה','עמוד נוסף דורש בדיקה','100.00','0.12'])assert.ok(output.response.includes(expected),expected);
   assert.ok(output.response.length>300&&output.response.length<12000);
  }
  const evidence={status:'PASS',kind,key,configuration,rules,input,output,raw:raw??prior.raw,modelCalls,cached:prior?.status==='PASS',checkedAt:new Date().toISOString()};
  if(!evidence.cached||!existsSync(path))writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');summary.push({kind,status:'PASS',key,modelCalls,cached:evidence.cached,path});console.log(JSON.stringify(summary.at(-1)));
 }catch(error){failed=true;const result={status:'FAIL',kind,key,code:error.code??null,error:error.message,configuration,rules,input,raw,modelCalls,checkedAt:new Date().toISOString()};
  if(prior?.status==='PASS')writeFileSync(path,JSON.stringify({...prior,status:'FAIL',qualityError:result.error},null,2)+'\n');
  writeFileSync(cacheRoot+'/'+key+'-failure.json',JSON.stringify(result,null,2)+'\n');summary.push({kind,status:'FAIL',key,code:result.code,error:result.error,modelCalls});console.error(JSON.stringify(summary.at(-1)));
 }
}
writeFileSync(cacheRoot+(selected?'/latest-'+selected+'-summary.json':'/latest-summary.json'),JSON.stringify({passed:!failed,testedKinds:kinds,summary},null,2)+'\n');if(failed)process.exitCode=1;
