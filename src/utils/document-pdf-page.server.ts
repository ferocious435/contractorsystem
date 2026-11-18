import 'server-only';
import {verifyDocumentSourceHash} from './document-source-hash.server';
import {renderPdfView} from './visual-pdf-renderer';

/** Optional image view; the original file response stays unchanged without renderPage. */
export function validDocumentPageRequest(params:URLSearchParams):boolean {
    const page=params.get('renderPage');
    return page===null||(params.getAll('renderPage').length===1&&/^[1-9]\d{0,4}$/u.test(page)
        &&Number(page)<=10000&&/^[a-f\d]{64}$/iu.test(params.get('sourceHash')??''));
}

/** Both production and the synthetic server render the same verified original bytes. */
export async function documentPdfPageResponse(file:Buffer,sourceHash:string|null,page:number,signal?:AbortSignal):Promise<Response> {
    const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    if(!Number.isInteger(page)||page<1||page>10000||!sourceHash)return Response.json({success:false,error:'Invalid renderPage'},{status:400,headers});
    if(!verifyDocumentSourceHash(file,sourceHash))return Response.json({success:false,code:'SOURCE_CHANGED'},{status:409,headers});
    signal?.throwIfAborted();
    try{
        const view=await renderPdfView(file,page,undefined);
        signal?.throwIfAborted();
        return new Response(Buffer.from(view.bytes),{headers:{...headers,'Content-Type':'image/png','X-Document-Page':String(page)}});
    }catch(error){
        if(signal?.aborted)throw error;
        return Response.json({success:false,error:'Original PDF page could not be rendered'},{status:422,headers});
    }
}
