import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { LOCAL_ACCESS_COOKIE, isValidLocalAccessCookie } from '../local-access'


function getRequestHostname(request: NextRequest) {
    const host = request.headers.get('host') || request.nextUrl.host || request.nextUrl.hostname;
    if (host.startsWith('[')) {
        const bracketEnd = host.indexOf(']');
        return bracketEnd > 0 ? host.slice(1, bracketEnd) : request.nextUrl.hostname;
    }
    return host.split(':')[0] || request.nextUrl.hostname;
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const localAccessCookie = request.cookies.get(LOCAL_ACCESS_COOKIE)?.value
    const hasLocalAccess = isValidLocalAccessCookie(localAccessCookie, getRequestHostname(request))

    if (request.nextUrl.pathname.startsWith('/local-access') || request.nextUrl.pathname.startsWith('/api/local')) {
        return supabaseResponse
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
        data: { user },
    } = await supabase.auth.getUser()

    if (user && request.nextUrl.pathname.startsWith('/login')) {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
    }

    if (hasLocalAccess && !request.nextUrl.pathname.startsWith('/login')) {
        return supabaseResponse
    }

    // TEMPORARY BYPASS FOR DEBUGGING
    if (
        !user &&
        !request.nextUrl.pathname.startsWith('/login') &&
        !request.nextUrl.pathname.startsWith('/auth')
    ) {
        // no user, potentially respond by redirecting the user to the login page
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }


    return supabaseResponse
}
