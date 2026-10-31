import {NextResponse,type NextRequest} from 'next/server';
import {isSameOriginRequest} from './request-origin';

/** These exact routes validate the session/owner themselves before reading data. */
const authenticatedRoutes=new Set(['/api/correspondence','/api/system/ai-status']);
export function createWorkspaceMiddleware(updateSession:(request:NextRequest)=>Promise<NextResponse>){
    return async(request:NextRequest):Promise<NextResponse>=>{
        if(!isSameOriginRequest(request))return NextResponse.json({success:false,code:'CROSS_ORIGIN_REQUEST',error:'הבקשה אינה מאתר המערכת.'},{status:403,headers:{'Cache-Control':'no-store'}});
        if(authenticatedRoutes.has(request.nextUrl.pathname))return NextResponse.next({headers:{'Cache-Control':'private, no-store'}});
        return updateSession(request);
    };
}
