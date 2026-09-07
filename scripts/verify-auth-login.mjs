import fs from "node:fs";

const baseUrl = process.env.VERIFY_RUNTIME_BASE_URL || "http://127.0.0.1:3000";

function read(relativePath) {
  return fs.readFileSync(relativePath, "utf8").replace(/\r\n/g, "\n");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchLoginHtml(headers = {}) {
  const response = await fetch(new URL("/login", baseUrl), {
    headers,
    redirect: "manual",
  });

  assert(response.status === 200, "Expected /login to return 200, got " + response.status);
  return response.text();
}

function assertOrdered(text, firstNeedle, secondNeedle, message) {
  const firstIndex = text.indexOf(firstNeedle);
  const secondIndex = text.indexOf(secondNeedle);

  assert(firstIndex !== -1, "Missing first marker: " + firstNeedle);
  assert(secondIndex !== -1, "Missing second marker: " + secondNeedle);
  assert(firstIndex < secondIndex, message);
}

const loginHtml = await fetchLoginHtml();
const loginHtmlWithOldDemoCookie = await fetchLoginHtml({
  cookie: "contractorsystem_local_access=demo",
});
const loginForm = read("src/app/login/LoginForm.tsx");
const loginActions = read("src/app/login/actions.ts");
const middleware = read("src/utils/supabase/middleware.ts");
const dashboard = read("src/components/features/DashboardContent.tsx");

assert(
  loginHtml.includes('autoComplete="on"'),
  "login form must allow browser password managers"
);
assert(
  loginHtml.includes('autoComplete="username"'),
  "login email field must be marked as username"
);
assert(
  loginHtml.includes('autoComplete="current-password"'),
  "login password field must be marked as current-password"
);
assert(
  loginHtml.includes("rotem435@gmail.com"),
  "login form must prefill the real account email"
);
assert(
  loginHtmlWithOldDemoCookie.includes("rotem435@gmail.com"),
  "old local/demo cookie must not hide the real login form"
);
assert(
  loginForm.includes("useActionState(login") && loginActions.includes("signInWithPassword"),
  "login must use the password sign-in action"
);
assert(
  loginForm.includes("sendMagicLink") && loginForm.includes("magicLinkAction"),
  "login must expose the existing passwordless email-link action"
);
assert(
  loginForm.includes("formNoValidate"),
  "email-link login must work without requiring a password"
);
assert(
  loginActions.includes("cookieStore.delete(LOCAL_ACCESS_COOKIE)"),
  "successful real login must clear local/demo access cookie"
);
assert(
  middleware.includes("hasLocalAccess && !request.nextUrl.pathname.startsWith('/login')"),
  "local/demo access must not redirect away from /login"
);
assertOrdered(
  dashboard,
  "const supabase = createClient()",
  "const localProjectsResponse = await fetch('/api/local/projects'",
  "dashboard must try the real Supabase session before local/demo projects"
);
assertOrdered(
  loginActions,
  "isAuthServiceUnavailable(error)",
  "invalid_credentials",
  "unavailable Supabase auth must be detected before showing wrong-password messaging"
);

console.log("Auth login verified against " + baseUrl + ".");
