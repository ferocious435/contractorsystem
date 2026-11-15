import 'server-only';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {readingUnitInputHash} from '@/server/ai/visual-reading-cache.server';
import {renderPdfView} from '@/utils/visual-pdf-renderer';
import {readPositionedPdfLines} from './pdf-positioned-text.server';
import {validReadingRect,type SourceManifest,type RenderedView} from '@/utils/visual-source-reading';
import type {FragmentRenderer} from '@/utils/visual-fragment-contracts';
import {readMsgContainer} from './msg-container.server';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const pdf=(bytes:Buffer)=>bytes.subarray(0,1024).toString('latin1').includes('%PDF-');
const nearInteger=(n:number)=>Math.abs(n-Math.round(n))<1e-7?Math.round(n):n;

/** Every output comes from the manifest's own bytes, never a URL or path from model output. */
export function createSourceFragmentRenderer(file:Buffer,_title:string,manifest:SourceManifest):FragmentRenderer {
    const sourceHash=manifest.sourceHash,inputs=new Map(manifest.units.map(unit=>{try{return [unit.id,readingUnitInputHash(unit)] as const;}catch{return [unit.id,null] as const;}}));
    let container:ReturnType<typeof readMsgContainer>|undefined;
    const render:FragmentRenderer=async(unit,rect):Promise<RenderedView|null>=>{
        try{
            if(hash(file)!==sourceHash||!validReadingRect(rect)||!inputs.get(unit.id)||inputs.get(unit.id)!==readingUnitInputHash(unit))return null;
            if(unit.kind==='PDF_PAGE'){
                const pages=[...new Set(unit.locations.map(l=>l.page))];if(pages.length!==1||!Number.isInteger(pages[0]))return null;
                let original=file;
                if(manifest.format==='MSG'){
                    const ids=[...new Set(unit.locations.map(l=>l.msgPartId))],id=ids[0];
                    if(ids.length!==1||!id||!file.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))return null;
                    container??=readMsgContainer(file);const extracted=await container,declared=manifest.msg?.parts.find(p=>p.id===id),part=extracted.parts.find(p=>p.id===id),payload=extracted.payloads.get(id);
                    if(!declared||!part||!payload||part.payloadHash!==hash(payload)||declared.payloadHash!==part.payloadHash||part.byteLength!==payload.length)return null;
                    original=payload;
                }else if(manifest.format!=='PDF')return null;
                if(!pdf(original))return null;
                return await renderPdfView(original,pages[0]!,rect,{detail:'fragment'});
            }
            const views=unit.views.filter(v=>v.rect.x<=rect.x+1e-9&&v.rect.y<=rect.y+1e-9
                &&v.rect.x+v.rect.width>=rect.x+rect.width-1e-9&&v.rect.y+v.rect.height>=rect.y+rect.height-1e-9)
                .sort((a,b)=>(b.width*b.height/(b.rect.width*b.rect.height))-(a.width*a.height/(a.rect.width*a.rect.height)));
            const view=views[0];if(!view||hash(view.bytes)!==view.sha256)return null;
            const meta=await sharp(Buffer.from(view.bytes),{limitInputPixels:16_000_000}).metadata();
            if(meta.width!==view.width||meta.height!==view.height)return null;
            const left=Math.max(0,Math.floor(nearInteger((rect.x-view.rect.x)/view.rect.width*view.width))),top=Math.max(0,Math.floor(nearInteger((rect.y-view.rect.y)/view.rect.height*view.height)));
            const right=Math.min(view.width,Math.ceil(nearInteger((rect.x+rect.width-view.rect.x)/view.rect.width*view.width))),bottom=Math.min(view.height,Math.ceil(nearInteger((rect.y+rect.height-view.rect.y)/view.rect.height*view.height)));
            const width=right-left,height=bottom-top;if(width<1||height<1)return null;
            const scale=Math.min(4,Math.sqrt(16_000_000/(width*height))),outputWidth=Math.max(1,Math.floor(width*scale)),outputHeight=Math.max(1,Math.floor(height*scale));
            const bytes=await sharp(Buffer.from(view.bytes),{limitInputPixels:16_000_000}).extract({left,top,width,height}).resize(outputWidth,outputHeight).png().toBuffer();
            const actual={x:view.rect.x+left/view.width*view.rect.width,y:view.rect.y+top/view.height*view.rect.height,width:width/view.width*view.rect.width,height:height/view.height*view.rect.height};
            return {id:`fragment:${unit.id}:${JSON.stringify(actual)}`,sha256:hash(bytes),bytes,width:outputWidth,height:outputHeight,rect:actual};
        }catch{return null;}
    };
    render.positionedLines=async unit=>{
        if(manifest.format!=='PDF'||unit.kind!=='PDF_PAGE'||hash(file)!==sourceHash||!inputs.get(unit.id)||inputs.get(unit.id)!==readingUnitInputHash(unit))return [];
        const pages=new Set(unit.locations.map(location=>location.page));
        const page=unit.locations[0]?.page;
        if(pages.size!==1||!page)return [];
        return readPositionedPdfLines(file,page).catch(()=>[]);
    };
    return render;
}
