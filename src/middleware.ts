import { NextResponse,type NextRequest } from 'next/server'
import { updateSession } from './utils/supabase/middleware'
import {isSameOriginRequest} from './utils/request-origin'

export async function middleware(request: NextRequest) {
    if(!isSameOriginRequest(request))return NextResponse.json({success:false,code:'CROSS_ORIGIN_REQUEST',error:'הבקשה אינה מאתר המערכת.'},{status:403,headers:{'Cache-Control':'no-store'}})
    return await updateSession(request)
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
