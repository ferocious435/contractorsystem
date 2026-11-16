import 'server-only';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import {renderPdfView} from '@/utils/visual-pdf-renderer';
import type {Rect} from '@/utils/visual-source-reading';
export type WordPixelWitness={page:number;rect:Rect;original:{sha256:string;width:number;height:number};removed:{sha256:string;width:number;height:number}};
/** A removed object must change only its own bounded pixels, without page reflow. */
export async function compareWordShapePixels(original:Buffer,without:Buffer,shape:{widthMm100?:number;heightMm100?:number;rotationDegrees?:number},repeated=false):Promise<WordPixelWitness[]>{
    if(!shape.widthMm100||!shape.heightMm100||shape.widthMm100<=0||shape.heightMm100<=0)return [];
    const a=await PDFDocument.load(original),b=await PDFDocument.load(without);
    if(a.getPageCount()!==b.getPageCount()||a.getPageCount()>128)return [];
    const changed:WordPixelWitness[]=[];
    for(let i=0;i<a.getPageCount();i++){
        const geometry=a.getPage(i).getSize(),other=b.getPage(i).getSize();
        if(geometry.width!==other.width||geometry.height!==other.height||JSON.stringify(a.getPage(i).getCropBox())!==JSON.stringify(b.getPage(i).getCropBox())||a.getPage(i).getRotation().angle!==b.getPage(i).getRotation().angle)return [];
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
        const angle=(shape.rotationDegrees??0)*Math.PI/180;
        if(!Number.isFinite(angle))return [];
        const width=Math.abs(shape.widthMm100*Math.cos(angle))+Math.abs(shape.heightMm100*Math.sin(angle));
        const height=Math.abs(shape.widthMm100*Math.sin(angle))+Math.abs(shape.heightMm100*Math.cos(angle));
        const maxWidth=(width+200)*72/2540/geometry.width*av.width;
        const maxHeight=(height+200)*72/2540/geometry.height*av.height;
        if(right-left+1>maxWidth||bottom-top+1>maxHeight)return [];
        changed.push({page:i+1,rect:{x:left/av.width,y:top/av.height,width:(right-left+1)/av.width,height:(bottom-top+1)/av.height},
            original:{sha256:av.sha256,width:av.width,height:av.height},removed:{sha256:bv.sha256,width:bv.width,height:bv.height}});
    }
    return changed.length&& (repeated||changed.length===1)?changed:[];
}


export async function verifyWordShapeDifference(original:Buffer,without:Buffer,shape:{widthMm100?:number;heightMm100?:number;rotationDegrees?:number},repeated=false){return (await compareWordShapePixels(original,without,shape,repeated)).map(p=>p.page);}
