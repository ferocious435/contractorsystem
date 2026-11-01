import {NextRequest,NextResponse} from 'next/server';
import {requireOwnedDocument,requireOwnedProject} from '@/app/api/_utils/auth';
import {createClient} from '@/utils/supabase/server';
import {resolveReadingVersion,getCurrentDocumentReading,documentReadingVersions} from '@/utils/document-reading-history';
import {validReadingHash,type OwnedSourceDocument} from '@/utils/visual-source-reading';
import {record,validUuid} from '@/server/ai/contracts';

export async function POST(request:NextRequest) {
    try{
        const body:unknown=await request.json();
        if(!record(body)||Object.keys(body).some(key=>!['projectId','documentId','textHash','quote','page'].includes(key))||!validUuid(body.projectId)||!validUuid(body.documentId)
            ||body.textHash!==undefined&&!validReadingHash(body.textHash)||body.quote!==undefined&&(typeof body.quote!=='string'||body.quote.length>200000)
            ||body.page!==undefined&&(!Number.isInteger(body.page)||(body.page as number)<1||(body.page as number)>10000))return NextResponse.json({success:false,error:'Invalid source reading request'},{status:400});
        const client=await createClient(),project=await requireOwnedProject(client,body.projectId);
        if(!project.ok)return project.response;
        const owned=await requireOwnedDocument<OwnedSourceDocument>(client,body.documentId);
        if(!owned.ok)return owned.response;
        if(owned.document.project_id!==body.projectId)return NextResponse.json({success:false,error:'Document does not belong to the requested project'},{status:403});
        const version=resolveReadingVersion(owned.document,body as {textHash?:string;quote?:string;page?:number});
        if(!version)return NextResponse.json({success:false,error:'Source reading version is absent or ambiguous'},{status:404});
        const current=getCurrentDocumentReading(owned.document),historical={...owned.document,extracted_text:version.text,extracted_text_hash:version.textHash,
            parsed_json:{source_reading:version.reading,source_reading_visual_descriptions:version.visualDescriptions||[]}};
        const effective=getCurrentDocumentReading(historical);
        const isCurrent=current.textHash===version.textHash;
        const parsed=record(owned.document.parsed_json)?owned.document.parsed_json:{};
        const reading=record(version.reading)?{...version.reading,...(isCurrent?{units:Array.isArray(parsed.source_reading_units)?parsed.source_reading_units:[]}:{} )}:version.reading;
        return NextResponse.json({success:true,...effective,current:isCurrent,reading,versions:documentReadingVersions(owned.document)});
    }catch{return NextResponse.json({success:false,error:'Unable to open the source reading'},{status:500});}
}
