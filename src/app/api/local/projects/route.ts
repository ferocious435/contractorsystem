import { NextRequest, NextResponse } from 'next/server';
import { LOCAL_ACCESS_COOKIE, LOCAL_DEMO_ACCESS_COOKIE_VALUE, isValidLocalAccessCookie } from '@/utils/local-access';


function getRequestHostname(request: NextRequest) {
    const host = request.headers.get('host') || request.nextUrl.host || request.nextUrl.hostname;
    if (host.startsWith('[')) {
        const bracketEnd = host.indexOf(']');
        return bracketEnd > 0 ? host.slice(1, bracketEnd) : request.nextUrl.hostname;
    }
    return host.split(':')[0] || request.nextUrl.hostname;
}

const REAL_LOCAL_PROJECTS = [
    {
        id: 'local-project-main',
        name: 'פרויקט מקומי לבדיקה',
        client_name: 'לקוח מקומי',
        budget: 0,
        image_index: 2,
    },
];

const DEMO_PROJECTS = [
    {
        id: 'demo-project-main',
        name: 'פרויקט ניסיון',
        client_name: 'לקוח דמו',
        budget: 125000,
        image_index: 1,
    },
    {
        id: 'demo-project-site',
        name: 'בדיקת שטח',
        client_name: 'ניסיון חינמי',
        budget: 38000,
        image_index: 3,
    },
];

export function GET(request: NextRequest) {
    const token = request.cookies.get(LOCAL_ACCESS_COOKIE)?.value;

    if (!isValidLocalAccessCookie(token, getRequestHostname(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isDemo = token === LOCAL_DEMO_ACCESS_COOKIE_VALUE;

    return NextResponse.json({
        mode: isDemo ? 'demo' : 'local',
        projects: isDemo ? DEMO_PROJECTS : REAL_LOCAL_PROJECTS,
    });
}
