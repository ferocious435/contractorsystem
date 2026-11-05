// Synthetic CFB v3 writer for tests. Contains no project correspondence.
const FREE=0xffffffff,END=0xfffffffe,FAT=0xfffffffd;
const unicode=value=>Buffer.from(value+'\0','utf16le');
const strings={'001A':'IPM.Note','0037':'Synthetic source','0C1A':'Synthetic sender','0C1F':'sender@example.invalid','0E04':'reader@example.invalid'};
const tag=(id,type)=>Number.parseInt(id+type,16);
function properties(values,headerSize=32,attachments=0){
 const result=Buffer.alloc(headerSize+values.length*16);
 if(headerSize>=24){result.writeUInt32LE(attachments,12);result.writeUInt32LE(attachments,20);}
 values.forEach(([property,value],i)=>{const offset=headerSize+i*16;result.writeUInt32LE(property,offset);result.writeUInt32LE(6,offset+4);if(typeof value==='bigint')result.writeBigUInt64LE(value,offset+8);else result.writeUInt32LE(value,offset+8);});return result;
}
function messageTree(options={},headerSize=32){
 const {body='אושר',attachments=[],subject='Synthetic source',date='2024-10-01T10:00:00.000Z'}=options;
 const entries=[],values=[];
 const add=(id,value,type='001F')=>{const bytes=type==='001F'?unicode(value):Buffer.from(value);entries.push({name:'__substg1.0_'+id+type,data:bytes});values.push([tag(id,type),bytes.length]);};
 for(const[id,value]of Object.entries({...strings,'0037':subject}))add(id,value);
 if(!options.omitBody)add('1000',body);
 if(options.html!==undefined)add('1013',Buffer.from(options.html),'0102');
 if(options.rtf!==undefined)add('1009',options.rtf,'0102');
 if(options.rtfInSync!==undefined)values.push([tag('0E1F','000B'),Number(options.rtfInSync)]);
 const headers='Date: Tue, 01 Oct 2024 10:00:00 +0000\r\nFrom: Synthetic sender <sender@example.invalid>\r\nTo: reader@example.invalid\r\nSubject: '+subject+'\r\n';
 add('007D',headers);values.push([tag('0039','0040'),BigInt(Date.parse(date)+11644473600000)*10000n]);
 entries.unshift({name:'__properties_version1.0',data:properties(values,headerSize,options.attachmentCountOverride??attachments.length)});
 attachments.forEach((attachment,i)=>{
  const children=[],props=[];
  const text=(id,value)=>{const bytes=unicode(value);children.push({name:'__substg1.0_'+id+'001F',data:bytes});props.push([tag(id,'001F'),bytes.length]);};
  text('3707',attachment.name||'attachment.bin');text('3704',attachment.name||'attachment.bin');text('370E',attachment.mimeType||'application/octet-stream');
  if(attachment.contentId)text('3712',attachment.contentId);
  if(attachment.embedded){children.push({name:'__substg1.0_3701000D',children:messageTree(attachment.embedded,24)});props.push([tag('3705','0003'),5]);}
  else if(!attachment.missing){const bytes=Buffer.from(attachment.data??'binary');children.push({name:'__substg1.0_37010102',data:bytes});props.push([tag('3701','0102'),bytes.length],[tag('3705','0003'),1]);}
  children.unshift({name:'__properties_version1.0',data:properties(props,8)});
  entries.push({name:'__attach_version1.0_#'+i.toString(16).padStart(8,'0'),children});
 });return entries;
}
function compound(children){
 const root={name:'Root Entry',children,type:5},records=[];
 function collect(entry){entry.id=records.length;records.push(entry);for(const child of entry.children||[])collect(child);}
 collect(root);const sectors=[],fat=[],mini=[],miniFat=[];
 function allocate(data){if(!data.length)return END;const first=sectors.length,count=Math.ceil(data.length/512);for(let i=0;i<count;i++){const sector=Buffer.alloc(512);data.copy(sector,0,i*512,(i+1)*512);sectors.push(sector);fat.push(i+1<count?first+i+1:END);}return first;}
 for(const entry of records){
  if(!entry.data)continue;entry.size=entry.data.length;
  if(entry.data.length>=4096){entry.start=allocate(entry.data);continue;}
  entry.start=entry.data.length?mini.length:END;const count=Math.ceil(entry.data.length/64);
  for(let i=0;i<count;i++){const block=Buffer.alloc(64);entry.data.copy(block,0,i*64,(i+1)*64);mini.push(block);miniFat.push(i+1<count?entry.start+i+1:END);}
 }
 const miniBytes=Buffer.concat(mini);root.start=allocate(miniBytes);root.size=miniBytes.length;
 const miniFatBytes=Buffer.alloc(Math.ceil(miniFat.length*4/512)*512,0xff);miniFat.forEach((v,i)=>miniFatBytes.writeUInt32LE(v,i*4));const miniFatStart=allocate(miniFatBytes);
 const directory=Buffer.alloc(Math.ceil(records.length/4)*512);
 function links(items,depth=0,maxDepth=Math.floor(Math.log2(items.length||1))){
  if(!items.length)return FREE;const mid=Math.floor(items.length/2),item=items[mid];
  item.left=links(items.slice(0,mid),depth+1,maxDepth);item.right=links(items.slice(mid+1),depth+1,maxDepth);item.color=depth>0&&depth===maxDepth?0:1;return item.id;
 }
 for(const entry of records){const items=[...(entry.children||[])].sort((a,b)=>a.name.length-b.name.length||a.name.toUpperCase().localeCompare(b.name.toUpperCase(),'en'));entry.child=links(items);}
 for(const entry of records){const offset=entry.id*128,name=unicode(entry.name);if(name.length>64)throw Error('CFB name too long');name.copy(directory,offset);directory.writeUInt16LE(name.length,offset+64);directory[offset+66]=entry.type|| (entry.children?1:2);directory[offset+67]=entry.color??1;directory.writeUInt32LE(entry.left??FREE,offset+68);directory.writeUInt32LE(entry.right??FREE,offset+72);directory.writeUInt32LE(entry.child??FREE,offset+76);directory.writeUInt32LE(entry.start??END,offset+116);directory.writeBigUInt64LE(BigInt(entry.size||0),offset+120);}
 const directoryStart=allocate(directory);let fatCount=1;while(Math.ceil((sectors.length+fatCount)/128)>fatCount)fatCount++;
 const fatStart=sectors.length;for(let i=0;i<fatCount;i++){sectors.push(Buffer.alloc(512,0xff));fat.push(FAT);}fat.forEach((value,i)=>sectors[fatStart+Math.floor(i/128)].writeUInt32LE(value,(i%128)*4));
 const header=Buffer.alloc(512);Buffer.from('d0cf11e0a1b11ae1','hex').copy(header);header.writeUInt16LE(0x3e,24);header.writeUInt16LE(3,26);header.writeUInt16LE(0xfffe,28);header.writeUInt16LE(9,30);header.writeUInt16LE(6,32);header.writeUInt32LE(fatCount,44);header.writeUInt32LE(directoryStart,48);header.writeUInt32LE(4096,56);header.writeUInt32LE(miniFatStart,60);header.writeUInt32LE(miniFatBytes.length/512,64);header.writeUInt32LE(END,68);
 for(let i=0;i<109;i++)header.writeUInt32LE(i<fatCount?fatStart+i:FREE,76+i*4);
 return Buffer.concat([header,...sectors]);
}
export function msgFixture(options={}){return compound(messageTree(options));}
export function nativeMsgFixture({body='אושר',subject='Synthetic source',date='2024-10-01T10:00:00.000Z'}={}){return {headers:{subject,from:['Synthetic sender <sender@example.invalid>'],to:['reader@example.invalid'],cc:[],bcc:[],sentAt:date,sentAtRaw:date},bodyText:body,issues:[]};}
export function uncompressedRtf(text){const bytes=Buffer.from(text,'latin1'),result=Buffer.alloc(16+bytes.length);result.writeUInt32LE(bytes.length+12,0);result.writeUInt32LE(bytes.length,4);result.write('MELA',8,'ascii');bytes.copy(result,16);return result;}
export function cyclicMsgFixture(){const bytes=msgFixture(),directory=bytes.readUInt32LE(48),fat=bytes.readUInt32LE(76);bytes.writeUInt32LE(directory,512+fat*512+directory*4);return bytes;}
export function compressedRtfFixture(){
 // MS-OXRTFCP: dictionary reference 0/6, seven literals, then end at 207+13.
 const data=Buffer.from([1,0,4,32,72,101,108,108,111,125,1,13,192]),result=Buffer.alloc(16+data.length);let crc=0;
 for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 result.writeUInt32LE(data.length+12);result.writeUInt32LE(13,4);result.write('LZFu',8,'ascii');result.writeUInt32LE(crc>>>0,12);data.copy(result,16);return result;
}
