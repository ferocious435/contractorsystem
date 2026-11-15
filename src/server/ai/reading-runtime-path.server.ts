import 'server-only';
import path from 'node:path';

/** Compare an owned runtime path with its exact Windows package alias.
 * Callers still check lstat/realpath and reject symbolic links. No file is moved. */
export function sameReadingRuntimePath(root:string,expected:string,actual:string,{platform=process.platform,localAppData=process.env.LOCALAPPDATA}:{platform?:string;localAppData?:string}={}):boolean {
    const api=platform==='win32'?path.win32:path.posix,fold=(value:string)=>platform==='win32'?value.toLowerCase():value;
    if(!api.isAbsolute(root)||!api.isAbsolute(expected)||!api.isAbsolute(actual))return false;
    const base=api.resolve(root),wanted=api.resolve(expected),found=api.resolve(actual),relative=api.relative(base,wanted);
    if(relative==='..'||relative.startsWith('..'+api.sep)||api.isAbsolute(relative))return false;
    if(fold(wanted)===fold(found))return true;
    if(platform!=='win32'||!localAppData||!api.isAbsolute(localAppData))return false;
    const local=api.resolve(localAppData);
    if(fold(api.relative(local,base))!==fold(api.join('ContractorSystem','ai-runtime')))return false;
    const packaged=api.join(local,'Packages','OpenAI.Codex_2p2nqsd0c76g0','LocalCache','Local','ContractorSystem','ai-runtime',relative);
    return fold(packaged)===fold(found);
}
