import { updateSession } from './utils/supabase/middleware'
import {createWorkspaceMiddleware} from './utils/workspace-middleware'

export const middleware = createWorkspaceMiddleware(updateSession)

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
