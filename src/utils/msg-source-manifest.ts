import 'server-only';import {createHash} from 'node:crypto';
import type {MsgExtraction,MsgPartReading,MsgReadingProof} from './msg-source-types';
import type {SourceManifest} from './visual-source-reading';
import {msgInventoryPart} from './msg-reading-proof';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export type MsgManifestDeps={extract:(file:Buffer)=>Promise<MsgExtraction>;buildPart:(file:Buffer,title:string)=>Promise<SourceManifest>};
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
