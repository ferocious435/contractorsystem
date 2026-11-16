import {createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {requireOwnedDocument,requireOwnedProject} from '@/app/api/_utils/auth';
import {createClient} from '@/utils/supabase/server';
import {downloadDocumentBuffer} from '@/utils/document-storage';
import {resolveReadingVersion} from '@/utils/document-reading-history';
import {buildVisualSourceManifest} from '@/utils/visual-source-manifest';
import {validReadingHash,type OwnedSourceDocument} from '@/utils/visual-source-reading';
import {validUuid,record} from '@/server/ai/contracts';
import {retainedFragmentComposition,verifyFragmentProof,verifyPositionedImage} from '@/server/ai/visual-fragment-proof.server';
import {createSourceFragmentRenderer} from '@/server/documents/visual-fragment-renderer.server';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const failure=(status:number,error:string)=>NextResponse.json({success:false,error},{status});

/** Read-only: coordinates come exclusively from the owned, versioned proof. */
export async function GET(request:NextRequest) {
    try{
        const params=new URL(request.url).searchParams,keys=['projectId','documentId','sourceHash','textHash','unitId','targetId'];
        if([...params.keys()].some(k=>!keys.includes(k))||keys.some(k=>params.getAll(k).length!==1))return failure(400,'Invalid fragment request');
        const projectId=params.get('projectId'),documentId=params.get('documentId'),sourceHash=params.get('sourceHash'),textHash=params.get('textHash'),unitId=params.get('unitId'),targetId=params.get('targetId');
        if(!validUuid(projectId)||!validUuid(documentId)||!validReadingHash(sourceHash)||!validReadingHash(textHash)||!unitId||unitId.length>1000
            ||/[\x00-\x1f\\]/u.test(unitId)||unitId.includes('..')||unitId.includes('://')||unitId.startsWith('/')||!targetId||!/^fragment:(?:line:\d+|table:\d+:row:\d+)$/u.test(targetId))return failure(400,'Invalid fragment request');
        const client=await createClient(),project=await requireOwnedProject(client,projectId);if(!project.ok)return project.response;
        const owned=await requireOwnedDocument<OwnedSourceDocument>(client,documentId);if(!owned.ok)return owned.response;
        if(owned.document.project_id!==projectId)return failure(403,'Document does not belong to the requested project');
        if(owned.document.content_hash&&owned.document.content_hash!==sourceHash)return failure(409,'Source has changed');
        const version=resolveReadingVersion(owned.document,{textHash});
        if(!version||version.sourceHash!==sourceHash)return failure(404,'Source reading version not found');
        const matches=Array.isArray(version.units)?version.units.filter(unit=>record(unit)&&unit.unitId===unitId):[],saved=matches[0];
        if(matches.length!==1)return failure(404,'Source fragment not found');
        const composition=saved.composition;
        if(!record(composition)||!Array.isArray(composition.proofs)||!Array.isArray(composition.pending))return failure(422,'Source fragment evidence is not verified');
        if(composition.pending.some(target=>record(target)&&target.id===targetId))return failure(422,'Source fragment is not yet confirmed');
        if(!composition.proofs.some(proof=>record(proof)&&record(proof.target)&&proof.target.id===targetId))return failure(404,'Source fragment not found');
        const file=await downloadDocumentBuffer(client,owned.document);request.signal.throwIfAborted();
        if(hash(file)!==sourceHash)return failure(409,'Source has changed');
        const manifest=await buildVisualSourceManifest(file,String(owned.document.title||''));request.signal.throwIfAborted();
        const source=manifest.units.find(unit=>unit.id===unitId),scope={ownerId:project.user.id,projectId,documentId,sourceHash};
        const checked=source&&retainedFragmentComposition(saved,source,scope);
        if(!source||!checked)return failure(422,'Source fragment evidence is not verified');
        const proof=checked.composition!.proofs.find(value=>value.target.id===targetId)!;
        const render=createSourceFragmentRenderer(file,String(owned.document.title||''),manifest);
        const image=await render(source,proof.rect);request.signal.throwIfAborted();
        if(!image||!verifyFragmentProof(proof,scope,source,checked,proof.target,image)||hash(image.bytes)!==proof.image.sha256||!await verifyPositionedImage(proof,source,render,checked))return failure(422,'Source fragment pixels do not match the saved evidence');
        const line=proof.correction??proof.positioned;
        const selected=line?await render(source,line.match.line.rect):image;
        if(!selected||line&&selected.sha256!==line.image.sha256)return failure(422,'Source line changed');
        return new NextResponse(new Uint8Array(selected.bytes),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="source-fragment.png"'}});
    }catch{return failure(500,'Unable to open the source fragment');}
}
