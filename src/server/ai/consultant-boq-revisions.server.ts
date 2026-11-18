import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createAdminClient} from '@/utils/supabase/admin';
import {ownedWritingProject,savedProjectDocuments,ProjectWritingError} from '@/utils/project-writing-context-server';
import {getCurrentDocumentReading} from '@/utils/document-reading-history';
import {compareBoqEdition} from '@/utils/consultant-boq-editions';
import {consultantBoqRowKey,savedConsultantBoqRows} from '@/utils/consultant-result';
import {authenticateRuntimeOwner} from './service.server';
import {getAiJobStore,type AiJobStore} from './jobs.server';
import {BusinessAiError,validUuid} from './contracts';
const headers={'Cache-Control':'no-store'};
export function createConsultantBoqRevisionReader({authenticate=authenticateRuntimeOwner,client=createAdminClient,store=getAiJobStore}:{
    authenticate?:(request:Request)=>Promise<string>;client?:()=>SupabaseClient;store?:()=>Pick<AiJobStore,'listOwned'>;
}={}){
    return async(request:Request):Promise<Response>=>{
        try{
            const ownerId=await authenticate(request),params=new URL(request.url).searchParams;
            const projectId=params.get('projectId'),conversationId=params.get('conversationId');
            if(!validUuid(projectId)||!validUuid(conversationId)||[...params.keys()].some(key=>!['projectId','conversationId'].includes(key))
                ||params.getAll('projectId').length!==1||params.getAll('conversationId').length!==1)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
            const database=client();await ownedWritingProject(database,projectId,ownerId);
            const jobs=(await store().listOwned(ownerId,projectId,'consultant',conversationId)).filter(job=>job.state==='SUCCEEDED'&&job.kind==='consultant'
                &&job.projectId===projectId&&job.conversationId===conversationId&&job.clientContextId===conversationId);
            const saved=jobs.map(job=>({jobId:job.id,rows:savedConsultantBoqRows(job.result)}));
            // Legacy replies do not need a catalogue read; their saved text stays unchanged.
            if(!saved.some(job=>job.rows.length))return Response.json({success:true,availability:'AVAILABLE',jobs:saved.map(job=>({...job,rows:[]}))},{headers});
            let documents;
            try{documents=(await savedProjectDocuments(database,projectId)).map(document=>{const reading=getCurrentDocumentReading(document);
                return {...document,extracted_text:reading.text,extracted_text_hash:reading.textHash};});}
            catch(error){console.warn('[consultant-boq-revisions]',JSON.stringify({projectId,code:error instanceof ProjectWritingError?error.code:'LOCAL_CONTEXT_UNAVAILABLE'}));
                return Response.json({success:true,availability:'UNAVAILABLE',jobs:saved.map(job=>({jobId:job.jobId,rows:job.rows.map(originalRow=>({rowKey:consultantBoqRowKey(originalRow),originalRow,comparison:null}))}))},{headers});}
            return Response.json({success:true,availability:'AVAILABLE',jobs:saved.map(job=>({jobId:job.jobId,rows:job.rows.map(originalRow=>({
                rowKey:consultantBoqRowKey(originalRow),originalRow,comparison:compareBoqEdition(originalRow,documents)}))}))},{headers});
        }catch(error){const known=error instanceof BusinessAiError?error:error instanceof ProjectWritingError?new BusinessAiError(error.code,error.message,error.status):new BusinessAiError('AI_UNAVAILABLE');
            if(!(error instanceof BusinessAiError||error instanceof ProjectWritingError))console.warn('[consultant-boq-revisions] request unavailable');
            return Response.json({success:false,code:known.code,error:known.message},{status:known.status,headers});}
    };
}
export const readConsultantBoqRevisions=createConsultantBoqRevisionReader();
