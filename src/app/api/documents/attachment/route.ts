import {createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {requireOwnedDocument,requireOwnedProject} from '@/app/api/_utils/auth';
import {createClient} from '@/utils/supabase/server';
import {downloadDocumentBuffer} from '@/utils/document-storage';
import {validReadingHash,type OwnedSourceDocument} from '@/utils/visual-source-reading';
import {validUuid} from '@/server/ai/contracts';
import {readMsgContainer} from '@/server/documents/msg-container.server';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** Only formats identified from the bytes may be displayed inline. */
function inlineType(bytes:Buffer):string|null {
    if(bytes.subarray(0,1024).toString('latin1').includes('%PDF-'))return 'application/pdf';
    if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
    if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
    if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
    if(bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
    return null;
}

export async function GET(request:NextRequest) {
    try{
        const params=new URL(request.url).searchParams,allowed=['projectId','documentId','sourceHash','partId'];
        if([...params.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>params.getAll(key).length!==1))return NextResponse.json({success:false,error:'Invalid attachment request'},{status:400});
        const projectId=params.get('projectId'),documentId=params.get('documentId'),sourceHash=params.get('sourceHash'),partId=params.get('partId');
        if(!validUuid(projectId)||!validUuid(documentId)||!validReadingHash(sourceHash)||!validReadingHash(partId))return NextResponse.json({success:false,error:'Invalid attachment request'},{status:400});
        const client=await createClient(),project=await requireOwnedProject(client,projectId);
        if(!project.ok)return project.response;
        const owned=await requireOwnedDocument<OwnedSourceDocument>(client,documentId);
        if(!owned.ok)return owned.response;
        if(owned.document.project_id!==projectId)return NextResponse.json({success:false,error:'Document does not belong to the requested project'},{status:403});
        if(owned.document.content_hash&&owned.document.content_hash!==sourceHash)return NextResponse.json({success:false,error:'Source has changed'},{status:409});
        const file=await downloadDocumentBuffer(client,owned.document);
        if(digest(file)!==sourceHash)return NextResponse.json({success:false,error:'Source has changed'},{status:409});
        const container=await readMsgContainer(file,{signal:request.signal}),part=container.parts.find(value=>value.id===partId&&value.id!==container.rootPartId);
        if(!part)return NextResponse.json({success:false,error:'Attachment not found'},{status:404});
        const bytes=container.payloads.get(part.id);
        if(!bytes||!part.payloadHash||part.byteLength!==bytes.length||digest(bytes)!==part.payloadHash)return NextResponse.json({success:false,error:'Independent attachment bytes are unavailable'},{status:422});
        const mime=inlineType(bytes),name=part.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,240)||'attachment';
        const ascii=name.replace(/["\\]/g,'_').replace(/[^\x20-\x7e]/g,'_');
        const encoded=encodeURIComponent(name).replace(/['()*]/g,value=>'%'+value.charCodeAt(0).toString(16).toUpperCase());
        return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':mime||'application/octet-stream','Content-Disposition':`${mime?'inline':'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
            'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }catch{return NextResponse.json({success:false,error:'Unable to open the attachment'},{status:500});}
}
