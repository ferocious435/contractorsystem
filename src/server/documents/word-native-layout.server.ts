import 'server-only';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {prepareWordLayoutCopy} from '@/utils/docx-image-extraction';
import type {Rect} from '@/utils/visual-source-reading';
import type {WordShape} from './word-layout.server';
import {compareWordShapePixels,type WordPixelWitness} from './word-shape-pixels.server';

export type NativeWordRegion={file:Buffer;page:number;shape:WordShape;rect:Rect;proof:WordPixelWitness&{version:'native-word-source-removal-v1';visibleHash:string;shape:{widthPoints:number;heightPoints:number;rotationDegrees:number}}};
type Evidence={original:Buffer;removed:Buffer;shape:WordShape;region:NativeWordRegion};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export async function renderNativeWordRegions(file:Buffer,shapes:WordShape[],options:{onEvidence?:(evidence:Evidence)=>Promise<void>;onIsolation?:(value:{pid:number;startedTicks:string;priorPids:number[]})=>Promise<void>}={}):Promise<{regions:NativeWordRegion[];unplaced:WordShape[]}>{
    const regions:NativeWordRegion[]=[],unplaced=[...shapes];
    const eligible=shapes.filter(s=>s.nativeEligible&&s.part==='word/document.xml'&&s.name&&new Set(shapes.filter(other=>other.name===s.name).map(other=>`${other.part}:${other.paragraph}`)).size===1);
    if(process.platform!=='win32'||file.length>16*1024*1024||!eligible.length||eligible.length>8)return {regions,unplaced};
    const safe=await prepareWordLayoutCopy(file,{native:true});if(!safe)return {regions,unplaced};
    const windows=process.env.SystemRoot||'C:/Windows',powershell=path.join(windows,'SysWOW64/WindowsPowerShell/v1.0/powershell.exe');
    const worker=path.join(process.cwd(),'src/server/documents/word-native-worker.ps1'),parent=os.tmpdir(),folder=await mkdtemp(path.join(parent,'contractor-native-word-'));
    const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',worker];
    try{
        await writeFile(path.join(folder,'source.docx'),safe.bytes,{flag:'wx',mode:0o600});
        await writeFile(path.join(folder,'targets.json'),JSON.stringify(eligible),{flag:'wx',mode:0o600});
        await promisify(execFile)(powershell,args,{cwd:folder,windowsHide:true,timeout:120_000,maxBuffer:256*1024});
        const readBounded=async(name:string)=>{const target=path.join(folder,name);if((await stat(target)).size>64*1024*1024)throw Error('WORD_NATIVE_SIZE_LIMIT');return readFile(target);};
        if(options.onIsolation)await options.onIsolation(JSON.parse((await readFile(path.join(folder,'owned-word.json'),'utf8')).replace(/^\uFEFF/,'')));
        for(let i=0;i<eligible.length;i++)if(hash(await readFile(path.join(folder,`probe-${i}.docx`)))!==hash(safe.bytes))throw Error('WORD_NATIVE_PROBE_CHANGED');
        if(hash(await readFile(path.join(folder,'source.docx')))!==hash(safe.bytes))throw Error('WORD_NATIVE_SOURCE_CHANGED');
        const original=await readBounded('source.pdf'),pdf=await PDFDocument.load(original,{updateMetadata:false});
        if(pdf.getPageCount()>128)throw Error('WORD_NATIVE_PAGE_LIMIT');
        const inventory:unknown=JSON.parse((await readFile(path.join(folder,'shapes.json'),'utf8')).replace(/^\uFEFF/,''));
        if(!Array.isArray(inventory))throw Error('WORD_NATIVE_INVENTORY_UNVERIFIED');
        for(const shape of eligible){
            const matches=inventory.filter(item=>item&&item.name===shape.name);
            if(matches.length!==1)continue;
            const item=matches[0];
            if(item.readOnly!==true||!/^without-[0-7]\.pdf$/.test(item.file)||![item.widthPoints,item.heightPoints,item.rotationDegrees].every(v=>typeof v==='number'&&Number.isFinite(v))||item.widthPoints<=0||item.heightPoints<=0)continue;
            const removed=await readBounded(item.file),comparison=await compareWordShapePixels(original,removed,{widthMm100:item.widthPoints*2540/72,heightMm100:item.heightPoints*2540/72,rotationDegrees:item.rotationDegrees});
            if(comparison.length!==1)continue;
            const witness=comparison[0],page=pdf.getPage(witness.page-1);
            if(page.getRotation().angle!==0)continue;
            const box=page.getCropBox(),padding=6*72/25.4,dx=padding/box.width,dy=padding/box.height;
            const x=Math.max(0,witness.rect.x-dx),y=Math.max(0,witness.rect.y-dy),right=Math.min(1,witness.rect.x+witness.rect.width+dx),bottom=Math.min(1,witness.rect.y+witness.rect.height+dy);
            const region:NativeWordRegion={file:original,page:witness.page,shape,rect:{x,y,width:right-x,height:bottom-y},proof:{...witness,version:'native-word-source-removal-v1',visibleHash:safe.visibleHash,
                shape:{widthPoints:item.widthPoints,heightPoints:item.heightPoints,rotationDegrees:item.rotationDegrees}}};
            await options.onEvidence?.({original,removed,shape,region});regions.push(region);
            const at=unplaced.indexOf(shape);if(at>=0)unplaced.splice(at,1);
        }
        return {regions,unplaced};
    }finally{
        // Cleanup only the process whose new PID AND creation time were recorded
        // by the private worker, never another already-open Word window.
        await promisify(execFile)(powershell,[...args,'-Cleanup'],{cwd:folder,windowsHide:true,timeout:10_000,maxBuffer:32*1024}).catch(()=>{});
        if(path.dirname(folder)===path.resolve(parent)&&path.basename(folder).startsWith('contractor-native-word-'))await rm(folder,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
}
