import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import {loadPdfParse} from './pdf-parser-runtime';
import {validReadingRect,type Rect,type RenderedView} from './visual-source-reading';

const MAX_PIXELS=16_000_000;
/** Rectangles use the displayed page's top-left origin, including crop and rotation. */
function userCrop(box:{x:number;y:number;width:number;height:number},angle:number,rect:Rect) {
    const rotation=((angle%360)+360)%360;
    if(![0,90,180,270].includes(rotation))throw Error('Unsupported PDF rotation');
    const points=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>{
        if(rotation===90)return {x:box.x+y*box.width,y:box.y+x*box.height};
        if(rotation===180)return {x:box.x+(1-x)*box.width,y:box.y+y*box.height};
        if(rotation===270)return {x:box.x+(1-y)*box.width,y:box.y+(1-x)*box.height};
        return {x:box.x+x*box.width,y:box.y+(1-y)*box.height};
    });
    const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}

export async function renderPdfView(file:Buffer,page:number,rect:Rect|undefined):Promise<RenderedView> {
    if(!Number.isInteger(page)||page<1||rect&&!validReadingRect(rect))throw Error('Invalid physical PDF view');
    let data=Buffer.from(file),renderPage=page;
    if(rect){
        const original=await PDFDocument.load(Uint8Array.from(file)),copy=await PDFDocument.create();
        if(page>original.getPageCount())throw Error('PDF page is absent');
        const [selected]=await copy.copyPages(original,[page-1]);copy.addPage(selected);
        const crop=userCrop(selected.getCropBox(),selected.getRotation().angle,rect);
        selected.setCropBox(crop.x,crop.y,crop.width,crop.height);
        data=Buffer.from(await copy.save());renderPage=1;
    }
    const PDFParse=await loadPdfParse(),parser=new PDFParse({data:Uint8Array.from(data)});
    try{
        const info=await parser.getInfo({parsePageInfo:true,partial:[renderPage]});
        const dimensions=info.pages.find(p=>p.pageNumber===renderPage);
        if(!dimensions||dimensions.width<=0||dimensions.height<=0)throw Error('PDF page geometry is absent');
        const scale=Math.min((rect?300:150)/72,Math.sqrt((MAX_PIXELS-16000)/(dimensions.width*dimensions.height)),32700/dimensions.width,32700/dimensions.height);
        const images=await parser.getScreenshot({partial:[renderPage],scale,imageBuffer:true,imageDataUrl:false});
        const image=images.pages.find(p=>p.pageNumber===renderPage);
        if(!image?.data.length||image.width*image.height>MAX_PIXELS)throw Error('PDF rendering exceeds the image limit');
        const bytes=Uint8Array.from(image.data);
        // The parser reports viewport floats; PNG metadata reports the actual integer canvas extent.
        const pixelDimensions=await sharp(bytes,{limitInputPixels:MAX_PIXELS}).metadata();
        if(!pixelDimensions.width||!pixelDimensions.height||pixelDimensions.width*pixelDimensions.height>MAX_PIXELS)throw Error('Invalid rendered PDF extent');
        return {id:`pdf:${page}:${rect?'crop:'+JSON.stringify(rect):'full'}`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes,
            width:pixelDimensions.width,height:pixelDimensions.height,rect:rect??{x:0,y:0,width:1,height:1}};
    }finally{await parser.destroy();}
}
