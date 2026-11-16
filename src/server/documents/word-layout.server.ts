import 'server-only';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import {renderPdfView} from '@/utils/visual-pdf-renderer';

export type WordShape={part:string;paragraph:number;name:string;issue:string};
export type WordPage={page:number;anchors:WordShape[]};
export async function renderWordShapes(file:Buffer,shapes:WordShape[]):Promise<{file:Buffer;pages:WordPage[];unplaced:WordShape[]}>{
    if(process.platform!=='win32'||file.length>64*1024*1024||!shapes.length||shapes.length>128)throw Error('WORD_LAYOUT_UNAVAILABLE');
    const python=path.join(process.env.ProgramFiles||'C:/Program Files','LibreOffice/program/python.exe');
    const parent=os.tmpdir(),folder=await mkdtemp(path.join(parent,'contractor-word-'));
    try{
        await writeFile(path.join(folder,'source.docx'),file,{flag:'wx'});
        await writeFile(path.join(folder,'targets.json'),JSON.stringify(shapes.map(s=>s.name)),{flag:'wx'});
        await promisify(execFile)(python,[path.join(process.cwd(),'src/server/documents/word-layout-worker.py')],{cwd:folder,windowsHide:true,timeout:190_000,maxBuffer:256*1024});
        const pdf=path.join(folder,'source.pdf');
        if((await stat(pdf)).size>64*1024*1024)throw Error('WORD_LAYOUT_SIZE_LIMIT');
        const bytes=await readFile(pdf),count=(await PDFDocument.load(bytes)).getPageCount();
        if(count>500)throw Error('WORD_LAYOUT_PAGE_LIMIT');
        const locations:unknown=JSON.parse(await readFile(path.join(folder,'shapes.json'),'utf8'));
        if(!Array.isArray(locations))throw Error('WORD_LAYOUT_INVENTORY_UNVERIFIED');
        let totalBytes=bytes.length;
        for(const item of locations){
            if(!item||typeof item!=='object'||!/^without-\d{4}\.pdf$/.test(item.differenceFile||''))continue;
            const matches=shapes.filter(s=>s.name===item.name);
            if(!matches.length)continue;
            const alternative=path.join(folder,item.differenceFile),size=(await stat(alternative)).size;
            totalBytes+=size;
            if(size>64*1024*1024||totalBytes>128*1024*1024)throw Error('WORD_LAYOUT_SIZE_LIMIT');
            try{
                const pages=await verifyWordShapeDifference(bytes,await readFile(alternative),item,
                    /^word\/(?:header|footer)\d*\.xml$/.test(matches[0].part));
                if(pages.length){item.placementVerified=true;item.verifiedPages=pages;}
            }catch{/* A failed comparison never certifies a shape. */}
        }
        return {file:bytes,...bindWordShapePages(shapes,locations,count)};
    }finally{
        if(path.dirname(folder)===path.resolve(parent)&&path.basename(folder).startsWith('contractor-word-'))await rm(folder,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
}

/** Only a unique imported shape at a verified body anchor can name a page. */
export function bindWordShapePages(shapes:WordShape[],locations:unknown[],count:number):{pages:WordPage[];unplaced:WordShape[]}{
        const pages=new Map<number,WordShape[]>(),unplaced:WordShape[]=[];
        for(const shape of shapes){
            const found=locations.filter(s=>(s as {name?:unknown})?.name===shape.name);
            const item=found[0] as {page?:number;verifiedPages?:number[];placementVerified?:boolean}|undefined;
            const selected=item?.verifiedPages??(item?.page===undefined?[]:[item.page]);
            if(!shape.name||new Set(shapes.filter(s=>s.name===shape.name).map(s=>`${s.part}:${s.paragraph}:${s.name}`)).size!==1
                ||found.length!==1||item?.placementVerified!==true||!selected.length||selected.some(page=>!Number.isSafeInteger(page)||page<1||page>count)
                ||(/^word\/(?:header|footer)\d*\.xml$/.test(shape.part)&&!item.verifiedPages)){
                unplaced.push(shape);continue;
            }
            for(const page of selected){const anchors=pages.get(page)??[];anchors.push(shape);pages.set(page,anchors);}
        }
        return {pages:[...pages].sort(([a],[b])=>a-b).map(([page,anchors])=>({page,anchors})),unplaced};
}

/** A removed object must change only its own bounded pixels, without page reflow. */
export async function verifyWordShapeDifference(original:Buffer,without:Buffer,shape:{widthMm100?:number;heightMm100?:number},repeated=false):Promise<number[]>{
    if(!shape.widthMm100||!shape.heightMm100||shape.widthMm100<=0||shape.heightMm100<=0)return [];
    const a=await PDFDocument.load(original),b=await PDFDocument.load(without);
    if(a.getPageCount()!==b.getPageCount()||a.getPageCount()>128)return [];
    const changed:number[]=[];
    for(let i=0;i<a.getPageCount();i++){
        const geometry=a.getPage(i).getSize(),other=b.getPage(i).getSize();
        if(geometry.width!==other.width||geometry.height!==other.height)return [];
        const av=await renderPdfView(original,i+1,undefined),bv=await renderPdfView(without,i+1,undefined);
        if(av.width!==bv.width||av.height!==bv.height)return [];
        const raw=async(bytes:Uint8Array)=>sharp(Buffer.from(bytes),{limitInputPixels:16_000_000}).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
        const first=await raw(av.bytes),second=await raw(bv.bytes);
        if(first.length!==second.length||first.length!==av.width*av.height*3)return [];
        let left=av.width,right=-1,top=av.height,bottom=-1;
        for(let p=0;p<first.length;p+=3){
            if(first[p]===second[p]&&first[p+1]===second[p+1]&&first[p+2]===second[p+2])continue;
            const pixel=p/3,x=pixel%av.width,y=Math.floor(pixel/av.width);
            left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        }
        if(right<left)continue;
        // 2 mm allows anti-aliasing/stroke/shadow edges, not unrelated layout changes.
        const maxWidth=(shape.widthMm100+200)*72/2540/geometry.width*av.width;
        const maxHeight=(shape.heightMm100+200)*72/2540/geometry.height*av.height;
        if(right-left+1>maxWidth||bottom-top+1>maxHeight)return [];
        changed.push(i+1);
    }
    return changed.length&& (repeated||changed.length===1)?changed:[];
}
