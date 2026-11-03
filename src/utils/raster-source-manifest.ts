import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {planPageViews,type SourceManifest,type ReadingUnit,type ReadingLocation,type RenderedView,type Rect} from './visual-source-reading';

const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const maxPixels=16_000_000,sourcePixels=256_000_000;
const whole:Rect={x:0,y:0,width:1,height:1};

function rasterSignature(bytes:Buffer):boolean {
    return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
        ||bytes[0]===255&&bytes[1]===216&&bytes[2]===255
        ||/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))
        ||bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP'
        ||bytes.subarray(0,2).toString('ascii')==='BM'
        ||['49492a00','4d4d002a'].includes(bytes.subarray(0,4).toString('hex'));
}

export function isRasterSource(file:Buffer,title:string):boolean {
    return rasterSignature(file)||/\.(?:png|jpe?g|gif|webp|tiff?|bmp)(?:$|[?#])/iu.test(title);
}

function pngFrames(bytes:Buffer):number|null {
    if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return null;
    for(let offset=8;offset+12<=bytes.length;){
        const size=bytes.readUInt32BE(offset);if(size>bytes.length-offset-12)return null;
        if(bytes.subarray(offset+4,offset+8).toString('ascii')==='acTL')return size===8?bytes.readUInt32BE(offset+8):null;
        offset+=size+12;
    }
    return null;
}

export function sealImageManifest(value:Omit<SourceManifest,'manifestHash'>):SourceManifest {
    const units=value.units.map(unit=>({...unit,views:unit.views.map(view=>({id:view.id,sha256:view.sha256,width:view.width,height:view.height,rect:view.rect}))}));
    return {...value,manifestHash:digest(JSON.stringify({...value,units}))};
}

export async function createRasterReadingUnits(bytes:Buffer,options:{kind:'IMAGE_FRAME'|'XLSX_IMAGE';locations:ReadingLocation[];contextText:string;idPrefix:string}):Promise<{units:ReadingUnit[];issues:string[]}> {
    const units:ReadingUnit[]=[],issues:string[]=[];
    try{
        if(!rasterSignature(bytes))throw Error('Unsupported raster signature');
        const meta=await sharp(bytes,{animated:true,limitInputPixels:sourcePixels,failOn:'warning'}).metadata();
        const frames=meta.pages??1,declared=pngFrames(bytes),height=meta.pageHeight??meta.height,width=meta.width;
        if(!width||!height||!Number.isSafeInteger(frames)||frames<1||frames>10000||width*height>sourcePixels
            ||declared!==null&&declared!==frames)throw Error('Image frame inventory is unsupported');
        for(let frame=0;frame<frames;frame++){
            try{
                const rotated=[5,6,7,8].includes(meta.orientation??1),w=rotated?height:width,h=rotated?width:height;
                const image=()=>sharp(bytes,{page:frame,pages:1,limitInputPixels:sourcePixels,failOn:'warning'}).rotate();
                // Decode, rather than accepting a valid header on a damaged image.
                await image().resize({width:1,height:1,fit:'inside'}).raw().toBuffer();
                const id=options.idPrefix+':frame:'+(frame+1),views:RenderedView[]=[];
                const add=async(buffer:Buffer,rect:Rect,suffix:string)=>{
                    const info=await sharp(buffer,{limitInputPixels:maxPixels}).metadata();
                    if(!info.width||!info.height||info.width*info.height>maxPixels)throw Error('Image view exceeds extent');
                    views.push({id:id+':'+suffix,sha256:digest(buffer),bytes:Uint8Array.from(buffer),width:info.width,height:info.height,rect});
                };
                if(w*h<=maxPixels){
                    const original=frames===1&&['png','jpeg'].includes(meta.format||'')&&(!meta.orientation||meta.orientation===1);
                    await add(original?bytes:await image().png().toBuffer(),whole,'whole');
                }else{
                    const scale=Math.sqrt(maxPixels/(w*h)),preview=await image().resize({width:Math.max(1,Math.floor(w*scale)),height:Math.max(1,Math.floor(h*scale)),fit:'inside',withoutEnlargement:true}).png().toBuffer();
                    await add(preview,whole,'whole');
                    const rectangles=planPageViews(w,h,maxPixels,32);
                    for(let index=0;index<rectangles.length;index++){
                        const rect=rectangles[index],left=Math.round(rect.x*w),top=Math.round(rect.y*h),right=Math.min(w,Math.round((rect.x+rect.width)*w)),bottom=Math.min(h,Math.round((rect.y+rect.height)*h));
                        await add(await image().extract({left,top,width:right-left,height:bottom-top}).png().toBuffer(),rect,'part:'+(index+1));
                    }
                }
                units.push({id,kind:options.kind,locations:options.locations.map(location=>({...location,frame:frame+1,
                    anchor:location.part==='image'?'image#frame'+(frame+1):location.anchor+'#frame'+(frame+1)})),
                    contextText:options.contextText,localText:'',views});
            }catch{issues.push('IMAGE_FRAME_RENDER_FAILED:'+(frame+1));}
        }
    }catch{issues.push('IMAGE_DECODE_FAILED');}
    return {units,issues};
}

export async function buildRasterSourceManifest(file:Buffer,_title:string):Promise<SourceManifest> {
    // The owning document supplies its current name; a rename does not alter image identity.
    void _title;
    const result=await createRasterReadingUnits(file,{kind:'IMAGE_FRAME',idPrefix:'image:'+digest(file),locations:[{part:'image',anchor:'image',mediaName:'source-image'}],contextText:''});
    return sealImageManifest({sourceHash:digest(file),format:'IMAGE',nativeText:'',nativeVerification:{version:'raster-source-v1',readFrames:result.units.length,complete:result.issues.length===0},
        units:result.units,issues:result.issues,assembly:result.units.map(unit=>({kind:'unit',unitId:unit.id}))});
}
