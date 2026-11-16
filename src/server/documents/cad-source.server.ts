import 'server-only';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {renderCadModelPreview} from './cad-model-preview.server';

const run=promisify(execFile), digest=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
export type ArchivePart={parentAddress:string;ordinal:number;name:string;size:number;sha256:string|null;bytes:Buffer|null;issues:string[]};
type CadLine={block:string;handle:string;layer:string;kind:string;start:number[];end:number[]};
type Inventory={status:string;layouts:string[];layoutBlocks:Array<{name:string;count:number;handle:string}>;types:Record<string,number>;xrefs:Array<{name:string;path:string;overlay:boolean}>;geometry:CadLine[];fileRequestsDenied:string[];entityCount:number;error?:string};
export type CadSheet={id:string;name:string;sourceHash:string;image:Buffer|null;issues:string[]};
export type CadResult={sourceHash:string;status:'REQUIRES_REVIEW';sheets:CadSheet[];issues:string[]};
const safe=(s:string)=>s.replace(/[\r\n\0]/g,' ').slice(0,512);
export async function buildCadResult(sourceHash:string,inventory:Inventory):Promise<CadResult>{
 const issues:string[]=['CAD_RENDER_PARTIAL','CAD_LAYER_VISIBILITY_UNCONFIRMED'];
 for(const r of inventory.xrefs||[])issues.push('CAD_XREF_UNRESOLVED:'+safe(r.name)+':'+safe(r.path||''));
 for(const [name,count] of Object.entries(inventory.types||{}))if(count&&name!=='Line')issues.push('CAD_UNSUPPORTED_ENTITY:'+safe(name));
 for(const request of inventory.fileRequestsDenied||[])issues.push('CAD_RESOURCE_DENIED:'+safe(request));
 const sheets:CadSheet[]=[];
 for(let i=0;i<(inventory.layouts||[]).length;i++){
  const name=inventory.layouts[i],sheetIssues=[...issues,'CAD_SHEET_VISIBILITY_UNCONFIRMED'];let image:Buffer|null=null;
  if(name==='Model'){
   const lines=(inventory.geometry||[]).filter(g=>g.block==='*Model_Space'&&g.kind==='Line'&&g.start?.length>=2&&g.end?.length>=2&&[...g.start.slice(0,2),...g.end.slice(0,2)].every(Number.isFinite));
   if(lines.length&&lines.length<=50000){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const l of lines)for(const p of [l.start,l.end]){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
    const w=Math.max(maxX-minX,1),h=Math.max(maxY-minY,1),scale=1800/Math.max(w,h),width=Math.max(20,Math.ceil(w*scale)+20),height=Math.max(20,Math.ceil(h*scale)+20);
    const paths=lines.map(l=>`<line x1="${10+(l.start[0]-minX)*scale}" y1="${10+(maxY-l.start[1])*scale}" x2="${10+(l.end[0]-minX)*scale}" y2="${10+(maxY-l.end[1])*scale}"/>`).join('');
    image=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g stroke="black" stroke-width="1">${paths}</g></svg>`)).png().toBuffer();
   }else sheetIssues.push(lines.length?'CAD_LINE_LIMIT_EXCEEDED':'CAD_NO_SUPPORTED_VISIBLE_GEOMETRY');
  }else sheetIssues.push('CAD_LAYOUT_VIEWPORT_UNSUPPORTED');
  sheets.push({id:'cad:'+sourceHash+':'+i+':'+digest(name).slice(0,16),name,sourceHash,image,issues:[...new Set(sheetIssues)]});
 }
 if(!sheets.length)issues.push('CAD_LAYOUT_INVENTORY_EMPTY');
 return {sourceHash,status:'REQUIRES_REVIEW',sheets,issues:[...new Set(issues)]};
}
export function attachCadModelPreview(result:CadResult,image:Buffer,issues:string[]):CadResult {
 return {...result,issues:[...new Set([...result.issues,...issues])],sheets:result.sheets.map(sheet=>sheet.name==='Model'?{...sheet,image,issues:[...new Set([...sheet.issues,...issues])]}:sheet)};
}
export async function renderCadSheets(bytes:Buffer,_siblings:readonly ArchivePart[]):Promise<CadResult>{
 const inputBytes=Buffer.from(bytes),sourceHash=digest(inputBytes),fail=(issue:string):CadResult=>({sourceHash,status:'REQUIRES_REVIEW',sheets:[],issues:[issue]});
 if(process.platform!=='win32')return fail('CAD_WINDOWS_REQUIRED');
 if(!inputBytes.length||inputBytes.length>64*1024*1024)return fail('CAD_SOURCE_SIZE_UNSUPPORTED');
 const exe='C:\\Program Files\\Autodesk\\AutoCAD 2022\\accoreconsole.exe',csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const acad=path.dirname(exe),source=path.join(process.cwd(),'src','server','documents','cad-inventory.cs');
 const root=await mkdtemp(path.join(tmpdir(),'contractor-cad-'));
 try{
  const trusted=path.join(root,'trusted'),input=path.join(root,'input'),profile=path.join(root,'profile');await mkdir(trusted);await mkdir(input);
  const code=await readFile(source);await writeFile(path.join(trusted,'worker.cs'),code);const dll=path.join(trusted,'worker.dll');
  await run(csc,['/nologo','/target:library','/out:'+dll,'/reference:System.Web.Extensions.dll',...['acdbmgd.dll','acmgd.dll','accoremgd.dll'].map(x=>'/reference:'+path.join(acad,x)),path.join(trusted,'worker.cs')],{timeout:30000,windowsHide:true,maxBuffer:1024*1024});
  const dwg=path.join(input,'source.dwg'),output=path.join(root,'result.json'),script=path.join(root,'worker.scr');await writeFile(dwg,inputBytes);
  await writeFile(script,`_.TRUSTEDPATHS\n${trusted}\n_.NETLOAD\n${dll}\n_.DEMANDLOAD\n0\n_.XLOADCTL\n0\nR05PROBE\n_.QUIT\n`,'ascii');
  await run(exe,['/s',script,'/l','en-US','/isolate','r05'+digest(root).slice(0,8),profile],{cwd:root,env:{...process.env,CAD_PROBE_INPUT:dwg,CAD_PROBE_OUTPUT:output},timeout:90000,windowsHide:true,maxBuffer:4*1024*1024});
  const data=await readFile(output);if(data.length>64*1024*1024)return fail('CAD_INVENTORY_OUTPUT_LIMIT');
  const inventory=JSON.parse(data.toString('utf8')) as Inventory;if(inventory.status!=='INVENTORIED')return fail('CAD_INVENTORY_FAILED');
  const result=await buildCadResult(sourceHash,inventory);
  try{
   const preview=await renderCadModelPreview({root,trusted,input:dwg,profile,exe,acad,csc,sourceHash});
   return preview?attachCadModelPreview(result,preview.image,preview.issues):{...result,issues:[...result.issues,'CAD_MODEL_PLOT_FAILED']};
  }catch{return {...result,issues:[...result.issues,'CAD_MODEL_PLOT_FAILED']};}
 }catch{return fail('CAD_INVENTORY_FAILED');}finally{await rm(root,{recursive:true,force:true}).catch(()=>{});}
}
