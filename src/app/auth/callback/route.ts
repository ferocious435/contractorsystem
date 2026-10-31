import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/utils/supabase/server'

function firstHeaderValue(value: string | null) {
    return value?.split(',')[0]?.trim() || ''
}

function isLocalHost(host: string) {
    const hostname = host.startsWith('[')
        ? host.slice(1, host.indexOf(']'))
        : host.split(':')[0]

    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '::1'
}

function getRedirectOrigin(request: Request, origin: string) {
    const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))

    if (!forwardedHost) return origin
    if (isLocalHost(forwardedHost)) return `http://${forwardedHost}`

    const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto')) || 'https'
    return `${forwardedProto}://${forwardedHost}`
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const redirectOrigin = getRedirectOrigin(request, origin)
    const code = searchParams.get('code')
    // if "next" is in param, use it as the redirect URL
    const next = searchParams.get('next') ?? '/'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${redirectOrigin}${next}`)
        }
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${redirectOrigin}/login?errorMessage=AuthCallbackError`)
}
