import 'server-only';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import type {MsgExtraction,MsgPart,MsgLimits} from '@/utils/msg-source-types';
import {readMsgHtml} from '@/utils/msg-html';
import {msgInventoryPart} from '@/utils/msg-reading-proof';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
export type ArchivePart={parentAddress:string;ordinal:number;name:string;size:number;sha256:string|null;bytes:Buffer|null;issues:string[]};
export type ArchiveLimits={maxEntries:number;maxPartBytes:number;maxTotalBytes:number;maxDepth:number};
const defaults:ArchiveLimits={maxEntries:128,maxPartBytes:32*1024*1024,maxTotalBytes:64*1024*1024,maxDepth:4};
const crc32=(bytes:Buffer)=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
/** Central-directory order, never a name-keyed map: repeated filenames remain separate sources. No disk extraction. */
export async function readArchiveParts(bytes:Buffer,options:Partial<ArchiveLimits>={}):Promise<ArchivePart[]> {
 const limits={...defaults,...options},parentAddress=hash(bytes),parts:ArchivePart[]=[];
 const fail=(reason:string)=>[{parentAddress,ordinal:0,name:'[archive]',size:0,sha256:null,bytes:null,issues:[reason]}];
 if(bytes.length>limits.maxPartBytes)return fail('ARCHIVE_SOURCE_LIMIT');
 try{
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0)throw Error('ARCHIVE_DIRECTORY_INVALID');
  const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),length=bytes.readUInt32LE(end+12);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||start+length!==end||count===65535)throw Error('ARCHIVE_DIRECTORY_UNSUPPORTED');
  let offset=start,total=0;
  for(let ordinal=0;ordinal<count;ordinal++){
   if(ordinal>=limits.maxEntries){parts.push({parentAddress,ordinal,name:'[remaining entries]',size:0,sha256:null,bytes:null,issues:['ARCHIVE_ENTRY_LIMIT']});break;}
   if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('ARCHIVE_DIRECTORY_INVALID');
   const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16),compressed=bytes.readUInt32LE(offset+20),size=bytes.readUInt32LE(offset+24),nl=bytes.readUInt16LE(offset+28),el=bytes.readUInt16LE(offset+30),cl=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
   if(offset+46+nl+el+cl>end)throw Error('ARCHIVE_DIRECTORY_INVALID');
   const nameBytes=bytes.subarray(offset+46,offset+46+nl),name=nameBytes.toString(flags&2048?'utf8':'latin1');offset+=46+nl+el+cl;
   const part:ArchivePart={parentAddress,ordinal,name,size,sha256:null,bytes:null,issues:[]};parts.push(part);
   try{
    if(name.endsWith('/')){part.bytes=Buffer.alloc(0);part.sha256=hash(part.bytes);continue;}
    if(/(?:^|[\\/])\.\.(?:[\\/]|$)|^[\\/]|^[a-z]:|\0/i.test(name))throw Error('ARCHIVE_UNSAFE_NAME');
    if(flags&1)throw Error('ARCHIVE_ENCRYPTED');if(![0,8].includes(method))throw Error('ARCHIVE_METHOD_UNSUPPORTED');
    total+=size;if(size>limits.maxPartBytes||total>limits.maxTotalBytes)throw Error('ARCHIVE_EXPANSION_LIMIT');
    if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50)throw Error('ARCHIVE_LOCAL_HEADER_INVALID');
    const lnl=bytes.readUInt16LE(local+26),lel=bytes.readUInt16LE(local+28),data=local+30+lnl+lel;
    if(!(flags&8)&&(bytes.readUInt32LE(local+14)!==crc||bytes.readUInt32LE(local+18)!==compressed||bytes.readUInt32LE(local+22)!==size))throw Error('ARCHIVE_LOCAL_HEADER_INVALID');
    if(data+compressed>start||!bytes.subarray(local+30,local+30+lnl).equals(nameBytes)||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)!==flags)throw Error('ARCHIVE_LOCAL_HEADER_INVALID');
    const packed=bytes.subarray(data,data+compressed),payload=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,size)});
    if(payload.length!==size||crc32(payload)!==crc)throw Error('ARCHIVE_CHECKSUM_INVALID');part.bytes=payload;part.sha256=hash(payload);
   }catch(error){part.issues.push(error instanceof Error&&error.message.startsWith('ARCHIVE_')?error.message:'ARCHIVE_ENTRY_CORRUPT');}
  }
  if(parts.length===count&&offset!==end)throw Error('ARCHIVE_DIRECTORY_INVALID');return parts;
 }catch(error){return [...parts,...fail(error instanceof Error?error.message:'ARCHIVE_UNREADABLE')];}
}
export async function expandMsgArchives(result:MsgExtraction,msgLimits?:MsgLimits,signal?:AbortSignal):Promise<MsgExtraction>{
 const effective={...defaults,...(msgLimits?{maxEntries:msgLimits.maxParts,maxPartBytes:msgLimits.maxPartBytes,maxTotalBytes:msgLimits.maxTotalPartBytes,maxDepth:msgLimits.maxDepth}:{})};
 let total=0;const original=[...result.parts];
 async function visit(parent:MsgPart,depth:number){
  signal?.throwIfAborted();
  const bytes=result.payloads.get(parent.id);if(!bytes||!(/\.zip$/i.test(parent.name)||parent.mimeType==='application/zip'))return;
  if(depth>=effective.maxDepth){parent.issues.push('ARCHIVE_DEPTH_LIMIT');return;}
  if(result.parts.length>=effective.maxEntries){parent.issues.push('ARCHIVE_ENTRY_LIMIT');return;}
  const entries=await readArchiveParts(bytes,{maxPartBytes:effective.maxPartBytes,maxEntries:Math.max(0,effective.maxEntries-result.parts.length),maxTotalBytes:Math.max(0,effective.maxTotalBytes-total)});
  parent.archive=true;
  for(const entry of entries){
   signal?.throwIfAborted();
   if(result.parts.length>=effective.maxEntries){parent.issues.push('ARCHIVE_ENTRY_LIMIT');break;}
   if(entry.name.endsWith('/')&&entry.issues.length===0)continue;
   const containerPath=[...parent.containerPath,'zip:'+entry.ordinal+':'+entry.name],id=hash(result.sourceHash+'\0'+containerPath.join('\0'));
   const child:MsgPart={id,parentId:parent.id,kind:'FILE',name:entry.name,mimeType:null,containerPath,payloadHash:entry.sha256,byteLength:entry.size,issues:[...entry.issues]};
   if(entry.bytes&&/\.ctb$/i.test(child.name)&&/^PIAFILEVERSION_[\d.]+,CTBVER\d+,compress\r?\n/.test(entry.bytes.subarray(0,100).toString('latin1')))child.auxiliaryRole='CAD_PLOT_STYLE';
   result.parts.push(child);if(entry.bytes){total+=entry.bytes.length;result.payloads.set(id,entry.bytes);}await visit(child,depth+1);
  }
 }
 for(const part of original)await visit(part,0);
 for(const part of result.parts)if(part.representation==='HTML'){const payload=result.payloads.get(part.id);if(payload)part.issues.push(...readMsgHtml(payload,part,result.parts.filter(p=>p.parentId===part.parentId)).issues);}
 result.inventoryHash=hash(JSON.stringify(result.parts.map(p=>msgInventoryPart(p))));result.issues=[...new Set([...result.issues,...result.parts.flatMap(p=>p.issues)])];return result;
}
