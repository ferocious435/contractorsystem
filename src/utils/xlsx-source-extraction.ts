import {createHash} from 'node:crypto';
import path from 'node:path';
import type {OfficeParserAST,CellMetadata} from 'officeparser';
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
function packageTarget(part:string,relationship:Relationship|undefined):string|null {
    if(!relationship||relationship.external||!relationship.target||/[\\\u0000-\u001f?#%]/u.test(relationship.target)
        ||/^[a-z][a-z\d+.-]*:/i.test(relationship.target)||relationship.target.startsWith('//'))return null;
    const target=path.posix.normalize(relationship.target.startsWith('/')?relationship.target.slice(1):path.posix.join(path.posix.dirname(part),relationship.target));
    return target.startsWith('xl/')?target:null;
}
function cellMarker(anchor:Element,name:string):string|undefined {
    const marker=children(anchor).find(element=>element.localName===name);
    if(!marker)return undefined;
    const values=children(marker),col=Number(values.find(element=>element.localName==='col')?.textContent),row=Number(values.find(element=>element.localName==='row')?.textContent);
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
    let gridSafe=nativeSheets.length===sheets.length,columns=0,rows=0;
    for(const [index,sheet] of nativeSheets.entries()){
        if(sheet.metadata?.sheetName!==sheets[index]?.name)issue('XLSX_SHEET_ORDER_UNVERIFIED');
        for(const row of sheet.children||[]){
            if(row.type!=='row'){gridSafe=false;continue;}rows++;let previous=-1;
            for(const cell of row.children||[]){
                const meta=cell.metadata as CellMetadata|undefined;
                if(cell.type!=='cell'||!meta||!Number.isSafeInteger(meta.col)||!Number.isSafeInteger(meta.row)
                    ||meta.col!<0||meta.col!>16383||meta.row!<0||meta.row!>1048575||meta.col!<=previous)gridSafe=false;
                previous=meta?.col??previous;columns=Math.max(columns,previous+1);
                if((meta?.colSpan||1)>1||(meta?.rowSpan||1)>1||cell.comments?.length)issue('XLSX_CELL_ANNOTATION_OR_MERGE_UNVERIFIED');
            }
        }
    }
    if(columns*rows>1_000_000+file.length*16)gridSafe=false;
    if(!gridSafe)issue('XLSX_CELL_GRID_UNVERIFIED');
    const native=gridSafe?await ast.to('csv',{renderMetadata:false,csvConfig:{columnDelimiter:'\t',mergeSheets:true}})
        :await ast.to('text',{textConfig:{preserveLayout:true}});
    let nativeText=String(native.value||'');
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
                    const transform=descendants(object,element=>element.localName==='srcRect'&&Array.from(element.attributes).some(attribute=>Number(attribute.value)!==0)
                        ||element.localName==='xfrm'&&['rot','flipH','flipV'].some(name=>element.hasAttribute(name)&&!['0','false'].includes(element.getAttribute(name)||''))
                        ||element.localName==='prstGeom'&&element.getAttribute('prst')!=='rect'||element.localName==='custGeom'||element.localName==='extLst');
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
