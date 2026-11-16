import 'server-only';import {createHash} from 'node:crypto';
import type {CadResult} from '@/server/documents/cad-source.server';
import type {ArchivePart} from '@/server/documents/archive-parts.server';
import type {MsgExtraction,MsgPartReading,MsgReadingProof} from './msg-source-types';
import type {SourceManifest} from './visual-source-reading';
import {readMsgHtml} from './msg-html';
import {msgInventoryPart} from './msg-reading-proof';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export type MsgManifestDeps={renderCadSheets?:(file:Buffer,siblings:readonly ArchivePart[])=>Promise<CadResult>;extract:(file:Buffer)=>Promise<MsgExtraction>;buildPart:(file:Buffer,title:string)=>Promise<SourceManifest>};
function supported(bytes:Buffer,name:string,mime:string|null){
    if(bytes.subarray(0,1024).toString('latin1').includes('%PDF-'))return true;
    if(/\.(?:pdf|docx|xlsx|png|jpe?g|gif|tiff?|bmp|webp|txt|text|csv|tsv|md|markdown|json|xml|log|ini)$/i.test(name))return true;
    return Boolean(mime&&/^image\/(?:png|jpeg|gif|tiff|bmp|webp)$/.test(mime));
}
export const isMsgSource=(_file:Buffer,title:string)=>/\.msg(?:$|[?#])/i.test(title);
export async function buildMsgSourceManifest(file:Buffer,title:string,deps:MsgManifestDeps):Promise<SourceManifest> {
    const extracted=await deps.extract(file),sourceHash=hash(file);
    if(extracted.sourceHash!==sourceHash)throw Error('MSG_SOURCE_CHANGED');
    const inventory=extracted.parts.map(p=>msgInventoryPart(p)),parts:MsgPartReading[]=extracted.parts.map(p=>{
        const {body,...metadata}=p;return {...metadata,issues:[...p.issues],bodyTextHash:body?.textHash??null,nativeComplete:false,unitIds:[],textRanges:[],status:'REQUIRES_REVIEW'};
    });
    for(const html of parts.filter(p=>p.representation==='HTML')){
        const plain=parts.find(p=>p.representation==='PLAIN'&&p.parentId===html.parentId),htmlBytes=extracted.payloads.get(html.id),plainBytes=plain&&extracted.payloads.get(plain.id);
        if(plain&&htmlBytes&&plainBytes){try{const plainText=new TextDecoder(plain.encoding==='utf16le'?'utf-16le':'utf-8',{fatal:true}).decode(plainBytes).replace(/\0+$/u,''),htmlText=readMsgHtml(htmlBytes,html,parts.filter(p=>p.parentId===html.parentId)).text;
            html.bodyComparison={plainPartId:plain.id,htmlPartId:html.id,textEquivalent:plainText.replace(/\s+/gu,' ').trim()===htmlText.replace(/\s+/gu,' ').trim(),hasTableStructure:htmlText.includes('\t'),plainTextHash:hash(plainText),htmlTextHash:hash(htmlText)};
        }catch{/* The per-part read below retains the exact decoding failure. */}}
    }
    const units:SourceManifest['units']=[],assembly:SourceManifest['assembly']=[],issues=[...extracted.issues];
    if(hash(JSON.stringify(inventory))!==extracted.inventoryHash)issues.push('MSG_SOURCE_INVENTORY_UNCONFIRMED');
    for(let i=0;i<parts.length;i++){
        const part=parts[i],original=extracted.parts[i];
        if(part.kind==='MESSAGE'){
            const h=part.headers,header=h?['Subject: '+h.subject,'From: '+h.from.join(', '),'To: '+h.to.join(', '),...(h.cc.length?['Cc: '+h.cc.join(', ')]:[]),...(h.bcc.length?['Bcc: '+h.bcc.join(', ')]:[]),...(h.sentAtRaw?['Sent: '+h.sentAtRaw]:[])].join('\n'):'';
            assembly.push({kind:'native',text:'\n\n'+(header?header+'\n\n':'')+(original.body?.text??''),msgPartId:part.id});
            part.nativeComplete=original.body?.complete===true&&Boolean(h)&&part.issues.length===0;continue;
        }
        assembly.push({kind:'native',text:'\n\n'+part.name+'\n'});
        const bytes=extracted.payloads.get(part.id);
        if(!bytes||hash(bytes)!==part.payloadHash){part.issues.push('MSG_PART_BYTES_UNCONFIRMED');continue;}
        if(part.archive){part.nativeComplete=part.issues.length===0;continue;}
        if(part.auxiliaryRole==='CAD_PLOT_STYLE'){part.nativeComplete=part.issues.length===0;continue;}
        if(part.representation==='RTF'){
            assembly.push({kind:'native',text:original.body?.text??'',msgPartId:part.id});part.nativeComplete=original.body?.complete===true&&part.issues.length===0;continue;
        }
        if(part.representation==='PLAIN'){
            try{const text=new TextDecoder(part.encoding==='utf16le'?'utf-16le':'utf-8',{fatal:true}).decode(bytes).replace(/\0+$/u,'');assembly.push({kind:'native',text,msgPartId:part.id});part.nativeComplete=part.issues.length===0;}catch{part.issues.push('MSG_BODY_ENCODING');}continue;
        }
        if(part.representation==='HTML'){
            const read=readMsgHtml(bytes,part,parts.filter(p=>p.parentId===part.parentId));part.issues.push(...read.issues);part.nativeComplete=part.issues.length===0;
            assembly.push({kind:'native',text:read.text,msgPartId:part.id});continue;
        }
        if(/\.dwg$/i.test(part.name)){
            if(deps.renderCadSheets){try{const cad=await deps.renderCadSheets(bytes,parts.filter(p=>p.parentId===part.parentId).map(p=>({parentAddress:parts.find(parent=>parent.id===p.parentId)?.payloadHash??sourceHash,ordinal:Number(p.containerPath.at(-1)?.match(/^zip:(\d+):/)?.[1]??0),name:p.name,size:p.byteLength??0,bytes:extracted.payloads.get(p.id)??null,sha256:p.payloadHash,issues:[...p.issues]})));if(cad.sourceHash!==part.payloadHash)throw Error('CAD_SOURCE_CHANGED');part.issues.push(...cad.issues);part.issues.push('CAD_RENDER_PARTIAL');
                part.cadSheets=[];
                for(const [sheetIndex,sheet] of cad.sheets.entries()){
                    if(sheet.sourceHash!==part.payloadHash){part.issues.push('CAD_SHEET_SOURCE_CHANGED:'+sheet.id);continue;}
                    const imageHash=sheet.image?hash(sheet.image):null;
                    part.cadSheets.push({id:sheet.id,name:sheet.name,sourceHash:sheet.sourceHash,imageHash,issues:[...sheet.issues]});
                    part.issues.push(...sheet.issues.map(issue=>'CAD_SHEET_ISSUE:'+sheet.id+':'+issue));
                    if(!sheet.image){part.issues.push('CAD_SHEET_IMAGE_UNAVAILABLE:'+sheet.id);continue;}
                    try{
                        const leaf=await deps.buildPart(sheet.image,sheet.name+'.png');
                        if(leaf.sourceHash!==imageHash||leaf.format!=='IMAGE'||leaf.units.some(unit=>unit.kind!=='IMAGE_FRAME'))throw Error('CAD_SHEET_IMAGE_CHANGED');
                        part.issues.push(...leaf.issues.map(issue=>'CAD_SHEET_ISSUE:'+sheet.id+':'+issue));
                        const prefix='msg:'+part.id+':cad:'+sheetIndex+':'+hash(sheet.id)+':';
                        for(const unit of leaf.units){const id=prefix+unit.id;part.unitIds.push(id);units.push({...unit,id,locations:unit.locations.map(location=>({...location,msgPartId:part.id,msgPartName:part.name,sheet:sheet.name,cadSheetId:sheet.id,cadSourceHash:sheet.sourceHash,cadImageHash:imageHash!})),contextText:unit.contextText+'\nPartial CAD preview; unsupported source content remains unread.\nAttachment: '+part.name+'\nSheet: '+sheet.name});}
                        for(const block of leaf.assembly)assembly.push(block.kind==='native'?{...block,msgPartId:part.id}:{...block,unitId:prefix+block.unitId,msgPartId:part.id});
                    }catch{part.issues.push('CAD_SHEET_READING_FAILED:'+sheet.id);}
                }
                if(!cad.sheets.length)part.issues.push('CAD_SHEET_INVENTORY_EMPTY');}catch{part.issues.push('CAD_READING_FAILED');}}
            else part.issues.push('CAD_SAFE_ENGINE_UNAVAILABLE');continue;
        }
        if(!supported(bytes,part.name,part.mimeType)){part.issues.push('MSG_UNSUPPORTED_ATTACHMENT');continue;}
        try {
            const leaf=await deps.buildPart(bytes,part.name);
            if(leaf.sourceHash!==part.payloadHash||leaf.format==='MSG')throw Error('MSG_PART_SOURCE_CHANGED');
            part.nativeComplete=leaf.issues.length===0;part.issues.push(...leaf.issues);
            for(const unit of leaf.units){const id='msg:'+part.id+':'+unit.id;part.unitIds.push(id);units.push({...unit,id,locations:unit.locations.map(l=>({...l,msgPartId:part.id,msgPartName:part.name})),contextText:unit.contextText+'\nAttachment: '+part.name});}
            for(const block of leaf.assembly)assembly.push(block.kind==='native'?{...block,msgPartId:part.id}:{...block,unitId:'msg:'+part.id+':'+block.unitId,msgPartId:part.id});
        } catch {part.issues.push('MSG_ATTACHMENT_READING_FAILED');}
    }
    issues.push(...parts.flatMap(p=>p.issues),...parts.filter(p=>!p.nativeComplete).map(p=>'MSG_NATIVE_PART_UNREAD:'+p.id));
    const msg:MsgReadingProof={version:'msg-source-v1',sourceHash,rootPartId:extracted.rootPartId,inventoryHash:extracted.inventoryHash,inventory,parts,issues:[...new Set(issues)]};
    const value={sourceHash,format:'MSG' as const,nativeText:assembly.flatMap(b=>b.kind==='native'?[b.text]:[]).join(''),nativeVerification:msg,units,issues:msg.issues,assembly,msg};
    const hashable={...value,units:units.map(u=>({...u,views:u.views.map(v=>({id:v.id,sha256:v.sha256,width:v.width,height:v.height,rect:v.rect}))}))};
    return {...value,manifestHash:hash(JSON.stringify(hashable))};
}
