import 'server-only';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {MSG_DEFAULT_LIMITS,type MsgLimits,type MsgReadOptions} from '@/utils/msg-source-types';

export function msgLimits(options:MsgReadOptions={}):MsgLimits {
    return Object.fromEntries(Object.entries(MSG_DEFAULT_LIMITS).map(([key,max])=>{
        const value=options.limits?.[key as keyof MsgLimits],min=key==='maxDepth'?0:1;
        return [key,typeof value==='number'&&Number.isSafeInteger(value)?Math.max(min,Math.min(max,value)):max];
    })) as MsgLimits;
}
export async function runMsgProcess(file:Buffer,command:{executable:string;args:(input:string,config:string)=>string[];config?:unknown},options:MsgReadOptions={}):Promise<string> {
    options.signal?.throwIfAborted();const limits=msgLimits(options);
    if(file.length>limits.maxSourceBytes)throw Error('MSG_SOURCE_LIMIT');
    const tempRoot=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(tempRoot,'contractorsystem-msg-'));
    try {
        const input=path.join(directory,'source.msg'),config=path.join(directory,'reader.json');
        await writeFile(input,file,{flag:'wx'});await writeFile(config,JSON.stringify(command.config??{}),{flag:'wx'});options.signal?.throwIfAborted();
        return await new Promise<string>((resolve,reject)=>{
            const child=spawn(command.executable,command.args(input,config),{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']});
            const chunks:Buffer[]=[];let length=0,stderr='',failure:Error|undefined;
            const stop=(error:Error)=>{failure??=error;child.kill();};
            const abort=()=>stop(Object.assign(new Error('MSG extraction aborted'),{name:'AbortError'}));
            const timer=setTimeout(()=>stop(Error('MSG_PROCESS_TIMEOUT')),limits.timeoutMs);
            options.signal?.addEventListener('abort',abort,{once:true});
            child.stdout.on('data',(value:Buffer)=>{length+=value.length;if(length>limits.maxOutputBytes)stop(Error('MSG_OUTPUT_LIMIT'));else chunks.push(value);});
            child.stderr.on('data',(value:Buffer)=>{stderr=(stderr+value.toString()).slice(-1000);});
            child.once('error',error=>{failure??=error;});
            child.once('close',code=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(failure)reject(failure);else if(code!==0)reject(Error('MSG_PROCESS_FAILED:'+code+':'+stderr.slice(-200)));else resolve(Buffer.concat(chunks).toString('utf8'));});
            if(options.signal?.aborted)abort();
        });
    } finally {
        const resolved=await realpath(directory),relative=path.relative(tempRoot,resolved);
        if(relative.startsWith('..')||path.isAbsolute(relative)||path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('contractorsystem-msg-'))throw Error('MSG_TEMP_PATH_CHANGED');
        await rm(resolved,{recursive:true,force:false});
    }
}
