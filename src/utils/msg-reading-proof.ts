import type {RegistryUnit} from './visual-source-reading';
import type {MsgInventoryPart} from './msg-source-types';
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{64}$/i.test(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(s=>typeof s==='string');
export function msgInventoryPart(part:Record<string,unknown>):MsgInventoryPart {
    return {id:part.id,parentId:part.parentId,kind:part.kind,name:part.name,mimeType:part.mimeType,containerPath:Array.isArray(part.containerPath)?[...part.containerPath]:part.containerPath,payloadHash:part.payloadHash,byteLength:part.byteLength,bodyTextHash:object(part.body)?part.body.textHash:part.bodyTextHash??null} as MsgInventoryPart;
}
export function assessMsgReadingProof(proof:unknown,source:{sourceHash:string;text:string;expectedUnits:RegistryUnit[]}):{complete:boolean;issues:string[]} {
    const issues:string[]=[],invalid=(reason:string)=>({complete:false,issues:[...issues,reason]});
    if(!object(proof)||proof.version!=='msg-source-v1'||proof.sourceHash!==source.sourceHash||!hash(proof.inventoryHash)||!hash(proof.rootPartId)
        ||!Array.isArray(proof.parts)||!Array.isArray(proof.inventory)||proof.parts.length<1||proof.parts.length>128||proof.parts.length!==proof.inventory.length||!strings(proof.issues))return invalid('MSG_INVENTORY_INVALID');
    const parts=new Map<string,Record<string,unknown>>(),inventory=new Map<string,Record<string,unknown>>();
    for(const raw of proof.inventory){if(!object(raw)||!hash(raw.id)||inventory.has(raw.id))return invalid('MSG_SOURCE_PART_INVALID');inventory.set(raw.id,raw);}
    const assignedUnits=new Set<string>();
    for(const raw of proof.parts){
        if(!object(raw)||!hash(raw.id)||parts.has(raw.id)||!['MESSAGE','FILE','INLINE'].includes(String(raw.kind))||typeof raw.name!=='string'
            ||!strings(raw.containerPath)||raw.containerPath.length<1||!strings(raw.issues)||!strings(raw.unitIds)||typeof raw.nativeComplete!=='boolean'||!Array.isArray(raw.textRanges)
            ||raw.payloadHash!==null&&!hash(raw.payloadHash)||raw.bodyTextHash!==null&&!hash(raw.bodyTextHash)
            ||raw.byteLength!==null&&(!Number.isSafeInteger(raw.byteLength)||(raw.byteLength as number)<0))return invalid('MSG_PART_INVALID');
        const original=inventory.get(raw.id);
        if(!original||JSON.stringify(msgInventoryPart(raw))!==JSON.stringify(msgInventoryPart(original)))return invalid('MSG_PART_SOURCE_CHANGED');
        parts.set(raw.id,raw);
        if(raw.status!=='READ'||!raw.nativeComplete||raw.issues.length)issues.push('MSG_PART_UNREAD:'+raw.id);
        for(const id of raw.unitIds){
            const unit=source.expectedUnits.find(u=>u.id===id);
            if(!unit||assignedUnits.has(id)||!Array.isArray(unit.locations)||unit.locations.some(l=>!object(l)||l.msgPartId!==raw.id))return invalid('MSG_PART_UNIT_MISMATCH');
            assignedUnits.add(id);if(unit.status!=='READ')issues.push('MSG_PART_UNIT_UNREAD:'+id);
        }
        let end=-1;
        for(const range of raw.textRanges){if(!object(range)||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||(range.start as number)<0||(range.end as number)<(range.start as number)||(range.end as number)>source.text.length||(range.start as number)<end)return invalid('MSG_PART_TEXT_RANGE_INVALID');end=range.end as number;}
        if(raw.kind==='MESSAGE'&&!hash(raw.bodyTextHash))issues.push('MSG_BODY_UNCONFIRMED:'+raw.id);
        if(raw.kind==='MESSAGE'&&raw.status==='READ'){
            const h=raw.headers;
            if(!object(h)||typeof h.subject!=='string'||!['from','to','cc','bcc'].every(key=>strings(h[key]))
                ||h.sentAt!==null&&typeof h.sentAt!=='string'||h.sentAtRaw!==null&&typeof h.sentAtRaw!=='string')return invalid('MSG_HEADERS_UNCONFIRMED');
            if(raw.bodyTextHash!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'&&!raw.textRanges.some(r=>object(r)&&(r.end as number)>(r.start as number)))return invalid('MSG_BODY_RANGE_MISSING');
        }
    }
    const root=parts.get(proof.rootPartId);if(!root||root.parentId!==null||root.kind!=='MESSAGE'||root.payloadHash!==source.sourceHash)return invalid('MSG_ROOT_INVALID');
    for(const part of parts.values()){
        const visited=new Set<string>();let current=part;
        while(current.parentId!==null){
            if(typeof current.parentId!=='string'||visited.has(current.parentId)||visited.size>=4)return invalid('MSG_PART_PARENT_INVALID');visited.add(current.parentId);
            const parent=parts.get(current.parentId);if(!parent||parent.kind!=='MESSAGE')return invalid('MSG_PART_PARENT_INVALID');current=parent;
        }
        if(current.id!==root.id)return invalid('MSG_PART_OUTSIDE_MESSAGE');
        if(part.kind==='MESSAGE'&&[...parts.values()].some(p=>p.parentId===part.id&&p.status!=='READ')&&part.status==='READ')return invalid('MSG_MESSAGE_STATUS_INVALID');
    }
    if(source.expectedUnits.some(u=>!assignedUnits.has(u.id)))return invalid('MSG_UNIT_OUTSIDE_INVENTORY');
    issues.push(...proof.issues);return {complete:issues.length===0,issues:[...new Set(issues)]};
}
