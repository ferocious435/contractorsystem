import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const args = process.argv.slice(2);
const requireLiveData = args.includes("--require-live-data");
const projectIdArgIndex = args.indexOf("--project-id");
const projectIdFilter = projectIdArgIndex >= 0 ? args[projectIdArgIndex + 1] : null;

const requiredTables = [
  "profiles",
  "projects",
  "documents",
  "contradictions",
  "pricing_ledger",
  "pricelists",
  "pricelist_items",
  "vo_letters",
  "vo_letter_items",
];

function readEnvFile(filePath) {
  const env = {};
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  return env;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseTotal(contentRange) {
  const match = String(contentRange || "").match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isTrustedBaseContractRow(row) {
  return (
    row.type === "BASE_CONTRACT" &&
    row.source === "BOQ" &&
    row.evidence_data?.source === "pricelist_items" &&
    Boolean(row.evidence_data?.pricelist_item_id)
  );
}

async function requestJson(url, key, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: key,
      "User-Agent": "ContractorSystemRemoteFinancialVerifier/1.0",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  return { response, json };
}

async function countTable(baseUrl, key, table) {
  const url = `${baseUrl}/rest/v1/${table}?select=id&limit=1`;
  const { response, json } = await requestJson(url, key, {
    headers: { Prefer: "count=exact" },
  });

  assert(response.ok, `${table}: REST check failed with ${response.status}: ${JSON.stringify(json)}`);

  return parseTotal(response.headers.get("content-range"));
}

async function main() {
  const env = { ...readEnvFile(envPath), ...process.env };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SERVICE_ROLE_KEY;

  assert(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is missing");
  assert(secretKey, "SUPABASE_SERVICE_ROLE_KEY is missing; remote financial verification needs a server key");

  const openApi = await requestJson(`${supabaseUrl}/rest/v1/`, secretKey);
  assert(openApi.response.ok, `OpenAPI check failed with ${openApi.response.status}`);
  assert(openApi.json?.paths, "OpenAPI response did not include REST paths");

  for (const table of requiredTables) {
    assert(openApi.json.paths[`/${table}`], `${table}: table is not exposed through the Data API`);
  }

  const pricingProperties = openApi.json.definitions?.pricing_ledger?.properties || {};
  assert(!pricingProperties.vat_amount, "pricing_ledger must not expose stored vat_amount");
  assert(!pricingProperties.total_price_incl_vat, "pricing_ledger must not expose stored total_price_incl_vat");

  const counts = {};
  for (const table of requiredTables) {
    counts[table] = await countTable(supabaseUrl, secretKey, table);
  }

  const ledgerProjectFilter = projectIdFilter ? `&project_id=eq.${encodeURIComponent(projectIdFilter)}` : "";
  const ledgerUrl = `${supabaseUrl}/rest/v1/pricing_ledger?select=id,project_id,type,source,quantity,unit_price_excl_vat,total_price_excl_vat,vat_rate,evidence_data&limit=1000${ledgerProjectFilter}`;
  const ledger = await requestJson(ledgerUrl, secretKey);
  assert(ledger.response.ok, `pricing_ledger fetch failed with ${ledger.response.status}`);

  const ledgerRows = Array.isArray(ledger.json) ? ledger.json : [];
  const fakeBaseRows = ledgerRows.filter(
    (row) => row.type === "BASE_CONTRACT" && !isTrustedBaseContractRow(row)
  );
  const trustedBaseRows = ledgerRows.filter(isTrustedBaseContractRow);
  const voRows = ledgerRows.filter((row) => row.type !== "BASE_CONTRACT");

  assert(fakeBaseRows.length === 0, `Found ${fakeBaseRows.length} untrusted BASE_CONTRACT rows`);
  assert(
    ledgerRows.every((row) => row.vat_rate == null || Number(row.vat_rate) === 0.18),
    "pricing_ledger contains rows with VAT rate different from 18%"
  );

  if (requireLiveData) {
    assert(counts.projects > 0, "Live financial verification requires at least one real project");
    assert(
      trustedBaseRows.length > 0,
      projectIdFilter
        ? `Project ${projectIdFilter} has no trusted BOQ BASE_CONTRACT rows`
        : "Live financial verification requires trusted BOQ BASE_CONTRACT rows"
    );
  }

  console.log("Remote financial state verified.");
  console.log(
    JSON.stringify(
      {
        mode: requireLiveData ? "live-data-required" : "schema-and-guardrails",
        projectId: projectIdFilter || null,
        tables: counts,
        pricingLedger: {
          totalRows: ledgerRows.length,
          trustedBaseRows: trustedBaseRows.length,
          variationRows: voRows.length,
          untrustedBaseRows: fakeBaseRows.length,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
