import { NextRequest, NextResponse } from 'next/server';
import {
    LOCAL_ACCESS_COOKIE,
    LOCAL_DEMO_ACCESS_COOKIE_VALUE,
    getLocalAccessToken,
    isDemoAccessEnabled,
    isLocalAccessEnabled,
    isLoopbackHost,
    isValidLocalAccessToken,
} from '@/utils/local-access';

const LOCAL_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

function createSameHostRedirect(request: NextRequest, pathname: string, search = '') {
    const redirectUrl = new URL(request.url);
    const host = request.headers.get('host');
    if (host) redirectUrl.host = host;
    redirectUrl.pathname = pathname;
    redirectUrl.search = search;
    return redirectUrl;
}

function getRequestHostname(request: NextRequest) {
    const host = request.headers.get('host') || request.nextUrl.host || request.nextUrl.hostname;
    if (host.startsWith('[')) {
        const bracketEnd = host.indexOf(']');
        return bracketEnd > 0 ? host.slice(1, bracketEnd) : request.nextUrl.hostname;
    }
    return host.split(':')[0] || request.nextUrl.hostname;
}

export function GET(request: NextRequest) {
    const hostname = getRequestHostname(request);
    const isRealMode = request.nextUrl.searchParams.get('real') === '1';
    const isDemoMode = request.nextUrl.searchParams.get('demo') === '1';
    const providedToken = request.nextUrl.searchParams.get('token');

    if (isRealMode) {
        const response = NextResponse.redirect(createSameHostRedirect(request, '/'));
        response.cookies.delete(LOCAL_ACCESS_COOKIE);
        response.cookies.set(LOCAL_ACCESS_COOKIE, '', {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/',
            maxAge: 0,
            expires: new Date(0),
        });
        response.headers.set('Cache-Control', 'no-store, max-age=0');
        return response;
    }

    const token = isDemoMode
        ? LOCAL_DEMO_ACCESS_COOKIE_VALUE
        : providedToken || (isLoopbackHost(hostname) ? getLocalAccessToken() : '');

    const isAllowed = isDemoMode
        ? isDemoAccessEnabled(hostname)
        : isLocalAccessEnabled(hostname) && isValidLocalAccessToken(token);

    if (!isAllowed) {
        return NextResponse.redirect(createSameHostRedirect(request, '/login', '?errorMessage=LocalAccessDenied'));
    }

    const response = NextResponse.redirect(createSameHostRedirect(request, '/'));
    response.cookies.set(LOCAL_ACCESS_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: LOCAL_ACCESS_MAX_AGE_SECONDS,
    });

    return response;
}
