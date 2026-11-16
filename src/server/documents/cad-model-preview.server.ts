import 'server-only';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {renderPdfView} from '../../utils/visual-pdf-renderer';
const run=promisify(execFile);
/** This is a partial illustration, never evidence that an original layout was read. */
export async function renderCadModelPreview(args:{root:string;trusted:string;input:string;profile:string;exe:string;acad:string;csc:string;sourceHash:string}):Promise<{image:Buffer;issues:string[]}|null>{
 const {root,trusted,input,profile,exe,acad,csc,sourceHash}=args,source=path.join(process.cwd(),'src','server','documents','cad-model-plot.cs');
 const dll=path.join(trusted,'plot.dll'),cs=path.join(trusted,'plot.cs'),out=path.join(root,'model.pdf'),script=path.join(root,'plot.scr');
 await writeFile(cs,await readFile(source));
 await run(csc,['/nologo','/target:library','/out:'+dll,...['acdbmgd.dll','acmgd.dll','accoremgd.dll'].map(x=>'/reference:'+path.join(acad,x)),cs],{timeout:30000,windowsHide:true,maxBuffer:1024*1024});
 await writeFile(script,`_.TRUSTEDPATHS\n${trusted}\n_.NETLOAD\n${dll}\n_.DEMANDLOAD\n0\n_.BACKGROUNDPLOT\n0\nR05PLOT\n_.QUIT\n`,'ascii');
 const child=spawn(exe,['/s',script,'/l','en-US','/isolate','r06'+sourceHash.slice(0,8),profile],{cwd:root,env:{...process.env,CAD_PROBE_INPUT:input,CAD_PROBE_OUTPUT:out},windowsHide:true,stdio:'ignore'});
 let exited=false;const done=new Promise<void>(resolve=>{child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});});
 try{
  const deadline=Date.now()+60000;let result='';
  while(Date.now()<deadline&&!exited){
   result=await readFile(out+'.txt','utf8').catch(()=>'');if(result.includes(' success')||result.includes(' ERROR '))break;
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!result.includes(' success'))return null;
  const pdf=await readFile(out);if(pdf.length>64*1024*1024)return null;
  const view=await renderPdfView(pdf,1,undefined);
  const issues=['CAD_MODEL_CLONED_PREVIEW_ONLY','CAD_MODEL_WINDOW_AND_PAPER_UNCONFIRMED','CAD_TEXT_STYLE_UNCONFIRMED','CAD_BLOCK_ATTRIBUTES_FORMAT_UNCONFIRMED'];
  const missing=result.match(/omitted=([^ ]*) success/);if(missing?.[1])for(const item of missing[1].split(','))issues.push('CAD_PLOT_OMITTED:'+item);
  return {image:Buffer.from(view.bytes),issues};
 }finally{if(!exited)child.kill();await done;}
}
