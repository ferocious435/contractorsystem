import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { signInOpenWorkspace, workspaceEntryRedirectUrl } from '../open-workspace'
import { createAdminClient } from './admin'
import { renderWorkspaceEntryError } from '../workspace-entry-error'


export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    if (request.nextUrl.pathname.startsWith('/local-access')) {
        return NextResponse.redirect(workspaceEntryRedirectUrl(request))
    }


    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser().
    const {
        data: { user: sessionUser },
    } = await supabase.auth.getUser()
    let user = sessionUser

    try {
        user = await signInOpenWorkspace(supabase, user, createAdminClient)
        supabaseResponse.headers.set('Cache-Control', 'private, no-store')
    } catch {
        return new NextResponse(renderWorkspaceEntryError(), {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
        })
    }

    if (user && (request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/auth'))) {
        const response = NextResponse.redirect(workspaceEntryRedirectUrl(request))
        supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
        response.headers.set('Cache-Control', 'private, no-store')
        return response
    }

    return supabaseResponse
}
