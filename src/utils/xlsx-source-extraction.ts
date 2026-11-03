import {createHash} from 'node:crypto';
import path from 'node:path';
import type {OfficeParserAST,OfficeContentNode,CellMetadata} from 'officeparser';
import type {ReadingLocation} from './visual-source-reading';

type PackageFile={path:string;content:Buffer};
type Relationship={type:string;target:string;external:boolean};
type SourceImage={bytes:Buffer;locations:ReadingLocation[];contextText:string};
const relNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const drawingNs='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const artNs='http://schemas.openxmlformats.org/drawingml/2006/main';
const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const children=(node:Node):Element[]=>Array.from(node.childNodes).filter((child):child is Element=>child.nodeType===1);
function descendants(node:Node,predicate:(element:Element)=>boolean):Element[]{
    const result:Element[]=[],pending=children(node).reverse();
    while(pending.length){const element=pending.pop()!;if(predicate(element))result.push(element);pending.push(...children(element).reverse());}
    return result;
}
const relatedPart=(part:string)=>path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels');
const cellPosition=(reference:string)=>{
    const match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(reference);if(!match)return null;
    let col=0;for(const letter of match[1])col=col*26+letter.charCodeAt(0)-64;
    const row=Number(match[2]);return col<=16384&&row<=1048576?{col:col-1,row:row-1}:null;
};
/** An ordinary merge is readable only when its bounds, anchor and covered cells agree with the package. */
function checkedMergedCells(doc:Document,sheet:OfficeContentNode):{valid:boolean;ranges:string[]} {
    const elements=descendants(doc,element=>element.localName==='mergeCell'),rawCells=descendants(doc,element=>element.localName==='c');
    if(elements.length>10000||elements.length*rawCells.length>10_000_000)return {valid:false,ranges:[]};
    const cells=(sheet.children||[]).flatMap(row=>row.children||[]).filter(cell=>cell.type==='cell');
    const metadata=new Map(cells.map(cell=>{const meta=cell.metadata as CellMetadata;return [meta?.row+':'+meta?.col,meta];}));
    const ranges:Array<{ref:string;from:{col:number;row:number};to:{col:number;row:number}}>=[];
    for(const element of elements){
        const ref=element.getAttribute('ref')||'',parts=ref.split(':'),from=cellPosition(parts[0]),to=cellPosition(parts[1]||'');
        if(parts.length!==2||!from||!to||from.col>to.col||from.row>to.row||from.col===to.col&&from.row===to.row)return {valid:false,ranges:[]};
        if(ranges.some(range=>from.col<=range.to.col&&to.col>=range.from.col&&from.row<=range.to.row&&to.row>=range.from.row))return {valid:false,ranges:[]};
        const anchor=metadata.get(from.row+':'+from.col);
        if(!anchor||(anchor.colSpan||1)!==to.col-from.col+1||(anchor.rowSpan||1)!==to.row-from.row+1)return {valid:false,ranges:[]};
        for(const cell of rawCells){
            const position=cellPosition(cell.getAttribute('r')||'');if(!position)return {valid:false,ranges:[]};
            if(position.col<from.col||position.col>to.col||position.row<from.row||position.row>to.row||position.col===from.col&&position.row===from.row)continue;
            if(descendants(cell,node=>['v','t','f'].includes(node.localName)).some(node=>(node.textContent||'').trim()))return {valid:false,ranges:[]};
        }
        ranges.push({ref,from,to});
    }
    if(cells.some(cell=>{const meta=cell.metadata as CellMetadata;return ((meta?.colSpan||1)>1||(meta?.rowSpan||1)>1)&&!ranges.some(range=>range.from.row===meta.row&&range.from.col===meta.col);}))return {valid:false,ranges:[]};
    return {valid:true,ranges:ranges.map(range=>range.ref)};
}
function harmlessPictureMetadata(list:Element):boolean {
    if(list.namespaceURI!==artNs||list.localName!=='extLst')return false;
    const attrs=(element:Element)=>Array.from(element.attributes).filter(attribute=>attribute.namespaceURI!=='http://www.w3.org/2000/xmlns/');
    return children(list).every(extension=>{
        const leaves=children(extension),leaf=leaves[0],owner=list.parentNode as Element|null;
        if(extension.namespaceURI!==artNs||extension.localName!=='ext'||attrs(extension).some(attribute=>attribute.name!=='uri')
            ||leaves.length!==1||children(leaf).length||(leaf.textContent||'').trim())return false;
        const uri=(extension.getAttribute('uri')||'').toUpperCase();
        // Creation IDs identify the element, not its pixels: MS-ODRAWXML CT_CreationId.
        if(uri==='{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}'&&owner?.namespaceURI===drawingNs&&owner.localName==='cNvPr'
            &&leaf.namespaceURI==='http://schemas.microsoft.com/office/drawing/2014/main'&&leaf.localName==='creationId'){
            return attrs(leaf).every(attribute=>attribute.name==='id'&&/^\{[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\}$/i.test(attribute.value));
        }
        // DPI controls Office's display/compression preference; the source pixels are retained verbatim.
        return uri==='{28A0092B-C50C-407E-A947-70E740481C1C}'&&owner?.namespaceURI===artNs&&owner.localName==='blip'
            &&leaf.namespaceURI==='http://schemas.microsoft.com/office/drawing/2010/main'&&leaf.localName==='useLocalDpi'
            &&attrs(leaf).length===1&&attrs(leaf)[0].name==='val'&&['0','1','true','false'].includes(leaf.getAttribute('val')||'');
    });
}
function packageTarget(part:string,relationship:Relationship|undefined):string|null {
    if(!relationship||relationship.external||!relationship.target||/[\\\u0000-\u001f?#%]/u.test(relationship.target)
        ||/^[a-z][a-z\d+.-]*:/i.test(relationship.target)||relationship.target.startsWith('//'))return null;
    const target=path.posix.normalize(relationship.target.startsWith('/')?relationship.target.slice(1):path.posix.join(path.posix.dirname(part),relationship.target));
    return target.startsWith('xl/')?target:null;
}
function cellMarker(anchor:Element,name:string):string|undefined {
    const marker=children(anchor).find(element=>element.localName===name);
    if(!marker)return undefined;
    const values=children(marker),cols=values.filter(element=>element.localName==='col'),rows=values.filter(element=>element.localName==='row');
    if(cols.length!==1||rows.length!==1||!/^\d+$/.test(cols[0].textContent?.trim()||'')||!/^\d+$/.test(rows[0].textContent?.trim()||''))return undefined;
    const col=Number(cols[0].textContent),row=Number(rows[0].textContent);
    if(!Number.isSafeInteger(col)||col<0||col>16383||!Number.isSafeInteger(row)||row<0||row>1048575)return undefined;
    let index=col+1,letters='';while(index){letters=String.fromCharCode(65+(index-1)%26)+letters;index=Math.floor((index-1)/26);}
    return letters+(row+1);
}

/** Read the cell grid and inventory drawings independently; never dereference an external link. */
export async function extractXlsxSource(file:Buffer):Promise<{nativeText:string;images:SourceImage[];issues:string[]}> {
    const nodeModule=await import(/* webpackIgnore: true */ 'node:module');
    const entry=path.join(process.cwd(),'node_modules/officeparser/dist/index.js'),load=nodeModule.createRequire(path.join(process.cwd(),'package.json'));
    const {extractFiles}=load(path.join(path.dirname(entry),'utils/zipUtils.js')) as {
        extractFiles:(bytes:Buffer,filter:(name:string)=>boolean,limits:Record<string,number>)=>Promise<PackageFile[]>;
    };
    const {parseXmlString}=load(path.join(path.dirname(entry),'utils/xmlUtils.js')) as {parseXmlString:(xml:string)=>Document};
    const files=await extractFiles(file,()=>true,{maxUncompressedBytes:128*1024*1024,maxZipEntries:10000});
    const byPath=new Map<string,Buffer>(),issues:string[]=[],images:SourceImage[]=[],usedParts=new Set<string>(),usedMedia=new Set<string>();
    const issue=(value:string)=>{if(!issues.includes(value))issues.push(value);};
    for(const entry of files){
        if(entry.path!==path.posix.normalize(entry.path)||entry.path.startsWith('/')||entry.path.startsWith('../')||entry.path.includes('\\')||byPath.has(entry.path))issue('XLSX_PACKAGE_PATH_UNVERIFIED');
        else byPath.set(entry.path,entry.content);
    }
    const xml=(part:string):Document|null=>{
        const bytes=byPath.get(part);if(!bytes){issue(part+':PART_MISSING');return null;}
        const text=bytes.toString('utf8');
        if(/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(text)){issue(part+':XML_DECLARATION_UNSUPPORTED');return null;}
        try{const doc=parseXmlString(text);if(!doc.documentElement||doc.getElementsByTagName('parsererror').length)throw Error('Invalid XML');return doc;}
        catch{issue(part+':XML_INVALID');return null;}
    };
    const relationships=(part:string):Map<string,Relationship>=>{
        const name=relatedPart(part);if(!byPath.has(name))return new Map();
        const doc=xml(name),result=new Map<string,Relationship>();if(!doc)return result;
        for(const element of descendants(doc,element=>element.localName==='Relationship')){
            const id=element.getAttribute('Id')||'';if(!id||result.has(id)){issue(name+':RELATIONSHIP_ID_UNVERIFIED');continue;}
            result.set(id,{target:element.getAttribute('Target')||'',type:element.getAttribute('Type')||'',external:(element.getAttribute('TargetMode')||'').toLowerCase()==='external'});
        }
        return result;
    };
    const workbook=xml('xl/workbook.xml');if(!workbook)throw Error('XLSX_WORKBOOK_UNREADABLE');
    const workbookRels=relationships('xl/workbook.xml');
    const sheets=descendants(workbook,element=>element.localName==='sheet').map(element=>({name:element.getAttribute('name')||'',
        relationship:workbookRels.get(element.getAttributeNS(relNs,'id')||'')}));
    if(!sheets.length)issue('XLSX_SHEETS_MISSING');

    const {OfficeParser}=await import('officeparser');
    const ast=await OfficeParser.parseOffice(file,{fileType:'xlsx',ocr:false,extractAttachments:false,newlineDelimiter:'\n'}) as OfficeParserAST;
    const nativeSheets=ast.content.filter(node=>node.type==='sheet');
    let gridSafe=nativeSheets.length===sheets.length,columns=0,rows=0;const mergeNotes:string[]=[];
    for(const [index,sheet] of nativeSheets.entries()){
        if(sheet.metadata?.sheetName!==sheets[index]?.name)issue('XLSX_SHEET_ORDER_UNVERIFIED');
        const part=packageTarget('xl/workbook.xml',sheets[index]?.relationship),doc=part?xml(part):null;
        const merges=doc?checkedMergedCells(doc,sheet):{valid:false,ranges:[]};
        if(!merges.valid)issue('XLSX_CELL_ANNOTATION_OR_MERGE_UNVERIFIED');
        else if(merges.ranges.length)mergeNotes.push(JSON.stringify(sheets[index]?.name)+': '+merges.ranges.join(', '));
        for(const row of sheet.children||[]){
            if(row.type!=='row'){gridSafe=false;continue;}rows++;let previous=-1;
            for(const cell of row.children||[]){
                const meta=cell.metadata as CellMetadata|undefined;
                if(cell.type!=='cell'||!meta||!Number.isSafeInteger(meta.col)||!Number.isSafeInteger(meta.row)
                    ||meta.col!<0||meta.col!>16383||meta.row!<0||meta.row!>1048575||meta.col!<=previous)gridSafe=false;
                previous=meta?.col??previous;columns=Math.max(columns,previous+1);
                if(cell.comments?.length)issue('XLSX_CELL_ANNOTATION_OR_MERGE_UNVERIFIED');
            }
        }
    }
    if(columns*rows>1_000_000+file.length*16)gridSafe=false;
    if(!gridSafe)issue('XLSX_CELL_GRID_UNVERIFIED');
    // CSV's span skip omits physical empty columns. The range is recorded separately;
    // emit each anchor at its original coordinate without changing any source bytes.
    const native=gridSafe?await ast.to('csv',{renderMetadata:false,csvConfig:{columnDelimiter:'\t',mergeSheets:true},onNode:node=>{
        if(node.type==='cell'&&node.metadata&&(node.metadata as CellMetadata).colSpan)(node.metadata as CellMetadata).colSpan=1;
    }})
        :await ast.to('text',{textConfig:{preserveLayout:true}});
    let nativeText=String(native.value||'');
    if(mergeNotes.length)nativeText='# Merged cells: '+mergeNotes.join('; ')+'\n'+nativeText;
    if(nativeSheets.length===1)nativeText='# Sheet: '+JSON.stringify(sheets[0]?.name||'Sheet1')+'\n'+nativeText;
    for(const warning of ast.warnings||[])issue('PARSER:'+warning.code);
    for(const message of native.messages||[])issue('XLSX_NATIVE_EXPORT:'+String(message));

    const byHash=new Map<string,SourceImage>();
    for(const sheet of sheets){
        const part=packageTarget('xl/workbook.xml',sheet.relationship);
        if(!part||!/^xl\/worksheets\/[^/]+\.xml$/.test(part)||!sheet.relationship?.type.endsWith('/worksheet')){issue('XLSX_WORKSHEET_LINK_UNVERIFIED');continue;}
        usedParts.add(part);const doc=xml(part);if(!doc)continue;
        const sheetRels=relationships(part);
        // Nearby cell context belongs to this sheet, never another sheet or a model's interpretation.
        const nativeSheet=nativeSheets.find(node=>node.metadata?.sheetName===sheet.name);
        const contextRows=(nativeSheet?.children||[]).filter(node=>node.type==='row');
        const context=(cellRange:string|undefined)=>{
            const row=Number(cellRange?.match(/\d+/)?.[0]||1)-1;
            const nearby=contextRows.filter(node=>Math.abs(((node.children?.[0]?.metadata as CellMetadata|undefined)?.row??0)-row)<=4);
            return '# Sheet: '+JSON.stringify(sheet.name)+'\n'+nearby.map(node=>(node.children||[]).map(cell=>cell.text||cell.children?.map(child=>child.text||'').join('')||'').join('\t')).join('\n');
        };
        for(const node of descendants(doc,element=>['drawing','legacyDrawing','legacyDrawingHF','picture','oleObject','control','extLst'].includes(element.localName))){
            if(node.localName!=='drawing'){issue(part+':UNSUPPORTED_'+node.localName.toUpperCase());continue;}
            const relation=sheetRels.get(node.getAttributeNS(relNs,'id')||''),drawing=packageTarget(part,relation);
            if(!drawing||!/^xl\/drawings\/[^/]+\.xml$/.test(drawing)||!relation?.type.endsWith('/drawing')){issue(part+':DRAWING_LINK_UNVERIFIED');continue;}
            usedParts.add(drawing);const drawingDoc=xml(drawing);if(!drawingDoc)continue;
            const drawingRels=relationships(drawing),root=drawingDoc.documentElement;
            if(root.namespaceURI!==drawingNs||root.localName!=='wsDr'){issue(drawing+':DRAWING_FORMAT_UNSUPPORTED');continue;}
            let occurrence=0;
            for(const anchor of children(root)){
                if(anchor.namespaceURI!==drawingNs||!['twoCellAnchor','oneCellAnchor','absoluteAnchor'].includes(anchor.localName)){issue(drawing+':UNSUPPORTED_DRAWING_OBJECT');continue;}
                const from=cellMarker(anchor,'from'),to=cellMarker(anchor,'to'),cellRange=from?(to?from+':'+to:from):undefined;
                if(anchor.localName!=='absoluteAnchor'&&(!from||anchor.localName==='twoCellAnchor'&&!to))issue(drawing+':IMAGE_CELL_UNVERIFIED');
                const objects=children(anchor).filter(element=>!['from','to','pos','ext','clientData'].includes(element.localName));
                for(const object of objects){
                    if(object.namespaceURI!==drawingNs||object.localName!=='pic'){issue(drawing+':UNSUPPORTED_DRAWING_OBJECT');continue;}
                    const reference=descendants(object,element=>element.namespaceURI===artNs&&element.localName==='blip');
                    if(reference.length!==1){issue(drawing+':PICTURE_REFERENCE_UNVERIFIED');continue;}
                    const link=reference[0].getAttributeNS(relNs,'embed')||reference[0].getAttributeNS(relNs,'link')||'',imageRel=drawingRels.get(link),resource=packageTarget(drawing,imageRel);
                    const location:ReadingLocation={part,anchor:part+'#'+path.posix.basename(drawing)+':'+(++occurrence),sheet:sheet.name,mediaName:resource||link||'missing-resource',...(cellRange?{cellRange}:{})};
                    if(!resource||!/^xl\/media\/[^/]+$/.test(resource)||!imageRel?.type.endsWith('/image')){issue(location.anchor+':IMAGE_LINK_UNVERIFIED');continue;}
                    usedMedia.add(resource);
                    const transform=descendants(object,element=>['srcRect','fillRect'].includes(element.localName)&&Array.from(element.attributes).some(attribute=>Number(attribute.value)!==0)
                        ||element.localName==='xfrm'&&['rot','flipH','flipV'].some(name=>element.hasAttribute(name)&&!['0','false'].includes(element.getAttribute(name)||''))
                        ||element.localName==='prstGeom'&&element.getAttribute('prst')!=='rect'||element.localName==='custGeom'
                        ||element.namespaceURI===artNs&&(element.localName==='tile'
                            ||['effectLst','effectDag'].includes(element.localName)&&children(element).length>0
                            ||element.localName==='blip'&&children(element).some(child=>child.localName!=='extLst'||!harmlessPictureMetadata(child)))
                        ||element.localName==='extLst'&&!harmlessPictureMetadata(element));
                    if(transform.length){issue(location.anchor+':IMAGE_TRANSFORM_UNVERIFIED');continue;}
                    const bytes=byPath.get(resource);if(!bytes?.length){issue(location.anchor+':IMAGE_MISSING_OR_EMPTY');continue;}
                    const hash=digest(bytes);let image=byHash.get(hash);
                    if(!image){image={bytes,locations:[],contextText:''};byHash.set(hash,image);images.push(image);}
                    image.locations.push(location);image.contextText+='\n'+context(cellRange);
                }
            }
        }
    }
    for(const name of byPath.keys()){
        if(/^xl\/media\//.test(name)&&!usedMedia.has(name))issue(name+':IMAGE_NOT_BOUND_TO_SHEET');
        if(/^xl\/(?:drawings\/|worksheets\/)[^/]+\.(?:xml|vml)$/.test(name)&&!usedParts.has(name))issue(name+':PART_NOT_BOUND_TO_WORKBOOK');
        if(/^xl\/(?:charts\/|embeddings\/|externalLinks\/|threadedComments\/|comments\d*\.xml$|richData\/)/.test(name))issue(name+':UNSUPPORTED_CONTENT');
    }
    return {nativeText,images,issues};
}
