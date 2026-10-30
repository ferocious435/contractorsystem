import 'server-only';
import {mkdir,open,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {BusinessAiError,checkedModelChoice,record,validUuid,type RuntimeProfile} from './contracts';
import {accountFingerprint} from './owner.server';
import {getCodexClient,getRuntimeDirectory} from './codex-client.server';
export {accountFingerprint} from './owner.server';

export interface RuntimeMetadata {account:unknown;models:unknown;}
interface ProfileOptions {runtimeDir:string;metadata:()=>Promise<RuntimeMetadata>;}
const errorCode=(error:unknown)=>record(error)&&typeof error.code==='string'?error.code:'';
export function createRuntimeProfileStore(options:ProfileOptions) {
    const root=path.resolve(options.runtimeDir,'profiles');
    const fileFor=(ownerId:string)=>{if(!validUuid(ownerId))throw new BusinessAiError('AI_PROFILE_INVALID',undefined,400);return path.join(root,ownerId.toLowerCase()+'.json');};
    async function stored(ownerId:string):Promise<RuntimeProfile|null> {
        const file=fileFor(ownerId);let text:string;
        try{text=await readFile(file,'utf8');}catch(error){if(errorCode(error)==='ENOENT')return null;throw new BusinessAiError('AI_PROFILE_INVALID');}
        let value:unknown;try{value=JSON.parse(text);}catch{throw new BusinessAiError('AI_PROFILE_INVALID');}
        if(!record(value)||Object.keys(value).some(key=>!['ownerId','accountFingerprint','model','effort','revision'].includes(key))
            ||value.ownerId!==ownerId||typeof value.accountFingerprint!=='string'||!/^[a-f\d]{64}$/i.test(value.accountFingerprint)
            ||typeof value.model!=='string'||!value.model.trim()||(value.effort!==null&&typeof value.effort!=='string')
            ||!Number.isSafeInteger(value.revision)||Number(value.revision)<1)throw new BusinessAiError('AI_PROFILE_INVALID');
        return value as unknown as RuntimeProfile;
    }
    async function read(ownerId:string):Promise<RuntimeProfile|null> {
        const value=await stored(ownerId);if(!value)return null;
        const metadata=await options.metadata();
        if(accountFingerprint(metadata.account)!==value.accountFingerprint)throw new BusinessAiError('AI_ACCOUNT_CHANGED');
        checkedModelChoice({model:value.model,effort:value.effort},metadata.models);return value;
    }
    async function save(ownerId:string,selection:unknown,expectedRevision:number):Promise<RuntimeProfile> {
        const file=fileFor(ownerId);
        if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new BusinessAiError('AI_PROFILE_INVALID',undefined,400);
        const metadata=await options.metadata(),choice=checkedModelChoice(selection,metadata.models),fingerprint=accountFingerprint(metadata.account);
        await mkdir(root,{recursive:true,mode:0o700});let lock;
        try{lock=await open(file+'.lock','wx',0o600);}catch(error){if(errorCode(error)==='EEXIST')throw new BusinessAiError('AI_PROFILE_CONFLICT',undefined,409);throw new BusinessAiError('AI_PROFILE_INVALID');}
        const temporary=file+'.'+randomUUID()+'.tmp';
        try{
            const previous=await stored(ownerId);
            if((previous?.revision??0)!==expectedRevision)throw new BusinessAiError('AI_PROFILE_CONFLICT',undefined,409);
            const value:RuntimeProfile={ownerId,accountFingerprint:fingerprint,...choice,revision:expectedRevision+1};
            await writeFile(temporary,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600});await rename(temporary,file);return value;
        }finally{
            await lock.close();await unlink(file+'.lock').catch(()=>{});await unlink(temporary).catch(()=>{});
        }
    }
    return {read,save};
}
let defaultStore:ReturnType<typeof createRuntimeProfileStore>|undefined;
function profiles(){return defaultStore??=createRuntimeProfileStore({runtimeDir:getRuntimeDirectory(),metadata:async()=>{
    const client=getCodexClient();const [account,models]=await Promise.all([client.request<Record<string,unknown>>('account/read',{refreshToken:false}),client.request<Record<string,unknown>>('model/list',{includeHidden:false,limit:100})]);
    return {account:account.account,models:models.data};
}});}
export const readRuntimeProfile=(ownerId:string)=>profiles().read(ownerId);
export const saveRuntimeProfile=(ownerId:string,selection:unknown,expectedRevision:number)=>profiles().save(ownerId,selection,expectedRevision);
