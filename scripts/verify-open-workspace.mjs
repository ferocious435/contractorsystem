import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';

const { NextRequest } = createRequire(import.meta.url)('next/server');

const feature = await import('../src/utils/open-workspace.ts').catch(() => null);
const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: ownerId, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
  phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

function requireFeature() {
  assert.ok(feature, 'Open workspace behavior is not implemented yet');
  return feature;
}

test('entry preserves the browser host when NextRequest normalizes a loopback URL', () => {
  const { workspaceEntryRedirectUrl } = requireFeature();
  assert.equal(typeof workspaceEntryRedirectUrl, 'function', 'Same-host entry redirect is not implemented yet');
  const request = new NextRequest('http://localhost:3003/login?code=discard', { headers: { host: '127.0.0.1:3003' } });
  assert.equal(workspaceEntryRedirectUrl(request).href, 'http://127.0.0.1:3003/');
  const ipv6 = new NextRequest('http://localhost:3003/local-access?demo=1', { headers: { host: '[::1]:3003' } });
  assert.equal(workspaceEntryRedirectUrl(ipv6).href, 'http://[::1]:3003/');
});

function authFixture(options = {}) {
  const requests = [];
  const sessionUser = options.sessionUser || user;
  const session = {
    access_token: 'test.' + Buffer.from(JSON.stringify({ sub: sessionUser.id, exp: 4102444800 })).toString('base64url') + '.signature',
    refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user: sessionUser,
  };
  const fakeFetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path: url.pathname, method: init?.method || 'GET', body });
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/rest/v1/profiles') {
      return respond(options.owners || [{ id: ownerId }]);
    }
    if (url.pathname === '/auth/v1/admin/users/' + ownerId) {
      return options.missingUser ? respond({ msg: 'User not found', code: 'user_not_found' }, 404) : respond(user);
    }
    if (url.pathname === '/auth/v1/admin/generate_link') {
      if (options.linkError) return respond({ msg: 'Unavailable', code: 'unexpected_failure' }, 500);
      return respond({ ...user, ...(options.linkUserId ? { id: options.linkUserId } : {}),
        action_link: 'https://auth.example.test/verify', email_otp: 'fixture-code',
        hashed_token: 'fixture-hash', redirect_to: 'http://localhost:3002', verification_type: 'magiclink' });
    }
    if (url.pathname === '/auth/v1/verify') {
      return options.verifyError ? respond({ msg: 'Expired', code: 'otp_expired' }, 403) : respond(session);
    }
    throw new Error('Unexpected external request: ' + url.pathname);
  };
  const settings = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fakeFetch } };
  const client = createClient('https://auth.example.test', 'fixture-publishable', settings);
  const admin = createClient('https://auth.example.test', 'fixture-server-secret', settings);
  return { client, admin, requests };
}

test('a new visitor opens real data without an activation setting or an email request', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture();
  const result = await signInOpenWorkspace(f.client, null, () => f.admin);
  assert.equal(result.id, ownerId);
  assert.deepEqual(f.requests.map(x => x.path), [
    '/rest/v1/profiles', '/auth/v1/admin/users/' + ownerId, '/auth/v1/admin/generate_link', '/auth/v1/verify',
  ]);
  assert.equal(f.requests[2].body.type, 'magiclink');
  assert.equal(f.requests[2].body.email, 'owner@example.test');
  assert.equal(f.requests[3].body.type, 'email');
  assert.equal(f.requests[3].body.token_hash, 'fixture-hash');
  const { data } = await f.client.auth.getSession();
  assert.equal(data.session.user.id, ownerId);
});

test('an existing workspace session is reused without generating another session', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture();
  const result = await signInOpenWorkspace(f.client, user, () => f.admin);
  assert.equal(result, user);
  assert.ok(f.requests.every(request => request.path === '/rest/v1/profiles'), 'The existing owner must not receive another sign-in token');
});

test('a browser signed into another account opens the agreed shared workspace', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture();
  assert.equal((await signInOpenWorkspace(f.client, { ...user, id: otherId }, () => f.admin)).id, ownerId);
});

test('an absent or ambiguous workspace owner never selects an arbitrary account', async () => {
  const { signInOpenWorkspace } = requireFeature();
  for (const owners of [[], [{ id: ownerId }, { id: otherId }]]) {
    const f = authFixture({ owners });
    await assert.rejects(signInOpenWorkspace(f.client, null, () => f.admin), /workspace/i);
    assert.deepEqual(f.requests.map(x => x.path), ['/rest/v1/profiles']);
  }
});

test('a missing owner does not create a new account or fall back to demo projects', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture({ missingUser: true });
  await assert.rejects(signInOpenWorkspace(f.client, null, () => f.admin), /workspace/i);
  assert.deepEqual(f.requests.map(x => x.path), ['/rest/v1/profiles', '/auth/v1/admin/users/' + ownerId]);
});

test('failed session generation does not attempt verification', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture({ linkError: true });
  await assert.rejects(signInOpenWorkspace(f.client, null, () => f.admin), /workspace/i);
  assert.equal(f.requests.length, 3);
});

test('a generated link for another account is rejected before verification', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture({ linkUserId: otherId });
  await assert.rejects(signInOpenWorkspace(f.client, null, () => f.admin), /workspace/i);
  assert.equal(f.requests.length, 3);
});

test('failed verification cannot be reported as an open workspace', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture({ verifyError: true });
  await assert.rejects(signInOpenWorkspace(f.client, null, () => f.admin), /workspace/i);
});

test('verification returning another user cannot open the configured workspace', async () => {
  const { signInOpenWorkspace } = requireFeature();
  const f = authFixture({ sessionUser: { ...user, id: otherId } });
  await assert.rejects(signInOpenWorkspace(f.client, null, () => f.admin), /workspace/i);
});
