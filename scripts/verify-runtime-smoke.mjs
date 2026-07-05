import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { createServerClient } from "@supabase/ssr";

loadEnv({ path: ".env.local", override: false });

const baseUrl = process.env.VERIFY_RUNTIME_BASE_URL || "http://127.0.0.1:3000";

async function request(pathname, options = {}) {
  const url = new URL(pathname, baseUrl).toString();

  try {
    return await fetch(url, {
      redirect: "manual",
      ...options,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Runtime smoke request failed for ${url}: ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isRedirectToLogin(response) {
  const location = response.headers.get("location") || "";
  return [302, 303, 307, 308].includes(response.status) && location.includes("/login");
}

function isTruthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function hasPotentialAuthenticatedSessionEvidence() {
  const hasExplicitCookieSession = Boolean(
    (process.env.VERIFY_RUNTIME_COOKIE || process.env.VERIFY_RUNTIME_COOKIE_FILE)
    && process.env.VERIFY_RUNTIME_PRICING_PROJECT_ID
  );
  const hasLoginSession = Boolean(
    process.env.VERIFY_RUNTIME_LOGIN_EMAIL
    && process.env.VERIFY_RUNTIME_LOGIN_PASSWORD
  );

  return hasExplicitCookieSession || hasLoginSession;
}

function readCookieFromFile(filePath) {
  if (!filePath) {
    return "";
  }

  try {
    return readFileSync(filePath, "utf8").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read VERIFY_RUNTIME_COOKIE_FILE: ${message}`);
  }
}

const requireAuthenticatedPricing = isTruthyEnv(process.env.VERIFY_RUNTIME_REQUIRE_AUTHENTICATED_PRICING);

if (requireAuthenticatedPricing && !hasPotentialAuthenticatedSessionEvidence()) {
  throw new Error(
    "Authenticated pricing runtime smoke requires session evidence via VERIFY_RUNTIME_COOKIE, VERIFY_RUNTIME_COOKIE_FILE, or VERIFY_RUNTIME_LOGIN_EMAIL/PASSWORD, plus VERIFY_RUNTIME_PRICING_PROJECT_ID unless login env can read an owned project"
  );
}

async function createAuthenticatedSessionFromLogin() {
  const email = process.env.VERIFY_RUNTIME_LOGIN_EMAIL;
  const password = process.env.VERIFY_RUNTIME_LOGIN_PASSWORD;

  if (!email || !password) {
    return { cookie: "", projectId: "" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Authenticated pricing runtime login requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const cookiesToSend = [];
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookiesToSend;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          const existingCookieIndex = cookiesToSend.findIndex((cookie) => cookie.name === name);
          const nextCookie = { name, value };

          if (existingCookieIndex >= 0) {
            cookiesToSend[existingCookieIndex] = nextCookie;
            return;
          }

          cookiesToSend.push(nextCookie);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(`Authenticated pricing runtime login failed: ${error.message}`);
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("contractor_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Authenticated pricing runtime project lookup failed: ${projectError.message}`);
  }

  return {
    cookie: cookiesToSend.map(({ name, value }) => `${name}=${value}`).join("; "),
    projectId: project?.id || "",
  };
}

async function resolveAuthenticatedSession() {
  const explicitProjectId = process.env.VERIFY_RUNTIME_PRICING_PROJECT_ID || "";
  const explicitCookie = process.env.VERIFY_RUNTIME_COOKIE
    || readCookieFromFile(process.env.VERIFY_RUNTIME_COOKIE_FILE);

  if (explicitProjectId && explicitCookie) {
    return {
      cookie: explicitCookie,
      projectId: explicitProjectId,
    };
  }

  const loginSession = await createAuthenticatedSessionFromLogin();

  return {
    cookie: loginSession.cookie || explicitCookie,
    projectId: explicitProjectId || loginSession.projectId,
  };
}

const rootResponse = await request("/");
assert(
  isRedirectToLogin(rootResponse),
  `Expected / to redirect to /login, got ${rootResponse.status}`
);

const loginResponse = await request("/login", { redirect: "follow" });
assert(loginResponse.status === 200, `Expected /login to return 200, got ${loginResponse.status}`);

const loginHtml = await loginResponse.text();
assert(
  loginHtml.includes("example@contractor.com") || loginHtml.toLowerCase().includes("password"),
  "Expected /login HTML to include the contractor login form"
);

const pricingResponse = await request("/dashboard/runtime-smoke/pricing");
assert(
  isRedirectToLogin(pricingResponse),
  `Expected unauthorized pricing route to redirect to /login, got ${pricingResponse.status}`
);

const {
  cookie: authenticatedCookie,
  projectId: authenticatedPricingProjectId,
} = await resolveAuthenticatedSession();
let authenticatedPricingChecked = false;

if (authenticatedPricingProjectId && authenticatedCookie) {
  const authenticatedPricingResponse = await request(`/dashboard/${authenticatedPricingProjectId}/pricing`, {
    headers: {
      cookie: authenticatedCookie,
    },
    redirect: "follow",
  });
  const authenticatedPricingHtml = await authenticatedPricingResponse.text();

  assert(
    authenticatedPricingResponse.status === 200,
    `Expected authenticated pricing route to return 200, got ${authenticatedPricingResponse.status}`
  );
  assert(
    !authenticatedPricingHtml.includes("example@contractor.com"),
    "Expected authenticated pricing route to render the pricing UI, got the login form"
  );
  assert(
    authenticatedPricingHtml.includes("תמחור") || authenticatedPricingHtml.toLowerCase().includes("pricing"),
    "Expected authenticated pricing route HTML to include pricing UI markers"
  );
  authenticatedPricingChecked = true;
} else if (requireAuthenticatedPricing) {
  throw new Error(
    "Authenticated pricing runtime smoke requires session evidence via VERIFY_RUNTIME_COOKIE, VERIFY_RUNTIME_COOKIE_FILE, or VERIFY_RUNTIME_LOGIN_EMAIL/PASSWORD, plus VERIFY_RUNTIME_PRICING_PROJECT_ID unless login env can read an owned project"
  );
} else {
  console.warn(
    "Authenticated pricing runtime smoke skipped; set VERIFY_RUNTIME_REQUIRE_AUTHENTICATED_PRICING=1 with cookie env/file plus project id, or login env that can read an owned project."
  );
}

console.log(
  `Runtime smoke verified against ${baseUrl}${authenticatedPricingChecked ? " with authenticated pricing UI" : " without authenticated pricing UI"}`
);
