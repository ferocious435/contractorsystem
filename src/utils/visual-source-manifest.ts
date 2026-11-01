import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {extractDocxWithImages,type DocxImageRecord} from './docx-image-extraction';
import {loadPdfParse} from './pdf-parser-runtime';
import {renderPdfView} from './visual-pdf-renderer';
import {planPageViews,type ReadingUnit,type SourceManifest} from './visual-source-reading';
import {prepareDocumentAnalysisInput} from './document-text-extraction';

const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
function finish(value:Omit<SourceManifest,'manifestHash'>):SourceManifest {
    const units=value.units.map(u=>({...u,views:u.views.map(v=>({id:v.id,sha256:v.sha256,width:v.width,height:v.height,rect:v.rect}))}));
    return {...value,manifestHash:hash(JSON.stringify({...value,units}))};
}
async function word(file:Buffer):Promise<SourceManifest> {
    const captured:Array<{record:DocxImageRecord;bytes:Buffer|null}>=[];
    const result=await extractDocxWithImages(file,{recognizeImage:async()=>({text:'',confidence:0}),onImage:value=>captured.push(value)});
    const units:ReadingUnit[]=[],issues=[...result.readingVerification.issues],byAnchor=new Map<string,ReadingUnit>();
    for(const {record,bytes} of captured){
        if(!bytes||!record.sha256||!['OCR_NO_READABLE_BODY',null].includes(record.reason)){
            issues.push(`${record.anchor}:${record.reason||'IMAGE_BYTES_MISSING'}`);continue;
        }
        let unit=units.find(u=>u.id==='docx:'+record.sha256);
        if(!unit){
            try{
                const meta=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();
                if(!meta.width||!meta.height||meta.width*meta.height>16_000_000||!['png','jpeg','webp','gif','tiff','bmp'].includes(meta.format||'')||(meta.pages??1)>1)throw Error('Image format or extent is unsupported');
                // PNG/JPEG originals are transmitted verbatim; supported alternate rasters are normalized locally.
                const image=['png','jpeg'].includes(meta.format!)?bytes:await sharp(bytes,{limitInputPixels:16_000_000}).png().toBuffer();
                unit={id:'docx:'+record.sha256,kind:'DOCX_IMAGE',locations:[],contextText:'',localText:'',
                    views:[{id:'image:'+record.sha256,sha256:hash(image),bytes:Uint8Array.from(image),width:meta.width,height:meta.height,rect:{x:0,y:0,width:1,height:1}}]};
                units.push(unit);
            }catch{issues.push(record.anchor+':IMAGE_RENDER_UNSUPPORTED');continue;}
        }
        unit.locations.push({part:record.part,anchor:record.anchor,mediaName:record.mediaName});byAnchor.set(record.anchor,unit);
    }
    const assembly:SourceManifest['assembly']=[],expression=/\[DOCX_IMAGE ([^\]\r\n ]+)[^\]\r\n]*\]\r?\n[\s\S]*?\[END_DOCX_IMAGE\]/g;
    let start=0;
    for(const match of result.text.matchAll(expression)){
        if(match.index!>start)assembly.push({kind:'native',text:result.text.slice(start,match.index)});
        const unit=byAnchor.get(match[1]);
        if(unit){
            assembly.push({kind:'unit',unitId:unit.id});
            unit.contextText+=`\n${match[1]}\n${result.text.slice(Math.max(0,match.index!-400),match.index)}\n${result.text.slice(match.index!+match[0].length,match.index!+match[0].length+400)}\n`;
        }else assembly.push({kind:'native',text:match[0]});
        start=match.index!+match[0].length;
    }
    if(start<result.text.length)assembly.push({kind:'native',text:result.text.slice(start)});
    for(const unit of units)if(!assembly.some(v=>v.kind==='unit'&&v.unitId===unit.id))issues.push(unit.id+':IMAGE_LOCATION_NOT_ASSEMBLED');
    return finish({sourceHash:hash(file),format:'DOCX',nativeText:result.text,nativeVerification:result.readingVerification,units,issues,assembly});
}
async function pdf(file:Buffer):Promise<SourceManifest> {
    const PDFParse=await loadPdfParse(),parser=new PDFParse({data:Uint8Array.from(file)});
    try{
        const info=await parser.getInfo({parsePageInfo:true});
        if(!Number.isInteger(info.total)||info.total<1||info.total>10000||info.pages.length!==info.total)throw Error('PDF_PAGE_INVENTORY_UNCONFIRMED');
        const text=await parser.getText().catch(()=>({text:'',pages:[] as Array<{num:number;text:string}>}));
        const units:ReadingUnit[]=[],issues:string[]=[],assembly:SourceManifest['assembly']=[];
        for(let page=1;page<=info.total;page++){
            const geometry=info.pages.find(p=>p.pageNumber===page),localText=text.pages.find(p=>p.num===page)?.text||'';
            const unit:ReadingUnit={id:'pdf:'+page,kind:'PDF_PAGE',locations:[{page}],views:[],contextText:'',localText,localMethod:'native'};
            units.push(unit);assembly.push({kind:'unit',unitId:unit.id});
            try{
                if(!geometry||geometry.width<=0||geometry.height<=0)throw Error('Unconfirmed page geometry');
                unit.views.push(await renderPdfView(file,page,undefined));
                const crops=planPageViews(Math.ceil(geometry.width*300/72),Math.ceil(geometry.height*300/72),16_000_000,32);
                for(const crop of crops)unit.views.push(await renderPdfView(file,page,crop));
            }catch{issues.push('PDF_PAGE_RENDER_FAILED:'+page);}
        }
        return finish({sourceHash:hash(file),format:'PDF',nativeText:text.text,nativeVerification:{version:'page-coverage-v1',complete:false,totalPages:info.total,readPages:[],unreadablePages:units.map((_,i)=>i+1)},units,issues,assembly});
    }finally{await parser.destroy();}
}
export async function buildVisualSourceManifest(file:Buffer,title:string):Promise<SourceManifest> {
    const before=hash(file);
    const result=file.subarray(0,1024).toString('latin1').includes('%PDF-')?await pdf(file)
        :/\.docx(?:$|[?#])/iu.test(title)?await word(file):await (async()=>{
            const native=await prepareDocumentAnalysisInput(file,title);
            if(native.kind!=='text')throw Error('SOURCE_VISUAL_FORMAT_UNSUPPORTED');
            return finish({sourceHash:before,format:'TEXT',nativeText:native.extractedText,nativeVerification:native.readingVerification,
                units:[],issues:native.requiresReview?['NATIVE_READING_INCOMPLETE']:[],assembly:[{kind:'native',text:native.extractedText}]});
        })();
    if(hash(file)!==before)throw Error('SOURCE_BYTES_CHANGED_DURING_READING');
    return result;
}
