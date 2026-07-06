import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });

function run(command, args) {
  execFileSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function hasAuthenticatedPricingEvidence() {
  const hasCookieSession = Boolean(
    (process.env.VERIFY_RUNTIME_COOKIE || process.env.VERIFY_RUNTIME_COOKIE_FILE)
    && process.env.VERIFY_RUNTIME_PRICING_PROJECT_ID
  );
  const hasLoginSession = Boolean(
    process.env.VERIFY_RUNTIME_LOGIN_EMAIL
    && process.env.VERIFY_RUNTIME_LOGIN_PASSWORD
  );

  return hasCookieSession || hasLoginSession;
}

const missingEvidence = [];

run("npm", ["run", "verify:boq-scale"]);
run("npm", ["run", "verify:financials"]);
run("npx", ["tsc", "--noEmit"]);

const hasPricingEvidence = hasAuthenticatedPricingEvidence();

if (!hasPricingEvidence) {
  missingEvidence.push(
    "Authenticated Pricing UI runtime evidence is missing. Provide VERIFY_RUNTIME_COOKIE/VERIFY_RUNTIME_COOKIE_FILE with VERIFY_RUNTIME_PRICING_PROJECT_ID, or VERIFY_RUNTIME_LOGIN_EMAIL/PASSWORD."
  );
}

if (missingEvidence.length > 0) {
  console.error("Enterprise goal readiness is incomplete:");
  missingEvidence.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

run("npm", ["run", "verify:runtime-pricing"]);

console.log("Enterprise goal readiness verified, including authenticated pricing UI runtime evidence.");
