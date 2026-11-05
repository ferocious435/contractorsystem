import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Ole=require('word-extractor/lib/ole-compound-doc'),Reader=require('word-extractor/lib/buffer-reader');
const hash=value=>createHash('sha256').update(value).digest('hex'),input=path.resolve(process.argv[2]||'');
if(input!==path.join(process.cwd(),'source.msg'))throw Error('Invalid MSG worker input');
const file=fs.readFileSync(input),limits=JSON.parse(process.argv[3]),sourceHash=hash(file),parts=[],payloads={},issues=[];
let totalBytes=0;
const partId=p=>hash(sourceHash+'\0'+p.join('\0'));
function unpackRtf(bytes){
    // Dictionary and framing: Microsoft MS-OXRTFCP 2.1.2.1 / 2.1.3.
    // https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfcp/4238b0e2-7147-42da-88c9-ea45a1243e67
    if(bytes.length<16||bytes.readUInt32LE(0)+4!==bytes.length)throw Error('MSG_RTF_INVALID');
    const size=bytes.readUInt32LE(4),magic=bytes.toString('ascii',8,12),data=bytes.subarray(16);
    if(size>limits.maxPartBytes)throw Error('MSG_RTF_LIMIT');
    if(magic==='MELA'){if(data.length!==size)throw Error('MSG_RTF_SIZE');return data;}
    if(magic!=='LZFu')throw Error('MSG_RTF_ENCODING');
    let crc=0;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if((crc>>>0)!==bytes.readUInt32LE(12))throw Error('MSG_RTF_CHECKSUM');
    const seed=Buffer.from('{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx','ascii');
    const dictionary=Buffer.alloc(4096),out=Buffer.alloc(size);seed.copy(dictionary);let position=207,index=0,written=0,ended=false;
    const emit=byte=>{if(written>=size)throw Error('MSG_RTF_SIZE');out[written++]=byte;dictionary[position]=byte;position=(position+1)&4095;};
    while(index<data.length&&!ended){const flags=data[index++];for(let bit=0;bit<8&&index<data.length;bit++){
        if(flags&(1<<bit)){if(index+1>=data.length)throw Error('MSG_RTF_TRUNCATED');const a=data[index++],b=data[index++],offset=(a<<4)|(b>>4),count=(b&15)+2;
            if(offset===position){ended=true;break;}for(let n=0;n<count;n++)emit(dictionary[(offset+n)&4095]);
        }else emit(data[index++]);
    }}
    if(!ended||written!==size||index!==data.length)throw Error('MSG_RTF_TRUNCATED');return out;
}
async function stream(storage,entry,name){
    const metadata=entry.streams[name];if(!metadata)return null;
    if(!Number.isSafeInteger(metadata.size)||metadata.size<0||metadata.size>limits.maxPartBytes)throw Error('MSG_PART_LIMIT');
    const chunks=[];let size=0;for await(const value of storage.stream(name)){size+=value.length;if(size>metadata.size||size>limits.maxPartBytes)throw Error('MSG_STREAM_LIMIT');chunks.push(value);}
    if(size!==metadata.size)throw Error('MSG_STREAM_TRUNCATED');return Buffer.concat(chunks);
}
async function text(storage,entry,property){const bytes=await stream(storage,entry,'__substg1.0_'+property+'001F');if(!bytes)return null;if(bytes.length%2)throw Error('MSG_UNICODE_INVALID');return new TextDecoder('utf-16le',{fatal:true}).decode(bytes).replace(/\0+$/u,'');}
function add(part){if(parts.length>=limits.maxParts)throw Error('MSG_PART_COUNT_LIMIT');parts.push(part);return part;}
function rtfTextInSync(properties,headerSize){
    // PidTagRtfInSync: TRUE confirms identical text, apart from whitespace/formatting.
    // https://learn.microsoft.com/office/client-developer/outlook/mapi/pidtagrtfinsync-canonical-property
    if(!properties||properties.length<headerSize||(properties.length-headerSize)%16)return false;
    const values=[];for(let offset=headerSize;offset+16<=properties.length;offset+=16)if(properties.readUInt32LE(offset)===0x0e1f000b)values.push(properties.readUInt16LE(offset+8));
    return values.length===1&&values[0]===1;
}
async function walk(storage,entry,part,depth,propertiesHeaderSize=32){
    if(depth>limits.maxDepth){part.issues.push('MSG_DEPTH_LIMIT');return;}
    if(!entry.streams['__properties_version1.0']){part.issues.push('MSG_STRUCTURE_UNCONFIRMED');return;}
    const properties=await stream(storage,entry,'__properties_version1.0');
    let body=null;try{body=await text(storage,entry,'1000');}catch{part.issues.push('MSG_BODY_ENCODING');}
    part.body={text:body??'',textHash:hash(body??''),complete:body!==null,issues:body===null?['MSG_BODY_UNCONFIRMED']:[]};
    if(body===null)part.issues.push('MSG_BODY_UNCONFIRMED');
    let expandedRtf='';const rtf=await stream(storage,entry,'__substg1.0_10090102');if(rtf){if(!rtfTextInSync(properties,propertiesHeaderSize))part.issues.push('MSG_RTF_TEXT_SYNC_UNCONFIRMED');try{expandedRtf=unpackRtf(rtf).toString('latin1');if(/\\(?:pict|object|objdata|shp)\b/.test(expandedRtf))part.issues.push('MSG_RTF_EMBEDDED_CONTENT_UNVERIFIED');}catch(error){part.issues.push(error.message);}}
    const html=await stream(storage,entry,'__substg1.0_10130102')??await stream(storage,entry,'__substg1.0_1013001F');
    const attachmentNames=Object.keys(entry.storages).filter(name=>name.startsWith('__attach_version1.0_#')).sort(),childParts=[];
    if(!properties||properties.length<24||properties.readUInt32LE(20)!==attachmentNames.length)part.issues.push('MSG_ATTACHMENT_INVENTORY_UNCONFIRMED');
    for(const name of attachmentNames){
        if(parts.length>=limits.maxParts){part.issues.push('MSG_PART_COUNT_LIMIT');break;}
        const childEntry=entry.storages[name],childStorage=storage.storage(name),location=[...part.containerPath,name];
        const child=add({id:partId(location),parentId:part.id,kind:'FILE',name:await text(childStorage,childEntry,'3707')??await text(childStorage,childEntry,'3704')??'attachment',mimeType:await text(childStorage,childEntry,'370E'),containerPath:location,payloadHash:null,byteLength:null,issues:[]});childParts.push(child);
        const cid=await text(childStorage,childEntry,'3712');if(cid){child.contentId=cid.replace(/^<|>$/g,'');child.kind='INLINE';}
        const data=await stream(childStorage,childEntry,'__substg1.0_37010102');
        if(data){totalBytes+=data.length;if(totalBytes>limits.maxTotalPartBytes){child.issues.push('MSG_TOTAL_PART_BYTES_LIMIT');continue;}child.payloadHash=hash(data);child.byteLength=data.length;payloads[child.id]=data.toString('base64');
            if(data.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1'&&(/\.msg$/i.test(child.name)||child.mimeType==='application/vnd.ms-outlook')){child.kind='MESSAGE';if(depth>=limits.maxDepth)child.issues.push('MSG_DEPTH_LIMIT');else try{const nested=await new Ole(new Reader(data)).read();await walk(nested,nested._directoryTree.root,child,depth+1);}catch{child.issues.push('MSG_NESTED_MESSAGE_UNREADABLE');}}
        }else if(childEntry.storages['__substg1.0_3701000D']){
            child.kind='MESSAGE';child.issues.push('MSG_EMBEDDED_MESSAGE_UNVERIFIED');const nestedName='__substg1.0_3701000D';await walk(childStorage.storage(nestedName),childEntry.storages[nestedName],child,depth+1,24);
        }else child.issues.push('MSG_ATTACHMENT_BYTES_UNAVAILABLE');
    }
    if(/\\(?:fromhtml[1-9]\d*|htmltag\d*)\b/.test(expandedRtf)){
        // Synchronized text does not certify graphics in HTML encapsulated by RTF.
        // Only image references backed by physical, separately read attachments are covered.
        for(const match of expandedRtf.matchAll(/<(?:img|v:imagedata)\b[^>]*>/gi)){
            const attribute=match[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),src=attribute?.[1]??attribute?.[2]??attribute?.[3]??'';
            if(!/^cid:/i.test(src))part.issues.push('MSG_RTF_EMBEDDED_CONTENT_UNVERIFIED');
            else if(!childParts.some(p=>p.contentId===src.slice(4)))part.issues.push('MSG_CID_TARGET_UNAVAILABLE');
        }
        if(/<(?:svg|object|embed|canvas|iframe|video|audio)\b|\b(?:background(?:-image)?|list-style(?:-image)?)\s*:[^;}]*\burl\s*\(|<[^>]+\bbackground\s*=/i.test(expandedRtf))part.issues.push('MSG_RTF_EMBEDDED_CONTENT_UNVERIFIED');
    }
    if(html){const raw=html.toString(entry.streams['__substg1.0_1013001F']?'utf16le':'utf8');for(const match of raw.matchAll(/\bcid:([^\s"'<>]+)/gi))if(!childParts.some(p=>p.contentId===match[1]))part.issues.push('MSG_CID_TARGET_UNAVAILABLE');part.issues.push('MSG_HTML_ALTERNATIVE_UNVERIFIED');}
    for(const name of Object.keys(entry.storages))if(!/^__(?:attach_version1\.0_#|recip_version1\.0_#|nameid_version1\.0$)/.test(name))part.issues.push('MSG_UNKNOWN_STORAGE');
}
const root=add({id:partId(['root']),parentId:null,kind:'MESSAGE',name:'message.msg',mimeType:'application/vnd.ms-outlook',containerPath:['root'],payloadHash:sourceHash,byteLength:file.length,issues:[]});
try{
    if(file.length>limits.maxSourceBytes||file.length<512||(file.length-512)%512||file.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1')throw Error('MSG_CONTAINER_INVALID');
    const doc=await new Ole(new Reader(file)).read();await walk(doc,doc._directoryTree.root,root,0);
}catch(error){issues.push(error.message||'MSG_CONTAINER_UNREADABLE');}
issues.push(...parts.flatMap(p=>p.issues));const inventory=parts.map(p=>({id:p.id,parentId:p.parentId,kind:p.kind,name:p.name,mimeType:p.mimeType,containerPath:p.containerPath,payloadHash:p.payloadHash,byteLength:p.byteLength,bodyTextHash:p.body?.textHash??null}));
const output=JSON.stringify({sourceHash,rootPartId:root.id,inventoryHash:hash(JSON.stringify(inventory)),parts,payloads,issues:[...new Set(issues)]});
if(Buffer.byteLength(output)>limits.maxOutputBytes)throw Error('MSG_OUTPUT_LIMIT');process.stdout.write(output);
