import assert from 'node:assert/strict';

const baseUrl = process.env.VERIFY_RUNTIME_BASE_URL || 'http://127.0.0.1:3002';
const projectId = process.env.VERIFY_WORKSPACE_PROJECT_ID || 'd7362181-c47b-46b5-b0c8-3e53bf9058eb';
const authCookies = (response) => response.headers.getSetCookie().filter((value) => /^sb-.*-auth-token(?:\.\d+)?=/.test(value));
const cookieHeader = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
function redirectDestination(response) {
    const location = response.headers.get('location');
    assert.ok(location, 'A redirect must provide a destination');
    return new URL(location, baseUrl).href;
}
const get = (path, cookie = '') => fetch(new URL(path, baseUrl), {
    headers: cookie ? { cookie } : {}, redirect: 'manual', signal: AbortSignal.timeout(60000),
});

const landing = await get('/');
assert.equal(landing.status, 200, 'A new browser must open the system directly');
assert.ok(authCookies(landing).length > 0, 'Direct entry must establish access to real data');
assert.match(landing.headers.get('cache-control') || '', /no-store/, 'Entry with a session must not be cached');
const html = await landing.text();
assert.ok(!html.includes('התחבר ללא סיסמה כדי לפתוח את הפרויקטים שלך'), 'Direct entry must not show the email login screen');
assert.ok(html.includes('תצוגת משתמש'), 'User view selection must be present');

const fromLogin = await get('/login', 'contractorsystem_local_access=demo');
assert.ok([302, 303, 307, 308].includes(fromLogin.status), '/login must open the workspace');
assert.equal(redirectDestination(fromLogin), new URL('/', baseUrl).href, 'Entry must keep the same hostname and port');
assert.ok(authCookies(fromLogin).length > 0, 'The redirect must preserve the automatic session cookies');
const cookie = cookieHeader(fromLogin);

const documents = await get('/api/documents?projectId=' + projectId + '&category=CONTRACT', cookie);
assert.equal(documents.status, 200, 'Document API must accept the session from direct entry');
const payload = await documents.json();
assert.equal(payload.success, true);
assert.ok(payload.documents.length > 0, 'Entry must return real project documents');
assert.ok(payload.documents.every((document) => document.project_id === projectId));

const repeated = await get('/', cookie);
assert.equal(repeated.status, 200);
assert.equal(authCookies(repeated).length, 0, 'A valid session must be reused');

const financials = await get('/dashboard/' + projectId + '/pricing', cookie);
assert.equal(financials.status, 200, 'Existing financial screens must remain accessible');

const deepLink = await get('/dashboard/' + projectId + '/documents');
assert.equal(deepLink.status, 200, 'A new browser must open a direct document link without login');
assert.ok(authCookies(deepLink).length > 0);

const legacy = await get('/local-access?demo=1');
assert.equal(redirectDestination(legacy), new URL('/', baseUrl).href, 'The old local link must open the real workspace');

console.log(JSON.stringify({ baseUrl, directEntry: true, loginRedirect: true, sameHostCookies: true,
    realContractDocuments: payload.documents.length, sessionReused: true, financials: true,
    directDocumentLink: true, legacyLinkUsesRealWorkspace: true }));
