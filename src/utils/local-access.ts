export const LOCAL_ACCESS_COOKIE = 'contractorsystem_local_access';
export const LOCAL_DEMO_ACCESS_COOKIE_VALUE = 'demo';

export function getLocalAccessToken() {
    return process.env.LOCAL_ACCESS_TOKEN?.trim() || '';
}

export function isLoopbackHost(hostname: string) {
    const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(normalizedHostname);
}

export function isPrivateNetworkHost(hostname: string) {
    const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const parts = normalizedHostname.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    const [first, second] = parts;
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function getAllowedLocalAccessHosts() {
    return new Set(
        (process.env.LOCAL_ACCESS_ALLOWED_HOSTS || '')
            .split(',')
            .map((host) => host.trim().toLowerCase())
            .filter(Boolean)
    );
}

export function isLocalAccessHost(hostname: string) {
    const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return isLoopbackHost(normalizedHostname) || isPrivateNetworkHost(normalizedHostname) || getAllowedLocalAccessHosts().has(normalizedHostname);
}

export function isLocalAccessEnabled(hostname: string) {
    return Boolean(getLocalAccessToken()) && isLocalAccessHost(hostname);
}

export function isDemoAccessEnabled(hostname: string) {
    return process.env.LOCAL_DEMO_ACCESS !== 'false' && isLocalAccessHost(hostname);
}

export function isValidLocalAccessToken(token: string | null | undefined) {
    const expectedToken = getLocalAccessToken();
    return Boolean(expectedToken && token && token === expectedToken);
}

export function isValidDemoAccessCookie(token: string | null | undefined, hostname: string) {
    return token === LOCAL_DEMO_ACCESS_COOKIE_VALUE && isDemoAccessEnabled(hostname);
}

export function isValidLocalAccessCookie(token: string | null | undefined, hostname: string) {
    return (isLocalAccessEnabled(hostname) && isValidLocalAccessToken(token)) || isValidDemoAccessCookie(token, hostname);
}
