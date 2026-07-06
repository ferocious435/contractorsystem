import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', override: false });

const baseUrl = process.env.VERIFY_RUNTIME_BASE_URL || 'http://127.0.0.1:3000';
const token = process.env.LOCAL_ACCESS_TOKEN;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyAccessPath(path, label) {
  const accessResponse = await fetch(new URL(path, baseUrl), {
    redirect: 'manual',
  });

  assert([302, 303, 307, 308].includes(accessResponse.status), label + ' must redirect after setting cookie');
  const redirectLocation = accessResponse.headers.get('location') || '';
  assert(
    redirectLocation.startsWith(baseUrl + '/'),
    label + ' must redirect to the same host that set the cookie'
  );

  const cookie = accessResponse.headers.get('set-cookie') || '';
  assert(cookie.includes('contractorsystem_local_access='), label + ' must set the local access cookie');

  const projectResponse = await fetch(new URL('/api/local/projects', baseUrl), {
    headers: { cookie },
  });
  assert(projectResponse.status === 200, label + ' project API must accept the access cookie');

  const payload = await projectResponse.json();
  assert(Array.isArray(payload.projects) && payload.projects.length > 0, label + ' project API must return a project list');

  const homeResponse = await fetch(new URL('/', baseUrl), {
    headers: { cookie },
    redirect: 'manual',
  });
  assert(homeResponse.status === 200, label + ' home page must open with the access cookie');
}

assert(token, 'LOCAL_ACCESS_TOKEN must be set in .env.local');

await verifyAccessPath('/local-access', 'Local access');
await verifyAccessPath('/local-access?demo=1', 'Demo access');

console.log('Local and demo access verified against ' + baseUrl + '.');
