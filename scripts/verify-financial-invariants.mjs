import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(file, needle, message) {
  const text = read(file);
  assert(text.includes(needle), `${file}: ${message}`);
}

function assertNotIncludes(file, needle, message) {
  const text = read(file);
  assert(!text.includes(needle), `${file}: ${message}`);
}

function assertRegex(file, regex, message) {
  const text = read(file);
  assert(regex.test(text), `${file}: ${message}`);
}

function assertSectionNotIncludes(file, startNeedle, endNeedle, forbiddenNeedle, message) {
  const text = read(file);
  const startIndex = text.indexOf(startNeedle);
  assert(startIndex !== -1, `${file}: section start not found: ${startNeedle}`);

  const endIndex = text.indexOf(endNeedle, startIndex);
  assert(endIndex !== -1, `${file}: section end not found: ${endNeedle}`);

  const section = text.slice(startIndex, endIndex);
  assert(!section.includes(forbiddenNeedle), `${file}: ${message}`);
}

function assertSectionIncludes(file, startNeedle, endNeedle, requiredNeedle, message) {
  const text = read(file);
  const startIndex = text.indexOf(startNeedle);
  assert(startIndex !== -1, `${file}: section start not found: ${startNeedle}`);

  const endIndex = text.indexOf(endNeedle, startIndex);
  assert(endIndex !== -1, `${file}: section end not found: ${endNeedle}`);

  const section = text.slice(startIndex, endIndex);
  assert(section.includes(requiredNeedle), `${file}: ${message}`);
}

let tsPathAliasRequireHookInstalled = false;

function installTsPathAliasRequireHook() {
  if (tsPathAliasRequireHookInstalled) {
    return;
  }

  const Module = require("node:module");
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const absoluteRequest = path.join(root, "src", request.slice(2));
      return originalResolveFilename.call(this, absoluteRequest, parent, isMain, options);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  tsPathAliasRequireHookInstalled = true;
}

function installTypeScriptRequireHook() {
  const ts = require("typescript");
  installTsPathAliasRequireHook();

  if (require.extensions[".ts"]) {
    return;
  }

  require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;

    module._compile(output, filename);
  };
}

assertIncludes(
  ".gitignore",
  "/output/playwright/",
  "runtime Playwright artifacts must stay out of Git commits"
);
assertIncludes(
  "package.json",
  "\"verify:runtime-smoke\": \"node scripts/verify-runtime-smoke.mjs\"",
  "runtime smoke verification must be available as an npm script"
);
assertIncludes(
  "package.json",
  "\"read-excel-file\":",
  "pricing uploads must use the safer focused XLSX reader"
);
assertNotIncludes(
  "package.json",
  "\"xlsx\":",
  "legacy xlsx dependency must not return to production dependencies"
);
assertIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "import readExcelFile, { type Row } from 'read-excel-file/browser'",
  "pricelist XLSX uploads must use the browser XLSX reader"
);
assertNotIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "import * as xlsx from 'xlsx'",
  "pricelist uploads must not import legacy xlsx"
);
assertNotIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "readAsBinaryString(file)",
  "pricelist uploads must not use legacy binary-string XLSX parsing"
);
assertIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "const sheets = await readExcelFile(file)",
  "pricelist XLSX uploads must read every workbook sheet, not only the first sheet"
);
assertIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "sheets.flatMap(({ sheet, data })",
  "pricelist XLSX uploads must merge rows from all sheets"
);
assertIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  ".select('id', { count: 'exact', head: true })",
  "pricelist list counts must use exact count queries instead of embedded row payloads"
);
assertIncludes(
  "supabase/migrations/20260704170000_pricelist_global_rls.sql",
  "Users can select own and global pricelists",
  "global pricelists must be readable through RLS"
);
assertIncludes(
  "supabase/migrations/20260704170000_pricelist_global_rls.sql",
  "Users can select own and global pricelist items",
  "global pricelist items must be readable through RLS"
);
assertIncludes(
  "supabase/migrations/20260704170000_pricelist_global_rls.sql",
  "FOR INSERT",
  "global pricelist RLS migration must keep write policies explicit"
);
assertIncludes(
  "supabase/migrations/20260704170000_pricelist_global_rls.sql",
  "AND is_global IS NOT TRUE",
  "non-admin pricelist writes must not be able to create global pricelists"
);
assert(fileExists("supabase/migrations/20260705090000_restrict_global_pricelist_writes.sql"), "corrective global pricelist write migration must exist");
assertIncludes(
  "supabase/migrations/20260705090000_restrict_global_pricelist_writes.sql",
  "AND is_global IS NOT TRUE",
  "corrective migration must block non-admin global pricelist writes"
);
assertIncludes(
  "supabase/migrations/20260705090000_restrict_global_pricelist_writes.sql",
  "AND pricelists.is_global IS NOT TRUE",
  "corrective migration must block non-admin item writes into global pricelists"
);
assertIncludes(
  "package.json",
  "\"verify:runtime-pricing\": \"node scripts/verify-runtime-pricing.mjs\"",
  "strict authenticated pricing runtime verification must be available as an npm script"
);
assertIncludes(
  "README.md",
  "npm run verify:runtime-pricing",
  "README must document the strict authenticated Pricing UI runtime check"
);
assertIncludes(
  "README.md",
  "VERIFY_RUNTIME_LOGIN_EMAIL",
  "README must document login-based authenticated Pricing UI verification"
);
assertIncludes(
  "README.md",
  "VERIFY_RUNTIME_COOKIE_FILE",
  "README must document cookie-file based authenticated Pricing UI verification"
);
assertIncludes(
  "README.md",
  "Files matching `.runtime-cookie*` are ignored by Git.",
  "README must document that local runtime cookie files are ignored"
);
assertIncludes(
  "package.json",
  "\"verify:boq-scale\": \"node scripts/verify-enterprise-boq-scale.mjs\"",
  "enterprise BOQ scale and AI automation verification must be available as an npm script"
);
assertIncludes(
  "package.json",
  "\"verify:goal-readiness\": \"node scripts/verify-enterprise-goal-readiness.mjs\"",
  "enterprise goal readiness audit must be available as an npm script"
);
assertIncludes(
  "scripts/verify-enterprise-goal-readiness.mjs",
  "Authenticated Pricing UI runtime evidence is missing.",
  "enterprise goal readiness audit must refuse completion without authenticated Pricing UI evidence"
);
assertIncludes(
  "scripts/verify-enterprise-goal-readiness.mjs",
  "run(\"npm\", [\"run\", \"verify:boq-scale\"])",
  "enterprise goal readiness audit must include BOQ scale verification"
);
assertIncludes(
  "scripts/verify-enterprise-goal-readiness.mjs",
  "run(\"npm\", [\"run\", \"verify:financials\"])",
  "enterprise goal readiness audit must include financial invariant verification"
);
assertIncludes(
  "scripts/verify-enterprise-goal-readiness.mjs",
  "run(\"npx\", [\"tsc\", \"--noEmit\"])",
  "enterprise goal readiness audit must include TypeScript verification"
);
assertIncludes(
  "scripts/verify-enterprise-boq-scale.mjs",
  "Enterprise BOQ scale and AI automation invariants verified.",
  "enterprise BOQ scale verification must have an explicit success signal"
);
assertIncludes(
  "scripts/verify-enterprise-boq-scale.mjs",
  "confidence preview service must enforce Confidence > 90% server-side",
  "enterprise BOQ scale verification must protect server-side smart approval confidence gates"
);
assertIncludes(
  "scripts/verify-enterprise-boq-scale.mjs",
  "ledger table must virtualize massive BOQ row sets at 500+ rows",
  "enterprise BOQ scale verification must protect ledger virtualization"
);
assertIncludes(
  "scripts/verify-runtime-pricing.mjs",
  "process.env.VERIFY_RUNTIME_REQUIRE_AUTHENTICATED_PRICING = \"1\"",
  "strict pricing runtime wrapper must force authenticated pricing verification"
);
assertIncludes(
  "scripts/verify-runtime-pricing.mjs",
  "await import(\"./verify-runtime-smoke.mjs\")",
  "strict pricing runtime wrapper must reuse the canonical runtime smoke checks"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "redirect: \"manual\"",
  "runtime smoke must verify redirects without following them implicitly"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "isRedirectToLogin(pricingResponse)",
  "runtime smoke must prove unauthorized pricing routes redirect to login"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "process.env.VERIFY_RUNTIME_PRICING_PROJECT_ID",
  "runtime smoke must support optional authenticated pricing UI verification"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "process.env.VERIFY_RUNTIME_COOKIE",
  "runtime smoke must accept authenticated session data only through env"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "process.env.VERIFY_RUNTIME_COOKIE_FILE",
  "runtime smoke must support authenticated session data through an ignored local cookie file"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "process.env.VERIFY_RUNTIME_LOGIN_EMAIL",
  "runtime smoke must support optional authenticated pricing login without hardcoded credentials"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "process.env.VERIFY_RUNTIME_LOGIN_PASSWORD",
  "runtime smoke must support optional authenticated pricing login password through env only"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "createServerClient(supabaseUrl, supabaseAnonKey",
  "runtime smoke login must use Supabase SSR cookie generation for page authentication"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  ".from(\"projects\")",
  "runtime smoke login must be able to discover an owned project for authenticated pricing UI verification"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  ".eq(\"contractor_id\", data.user.id)",
  "runtime smoke project discovery must stay scoped to the logged-in contractor"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  ".limit(1)",
  "runtime smoke project discovery must fetch only one owned project"
);
assertIncludes(
  ".gitignore",
  ".runtime-cookie*",
  "runtime smoke local cookie files must stay out of Git commits"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "process.env.VERIFY_RUNTIME_REQUIRE_AUTHENTICATED_PRICING",
  "runtime smoke must support a strict mode for authenticated pricing UI verification"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "function hasPotentialAuthenticatedSessionEvidence()",
  "strict authenticated pricing smoke must preflight required session evidence before runtime requests"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "if (requireAuthenticatedPricing && !hasPotentialAuthenticatedSessionEvidence())",
  "strict authenticated pricing smoke must fail closed before runtime requests when session evidence is missing"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "Authenticated pricing runtime smoke requires session evidence via VERIFY_RUNTIME_COOKIE, VERIFY_RUNTIME_COOKIE_FILE, or VERIFY_RUNTIME_LOGIN_EMAIL/PASSWORD, plus VERIFY_RUNTIME_PRICING_PROJECT_ID unless login env can read an owned project",
  "strict authenticated pricing smoke must fail when required session evidence is missing"
);
assertNotIncludes(
  "scripts/verify-runtime-smoke.mjs",
  ".insert(",
  "runtime smoke project discovery must remain read-only"
);
assertNotIncludes(
  "scripts/verify-runtime-smoke.mjs",
  ".update(",
  "runtime smoke project discovery must not update data"
);
assertNotIncludes(
  "scripts/verify-runtime-smoke.mjs",
  ".delete(",
  "runtime smoke project discovery must not delete data"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "Authenticated pricing runtime smoke skipped",
  "runtime smoke must report when authenticated pricing UI verification was skipped"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "with authenticated pricing UI",
  "runtime smoke success output must distinguish real authenticated pricing UI coverage"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "headers: {\n      cookie: authenticatedCookie,",
  "runtime smoke must send the optional auth cookie only as an HTTP header"
);
assertIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "!authenticatedPricingHtml.includes(\"example@contractor.com\")",
  "runtime smoke authenticated pricing check must fail if it receives the login form"
);
assertNotIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "method: \"POST\"",
  "runtime smoke must stay read-only and must not mutate project data"
);
assertNotIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "console.log(authenticatedCookie)",
  "runtime smoke must not print session cookies"
);
assertNotIncludes(
  "scripts/verify-runtime-smoke.mjs",
  "console.log(password)",
  "runtime smoke must not print login passwords"
);

function createFakeSupabase(initialTables) {
  const tables = new Map(
    Object.entries(initialTables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );

  let nextId = 1;

  function getRows(table) {
    if (!tables.has(table)) {
      tables.set(table, []);
    }

    return tables.get(table);
  }

  function matches(row, filter) {
    if (filter.kind === "eq") {
      return row[filter.column] === filter.value;
    }

    if (filter.kind === "in") {
      return filter.values.includes(row[filter.column]);
    }

    return true;
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.action = "select";
      this.payload = null;
    }

    select() {
      this.action = "select";
      return this;
    }

    eq(column, value) {
      this.filters.push({ kind: "eq", column, value });
      return this;
    }

    in(column, values) {
      this.filters.push({ kind: "in", column, values });
      return this;
    }

    update(payload) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    insert(payload) {
      this.action = "insert";
      this.payload = Array.isArray(payload) ? payload : [payload];
      return this;
    }

    then(resolve, reject) {
      try {
        resolve(this.execute());
      } catch (error) {
        reject(error);
      }
    }

    execute() {
      const rows = getRows(this.table);
      const selectedRows = rows.filter((row) => this.filters.every((filter) => matches(row, filter)));

      if (this.action === "select") {
        return { data: selectedRows.map((row) => ({ ...row })), error: null };
      }

      if (this.action === "update") {
        for (const row of selectedRows) {
          Object.assign(row, this.payload);
        }

        return { data: selectedRows.map((row) => ({ ...row })), error: null };
      }

      if (this.action === "insert") {
        for (const row of this.payload) {
          rows.push({ id: row.id || `fake-${nextId++}`, ...row });
        }

        return { data: null, error: null };
      }

      return { data: null, error: null };
    }
  }

  return {
    from(table) {
      return new Query(table);
    },
    table(name) {
      return getRows(name);
    },
  };
}

async function verifyContractBoqLedgerSyncBehavior() {
  installTypeScriptRequireHook();
  const { syncContractBoqToLedger } = require(path.join(root, "src/utils/pricing-ledger-contract-sync.ts"));

  const supabase = createFakeSupabase({
    pricelists: [
      {
        id: "pl-contract",
        name: "Project BOQ contract",
        description: "כתב כמויות לביצוע",
        is_global: false,
        project_id: "project-1",
      },
      {
        id: "pl-global",
        name: "Global Dekel",
        description: "reference prices",
        is_global: true,
        project_id: "project-1",
      },
    ],
    pricelist_items: [
      {
        id: "item-1",
        pricelist_id: "pl-contract",
        item_type: "ITEM",
        item_code: "01.001",
        description: "Concrete works",
        unit: "m3",
        quantity: 2,
        rate: 100,
      },
      {
        id: "item-2",
        pricelist_id: "pl-contract",
        item_type: "ITEM",
        item_code: "01.002",
        description: "Steel works",
        unit: "kg",
        quantity: "3",
        rate: "250.125",
      },
      {
        id: "item-3",
        pricelist_id: "pl-contract",
        item_type: "ITEM",
        item_code: "01.001",
        description: "Concrete works duplicate BOQ line",
        unit: "m3",
        quantity: 4,
        rate: 10,
      },
      {
        id: "chapter-1",
        pricelist_id: "pl-contract",
        item_type: "CHAPTER",
        item_code: "01",
        description: "Chapter",
        quantity: 0,
        rate: 0,
      },
      {
        id: "note-1",
        pricelist_id: "pl-contract",
        item_type: "NOTE",
        item_code: "note",
        description: "Parser note must not become a contract row",
        quantity: 0,
        rate: 0,
      },
      {
        id: "global-item",
        pricelist_id: "pl-global",
        item_type: "ITEM",
        item_code: "99.001",
        description: "Global item must not sync",
        unit: "unit",
        quantity: 1,
        rate: 999,
      },
    ],
    pricing_ledger: [],
  });

  const firstSync = await syncContractBoqToLedger(supabase, "project-1");
  assert(firstSync.eligiblePricelists === 1, "contract sync must ignore global pricelists");
  assert(firstSync.candidateItems === 3, "contract sync must normalize only priced ITEM rows");
  assert(firstSync.inserted === 3, "contract sync must insert trusted BASE_CONTRACT rows");

  const ledgerRows = supabase.table("pricing_ledger");
  assert(ledgerRows.length === 3, "contract sync must not insert chapter/global rows");
  assert(
    ledgerRows.every((row) => row.type === "BASE_CONTRACT" && row.source === "BOQ"),
    "contract sync rows must be trusted BASE_CONTRACT/BOQ rows"
  );
  assert(
    ledgerRows.every((row) => row.evidence_data?.source === "pricelist_items" && row.evidence_data?.pricelist_item_id),
    "contract sync rows must be traceable to concrete pricelist_items rows"
  );
  assert(
    ledgerRows.every((row) => row.vat_rate === 0.18),
    "contract sync must store VAT rate separately as 18%"
  );
  assert(
    ledgerRows.find((row) => row.item_code === "01.002")?.unit_price_excl_vat === 250.13,
    "contract sync must round unit prices to two decimals"
  );
  assert(
    ledgerRows.filter((row) => row.item_code === "01.001").length === 2,
    "contract sync must preserve duplicate BOQ item codes as separate source rows"
  );

  supabase.table("pricelist_items").find((row) => row.id === "item-1").rate = 125;
  const secondSync = await syncContractBoqToLedger(supabase, "project-1", {
    pricelistIds: ["pl-contract"],
    forceContractBoq: true,
  });

  assert(secondSync.inserted === 0, "contract sync must be idempotent for existing item codes");
  assert(secondSync.updated === 3, "contract sync must update existing BOQ base rows");
  assert(supabase.table("pricing_ledger").length === 3, "contract sync must not duplicate ledger rows");
  assert(
    supabase.table("pricing_ledger").find((row) => row.item_code === "01.001")?.unit_price_excl_vat === 125,
    "contract sync must update changed unit prices"
  );
}

function verifyProjectFinancialHelperBehavior() {
  installTypeScriptRequireHook();
  const {
    getBaseContractAmount,
    getPreferredProjectAmount,
    getVariationOrderAmount,
    isVisibleLedgerRow,
    getLedgerRowVatAmount,
    getLedgerRowTotalInclVat,
    getAmountVat,
    getAmountInclVat,
    getMoneySum,
  } = require(path.join(root, "src/utils/project-financials.ts"));

  const ledgerRows = [
    {
      type: "BASE_CONTRACT",
      source: "BOQ",
      quantity: 2,
      unit_price_excl_vat: 100,
      total_price_excl_vat: 999,
      vat_rate: 0.18,
      evidence_data: { source: "pricelist_items", pricelist_item_id: "item-1" },
    },
    {
      type: "BASE_CONTRACT",
      source: "BOQ",
      quantity: 100,
      unit_price_excl_vat: 100,
      vat_rate: 0.18,
    },
    {
      type: "BASE_CONTRACT",
      source: "DEKEL",
      quantity: 1000,
      unit_price_excl_vat: 1000,
      vat_rate: 0.18,
    },
    {
      type: "BASE_CONTRACT",
      source: "CUSTOM_ANALYSIS",
      total_price_excl_vat: 11000000,
      vat_rate: 0.18,
    },
    {
      type: "PENDING_VO",
      source: "BOQ",
      quantity: 3,
      unit_price_excl_vat: 50,
      vat_rate: 0.18,
    },
    {
      type: "PENDING_VO",
      source: "CUSTOM_ANALYSIS",
      quantity: 3,
      unit_price_excl_vat: 33.333,
      vat_rate: 0.18,
    },
  ];

  assert(getBaseContractAmount(ledgerRows) === 200, "base contract amount must trust only BOQ quantity and unit price");
  assert(getPreferredProjectAmount(999, ledgerRows) === 200, "BOQ base amount must override manual project budget");
  assert(getVariationOrderAmount(ledgerRows) === 250, "VO amount must stay separate from base contract");
  assert(!isVisibleLedgerRow(ledgerRows[1]), "non-BOQ BASE_CONTRACT rows must be hidden");
  assert(!isVisibleLedgerRow(ledgerRows[2]), "non-BOQ BASE_CONTRACT rows must be hidden");
  assert(!isVisibleLedgerRow(ledgerRows[3]), "CUSTOM_ANALYSIS BASE_CONTRACT rows must be hidden");
  assert(getLedgerRowVatAmount(ledgerRows[4], 0.18) === 27, "VO VAT must be calculated separately at 18%");
  assert(getLedgerRowTotalInclVat(ledgerRows[4], 0.18) === 177, "VO gross total must be base plus separate VAT");
  assert(getLedgerRowVatAmount(ledgerRows[5], 0.18) === 18, "money helper must round VAT to two decimals");
  assert(getLedgerRowTotalInclVat(ledgerRows[5], 0.18) === 118, "money helper must round gross totals to two decimals");
  assert(getAmountVat(100.005, 0.18) === 18, "amount VAT helper must round VAT to two decimals");
  assert(getAmountInclVat(100.005, 0.18) === 118.01, "amount gross helper must round gross totals to two decimals");
  assert(getMoneySum([0.105, 0.105]) === 0.22, "money sum helper must round cumulative totals to two decimals");
}

function verifyServerLetterEvidenceBehavior() {
  installTypeScriptRequireHook();
  const {
    buildServerBackedLetterEvidence,
    getOfficialLetterEvidenceBlockers,
  } = require(path.join(root, "src/utils/server-letter-evidence.ts"));

  const fakeLedgerItem = {
    id: "ledger-fake",
    evidence_data: {
      evidence_status: "VERIFIED",
      contract_quote: "client fake contract quote",
      work_quote: "client fake work quote",
    },
  };

  assert(
    getOfficialLetterEvidenceBlockers(fakeLedgerItem, null).includes("missing_server_contradiction"),
    "official letters must reject client/ledger-only fake evidence"
  );

  const verifiedServerContradiction = {
    id: "contradiction-1",
    status: "OPEN",
    source_execution_doc_id: "work-doc-1",
    target_contract_doc_id: "contract-doc-1",
    evidence_data: {
      evidence_status: "VERIFIED",
      contract_quote: "server contract quote",
      work_quote: "server work quote",
    },
  };

  const officialBlockers = getOfficialLetterEvidenceBlockers(
    {
      id: "ledger-verified",
      contradiction_id: "contradiction-1",
      evidence_data: fakeLedgerItem.evidence_data,
    },
    verifiedServerContradiction
  );

  assert(officialBlockers.length === 0, "official letters must allow verified server contradiction evidence");

  const evidenceForPrompt = buildServerBackedLetterEvidence(
    {
      id: "ledger-verified",
      contradiction_id: "contradiction-1",
      evidence_data: { pricing_evaluation: { match_quality: "HIGH" } },
    },
    verifiedServerContradiction
  );

  assert(
    evidenceForPrompt.contract_quote === "server contract quote",
    "letter evidence must use server contradiction quotes instead of ledger/client quotes"
  );
  assert(
    evidenceForPrompt.pricing_evaluation?.match_quality === "HIGH",
    "letter evidence may still include server-fetched ledger pricing context"
  );
}

function verifyServerDocumentAndLetterBoundaryStatics() {
  assertIncludes(
    "src/utils/server-letter-evidence.ts",
    "getOfficialLetterEvidenceBlockers",
    "official letter evidence gate must live in a shared server helper"
  );
  assertIncludes(
    "src/app/api/generate-letter/route.ts",
    "getOfficialLetterEvidenceBlockers",
    "letter generation must reject official VO without server-verified evidence"
  );
  assertIncludes(
    "src/app/api/generate-letter/route.ts",
    ".from(\"contradictions\")",
    "letter generation must load contradiction evidence from the server"
  );
  assertIncludes(
    "src/app/api/pricing/vo-letters/route.ts",
    "getOfficialLetterEvidenceBlockers",
    "official VO save must reject rows without server-verified evidence"
  );
  assertIncludes(
    "src/app/api/pricing/vo-letters/route.ts",
    "buildOfficialVoServerContent",
    "official VO save must build the persisted letter text on the server"
  );
  assertIncludes(
    "src/app/api/pricing/vo-letters/route.ts",
    "content: contentToStore",
    "official VO save must not persist raw client-provided content"
  );
  assertIncludes(
    "src/app/api/pricing/vo-letters/route.ts",
    "Client-provided letter text is not used for this official document.",
    "official VO saved content must document that client text is ignored"
  );
  assertIncludes(
    "src/app/api/documents/route.ts",
    "export async function POST",
    "document uploads must have a server-side entry point"
  );
  assertIncludes(
    "src/components/documents/DocumentsPageClient.tsx",
    "fetch('/api/documents'",
    "document page must upload through the server document API"
  );
  assertNotIncludes(
    "src/components/documents/DocumentsPageClient.tsx",
    ".from('documents')",
    "document page must not query document rows directly from the browser"
  );
  assertNotIncludes(
    "src/components/documents/DocumentsPageClient.tsx",
    "storage.from('documents')",
    "document page must not upload to private storage directly from the browser"
  );
  assertNotIncludes(
    "src/components/features/DocumentUpload.tsx",
    ".from('documents')",
    "legacy document uploader must not insert document rows directly from the browser"
  );
  assertNotIncludes(
    "src/components/features/DocumentUpload.tsx",
    ".storage",
    "legacy document uploader must not upload to storage directly from the browser"
  );
  assertIncludes(
    "src/app/api/documents/delete/route.ts",
    "const projectId = searchParams.get('projectId')",
    "document delete must require explicit project context"
  );
  assertIncludes(
    "src/app/api/documents/signed-url/route.ts",
    "requireOwnedProject(supabase, projectId)",
    "signed-url creation must verify project ownership"
  );
  assertIncludes(
    "src/app/api/documents/extract-text/route.ts",
    "requireOwnedProject(supabase, projectId)",
    "document text extraction must verify project ownership"
  );
  assertIncludes(
    "src/app/api/documents/validate/route.ts",
    "requireOwnedProject(supabase, projectId)",
    "document validation must verify project ownership"
  );
  assertIncludes(
    "src/app/api/documents/process/route.ts",
    ".update({ ai_status: 'ERROR' })",
    "document processing failures must persist ERROR status"
  );
}

function verifyProjectContractBaseBehavior() {
  installTypeScriptRequireHook();
  const { resolveProjectContractBase } = require(path.join(root, "src/utils/project-contract-base.ts"));

  const agreementResolution = resolveProjectContractBase([
    {
      title: "\u05D4\u05E1\u05DB\u05DD \u05D0",
      extracted_text: "\u05E1\u05DA \u05D4\u05DB\u05DC 100.10 \u05E1\u05D4\u05DB \u05DB\u05DC\u05DC\u05D9",
      parsed_json: { type: "\u05D7\u05D5\u05D6\u05D4" },
    },
    {
      title: "\u05D4\u05E1\u05DB\u05DD \u05D1",
      extracted_text: "\u05E1\u05DA \u05D4\u05DB\u05DC 0.20 \u05E1\u05D4\u05DB \u05DB\u05DC\u05DC\u05D9",
      parsed_json: { type: "\u05D7\u05D5\u05D6\u05D4" },
    },
  ]);

  assert(agreementResolution.strategy === "CONTRACT_SUM", "contract resolver must sum agreement documents only in agreement mode");
  assert(agreementResolution.amount === 100.3, "contract resolver must round cumulative agreement totals to two decimals");
}

async function verifyPricingLedgerAiAutomationBehavior() {
  installTypeScriptRequireHook();
  const {
    AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
    normalizeConfidenceScore,
    getPricingEvidenceConfidenceScore,
    formatConfidencePercent,
  } = require(path.join(root, "src/utils/pricing-confidence.ts"));
  const { normalizePricingQueueIds } = require(path.join(root, "src/utils/pricing-queue-ids.ts"));
  const { getQueueItemConfidenceScore } = require(path.join(root, "src/components/features/pricing-ledger/utils/aiConfidence.ts"));
  const { normalizeLedgerEvidenceData } = require(path.join(root, "src/app/api/pricing/save-ledger/ledger-evidence.ts"));
  const { normalizeSaveLedgerInput } = require(path.join(root, "src/app/api/pricing/save-ledger/ledger-input.ts"));
  const { buildLedgerMutationPayload } = require(path.join(root, "src/app/api/pricing/save-ledger/ledger-mutation-payload.ts"));
  const { BulkConfidencePreviewService } = require(path.join(
    root,
    "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts"
  ));

  assert(normalizeConfidenceScore(0.91) === 0.91, "confidence helper must accept normalized 0..1 values");
  assert(AI_BULK_APPROVE_CONFIDENCE_THRESHOLD === 0.9, "shared confidence helper must own the smart bulk approval threshold");
  assert(normalizeConfidenceScore(92) === 0.92, "confidence helper must normalize percent-like values");
  assert(normalizeConfidenceScore(-1) === null, "confidence helper must reject negative values");
  assert(formatConfidencePercent(0.925) === "93%", "confidence helper must format display percentages");
  assert(
    normalizePricingQueueIds([" a ", "a", "", " b "]).join("|") === "a|b",
    "pricing queue id helper must trim, drop empty ids, and deduplicate in insertion order"
  );
  assert(
    getPricingEvidenceConfidenceScore({ evidence_data: { pricing_evaluation: { confidence_score: 94 } } }) === 0.94,
    "shared confidence helper must read AI pricing metadata from evidence_data"
  );
  assert(
    getQueueItemConfidenceScore({ evidence_data: { pricing_evaluation: { confidence_score: 94 } } }) === 0.94,
    "queue confidence adapter must use shared AI pricing metadata logic"
  );
  const normalizedLedgerEvidenceData = normalizeLedgerEvidenceData({
    pricing_evaluation: {
      confidence: 94,
      source: "CUSTOM_ANALYSIS",
    },
  });
  assert(
    normalizedLedgerEvidenceData.pricing_evaluation.confidence_score === 0.94,
    "save-ledger evidence helper must normalize legacy confidence into explicit confidence_score"
  );
  const ledgerMutationPayload = buildLedgerMutationPayload({
    safeType: "PENDING_VO",
    safeSource: "CUSTOM_ANALYSIS",
    itemCode: "AI-1",
    safeDescription: "AI priced variation",
    unit: "",
    safeQuantity: 2,
    safeUnitPrice: 100,
    normalizedMarkupPercentage: 0.15,
    rationale: "reason",
    notes: ["note"],
    expertStrategy: { strategy: true },
    safeEvidenceData: normalizedLedgerEvidenceData,
    safeVatRate: 0.18,
  });
  assert(ledgerMutationPayload.type === "PENDING_VO", "save-ledger mutation helper must preserve ledger row type");
  assert(ledgerMutationPayload.source === "CUSTOM_ANALYSIS", "save-ledger mutation helper must preserve pricing source");
  assert(ledgerMutationPayload.quantity === 2, "save-ledger mutation helper must preserve normalized quantity");
  assert(ledgerMutationPayload.unit_price_excl_vat === 100, "save-ledger mutation helper must preserve VAT-exclusive unit price");
  assert(ledgerMutationPayload.markup_percentage === 0.15, "save-ledger mutation helper must preserve normalized markup");
  assert(
    ledgerMutationPayload.evidence_data.pricing_evaluation.confidence_score === 0.94,
    "save-ledger mutation helper must carry normalized AI confidence evidence"
  );
  const normalizedLedgerInput = normalizeSaveLedgerInput({
    quantity: 2,
    unit_price_excl_vat: 100,
    description: "AI priced variation",
    type: "BASE_CONTRACT",
    evidence_data: {
      pricing_evaluation: {
        confidence: 94,
      },
    },
  });
  assert(normalizedLedgerInput.ok === true, "save-ledger input helper must accept complete manual ledger payloads");
  assert(
    normalizedLedgerInput.value.ledgerMutationPayload.type === "PENDING_VO",
    "save-ledger input helper must downgrade manual BASE_CONTRACT saves to PENDING_VO"
  );
  assert(
    normalizedLedgerInput.value.ledgerMutationPayload.evidence_data.pricing_evaluation.confidence_score === 0.94,
    "save-ledger input helper must normalize AI confidence evidence before persistence"
  );
  assert(
    normalizeSaveLedgerInput({ quantity: 0, unit_price_excl_vat: 100, description: "bad quantity" }).error ===
      "quantity must be a positive number",
    "save-ledger input helper must reject non-positive quantities"
  );
  assert(
    normalizeSaveLedgerInput({ quantity: 1, description: "missing price" }).error === "unit_price_excl_vat is required",
    "save-ledger input helper must require explicit pre-VAT unit price"
  );
  assert(
    normalizeSaveLedgerInput({ quantity: 1, unit_price_excl_vat: 100, description: "" }).error ===
      "description is required before saving a ledger item",
    "save-ledger input helper must require a meaningful description"
  );

  let emptyPreviewQueryCount = 0;
  const emptyPreviewService = new BulkConfidencePreviewService({
    from() {
      emptyPreviewQueryCount += 1;
      return {};
    },
  });
  const emptyPreviewResult = await emptyPreviewService.previewHighConfidenceItems({
    projectId: "project-1",
    requestedIds: ["", "   "],
  });
  assert(emptyPreviewQueryCount === 0, "bulk confidence preview service must not query Supabase for empty normalized ids");
  assert(emptyPreviewResult.stagedIds.length === 0, "bulk confidence preview empty-id result must not stage ids");
  assert(emptyPreviewResult.approvedIds.length === 0, "bulk confidence preview empty-id result must preserve the legacy alias");
  assert(emptyPreviewResult.skippedIds.length === 0, "bulk confidence preview empty-id result must not invent skipped ids");

  const queryLog = [];
  const previewService = new BulkConfidencePreviewService({
    from(table) {
      queryLog.push({ step: "from", table });
      return {
        select(columns) {
          queryLog.push({ step: "select", columns });
          return this;
        },
        eq(column, value) {
          queryLog.push({ step: "eq", column, value });
          return this;
        },
        in(column, ids) {
          queryLog.push({ step: "in", column, ids });
          return {
            data: [
              { id: "a", evidence_data: { pricing_evaluation: { confidence_score: 91 } } },
              { id: "b", evidence_data: { pricing_evaluation: { confidence_score: 0.9 } } },
              { id: "c", evidence_data: { pricing_evaluation: { confidence_score: 0.95 } } },
            ],
            error: null,
          };
        },
      };
    },
  });
  const previewResult = await previewService.previewHighConfidenceItems({
    projectId: "project-1",
    requestedIds: [" a ", "a", "b", " missing ", "c", ""],
  });
  const inQuery = queryLog.find((entry) => entry.step === "in");
  assert(inQuery?.ids.join("|") === "a|b|missing|c", "bulk confidence preview service must query trimmed unique ids");
  assert(previewResult.stagedIds.join("|") === "a|c", "bulk confidence preview service must stage only ids above 90% confidence");
  assert(previewResult.approvedIds.join("|") === "a|c", "bulk confidence preview service must preserve staged ids in the legacy alias");
  assert(previewResult.skippedIds.join("|") === "b|missing", "bulk confidence preview service must report low-confidence and missing ids as skipped");
}

function verifyPricingAiRouteModularizationBehavior() {
  installTypeScriptRequireHook();
  const {
    DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS,
    filterPricingQuestions,
    normalizeConfidence,
    normalizePricingEvaluation,
    normalizePositiveMoney,
    normalizePositiveQuantity,
    looksLikeLumpSumUnit,
  } = require(path.join(root, "src/app/api/pricing/evaluate-ai/evaluation-normalizers.ts"));

  assert(normalizeConfidence(94) === 0.94, "AI evaluation normalizer must convert percent confidence to ratios");
  assert(normalizePositiveMoney(100.005) === 100.01, "AI evaluation normalizer must round money to two decimals");
  assert(normalizePositiveQuantity(0, 7) === 7, "AI evaluation normalizer must reject non-positive quantities");
  assert(looksLikeLumpSumUnit("ls"), "AI evaluation normalizer must recognize lump-sum units");
  assert(
    filterPricingQuestions(["\u05d0\u05d9\u05e9\u05d5\u05e8 \u05d1\u05d9\u05e9\u05d9\u05d1\u05d4", "\u05de\u05d4 \u05d4\u05db\u05de\u05d5\u05ea?"], 3).length === 1,
    "AI evaluation normalizer must keep amount-changing questions and filter approval-only questions"
  );
  assert(
    DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS.zeroMatchQuestions.length === 3,
    "AI evaluation default text fallbacks must provide targeted zero-match quantity questions"
  );
  const normalizedDraft = normalizePricingEvaluation(
    {
      confidence: 98,
      suggested_unit_price_excl_vat: 123.456,
      suggested_quantity: 1,
      suggested_unit: "m",
      needed_documents: [],
      questions: [],
      ancillary_notes: [],
      quantity_basis: "UNKNOWN",
    },
    {
      hasSourceMatches: false,
      textFallbacks: {
        zeroMatchWithDraftPrice: "draft",
        zeroMatchWithoutDraftPrice: "no draft",
        zeroMatchQuestions: ["quantity?"],
        quantityReviewQuestion: "review quantity",
      },
    }
  );
  assert(normalizedDraft.source === "CUSTOM_ANALYSIS", "AI evaluation normalizer must force CUSTOM_ANALYSIS on zero-match");
  assert(normalizedDraft.match_quality === "ZERO_MATCH", "AI evaluation normalizer must force ZERO_MATCH on zero-match");
  assert(normalizedDraft.confidence === 0.6, "AI evaluation normalizer must cap confident zero-match drafts");
  assert(normalizedDraft.suggested_unit_price_excl_vat === 123.46, "AI evaluation normalizer must round suggested prices excluding VAT");
  assert(normalizedDraft.quantity_review_required === true, "AI evaluation normalizer must require review for estimated non-lump-sum quantity");
  assert(normalizedDraft.questions.includes("review quantity"), "AI evaluation normalizer must ask for quantity review when needed");
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "from './evaluation-normalizers'",
    "AI estimator service must import normalization from an isolated module"
  );
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "normalizePricingEvaluation(evaluation",
    "AI estimator service must delegate response normalization to the isolated module"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "function normalizeConfidence(",
    "AI evaluation route must not keep confidence normalization inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "evaluation.confidence = normalizeConfidence(evaluation.confidence)",
    "AI evaluation route must not keep response normalization inline"
  );

  const {
    buildExpertPrompt,
    buildKeywordPrompt,
    buildPricingPrompt,
  } = require(path.join(root, "src/app/api/pricing/evaluate-ai/evaluation-prompts.ts"));
  const {
    buildBoqContext,
    buildBoqRawContext,
    buildMatchedItems,
    MAX_BOQ_RAW_CONTEXT_CHARS,
    MAX_BOQ_RAW_CONTEXT_DOCS,
    buildPricelistContext,
    buildPricingEvidenceData,
    buildSourceTrace,
    hasSourceMatches,
  } = require(path.join(root, "src/app/api/pricing/evaluate-ai/evaluation-context.ts"));
  const { extractPricingKeywords } = require(path.join(root, "src/app/api/pricing/evaluate-ai/evaluation-keywords.ts"));
  const {
    appendUniqueParentNotes,
    buildParentItemCodePrefixes,
    buildParentNoteOrFilter,
    filterExternalPricingReferences,
    isExternalPricingReference,
  } = require(path.join(root, "src/app/api/pricing/evaluate-ai/evaluation-pricelists.ts"));
  assert(
    extractPricingKeywords("pipe, concrete, asphalt", "fallback title").join("|") === "pipe|concrete|asphalt|fallback|title",
    "AI evaluation keyword extractor must merge Gemini keywords with contradiction fallback text"
  );
  assert(
    extractPricingKeywords("", "fallback title words").join("|") === "fallback|title|words",
    "AI evaluation keyword extractor must fallback to contradiction title"
  );
  assert(
    extractPricingKeywords("", "\u05E4\u05D9\u05E8\u05D5\u05E7 \u05D5\u05D4\u05E8\u05DB\u05D1\u05D4 \u05DE\u05D7\u05D3\u05E9").includes("\u05D4\u05EA\u05E7\u05E0\u05D4"),
    "AI evaluation keyword extractor must expand construction pricing synonyms"
  );
  assert(
    isExternalPricingReference({ pricelists: { is_global: true, name: "Dekel" } }) === true,
    "AI evaluation pricelist filter must always allow global external references"
  );
  assert(
    isExternalPricingReference({ pricelists: { is_global: false, name: "\u05DB\u05EA\u05D1 \u05DB\u05DE\u05D5\u05D9\u05D5\u05EA \u05DC\u05D1\u05D9\u05E6\u05D5\u05E2", description: "\u05D7\u05D5\u05D6\u05D4" } }) === false,
    "AI evaluation pricelist filter must reject local contract BOQ references"
  );
  assert(
    filterExternalPricingReferences([
      { id: "contract", pricelists: { is_global: false, name: "BOQ contract" } },
      { id: "dekel", pricelists: { is_global: true, name: "Dekel" } },
    ]).map((item) => item.id).join("|") === "dekel",
    "AI evaluation pricelist filter must keep only external pricing references"
  );
  const parentPrefixes = buildParentItemCodePrefixes([{ item_code: "01.02.03.004" }]);
  assert(parentPrefixes.has("01") && parentPrefixes.has("01.02") && parentPrefixes.has("01.02.03"), "AI evaluation parent prefix builder must preserve hierarchy levels");
  assert(buildParentNoteOrFilter(parentPrefixes).includes("item_code.ilike.01.02%"), "AI evaluation parent note filter must produce Supabase ilike filters");
  const mergedParentNotes = [{ id: "item", pricelists: { is_global: true, name: "Dekel" } }];
  appendUniqueParentNotes(mergedParentNotes, [
    { id: "item", pricelists: { is_global: true, name: "Dekel" } },
    { id: "note", pricelists: { is_global: true, name: "Dekel" } },
    { id: "contract-note", pricelists: { is_global: false, name: "BOQ contract" } },
  ]);
  assert(mergedParentNotes.map((item) => item.id).join("|") === "item|note", "AI evaluation parent note merger must append unique external notes only");
  assert(
    buildKeywordPrompt({ title: "title", description: "description" }).includes("title"),
    "AI evaluation keyword prompt builder must include contradiction title"
  );
  assert(
    buildBoqContext([{ item_code: "01.001", description: "work", unit_price_excl_vat: 100, unit: "m" }]).includes("[CONTRACT ITEM]"),
    "AI evaluation BOQ context builder must keep contract items separate"
  );
  assert(MAX_BOQ_RAW_CONTEXT_CHARS === 12000, "AI evaluation raw BOQ context must have a stable prompt-size budget");
  assert(MAX_BOQ_RAW_CONTEXT_DOCS === 8, "AI evaluation raw BOQ context must cap the number of BOQ documents sent to the prompt");
  const cappedBoqRawContext = buildBoqRawContext([
    { title: "large boq", parsed_json: { text: "x".repeat(MAX_BOQ_RAW_CONTEXT_CHARS + 1000) } },
    { title: "second boq", parsed_json: { text: "second" } },
  ]);
  assert(
    cappedBoqRawContext.length <= MAX_BOQ_RAW_CONTEXT_CHARS + 16,
    "AI evaluation raw BOQ context builder must cap oversized parsed_json prompt context"
  );
  assert(
    cappedBoqRawContext.includes("[TRUNCATED BOQ]"),
    "AI evaluation raw BOQ context builder must mark truncated parsed_json context"
  );
  assert(
    buildBoqRawContext(Array.from({ length: MAX_BOQ_RAW_CONTEXT_DOCS + 2 }, (_, i) => ({
      title: `doc-${i}`,
      parsed_json: { value: i },
    }))).includes(`doc-${MAX_BOQ_RAW_CONTEXT_DOCS - 1}`),
    "AI evaluation raw BOQ context builder must include documents up to the configured cap"
  );
  assert(
    !buildBoqRawContext(Array.from({ length: MAX_BOQ_RAW_CONTEXT_DOCS + 2 }, (_, i) => ({
      title: `doc-${i}`,
      parsed_json: { value: i },
    }))).includes(`doc-${MAX_BOQ_RAW_CONTEXT_DOCS}`),
    "AI evaluation raw BOQ context builder must exclude documents beyond the configured cap"
  );
  assert(
    buildPricelistContext([
      { item_type: "ITEM", item_code: "02.001", description: "external", rate: 200, unit: "m", pricelists: { name: "Dekel" } },
      { item_type: "NOTE", item_code: "02", description: "note", pricelists: { name: "Dekel" } },
    ]).includes("[GOVERNING NOTE]"),
    "AI evaluation pricelist context builder must preserve governing notes"
  );
  assert(hasSourceMatches([], [{ item_type: "ITEM" }]) === true, "AI evaluation source detector must recognize external item matches");
  assert(buildSourceTrace([{ id: "contract" }], [{ item_type: "ITEM" }, { item_type: "NOTE" }], ["pipe"]).governing_note_matches === 1, "AI evaluation source trace must count governing notes");
  assert(buildMatchedItems([{ id: "contract" }], Array.from({ length: 12 }, (_, i) => ({ id: i, item_type: "ITEM" }))).pricelist.length === 10, "AI evaluation matched items must cap returned external matches");
  const pricingPrompt = buildPricingPrompt({
    contradiction: { title: "title", description: "description", evidence_data: { source: "test" } },
    boqContext: "[CONTRACT ITEM]",
    boqRawContext: "raw BOQ",
    pricelistContext: "[EXTERNAL ITEM]",
  });
  assert(pricingPrompt.includes("VAT COMPLIANCE"), "AI evaluation pricing prompt must preserve VAT compliance instructions");
  assert(pricingPrompt.includes("EXCLUDING VAT"), "AI evaluation pricing prompt must preserve excluding-VAT instruction");
  assert(pricingPrompt.includes("CUSTOM_ANALYSIS"), "AI evaluation pricing prompt must preserve custom-analysis source option");
  assert(pricingPrompt.includes("quantity_basis"), "AI evaluation pricing prompt must preserve quantity basis output contract");
  assert(
    buildExpertPrompt({
      strategyPrompt: "strategy",
      contradiction: { title: "title", evidence_data: { source: "test" } },
      evaluation: { suggested_unit_price_excl_vat: 1, suggested_unit: "m", ai_rationale: "reason" },
    }).includes("strategy"),
    "AI evaluation expert prompt builder must include the strategy prompt"
  );
  const evidenceData = buildPricingEvidenceData(
    { existing: true },
    {
      match_found: false,
      source: "CUSTOM_ANALYSIS",
      confidence: 0.5,
      match_quality: "ZERO_MATCH",
      quantity_basis: "ESTIMATED",
      quantity_review_required: true,
      ancillary_scope: "NONE",
      source_trace: { keywords: ["pipe"] },
      matched_items: { contract: [], pricelist: [], notes: [] },
    },
    { strategy: true }
  );
  assert(evidenceData.existing === true, "AI evaluation evidence builder must preserve existing evidence data");
  assert(evidenceData.pricing_evaluation.source === "CUSTOM_ANALYSIS", "AI evaluation evidence builder must persist normalized pricing source");
  assert(evidenceData.pricing_evaluation.confidence_score === 0.5, "AI evaluation evidence builder must persist explicit confidence_score for queue automation");
  assert(evidenceData.expert_strategy.strategy === true, "AI evaluation evidence builder must persist expert strategy when present");
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/evaluation-normalizers.ts",
    "evaluation.confidence_score = evaluation.confidence",
    "AI evaluation normalizer must expose explicit confidence_score after normalization"
  );
  assertIncludes(
    "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
    "estimateData?.confidence_score ?? estimateData?.confidence",
    "AI estimator UI must preserve confidence_score when saving ledger evidence"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-evidence.ts",
    "import { normalizeConfidenceScore } from '../../../../utils/pricing-confidence'",
    "save-ledger evidence helper must reuse shared confidence normalization policy"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-evidence.ts",
    "export function normalizeLedgerEvidenceData",
    "save-ledger evidence helper must normalize AI evidence metadata at the server boundary"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-evidence.ts",
    "pricingEvaluationData.confidence_score ?? pricingEvaluationData.confidence",
    "save-ledger evidence helper must backfill confidence_score from legacy confidence values"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "import { normalizeLedgerEvidenceData } from './ledger-evidence'",
    "save-ledger input helper must delegate evidence metadata normalization to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "import { buildLedgerMutationPayload } from './ledger-mutation-payload'",
    "save-ledger input helper must delegate ledger mutation payload construction to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "saveLedgerItem",
    "save-ledger route must delegate POST orchestration to the service layer"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "deleteLedgerItem",
    "save-ledger route must delegate DELETE orchestration to the service layer"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "const ALLOWED_SOURCES",
    "save-ledger input helper must own the allowed pricing source policy"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "const ALLOWED_TYPES",
    "save-ledger input helper must own the allowed ledger type policy"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "requestedType === 'BASE_CONTRACT' ? 'PENDING_VO' : requestedType",
    "save-ledger input helper must downgrade manual BASE_CONTRACT saves to PENDING_VO"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "quantity must be a positive number",
    "save-ledger input helper must require explicit positive quantity"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "unit_price_excl_vat is required",
    "save-ledger input helper must require explicit pre-VAT unit price"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "description is required before saving a ledger item",
    "save-ledger input helper must require meaningful descriptions before persistence"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-input.ts",
    "buildLedgerMutationPayload",
    "save-ledger input helper must build one canonical mutation payload"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "import { markContradictionAsPriced } from './ledger-queue-status'",
    "save-ledger service must delegate queue status mutation to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "import { verifyProjectOwnership } from './project-access'",
    "save-ledger service must delegate project ownership checks to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "import { deleteMutableLedgerRow } from './ledger-delete'",
    "save-ledger service must delegate ledger delete mutation to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "from './ledger-write'",
    "save-ledger service must delegate ledger write mutations to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-write.ts",
    "export async function updateMutableLedgerRow",
    "save-ledger write helper must expose one update mutation entrypoint"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-write.ts",
    "export async function insertMutableLedgerRow",
    "save-ledger write helper must expose one insert mutation entrypoint"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-write.ts",
    "export async function upsertMutableLedgerRowByContradiction",
    "save-ledger write helper must expose one atomic contradiction upsert entrypoint"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-write.ts",
    "onConflict: 'project_id,contradiction_id'",
    "save-ledger contradiction upsert must use the project and contradiction uniqueness boundary"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-write.ts",
    ".neq('type', 'BASE_CONTRACT')",
    "save-ledger write helper must defensively exclude BASE_CONTRACT updates"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-delete.ts",
    "export async function deleteMutableLedgerRow",
    "save-ledger delete helper must expose one delete mutation entrypoint"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-delete.ts",
    ".neq('type', 'BASE_CONTRACT')",
    "save-ledger delete helper must defensively exclude BASE_CONTRACT deletes"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "from './ledger-row-access'",
    "save-ledger service must delegate ledger row lookup and read-only checks to an isolated helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-row-access.ts",
    "export async function findLedgerRowById",
    "save-ledger row access helper must expose id-based lookup"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-row-access.ts",
    "export async function findLedgerRowByContradiction",
    "save-ledger row access helper must expose contradiction-based lookup"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-row-access.ts",
    "export function isReadOnlyBaseContractRow",
    "save-ledger row access helper must centralize BASE_CONTRACT read-only detection"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/project-access.ts",
    "export async function verifyProjectOwnership",
    "save-ledger project access helper must expose one ownership check entrypoint"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/project-access.ts",
    ".eq('contractor_id', contractorId)",
    "save-ledger project access helper must enforce contractor ownership"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/project-access.ts",
    "return Boolean(data)",
    "save-ledger project access helper must return a clear authorization result"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-queue-status.ts",
    "export async function markContradictionAsPriced",
    "save-ledger queue status helper must expose one status transition entrypoint"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/ledger-queue-status.ts",
    ".update({ pricing_status: 'PRICED', status: 'MOVED_TO_PRICING' })",
    "save-ledger queue status helper must preserve the priced queue transition"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const normalizedInput = normalizeSaveLedgerInput(data)",
    "save-ledger service must normalize request data through the input helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const { itemId, activeContradictionId, ledgerMutationPayload } = normalizedInput.value",
    "save-ledger service must receive a canonical mutation payload from the input helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const updatedLedgerItem = await updateMutableLedgerRow(",
    "save-ledger service update paths must use the isolated write helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const newLedgerItem = await insertMutableLedgerRow(",
    "save-ledger service insert path must use the isolated write helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "await markContradictionAsPriced(supabase, activeContradictionId, projectId)",
    "save-ledger service must mark priced contradictions through the helper"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const hasProjectAccess = await verifyProjectOwnership(supabase, projectId, contractorId)",
    "save-ledger service must verify project ownership before mutating ledger rows"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const existingLedgerItem = await findLedgerRowById(supabase, itemId, projectId)",
    "save-ledger service must use row access helper for item_id updates"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const existingLedgerItem = await findLedgerRowByContradiction(supabase, projectId, activeContradictionId)",
    "save-ledger service must use row access helper for contradiction updates"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const savedLedgerItem = await upsertMutableLedgerRowByContradiction(",
    "save-ledger service must use an atomic contradiction upsert to reduce concurrent duplicate rows"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "const ledgerItem = await findLedgerRowById(supabase, item_id, project_id)",
    "save-ledger service DELETE must use row access helper before deletes"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "await deleteMutableLedgerRow(supabase, item_id, project_id)",
    "save-ledger service DELETE must use the isolated delete helper after read-only guard"
  );
  assertIncludes(
    "src/app/api/pricing/save-ledger/save-ledger-service.ts",
    "isReadOnlyBaseContractRow(",
    "save-ledger service must use the centralized BASE_CONTRACT read-only guard"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "function normalizeLedgerEvidenceData",
    "save-ledger route must stay thin and not inline AI evidence normalization"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "evidence_data: safeEvidenceData",
    "save-ledger route must not duplicate ledger mutation payload object literals inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    ".from('contradictions')",
    "save-ledger route must not inline queue status table mutations"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    ".from('projects')",
    "save-ledger route must not inline project ownership queries"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    ".select('id, type')",
    "save-ledger route must not inline ledger row lookup queries"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    ".delete()",
    "save-ledger route must not inline ledger delete mutations"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    ".from('pricing_ledger')",
    "save-ledger route must not inline pricing_ledger read or write queries"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "evidence_data: evidence_data || {}",
    "save-ledger route must not persist raw evidence_data without confidence normalization"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "ALLOWED_SOURCES",
    "save-ledger route must not own pricing source policy inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "ALLOWED_TYPES",
    "save-ledger route must not own ledger type policy inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "function toNumber",
    "save-ledger route must not own numeric parsing inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "function roundMoney",
    "save-ledger route must not own money rounding inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "function normalizeMarkupPercentage",
    "save-ledger route must not own markup normalization inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "unit_price_excl_vat is required",
    "save-ledger route must delegate unit price validation to the input helper"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "quantity must be a positive number",
    "save-ledger route must delegate quantity validation to the input helper"
  );
  assertNotIncludes(
    "src/app/api/pricing/save-ledger/route.ts",
    "description is required before saving a ledger item",
    "save-ledger route must delegate description validation to the input helper"
  );
  assertIncludes(
    "supabase/migrations/20260618000000_add_pricing_ledger_contradiction_unique.sql",
    "ROW_NUMBER() OVER",
    "pricing ledger uniqueness migration must rank existing duplicate contradiction rows before adding the constraint"
  );
  assertIncludes(
    "supabase/migrations/20260618000000_add_pricing_ledger_contradiction_unique.sql",
    "SET contradiction_id = NULL",
    "pricing ledger uniqueness migration must preserve duplicate financial rows while detaching duplicate contradiction links"
  );
  assertIncludes(
    "supabase/migrations/20260618000000_add_pricing_ledger_contradiction_unique.sql",
    "duplicates.duplicate_rank > 1",
    "pricing ledger uniqueness migration must keep the first contradiction-linked row intact"
  );
  assertNotIncludes(
    "supabase/migrations/20260618000000_add_pricing_ledger_contradiction_unique.sql",
    "DELETE FROM public.pricing_ledger",
    "pricing ledger uniqueness migration must not delete existing financial rows"
  );
  assertIncludes(
    "supabase/migrations/20260618000000_add_pricing_ledger_contradiction_unique.sql",
    "UNIQUE (project_id, contradiction_id)",
    "pricing ledger schema must prevent duplicate rows for the same priced contradiction"
  );
assertIncludes(
  "supabase/migrations/20260618000000_add_pricing_ledger_contradiction_unique.sql",
  "pricing_ledger_project_contradiction_unique",
  "pricing ledger contradiction uniqueness must have a stable constraint name for upsert conflict targeting"
);
assertIncludes(
  "supabase/migrations/20260618001000_add_pricing_ledger_query_indexes.sql",
  "CREATE INDEX IF NOT EXISTS idx_pricing_ledger_project_created_at",
  "pricing ledger large BOQ reads must have a project and created_at index"
);
assertIncludes(
  "supabase/migrations/20260618001000_add_pricing_ledger_query_indexes.sql",
  "ON public.pricing_ledger(project_id, created_at ASC)",
  "pricing ledger large BOQ index must match project filtering and ascending created_at ordering"
);
assertIncludes(
  "supabase/migrations/20260618001000_add_pricing_ledger_query_indexes.sql",
  "CREATE INDEX IF NOT EXISTS idx_contradictions_project_status_created_at",
  "pending pricing queue reads must have a project, status, and created_at index"
);
assertIncludes(
  "supabase/migrations/20260618001000_add_pricing_ledger_query_indexes.sql",
  "WHERE status IN ('OPEN', 'MOVED_TO_PRICING')",
  "pending pricing queue index must stay partial to the statuses rendered by the pricing screen"
);
assertIncludes(
  "supabase/migrations/20260618001000_add_pricing_ledger_query_indexes.sql",
  "CREATE INDEX IF NOT EXISTS idx_contradictions_project_id_id",
  "bulk confidence preview lookups must have a project and contradiction id index"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "const PRICING_LEDGER_SELECT_COLUMNS = [",
  "pricing ledger large BOQ reads must use an explicit column list instead of select star"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  ".select(PRICING_LEDGER_SELECT_COLUMNS)",
  "pricing ledger fetch must use the explicit lightweight ledger payload"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "export async function fetchLedgerRows",
  "export async function fetchPendingQueue",
  ".select('*')",
  "pricing ledger fetch must not use select star for large BOQ payloads"
);
[
  "'id'",
  "'project_id'",
  "'type'",
  "'source'",
  "'item_code'",
  "'description'",
  "'unit'",
  "'quantity'",
  "'unit_price_excl_vat'",
  "'total_price_excl_vat'",
  "'vat_rate'",
  "'evidence_data'",
  "'contradiction_id'",
  "'created_at'",
].forEach((column) => {
  assertIncludes(
    "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
    column,
    `pricing ledger lightweight payload must include ${column}`
  );
});
assertNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "'vat_amount'",
  "pricing ledger client payload must not load stored VAT totals"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "'total_price_incl_vat'",
  "pricing ledger client payload must not load stored gross totals"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "const PENDING_QUEUE_SELECT_COLUMNS = `",
  "pending pricing queue reads must use an explicit column list instead of select star"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  ".select(PENDING_QUEUE_SELECT_COLUMNS)",
  "pending pricing queue fetch must use the explicit lightweight queue payload"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "export async function fetchPendingQueue",
  "export async function updateLedgerRowStatus",
  ".select(`",
  "pending pricing queue fetch must not keep inline select-star payloads"
);
[
  "id,",
  "project_id,",
  "title,",
  "description,",
  "category,",
  "severity,",
  "status,",
  "pricing_status,",
  "source_execution_doc_id,",
  "target_contract_doc_id,",
  "evidence_data,",
  "created_at,",
  "source_doc:documents!contradictions_source_execution_doc_id_fkey(title)",
  "target_doc:documents!contradictions_target_contract_doc_id_fkey(title)",
].forEach((column) => {
  assertIncludes(
    "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
    column,
    `pending pricing queue lightweight payload must include ${column}`
  );
});
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "const PENDING_QUEUE_SELECT_COLUMNS = `",
  "function isRecord",
  "confidence_score,",
  "pending pricing queue must not select non-migrated confidence_score columns"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "const PENDING_QUEUE_SELECT_COLUMNS = `",
  "function isRecord",
  "ai_metadata,",
  "pending pricing queue must not select non-migrated ai_metadata columns"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "from '@/utils/pricing-confidence'",
  "pending pricing queue must import shared AI confidence normalization policy"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "getPricingEvidenceConfidenceScore",
  "pending pricing queue must reuse the shared AI confidence normalization policy"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "function normalizePricingQueueAiMetadata",
  "pending pricing queue must normalize AI metadata at the API boundary"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "confidence_score: aiMetadata?.confidence_score ?? null",
  "pending pricing queue rows must expose normalized confidence_score without selecting non-migrated columns"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "ai_metadata: aiMetadata",
  "pending pricing queue rows must expose normalized AI contradiction metadata"
);
assert(
  !fileExists("src/components/pricing/PricingClient.tsx"),
  "legacy PricingClient must not remain after direct pricing route consolidation"
);
assert(
  !fileExists("src/components/pricing/PendingQueue.tsx"),
  "legacy PendingQueue must not remain after QueuePanel/PendingQueueTable consolidation"
);
assert(
  !fileExists("src/components/pricing/LedgerTable.tsx"),
  "legacy pricing LedgerTable must not remain as a duplicate pricing screen or type owner"
);
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "from './evaluation-prompts'",
    "AI estimator service must import prompt builders from an isolated module"
  );
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "from './evaluation-context'",
    "AI estimator service must import context builders from an isolated module"
  );
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "from './evaluation-keywords'",
    "AI estimator service must import keyword extraction from an isolated module"
  );
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "from './evaluation-pricelists'",
    "AI estimator service must import pricelist filtering from an isolated module"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "isLikelyContractBoqPricelist",
    "AI evaluation route must not duplicate contract-BOQ pricelist filtering inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "const extractedKeywords =",
    "AI evaluation route must not keep keyword parsing inline"
  );
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    "DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS",
    "AI estimator service must use shared default text fallbacks"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "const pricingPrompt = `",
    "AI evaluation route must not keep the main pricing prompt inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "const itemsContext = pricelistMatches",
    "AI evaluation route must not keep pricelist context formatting inline"
  );
  assertNotIncludes(
    "src/app/api/pricing/evaluate-ai/route.ts",
    "pricing_evaluation: {",
    "AI evaluation route must delegate evidence payload construction"
  );
}

const filesToScanForInlineTotals = [
  "src/app/api/generate-letter/route.ts",
  "src/app/api/export/route.ts",
  "src/app/api/chat/route.ts",
  "src/components/features/AIPanel.tsx",
  "src/components/features/LedgerTable.tsx",
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "src/components/features/SmartLetterGenerator.tsx",
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "src/components/pricing/PricingLedgerTable.tsx",
  "src/components/pricing/PrintableLetter.tsx",
];

for (const file of filesToScanForInlineTotals) {
  assertRegex(
    file,
    /getLedgerRowAmount|getPreferredProjectAmount|getVariationOrderAmount|getLedgerRowVatAmount|getLedgerRowTotalInclVat|getAmountVat|getAmountInclVat|getMoneySum/,
    "financial code must use shared project-financials helpers"
  );

  assert(
    !/quantity\s*\*\s*[^;\n]*unit_price_excl_vat/.test(read(file)),
    `${file}: inline quantity * unit_price_excl_vat calculation is forbidden`
  );
}

assertIncludes(
  "src/utils/project-financials.ts",
  'row.source === "BOQ"',
  "only BOQ-sourced base contract rows must be trusted"
);
assertIncludes(
  "src/utils/project-financials.ts",
  'row.evidence_data?.source === "pricelist_items"',
  "trusted BOQ base rows must be traceable to imported pricelist items"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "Boolean(row.evidence_data?.pricelist_item_id)",
  "trusted BOQ base rows must include a concrete pricelist item id"
);
assertIncludes(
  "src/utils/project-financials.ts",
  '.filter((row) => row.type !== "BASE_CONTRACT")',
  "VO totals must exclude the base contract"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "const roundMoney",
  "shared financial helpers must round money to two decimals"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "return roundMoney(normalizeAmount(normalizedRow.quantity) * normalizeAmount(normalizedRow.unit_price_excl_vat))",
  "shared row amount helper must round quantity times unit price"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "if (isTrustedBaseContractRow(normalizedRow))",
  "trusted BOQ base rows must prefer BOQ quantity and unit price over any stored total"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "export function getAmountVat",
  "shared financial helpers must expose amount VAT calculation"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "export function getMoneySum",
  "shared financial helpers must expose rounded money summation"
);
assertIncludes(
  "supabase/migrations/20260616075211_drop_pricing_ledger_gross_generated_columns.sql",
  "DROP COLUMN IF EXISTS vat_amount",
  "pricing_ledger must not keep VAT amount as stored ledger data"
);
assertIncludes(
  "supabase/migrations/20260616075211_drop_pricing_ledger_gross_generated_columns.sql",
  "DROP COLUMN IF EXISTS total_price_incl_vat",
  "pricing_ledger must not keep gross amount as stored ledger data"
);
assertNotIncludes(
  "src/types/index.ts",
  "total_price_incl_vat",
  "shared ledger item type must not model gross totals as pricing_ledger data"
);
assertNotIncludes(
  "src/types/index.ts",
  "vat_amount",
  "shared ledger item type must not model VAT amount as pricing_ledger data"
);
[
  "src/components/pricing/PrintableLetter.tsx",
  "src/components/features/SmartLetterGenerator.tsx",
].forEach((file) => {
  assertIncludes(
    file,
    "import type { LedgerItem } from '@/types'",
    "pricing document modules must import LedgerItem from the shared domain types"
  );
  assertNotIncludes(
    file,
    "@/components/pricing/LedgerTable",
    "pricing document modules must not depend on a UI component for LedgerItem"
  );
  assertNotIncludes(
    file,
    "./LedgerTable",
    "pricing document modules must not depend on a local UI component for LedgerItem"
  );
});
assert(
  !fileExists("src/components/pricing/GenerateVOLetterModal.tsx"),
  "legacy VO letter modal must not remain after SmartLetter/LetterGenerator consolidation"
);
assert(
  !fileExists("src/components/pricing/PricingLedgerHeader.tsx"),
  "legacy pricing header must not remain after ActionBar/TotalsSummary consolidation"
);
assert(
  !fileExists("src/utils/pdfGenerator.ts"),
  "legacy pricing PDF generator must not remain outside the SmartLetter/PrintableLetter flow"
);

assertIncludes(
  "src/app/api/pricing/save-ledger/ledger-input.ts",
  "requestedType === 'BASE_CONTRACT' ? 'PENDING_VO' : requestedType",
  "manual save-ledger must downgrade BASE_CONTRACT to PENDING_VO"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/ledger-input.ts",
  "unit_price_excl_vat is required",
  "manual save-ledger must require explicit pre-VAT unit price"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/ledger-input.ts",
  "quantity must be a positive number",
  "manual save-ledger must require explicit positive quantity"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "toNumber(quantity, 1)",
  "manual save-ledger must not invent a default quantity"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "user_final_amount ?? ai_estimated_amount",
  "manual save-ledger must not treat legacy client totals as unit prices"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "unit_price_excl_vat ??",
  "manual save-ledger must not fall back from explicit unit price to client totals"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "requestedType === 'BASE_CONTRACT' ? 'PENDING_VO' : requestedType",
  "manual save-ledger route must delegate BASE_CONTRACT downgrade policy to the input helper"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "unit_price_excl_vat is required",
  "manual save-ledger route must delegate unit price validation to the input helper"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "quantity must be a positive number",
  "manual save-ledger route must delegate quantity validation to the input helper"
);
assertNotIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "ALLOWED_TYPES = new Set(['BASE_CONTRACT', 'APPROVED_VO', 'PENDING_VO', 'SENT_VO'])",
  "manual save-ledger must not allow SENT_VO without a VO letter"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/project-access.ts",
  ".eq('contractor_id', contractorId)",
  "manual save-ledger must verify project ownership through the isolated access helper"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/save-ledger-service.ts",
  "isReadOnlyBaseContractRow(existingLedgerItem)",
  "manual save-ledger service must reject updates to existing BASE_CONTRACT rows through the centralized guard"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "export async function DELETE",
  "manual save-ledger API must own ledger deletes server-side"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/ledger-write.ts",
  ".neq('type', 'BASE_CONTRACT')",
  "manual save-ledger write helper must defensively exclude BASE_CONTRACT writes"
);
assertIncludes(
  "src/app/api/pricing/update-status/route.ts",
  "ALLOWED_STATUS_UPDATES",
  "status updates must be allow-listed"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/save-ledger-service.ts",
  "isReadOnlyBaseContractRow(ledgerItem)",
  "manual save-ledger service DELETE must reject existing BASE_CONTRACT rows through the centralized guard"
);
assertIncludes(
  "src/app/api/pricing/update-status/route.ts",
  ".neq('type', 'BASE_CONTRACT')",
  "status update writes must defensively exclude BASE_CONTRACT rows"
);
assertNotIncludes(
  "src/app/api/pricing/update-status/route.ts",
  "ALLOWED_STATUS_UPDATES = new Set(['BASE_CONTRACT'",
  "status updates must not allow BASE_CONTRACT"
);

assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "function isSelectableVariationOrder(item?: Pick<PricingLedgerItem, 'type'> | null): boolean",
  "pricing ledger UI must define a null-safe strict selectable VO predicate"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "item?.type === 'PENDING_VO' || item?.type === 'APPROVED_VO'",
  "letter selection must be restricted to pending or approved VO rows"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "initialSelectedItems={derived.selectedVOIds}",
  "letter modal must receive only VO row ids"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "\"use client\";",
  "PricingLedgerUI must declare its client boundary before direct server routes import it"
);
assertIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "import PricingLedgerUI from '@/components/features/PricingLedgerUI'",
  "direct pricing route must render the modular pricing ledger UI"
);
assertIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "<PricingLedgerUI projectId={id} />",
  "direct pricing route must pass project context into the modular pricing ledger UI"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "PricingClient",
  "direct pricing route must not bypass modular pricing ledger state through the legacy client"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "initialQueue",
  "direct pricing route must not keep a separate SSR queue state path"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "initialLedger",
  "direct pricing route must not keep a separate SSR ledger state path"
);
assert(
  !/from\('pricing_ledger'\)/.test(read("src/app/dashboard/[id]/pricing/page.tsx")),
  "direct pricing route must not read pricing_ledger outside the modular pricing API/state layer"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "fetch('/api/pricing/save-ledger'",
  "pricing ledger UI must save ledger rows through the server API"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "fetch('/api/pricing/update-status'",
  "pricing ledger UI must update status through the server API"
);
assertIncludes(
  "src/components/features/LedgerTable.tsx",
  "rows.filter(isVisibleLedgerRow)",
  "legacy feature ledger table must hide untrusted BASE_CONTRACT rows"
);
assertIncludes(
  "src/components/features/LedgerTable.tsx",
  "visibleRows.reduce",
  "legacy feature ledger table totals must use only visible ledger rows"
);
assertIncludes(
  "src/components/features/LedgerTable.tsx",
  "getMoneySum([acc, getLedgerRowAmount(row)])",
  "legacy feature ledger table must use rounded money summation for visible totals"
);
assertIncludes(
  "src/components/features/LedgerTable.tsx",
  "visibleRows.map",
  "legacy feature ledger exports/rendering must use only visible ledger rows"
);
assert(
  !/from\('pricing_ledger'\)[\s\S]{0,180}\.(insert|update|delete)\(/.test(read("src/components/features/PricingLedgerUI.tsx")),
  "PricingLedgerUI must not mutate pricing_ledger directly from the client"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "export async function deleteLedgerRow(\n    projectId: string,\n    rowId: string",
  "pricing ledger API delete helper must receive project context from state instead of doing a client lookup"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "method: 'DELETE'",
  "pricing ledger API delete helper must route deletes through the server save-ledger API"
);
assert(
  !/export async function deleteLedgerRow[\s\S]*?from\('pricing_ledger'\)/.test(read("src/components/features/pricing-ledger/api/pricingLedgerApi.ts")),
  "pricing ledger API delete helper must not read pricing_ledger directly before server-side authorization"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const result = await deleteLedgerRow(projectId, rowId)",
  "pricing ledger state hook must pass project context into the server delete API"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "disabled={!isSelectable}",
  "non-selectable rows must not be selectable for VO letters"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const selectableItems = React.useMemo",
  "pricing ledger table must allow selecting only pending or approved VO rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const selectedLedgerIdSet = React.useMemo(() => new Set(selectedLedgerIds), [selectedLedgerIds])",
  "pricing ledger table must use a memoized selection set for large BOQ row checks"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "function useLatestCallback",
  "pricing ledger table must keep memoized row actions current without forcing row re-renders"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "callbackRef.current = callback",
  "pricing ledger stable action wrapper must always call the latest parent handler"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const stableToggleSelectItem = useLatestCallback(toggleSelectItem)",
  "pricing ledger row selection action must be stable for memoized large-BOQ rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const stableApproveVO = useLatestCallback(approveVO)",
  "pricing ledger approve action must be stable for memoized large-BOQ rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const TypeBadge = React.memo",
  "pricing ledger type badges must be memoized for repeated large-BOQ rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const DisplayLedgerRowCells = React.memo",
  "pricing ledger table must memoize heavy display row cells for large BOQ rendering"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const NewLedgerRow = React.memo",
  "pricing ledger table must isolate the add-row form behind a memoized row component"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const EditLedgerRowCells = React.memo",
  "pricing ledger table must isolate inline editing cells behind a memoized component"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "<NewLedgerRow",
  "pricing ledger table must render the add-row form through the isolated component"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "<EditLedgerRowCells",
  "pricing ledger table must render inline editing through the isolated component"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const updateField = React.useCallback",
  "pricing ledger add/edit row forms must use localized field update handlers"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "formatCurrency(getLedgerRowAmount(form))",
  "pricing ledger add/edit row totals must still use the shared financial helper"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "<DisplayLedgerRowCells",
  "pricing ledger virtual rows must render heavy display cells through the memoized row component"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const rowTotal = getLedgerRowAmount(item)",
  "pricing ledger memoized display row must calculate totals through the shared financial helper"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "prev.item === next.item",
  "pricing ledger memoized display row must preserve stable row renders when row references do not change"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "&& (!next.shouldAnimateRows || prev.rowIndex === next.rowIndex)",
  "pricing ledger row shell must ignore virtual row index changes when large-BOQ motion is disabled"
);
assertSectionNotIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const LedgerRowShell = React.memo",
  "interface DisplayLedgerRowCellsProps",
  "prev.children",
  "pricing ledger row shell comparator must not compare children because row children are recreated by parent renders"
);
assertSectionNotIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const LedgerRowShell = React.memo",
  "interface DisplayLedgerRowCellsProps",
  "next.children",
  "pricing ledger row shell comparator must not compare children because row children are recreated by parent renders"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "selectedLedgerIdSet.has(item.id)",
  "pricing ledger table row selection checks must be O(1) for large BOQ tables"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "onChange={() => isSelectable && stableToggleSelectItem(item.id)}",
  "pricing ledger row checkbox must use the stable selection action"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "approveVO={stableApproveVO}",
  "pricing ledger display rows must receive stable approve actions"
);
assertNotIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "false && isAddingNew",
  "pricing ledger table must not keep disabled legacy add-row JSX"
);
assertNotIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "{false && (",
  "pricing ledger table must not keep disabled legacy edit-row JSX"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "disabled={isBaseContract}",
  "BASE_CONTRACT rows must be read-only in the ledger table"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const VIRTUALIZATION_THRESHOLD = 500",
  "pricing ledger table must enable windowing for massive BOQ tables"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const LEDGER_ROW_MOTION_THRESHOLD = 200",
  "pricing ledger table must disable row motion above the large-BOQ threshold"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const virtualWindow = React.useMemo",
  "pricing ledger table must memoize the visible row window"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "requestAnimationFrame",
  "pricing ledger table scrolling must throttle virtual window updates"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "export default React.memo(PricingLedgerTable)",
  "pricing ledger table component must be memoized for large BOQ screens"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const shouldAnimateRows = ledgerItems.length <= LEDGER_ROW_MOTION_THRESHOLD",
  "pricing ledger table must switch off row animations for large BOQs"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const ledgerRowsContent = React.useMemo(() => (",
  "pricing ledger table must memoize isolated row content so large BOQs avoid unnecessary remaps"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "stableToggleSelectItem,\n        virtualWindow,",
  "pricing ledger row content memo must depend on the visible virtual window and stable row actions"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  ") : shouldAnimateRows ? (",
  "pricing ledger table must use AnimatePresence only when row animations are enabled"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  ") : (\n                            ledgerRowsContent",
  "pricing ledger table must render large BOQ rows without AnimatePresence overhead"
);
assertSectionNotIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "<AnimatePresence mode=\"popLayout\">",
  "</AnimatePresence>",
  "virtualWindow.visibleRows.map",
  "pricing ledger AnimatePresence branch must reuse shared ledgerRowsContent instead of remapping rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "shouldAnimateRows={shouldAnimateRows}",
  "pricing ledger row shell must receive the large-BOQ motion gate"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "if (!shouldAnimateRows)",
  "pricing ledger rows must bypass framer-motion above the motion threshold"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "<tr key={itemId} className={className}>",
  "pricing ledger rows must render plain table rows for large BOQs"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "Math.min(rowIndex, 10) * 0.02",
  "pricing ledger row animation delay must be capped for large BOQs"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/LedgerTable.tsx",
  "export default React.memo(LedgerTable)",
  "pricing ledger facade table must be memoized for large BOQ screens"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "export default React.memo(QueuePanel)",
  "pricing queue panel must be memoized to reduce large BOQ screen re-renders"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/ActionBar.tsx",
  "export default React.memo(ActionBar)",
  "pricing action bar must be memoized to reduce unrelated ledger screen re-renders"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/TotalsSummary.tsx",
  "export default React.memo(TotalsSummary)",
  "pricing totals summary must be memoized to reduce unrelated ledger screen re-renders"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "const getConfidencePercent = React.useCallback",
  "pricing queue confidence renderer must be stable across parent re-renders"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "export default React.memo(PendingQueueTable)",
  "pending pricing queue table must be memoized for high-volume contradiction queues"
);
[
  "AlertTriangle",
  "AlertCircle",
  "Info",
  "ChevronRight",
  "CheckCircle2",
  "XCircle",
  "ArrowRightLeft",
  "Search",
  "Check,",
  "Download",
  "ShieldAlert",
  "FileSearch",
  "Scale",
  "Gavel",
  "Quote",
  "ExternalLink",
  "Sparkles",
  "Database",
  "Loader2",
  "Link as LinkIcon",
  "Bot",
  "Clock",
].forEach((unusedIcon) => {
  assertSectionNotIncludes(
    "src/components/pricing/PendingQueueTable.tsx",
    "import {",
    "} from 'lucide-react'",
    unusedIcon,
    `pending pricing queue table must not import unused lucide icon ${unusedIcon}`
  );
});
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const PendingQueueGroupHeader = React.memo",
  "pending pricing queue group headers must be isolated and memoized"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const groupedItems = React.useMemo",
  "pending pricing queue grouping must be memoized for high-volume contradiction queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const groupedEntries = React.useMemo",
  "pending pricing queue group entries must be memoized for high-volume contradiction queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const collapsedGroupSet = React.useMemo",
  "pending pricing queue collapsed group membership must be memoized for high-volume grouped queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds])",
  "pending pricing queue must use a memoized selection set for high-volume row checks"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const scanningItemIdSet = React.useMemo(() => new Set(scanningItems), [scanningItems])",
  "pending pricing queue must use a memoized scanning set for high-volume row checks"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const confidencePercentById = React.useMemo",
  "pending pricing queue must memoize per-row confidence labels for high-volume AI queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const queueRowsContent = React.useMemo",
  "pending pricing queue must use one memoized render path for virtualized and non-virtualized rows"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "virtualWindow.visibleRows.map((row)",
  "pending pricing queue row rendering must be driven by the virtual window"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "new Map(items.map((item) => [item.id, getConfidencePercent(item)]))",
  "pending pricing queue confidence map must be keyed by queue id"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "confidencePercent={confidencePercentById.get(row.item.id) ?? null}",
  "pending pricing queue rows must read confidence labels from the memoized map"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "{queueRowsContent}",
  "pending pricing queue tbody must render through the shared memoized row content"
);
assertSectionNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "<tbody className=\"divide-y divide-white/5\">",
  "</tbody>",
  "groupedEntries.map(([sourceTitle",
  "pending pricing queue tbody must not keep the old non-virtual duplicate grouped render path"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "confidencePercent={getConfidencePercent?.(item)}",
  "pending pricing queue must not compute confidence labels inline for every row render"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "function getEvidenceSummary(evidenceData: unknown)",
  "pending pricing queue evidence summary must be a stable module-level helper"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const getEvidenceSummary =",
  "pending pricing queue must not recreate evidence summary logic during table renders"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const handleSelectAllChange = React.useCallback",
  "pending pricing queue select-all handler must be stable across renders"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "Math.min(itemIdx, 10) * 0.03",
  "pending pricing queue row animation delay must be capped for high-volume queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const QUEUE_ROW_MOTION_THRESHOLD = 200",
  "pending pricing queue must define a stable row-motion cutoff for high-volume queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const QUEUE_ROW_VIRTUALIZATION_THRESHOLD = 500",
  "pending pricing queue must define a stable virtualization cutoff for 500+ row queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const queueRenderRows = React.useMemo<PendingQueueRenderRow[]>",
  "pending pricing queue must flatten grouped rows before virtualizing large queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "function findFirstVirtualRowIndex",
  "pending pricing queue virtualizer must use binary search for the first visible row"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "function findFirstVirtualRowAfterOffset",
  "pending pricing queue virtualizer must use binary search for the end of the visible window"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const queueVirtualRowMetrics = React.useMemo<PendingQueueVirtualMetric[]>",
  "pending pricing queue must precompute row offsets outside the scroll path"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const shouldVirtualizeRows = items.length > QUEUE_ROW_VIRTUALIZATION_THRESHOLD",
  "pending pricing queue must enable virtualization above the 500-row cutoff"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const virtualWindow = React.useMemo(() =>",
  "pending pricing queue must memoize the visible virtual row window"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "onScroll={handleScroll}",
  "pending pricing queue scroll container must drive the virtual window"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "virtualWindow.visibleRows.map((row)",
  "pending pricing queue must render only the virtual visible rows above the cutoff"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "<PendingQueueGroupHeader",
  "pending pricing queue virtual branch must reuse the shared group header component"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "itemCount={row.groupItems.length}",
  "pending pricing queue virtual group headers must pass the grouped item count into the shared header"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "virtualWindow.topPadding",
  "pending pricing queue virtualization must preserve scroll height with top padding"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "virtualWindow.bottomPadding",
  "pending pricing queue virtualization must preserve scroll height with bottom padding"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "for (const row of queueRenderRows)",
  "pending pricing queue scroll window must not scan every row on each scroll"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "items: {row.groupItems.length}",
  "pending pricing queue virtual group headers must not switch to English labels"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "'expand source'",
  "pending pricing queue virtual group actions must not switch to English labels"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const shouldAnimateRows = items.length <= QUEUE_ROW_MOTION_THRESHOLD",
  "pending pricing queue must disable per-row motion for high-volume queues"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const RowComponent = (shouldAnimateRows ? motion.tr : 'tr') as React.ElementType",
  "pending pricing queue rows must bypass framer-motion above the motion threshold"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const rowAnimationProps = shouldAnimateRows",
  "pending pricing queue row animation props must only exist below the motion threshold"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "{...rowAnimationProps}",
  "pending pricing queue rows must keep motion props isolated from plain table rows"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "</RowComponent>",
  "pending pricing queue rows must close through the dynamic row component"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "shouldAnimateRows={shouldAnimateRows}",
  "pending pricing queue must pass the motion cutoff decision into memoized rows"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "Object.entries(groupedItems).map",
  "pending pricing queue must not rebuild group entries inside render"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "collapsedGroups.includes(sourceTitle)",
  "pending pricing queue must use O(1) collapsed group membership checks in render"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "const queueConfidence = useMemo",
  "pricing ledger facade must pass a stable confidence prop into the memoized queue panel"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "const handleGenerateLetter = useCallback",
  "pricing ledger facade must pass stable action bar callbacks"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "handleApproveEstimation: approveEstimation",
  "pricing ledger facade callbacks must depend on specific action functions, not the aggregate actions object"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "setIsGeneratingLetter",
  "pricing ledger facade callbacks must depend on specific setter functions, not the aggregate setters object"
);
assertNotIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "}, [actions]);",
  "pricing ledger facade must not recreate callbacks from the aggregate actions object"
);
assertNotIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "}, [setters]);",
  "pricing ledger facade must not recreate callbacks from the aggregate setters object"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "selectedLedgerIds.filter((id) => (",
  "modular ledger state must filter selected ledger ids through the visible VO lookup"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "item?.type === 'PENDING_VO' || item?.type === 'APPROVED_VO'",
  "modular ledger selectable predicate must exclude sent VO and base contract rows"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "getPreferredProjectAmount(projectBudget, financialRows)",
  "modular ledger state must show base contract total through shared helpers"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "getVariationOrderAmount(visibleFinancialRows)",
  "modular ledger state must show VO total separately through shared helpers"
);
assertNotIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "{ value: 'SENT_VO', label:",
  "ledger edit type selector must not expose SENT_VO as a manual status"
);
assertIncludes(
  "src/components/features/smart-letter/api/smartLetterApi.ts",
  '.in("type", ["PENDING_VO", "APPROVED_VO"])',
  "letter generator must fetch only VO rows"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "confidence_score?: AiConfidenceScore | null",
  "pricing ledger queue types must model AI confidence explicitly"
);
assertSectionIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "export interface PricingLedgerItem",
  "export interface PricingQueueItem",
  "confidence_score?: AiConfidenceScore | null",
  "pricing ledger row type must keep AI confidence available for ledger facades"
);
assertSectionIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "export interface PricingLedgerItem",
  "export interface PricingQueueItem",
  "ai_metadata?: PricingAiContradictionMetadata | null",
  "pricing ledger row type must keep AI metadata available for ledger facades"
);
assertSectionIncludes(
  "src/types/index.ts",
  "export interface LedgerItem",
  "export interface QueueItem",
  "confidence_score?: number | null",
  "shared ledger row type must expose optional AI confidence for table rendering"
);
assertSectionIncludes(
  "src/types/index.ts",
  "export interface LedgerItem",
  "export interface QueueItem",
  "ai_metadata?: JsonObject | null",
  "shared ledger row type must expose optional AI metadata for table rendering"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "getQueueItemConfidenceScore",
  "pricing queue state hook must derive per-row AI confidence through shared helpers"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const queueConfidenceScoreById = useMemo",
  "pricing queue confidence scores must be memoized once for large AI queues"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "new Map(pendingQueue.map((item) => [item.id, getQueueItemConfidenceScore(item)]))",
  "pricing queue confidence score map must be keyed by queue id"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const queueConfidencePercentById = useMemo",
  "pricing queue confidence display percentages must be memoized once for row rendering"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "Array.from(queueConfidenceScoreById.values())",
  "pricing queue confidence stats must reuse the memoized confidence score map"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  ".map(getQueueItemConfidenceScore)",
  "pricing queue confidence stats must not recalculate scores after the memoized map exists"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "queueConfidenceScoreById: Map<string, number | null>",
  "pricing ledger derived state must expose memoized confidence score lookup"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "queueConfidencePercentById: Map<string, string | null>",
  "pricing ledger derived state must expose memoized confidence display lookup"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "queueConfidencePercentById.get(item.id) ?? null",
  "pricing queue UI must read per-row AI confidence from derived memoized lookup"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "getQueueItemConfidenceScore",
  "pricing queue UI must not recalculate AI confidence per row render"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "getConfidencePercent?:",
  "pending queue table must support optional per-row confidence rendering"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const PendingQueueRow = React.memo",
  "pending queue table must isolate heavy row rendering behind React.memo"
);
assertNotIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "false && !collapsedGroupSet",
  "pending queue table must not keep disabled legacy row render blocks"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "score !== null && score > AI_BULK_APPROVE_CONFIDENCE_THRESHOLD",
  "smart bulk selection must only pass high-confidence queue items"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const highConfidenceQueueIdSet = useMemo",
  "smart bulk selection must memoize high-confidence queue membership for large queues"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "highConfidenceQueueIdSet.has(id)",
  "smart bulk selection must use O(1) high-confidence membership checks"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const visibleLedgerRowById = useMemo",
  "ledger selection must memoize visible row lookup for large BOQ tables"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "visibleLedgerRowById.get(rowId)",
  "ledger row toggles must use O(1) visible row lookup"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const scanningItemIdSet = useMemo",
  "queue rescan must memoize scanning membership for large queues"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids'",
  "pricing ledger state hook must use the shared queue id normalization helper"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const requestedQueueIds = normalizePricingQueueIds(ids)",
  "bulk rescan must normalize selected queue ids before async work"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "if (!requestedQueueIds.length)",
  "bulk rescan must skip empty requests without creating stale operations"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const selectedQueueIdSet = new Set(requestedQueueIds)",
  "bulk rescan must use O(1) normalized selected queue membership checks"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "if (!itemsToScan.length)",
  "bulk rescan must skip rows already being scanned instead of creating duplicate operations"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const bulkRescanOperationRef = useRef(0)",
  "bulk rescan must track operation ids to prevent stale refreshes from winning races"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "bulkRescanOperationRef.current = operationId",
  "bulk rescan must register the latest operation before starting async work"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "rescanQueueItemsInBatches(projectId, itemsToScan)",
  "bulk rescan must run selected queue rescans through a bounded batch helper"
);
assertIncludes(
  "src/components/features/pricing-ledger/constants.ts",
  "export const BULK_RESCAN_CONCURRENCY = 4",
  "bulk rescan must expose an explicit concurrency policy"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "index += BULK_RESCAN_CONCURRENCY",
  "bulk rescan helper must process scan requests in bounded batches"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "batch.map((item) => rescanQueueItem(projectId, item))",
  "bulk rescan helper must call scan API only inside the bounded batch"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const completedScanIdSet = new Set(idsToScan)",
  "bulk rescan must clear scanning state in one pass after batch completion"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "setSelectedQueueIds((currentIds) => currentIds.filter((id) => !completedScanIdSet.has(id)))",
  "bulk rescan must clear only completed scan ids from selection after async refresh"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkRescan = useCallback",
  "const handleBulkDeleteQueue = useCallback",
  "setSelectedQueueIds([])",
  "bulk rescan must not reset the full queue selection after async work"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "bulkRescanOperationRef.current !== operationId",
  "bulk rescan must ignore superseded batch responses before refreshing the queue"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkRescan = useCallback",
  "const handleBulkDeleteQueue = useCallback",
  "handleRescan(item)",
  "bulk rescan must not call single-item rescan because it refreshes the queue per item"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkRescan = useCallback",
  "const handleBulkDeleteQueue = useCallback",
  "Promise.all(itemsToScan.map",
  "bulk rescan must not start all selected scan requests at once"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const requestedQueueIds = normalizePricingQueueIds(ids)",
  "bulk delete must normalize selected queue ids before async archive"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const bulkDeleteInFlightIdSetRef = useRef<Set<string>>(new Set())",
  "bulk delete must keep a synchronous in-flight id set to prevent duplicate archive requests"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const idsToArchive = requestedQueueIds.filter((id) => !inFlightDeleteIdSet.has(id))",
  "bulk delete must skip queue ids that already have an archive request in flight"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "idsToArchive.forEach((id) => inFlightDeleteIdSet.add(id))",
  "bulk delete must lock queue ids before starting the async archive request"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const result = await archivePendingQueueItems(projectId, idsToArchive)",
  "bulk delete must archive queue items through the server API with project context"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const archivedQueueIdSet = new Set(result.archivedIds || [])",
  "bulk delete must use only server-confirmed archived queue ids for local optimistic cleanup"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "setSelectedQueueIds((currentIds) => currentIds.filter((id) => !archivedQueueIdSet.has(id)))",
  "bulk delete must preserve newer selections by clearing only archived queue ids"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "idsToArchive.forEach((id) => inFlightDeleteIdSet.delete(id))",
  "bulk delete must release in-flight archive locks after the request settles"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkDeleteQueue = useCallback",
  "const handleBulkApprove = useCallback",
  "setSelectedQueueIds([])",
  "bulk delete must not reset the full selection after an async archive"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids'",
  "pricing ledger API client must use the shared queue id normalization helper"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "const requestedIds = normalizePricingQueueIds(ids)",
  "pricing ledger API client must normalize archive queue ids before sending them to the server"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "body: JSON.stringify({ projectId, ids: requestedIds })",
  "pricing ledger API client must send only normalized archive queue ids"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "previewHighConfidenceQueueItems(projectId, clientEligibleIds)",
  "smart bulk selection must be verified by the server before staging items"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const requestedIds = normalizePricingQueueIds(ids)",
  "smart bulk selection must trim, drop empty ids, and deduplicate requested ids before async server preview"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const requestedIdSet = new Set(requestedIds)",
  "smart bulk selection must remember the normalized requested ids before async server preview"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "previewHighConfidenceQueueItems(projectId, clientEligibleIds)",
  "smart bulk selection must send only normalized high-confidence candidate ids to the server preview"
);
assertSectionIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "export async function previewHighConfidenceQueueItems",
  "export async function rescanQueueItem",
  "const requestedIds = normalizePricingQueueIds(ids)",
  "pricing ledger API client must normalize smart bulk preview ids before sending them to the server"
);
assertSectionIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "export async function previewHighConfidenceQueueItems",
  "const response = await fetch('/api/pricing/bulk-confidence-preview'",
  "if (!requestedIds.length)",
  "pricing ledger API client must return early for empty smart bulk preview ids"
);
assertSectionIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "if (!requestedIds.length)",
  "const response = await fetch('/api/pricing/bulk-confidence-preview'",
  "approvedIds: []",
  "pricing ledger API client empty preview result must preserve the legacy wire alias"
);
assertSectionIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "export async function previewHighConfidenceQueueItems",
  "export async function rescanQueueItem",
  "body: JSON.stringify({ projectId, ids: requestedIds })",
  "pricing ledger API client must send only normalized smart bulk preview ids"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "skippedIds: requestedIds",
  "smart bulk selection must return normalized skipped ids for superseded preview responses"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const stagedIds = result.stagedIds || result.approvedIds || []",
  "smart bulk selection must prefer staged preview ids while preserving legacy wire compatibility"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const stagedIdSet = new Set(stagedIds)",
  "smart bulk selection must stage preview ids through a set for stable merging"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const unrelatedNewSelection = currentIds.filter((id) => !requestedIdSet.has(id))",
  "smart bulk selection must preserve user selections made outside the requested preview set"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "return Array.from(new Set([...unrelatedNewSelection, ...stagedIdSet]))",
  "smart bulk selection must merge staged preview ids without clobbering newer unrelated selections"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "setSelectedQueueIds(approvedIds)",
  "smart bulk selection must not overwrite queue selection after async preview"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "fetch('/api/pricing/archive-queue'",
  "pricing ledger API client must route queue archive mutations through the server"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  ".update({ status: 'ARCHIVED' })",
  "pricing ledger API client must not mutate contradiction queue status directly"
);
assertIncludes(
  "src/app/api/pricing/archive-queue/route.ts",
  "import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids'",
  "queue archive route must use the shared queue id normalization helper"
);
assertIncludes(
  "src/app/api/pricing/archive-queue/route.ts",
  "const requestedIds = normalizePricingQueueIds(Array.isArray(ids) ? ids : [])",
  "queue archive route must normalize requested ids before access-checked archive mutation"
);
assertIncludes(
  "src/app/api/pricing/archive-queue/route.ts",
  "auth.getUser()",
  "queue archive route must authenticate the user"
);
assertIncludes(
  "src/app/api/pricing/archive-queue/route.ts",
  ".eq('contractor_id', user.id)",
  "queue archive route must verify project ownership"
);
assertIncludes(
  "src/app/api/pricing/archive-queue/route.ts",
  ".eq('project_id', projectId)",
  "queue archive route must constrain contradiction updates to the requested project"
);
assertIncludes(
  "src/app/api/pricing/archive-queue/route.ts",
  ".select('id')",
  "queue archive route must return server-confirmed archived ids"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const bulkApproveOperationRef = useRef(0)",
  "smart bulk selection must track operation ids to prevent stale preview responses from winning races"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "bulkApproveOperationRef.current !== operationId",
  "smart bulk selection must ignore superseded bulk confidence preview responses"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "superseded?: boolean",
  "smart bulk selection result must expose superseded responses to the UI"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "const bulkApproveInFlightRef = React.useRef(false)",
  "smart bulk approve UI must use a synchronous ref guard for duplicate launch prevention"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "if (bulkApproveInFlightRef.current)",
  "smart bulk approve UI must block duplicate confidence preview launches synchronously"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "bulkApproveInFlightRef.current = true",
  "smart bulk approve UI must lock duplicate launches before the async preview request"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "bulkApproveInFlightRef.current = false",
  "smart bulk approve UI must release the duplicate-launch lock after async preview settles"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "[onBulkApprove, selectedIds, thresholdPercent]",
  "smart bulk approve UI callback must not depend on asynchronous state for duplicate-launch prevention"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "if (result.superseded)",
  "smart bulk approve UI must ignore superseded preview responses"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "const [bulkApproveFeedback, setBulkApproveFeedback]",
  "smart bulk approve UI must store server preview feedback in component state"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "function buildBulkApproveFeedback",
  "smart bulk approve UI must build preview feedback through a pure helper"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "function buildBulkApproveErrorFeedback",
  "smart bulk approve UI must build error feedback through a pure helper"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "setBulkApproveFeedback(null)",
  "smart bulk approve UI must clear stale feedback before starting a new server preview"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "setBulkApproveFeedback(buildBulkApproveFeedback(result, thresholdPercent))",
  "smart bulk approve handler must delegate success and warning feedback construction"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "items staged after Confidence",
  "smart bulk approve feedback must describe high-confidence matches as staged, not persisted approvals"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "const stagedIds = result.stagedIds || result.approvedIds",
  "smart bulk approve feedback must prefer staged preview ids while accepting the legacy wire alias"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "Staged: ${bulkApproveFeedback.stagedCount}",
  "smart bulk approve feedback counter must not label previewed ids as persisted approvals"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "approvedCount",
  "smart bulk approve feedback state must not keep persisted-approval terminology for staged preview ids"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "stagedIds?: string[]",
  "bulk approve preview result type must expose staged preview ids explicitly"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "Legacy wire alias kept for backward compatibility",
  "bulk approve preview result type must document approvedIds as a legacy staged-id alias"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "setBulkApproveFeedback(buildBulkApproveErrorFeedback(message, selectedIds.length))",
  "smart bulk approve handler must delegate error feedback construction"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "role=\"status\"",
  "smart bulk approve UI must show preview results inline without blocking the workflow"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "aria-live=\"polite\"",
  "smart bulk approve feedback must be announced without interrupting the workflow"
);
assertNotIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "alert(`",
  "smart bulk approve UI must not use blocking alert dialogs for preview feedback"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkApprove = useCallback",
  "const handleEditClick = useCallback",
  "saveLedgerRow",
  "smart bulk approve must not create ledger rows without explicit pricing data"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkApprove = useCallback",
  "const handleEditClick = useCallback",
  "archivePendingQueueItems",
  "smart bulk approve must not archive queue items before ledger pricing exists"
);
assertSectionNotIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkApprove = useCallback",
  "const handleEditClick = useCallback",
  "updateLedgerRowStatus",
  "smart bulk approve must not mutate ledger row status directly"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "fetch('/api/pricing/bulk-confidence-preview'",
  "pricing ledger API client must route smart bulk confidence checks through the server"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "auth.getUser()",
  "bulk confidence preview must authenticate the user"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  ".eq('contractor_id', user.id)",
  "bulk confidence preview must verify project ownership"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "from './bulk-confidence-preview-service'",
  "bulk confidence preview route must delegate read-only confidence calculations to its service"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "new BulkConfidencePreviewService(supabase)",
  "bulk confidence preview route must instantiate the isolated service"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "service.previewHighConfidenceItems({ projectId, requestedIds })",
  "bulk confidence preview route must delegate preview calculation to the service"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids'",
  "bulk confidence preview route must use the shared queue id normalization helper"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "const requestedIds = normalizePricingQueueIds(Array.isArray(ids) ? ids : [])",
  "bulk confidence preview route must normalize duplicate requested ids before service execution"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "@/components/features/pricing-ledger/constants",
  "bulk confidence preview must not depend on frontend feature constants"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "getPricingEvidenceConfidenceScore",
  "bulk confidence preview service must use the shared confidence helper"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "from '@/utils/pricing-confidence'",
  "bulk confidence preview service must import confidence policy from the shared utility layer"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "return score !== null && score > AI_BULK_APPROVE_CONFIDENCE_THRESHOLD",
  "bulk confidence preview service must enforce the server-side confidence threshold"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids'",
  "bulk confidence preview service must use the shared queue id normalization helper"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "const uniqueRequestedIds = normalizePricingQueueIds(requestedIds)",
  "bulk confidence preview service must trim, drop empty ids, and deduplicate requested ids before querying"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "if (uniqueRequestedIds.length === 0)",
  "bulk confidence preview service must return early for empty normalized id sets"
);
assertSectionIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "if (uniqueRequestedIds.length === 0)",
  "const { data: contradictions, error } = await this.supabase",
  "approvedIds: []",
  "bulk confidence preview service empty-id branch must preserve the legacy wire alias"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".in('id', uniqueRequestedIds)",
  "bulk confidence preview service must query only normalized requested ids"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "const skippedIds = uniqueRequestedIds.filter",
  "bulk confidence preview service must report skipped ids from the normalized request set"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "const stagedIds = rows",
  "bulk confidence preview service must use staged terminology internally for previewed ids"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "const stagedIdSet = new Set(stagedIds)",
  "bulk confidence preview service must use staged terminology for preview membership checks"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "approvedIds: stagedIds",
  "bulk confidence preview service must keep approvedIds only as a legacy wire alias"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "function normalizeConfidenceScore",
  "bulk confidence preview must not duplicate confidence normalization"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".select('id, evidence_data')",
  "bulk confidence preview service must rely on existing contradiction evidence_data columns"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".select('id, evidence_data, confidence_score, ai_metadata')",
  "bulk confidence preview service must not select non-migrated confidence columns"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".update(",
  "bulk confidence preview service must not mutate contradictions"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".insert(",
  "bulk confidence preview service must not create ledger or queue rows"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".delete(",
  "bulk confidence preview service must not delete queue rows"
);
assertIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "initialSelectedItems.filter((id) => selectableIds.has(id))",
  "letter generator must drop non-VO initial selections"
);
assertIncludes(
  "src/components/features/SmartLetterGenerator.tsx",
  "useSmartLetterState({ projectId, initialSelectedItems })",
  "smart letter UI facade must delegate state to the isolated hook"
);
assertIncludes(
  "src/components/features/SmartLetterGenerator.tsx",
  "derived.totalInclVat",
  "smart letter UI facade must read selected totals from derived hook state"
);
assertIncludes(
  "src/components/pricing/LetterGeneratorModal.tsx",
  "export default React.memo(LetterGeneratorModal)",
  "letter generator modal must be memoized so pricing screen shell remains stable"
);
assertIncludes(
  "src/components/features/KPIStrip.tsx",
  'row.type === "APPROVED_VO" || row.type === "SENT_VO"',
  "KPI strip must keep sent VO letters in approved/sent variation totals"
);
assertIncludes(
  "src/components/features/KPIStrip.tsx",
  "const visibleLedgerRows = ledgerData.filter(isVisibleLedgerRow)",
  "KPI strip must hide untrusted BASE_CONTRACT rows before ledger stats"
);
assertIncludes(
  "src/components/features/KPIStrip.tsx",
  "governing_notes, evidence_data",
  "KPI strip must select evidence_data before applying trusted BOQ filters"
);
assertIncludes(
  "src/components/features/KPIStrip.tsx",
  "getMoneySum([sum, getLedgerRowAmount(row)])",
  "KPI strip must use rounded money summation for VO totals"
);
assertNotIncludes(
  "src/components/features/KPIStrip.tsx",
  "const totalItems = ledgerData.length",
  "KPI strip coverage must not include hidden legacy base rows"
);
assertIncludes(
  "src/components/features/ProjectOverview.tsx",
  "r.type === 'APPROVED_VO' || r.type === 'SENT_VO'",
  "project overview must keep sent VO letters in approved/sent variation totals"
);
assertIncludes(
  "src/components/features/ProjectOverview.tsx",
  "const visibleLedgerRows = ledger.filter(isVisibleLedgerRow)",
  "project overview must hide untrusted BASE_CONTRACT rows before ledger stats"
);
assertIncludes(
  "src/components/features/ProjectOverview.tsx",
  "governing_notes, evidence_data",
  "project overview must select evidence_data before applying trusted BOQ filters"
);
assertIncludes(
  "src/components/features/ProjectOverview.tsx",
  "getMoneySum([acc, getLedgerRowAmount(r)])",
  "project overview must use rounded money summation for VO totals"
);
assertNotIncludes(
  "src/components/features/ProjectOverview.tsx",
  "ledger.length > 0 ?",
  "project overview coverage must not include hidden legacy base rows"
);
assertIncludes(
  "src/app/api/pricing/estimate/route.ts",
  "Legacy estimator is disabled",
  "legacy estimator must not produce AI prices without project BOQ context"
);
assertIncludes(
  "src/app/api/pricing/estimate/route.ts",
  "{ status: 410 }",
  "legacy estimator must return Gone instead of bypassing evaluate-ai"
);
assertIncludes(
  "src/components/pricing/ai-estimator/api/aiEstimatorApi.ts",
  "if (!response.ok)",
  "AI estimator API helper must not treat failed evaluations as usable prices"
);
assertIncludes(
  "src/components/pricing/ai-estimator/api/aiEstimatorApi.ts",
  "const AI_ESTIMATOR_SOURCE_DOCUMENT_SELECT_COLUMNS = [",
  "AI estimator source-document lookup must use an explicit document column list"
);
assertIncludes(
  "src/components/pricing/ai-estimator/api/aiEstimatorApi.ts",
  ".select(AI_ESTIMATOR_SOURCE_DOCUMENT_SELECT_COLUMNS)",
  "AI estimator source-document lookup must use the lightweight document payload"
);
assertNotIncludes(
  "src/components/pricing/ai-estimator/api/aiEstimatorApi.ts",
  "supabase.from('documents').select('*')",
  "AI estimator source-document lookup must not load full document rows"
);
[
  "'id'",
  "'project_id'",
  "'title'",
  "'category'",
  "'file_url'",
  "'ai_status'",
  "'ocr_status'",
  "'extracted_text_hash'",
  "'created_at'",
].forEach((column) => {
  assertIncludes(
    "src/components/pricing/ai-estimator/api/aiEstimatorApi.ts",
    column,
    `AI estimator source-document payload must include ${column}`
  );
});
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "useAiEstimatorState",
  "AI estimator modal must delegate state, effects, and actions to the local hook"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorSourceSelector",
  "AI estimator modal must delegate source selector JSX to a presentation component"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorFinancialSummary",
  "AI estimator modal must delegate financial summary JSX to a presentation component"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorEvidenceTrace",
  "AI estimator modal must delegate evidence trace JSX to a presentation component"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorExpertStrategy",
  "AI estimator modal must delegate expert strategy JSX to a presentation component"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorPricingForm",
  "AI estimator modal must delegate pricing input JSX to a presentation component"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorLoadingState",
  "AI estimator modal must delegate loading-state JSX to a presentation component"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "EstimatorReasoningPanel",
  "AI estimator modal must delegate reasoning and zero-match JSX to a presentation component"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "handleSourceChange",
  "AI estimator modal must not allow manual pricing-source selection"
);
assertNotIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorSourceSelector.tsx",
  "onSourceChange",
  "AI estimator source hierarchy must be read-only and contract-driven"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorSourceSelector.tsx",
  "currentSourceLabel",
  "AI estimator source selector must explain that pricing source detection is automatic"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorPricingForm.tsx",
  "pricingBasisLabel",
  "AI estimator pricing form must show the detected pricing basis as read-only"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "const hasPricingDraft = totalExclVat > 0",
  "AI estimator must treat a draft as real only when it has a positive pre-VAT amount"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "Pricing draft is incomplete: unit price and quantity must be positive before saving.",
  "AI estimator must block saving zero-value pricing drafts"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "hasPricingDraft={hasPricingDraft}",
  "AI estimator modal must pass draft completeness to all pricing UI surfaces"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorFinancialSummary.tsx",
  "disabled={isSubmitDisabled}",
  "AI estimator financial summary must disable saving incomplete pricing drafts"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorFinancialSummary.tsx",
  "blockReason ||",
  "AI estimator must explain why a zero-value pricing draft cannot be saved"
);
for (const aiEstimatorUserFacingFile of [
  "src/components/pricing/ai-estimator/components/EstimatorSourceSelector.tsx",
  "src/components/pricing/ai-estimator/components/EstimatorPricingForm.tsx",
  "src/components/pricing/ai-estimator/components/EstimatorReasoningPanel.tsx",
  "src/components/pricing/ai-estimator/components/EstimatorEvidenceTrace.tsx",
]) {
  assertNotIncludes(
    aiEstimatorUserFacingFile,
    "שוק",
    "AI estimator UI must not present market pricing as a contract source"
  );
  assertNotIncludes(
    aiEstimatorUserFacingFile,
    "סינתטי",
    "AI estimator UI must not present synthetic pricing terminology to users"
  );
  assertNotIncludes(
    aiEstimatorUserFacingFile,
    "סינתזה",
    "AI estimator UI must not present synthesis terminology to users"
  );
}
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "const handleMarkupPreset = React.useCallback",
  "AI estimator modal must pass a stable pricing form preset callback"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorSourceSelector.tsx",
  "export default React.memo(EstimatorSourceSelector)",
  "AI estimator source selector must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorPricingForm.tsx",
  "export default React.memo(EstimatorPricingForm)",
  "AI estimator pricing form must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorFinancialSummary.tsx",
  "export default React.memo(EstimatorFinancialSummary)",
  "AI estimator financial summary must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorEvidenceTrace.tsx",
  "export default React.memo(EstimatorEvidenceTrace)",
  "AI estimator evidence trace must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorExpertStrategy.tsx",
  "export default React.memo(EstimatorExpertStrategy)",
  "AI estimator expert strategy must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorLoadingState.tsx",
  "export default React.memo(EstimatorLoadingState)",
  "AI estimator loading state must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorReasoningPanel.tsx",
  "export default React.memo(EstimatorReasoningPanel)",
  "AI estimator reasoning panel must be memoized as a presentation component"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorPricingForm.tsx",
  "const MARKUP_PRESETS = [0, 10, 15, 20, 25]",
  "AI estimator pricing form must allow 0 percent overhead/profit"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "markup: prev.markup || 0",
  "AI estimator must not default zero-match pricing to contractor profit"
);
assertIncludes(
  "src/components/pricing/ai-estimator/components/EstimatorPricingBreakdown.tsx",
  "breakdown.map",
  "AI estimator must show a line-item pricing breakdown"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/evaluation-prompts.ts",
  "Do not return a naked total. Always return pricing_breakdown rows.",
  "AI pricing prompt must require a professional line-item pricing breakdown"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "Pricing draft requires user answers before approval.",
  "AI estimator must block approval when unanswered questions materially affect the price"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "const [transactionDisplayId] = useState(createTransactionDisplayId)",
  "AI estimator transaction display id must be stable across input re-renders"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "{ id: 'BOQ', label:",
  "AI estimator modal must not keep source selector option data inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "Math.random()",
  "AI estimator modal must not regenerate transaction display IDs during render"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "name=\"unitPrice\"",
  "AI estimator modal must not keep pricing input fields inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "[10, 15, 20, 25].map",
  "AI estimator modal must not keep markup preset rendering inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "מבצע ניתוח מעמיק",
  "AI estimator modal must not keep loading-state markup inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "estimateData?.ai_rationale",
  "AI estimator modal must not keep reasoning text rendering inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "zero_match_reason",
  "AI estimator modal must not keep zero-match warning rendering inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "initial={{ opacity: 0, x: -30 }}",
  "AI estimator modal must not keep expert strategy animation block inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "governing_notes?.map",
  "AI estimator modal must not keep evidence governing-note rendering inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "handleViewSource(ev)",
  "AI estimator modal must not keep evidence source buttons inline"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "fetch('/api/pricing/evaluate-ai'",
  "AI estimator modal must not keep the evaluate-ai HTTP request inline"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "evaluateAiPricing",
  "AI estimator state hook must delegate AI evaluation requests to the local API helper"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "fetchAiEstimatorSourceDocument",
  "AI estimator state hook must delegate source-document lookup to the local API helper"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "supabase.from('documents').select('*')",
  "AI estimator modal must not keep Supabase document lookup inline"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "getLedgerRowAmount",
  "AI estimator state hook preview must use the shared ledger amount helper"
);
assertIncludes(
  "src/components/pricing/ai-estimator/hooks/useAiEstimatorState.ts",
  "return {\n        state,\n        setters,\n        actions,\n        derived,",
  "AI estimator state hook must expose the standard state/setters/actions/derived contract"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "useState(",
  "AI estimator modal facade must not keep local state after hook extraction"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "useEffect(",
  "AI estimator modal facade must not keep effects after hook extraction"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "formState.quantity * formState.unitPrice",
  "AI estimator modal must not calculate preview totals with inline quantity/price arithmetic"
);
assertNotIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "data.source || (data.item_code === 'NEW' ? 'CUSTOM_ANALYSIS' : 'BOQ')",
  "AI estimator modal must not fallback to BOQ when the API did not explicitly return BOQ"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "new AiEstimatorService(supabase)",
  "AI evaluation route must delegate pricing orchestration to AiEstimatorService"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "export class AiEstimatorService",
  "AI pricing pipeline must expose a service boundary for automation"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "const context = await this.loadContext(input)",
  "AI pricing service must expose a staged loadContext pipeline step"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "buildBoqRawContext",
  "AI pricing context load must delegate raw BOQ prompt shaping to the context helper"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "const boqRawContext = buildBoqRawContext(toRecords(contractDocs as unknown))",
  "AI pricing context load must use the capped raw BOQ context builder"
);
assertNotIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  ".map((d: AnyRecord) => JSON.stringify(d.parsed_json))",
  "AI pricing context load must not stringify all parsed_json documents inline"
);
assertNotIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  ".join('\\n') || 'No existing BOQ found.'",
  "AI pricing context load must not join unbounded raw BOQ context inline"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "const CONTRADICTION_CONTEXT_SELECT_COLUMNS = [",
  "AI pricing context load must use an explicit contradiction column list"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  ".select(CONTRADICTION_CONTEXT_SELECT_COLUMNS)",
  "AI pricing context load must use the lightweight contradiction payload"
);
assertSectionNotIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "private async loadContext",
  "const { data: contractDocs }",
  ".select('*')",
  "AI pricing context load must not select full contradiction rows"
);
[
  "'id'",
  "'project_id'",
  "'title'",
  "'description'",
  "'category'",
  "'severity'",
  "'status'",
  "'pricing_status'",
  "'source_execution_doc_id'",
  "'target_contract_doc_id'",
  "'evidence_data'",
  "'created_at'",
].forEach((column) => {
  assertIncludes(
    "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
    column,
    `AI pricing contradiction context payload must include ${column}`
  );
});
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "const priceMatches = await this.findPriceMatches(input.projectId, context.keywords)",
  "AI pricing service must expose a staged findPriceMatches pipeline step"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "const pricingPrompt = this.buildPrompt(context, priceMatches)",
  "AI pricing service must expose a staged buildPrompt pipeline step"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "const evaluation = this.normalizeResponse(",
  "AI pricing service must expose a staged normalizeResponse pipeline step"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  ".eq('source', 'BOQ')",
  "AI evaluation must use only BOQ-sourced base contract rows"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "await syncProjectContractBase(this.supabase, projectId)",
  "AI evaluation must refresh project contract amount before building pricing context"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "await syncContractBoqToLedger(this.supabase, projectId, { contractorId })",
  "AI evaluation must refresh trusted BOQ ledger rows before building pricing context"
);
{
  const evaluateAiService = read("src/app/api/pricing/evaluate-ai/ai-estimator-service.ts");
  assert(
    evaluateAiService.indexOf("await syncContractBoqToLedger") < evaluateAiService.indexOf(".from('pricing_ledger')"),
    "AI evaluation must run BOQ ledger sync before fetching contract pricing_ledger rows"
  );
}
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "trustedLedgerMatches: ledgerMatchRows.filter(isTrustedBaseContractRow)",
  "AI evaluation must filter contract context through trusted BOQ evidence rules"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "boqContext: buildBoqContext(priceMatches.trustedLedgerMatches)",
  "AI evaluation prompt must use only trusted BOQ ledger matches for contract context"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "requirePricingEvaluationProjectAccess(supabase, projectId)",
  "AI evaluation route must delegate project access checks to the access helper"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/evaluation-access.ts",
  "auth.getUser()",
  "AI evaluation must authenticate with getUser before reading project pricing context"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/evaluation-access.ts",
  ".eq('contractor_id', user.id)",
  "AI evaluation must verify project ownership before reading project pricing context"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/evaluation-access.ts",
  "Project not found or forbidden",
  "AI evaluation access helper must reject missing or foreign projects"
);
assertRegex(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  /\.from\('contradictions'\)[\s\S]*\.eq\('project_id', projectId\)/,
  "AI evaluation must bind contradiction lookup to the requested project"
);
assertRegex(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  /\.from\('contradictions'\)[\s\S]*\.update\(\{[\s\S]*evidence_data: nextEvidenceData[\s\S]*\.eq\('id', contradictionId\)[\s\S]*\.eq\('project_id', projectId\)/,
  "AI evaluation must bind contradiction evidence updates to the requested project"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/evaluation-pricelists.ts",
  "isLikelyContractBoqPricelist",
  "AI evaluation pricelist helper must exclude local contract BOQ from external price references"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "description,",
  "AI evaluation must load pricelist descriptions before classifying BOQ price lists"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "pricelistMatches = filterExternalPricingReferences(toRecords(matches as unknown))",
  "AI evaluation must filter external pricelist matches before building the prompt"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  ".or(`pricelists.is_global.eq.true,pricelists.project_id.eq.${projectId}`)",
  "AI evaluation parent notes must be limited to global or current-project pricelists"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "appendUniqueParentNotes(pricelistMatches, toRecords(parentNotes as unknown))",
  "AI evaluation parent notes must use the same contract-BOQ exclusion filter"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "is_global,",
  "AI evaluation must load parent-note pricelist visibility metadata before filtering"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/ai-estimator-service.ts",
  "project_id",
  "AI evaluation must load parent-note pricelist project metadata before filtering"
);
assertIncludes(
  "src/app/api/chat/route.ts",
  "auth.getUser()",
  "chat financial context must authenticate with getUser"
);
assertIncludes(
  "src/app/api/chat/route.ts",
  ".eq('contractor_id', user.id)",
  "chat financial context must verify project ownership"
);
assertIncludes(
  "src/app/api/chat/route.ts",
  "await syncProjectContractBase(supabase, projectId)",
  "chat financial context must refresh project contract amount before reading pricing context"
);
assertIncludes(
  "src/app/api/chat/route.ts",
  "await syncContractBoqToLedger(supabase, projectId, { contractorId: user.id })",
  "chat financial context must refresh trusted BOQ ledger rows before reading pricing context"
);
{
  const chatRoute = read("src/app/api/chat/route.ts");
  assert(
    chatRoute.indexOf("await syncContractBoqToLedger") < chatRoute.indexOf(".from('pricing_ledger')"),
    "chat route must run BOQ ledger sync before fetching pricing_ledger rows"
  );
}
assertIncludes(
  "src/app/api/chat/route.ts",
  "getMoneySum([s, getLedgerRowVatAmount(i, VAT_RATE)])",
  "chat financial context must use rounded money summation for VO VAT"
);
assertIncludes(
  "src/app/api/chat/route.ts",
  "totalBaseExclVat > 0 ?",
  "chat prompt must show the trusted base contract amount from financial helpers"
);
assertNotIncludes(
  "src/app/api/chat/route.ts",
  "תקציב: ${project?.budget",
  "chat prompt must not present raw project budget as the contract base"
);
assertIncludes(
  "src/app/api/export/route.ts",
  ".eq('contractor_id', user.id)",
  "export financial context must verify project ownership"
);
assertIncludes(
  "src/app/api/export/route.ts",
  "await syncProjectContractBase(supabase, projectId)",
  "export financial context must refresh project contract amount before ledger export"
);
assertIncludes(
  "src/app/api/export/route.ts",
  "await syncContractBoqToLedger(supabase, projectId, { contractorId: user.id })",
  "export financial context must refresh trusted BOQ ledger rows before ledger export"
);
{
  const exportRoute = read("src/app/api/export/route.ts");
  assert(
    exportRoute.indexOf("await syncContractBoqToLedger") < exportRoute.indexOf(".from('pricing_ledger')"),
    "export route must run BOQ ledger sync before fetching pricing_ledger rows"
  );
}
assertIncludes(
  "src/components/features/DashboardContent.tsx",
  "total_price_excl_vat, evidence_data",
  "project cards must select evidence_data before applying trusted BOQ filters"
);
assertIncludes(
  "src/components/features/DashboardContent.tsx",
  "const handleSaveNewProject",
  "project creation must collect real project details before inserting"
);
assertNotIncludes(
  "src/components/features/DashboardContent.tsx",
  "פרויקט_${Math.floor",
  "project creation must not insert random demo-like project names"
);
assertIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  ".eq('contractor_id', user.id)",
  "pricing server page must verify project ownership before loading ledger data"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const syncResult = await syncBoqAndContract(projectId)",
  "modular pricing ledger state must sync trusted BOQ base rows before loading ledger rows"
);
assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "fetch('/api/projects/sync-contract-base'",
  "modular pricing ledger API must route BOQ contract sync through the server sync endpoint"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  ".from('pricing_ledger')",
  "pricing server page must not keep an initial ledger data path outside the modular ledger state"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  ".from('contradictions')",
  "pricing server page must not keep an initial queue data path outside the modular ledger state"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "SUPABASE_SERVICE_ROLE_KEY",
  "pricing server page must not use service role secrets"
);
assertIncludes(
  "src/app/api/projects/sync-contract-base/route.ts",
  "? createAdminClient(supabaseUrl, serviceRoleKey)",
  "project contract sync API may use service role when configured"
);
assertIncludes(
  "src/app/api/projects/sync-contract-base/route.ts",
  ": authClient",
  "project contract sync API must fall back to authenticated user client"
);
{
  const pricingLedgerState = read("src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts");
  assert(
    pricingLedgerState.indexOf("await syncBoqAndContract(projectId)") < pricingLedgerState.indexOf("fetchLedgerRows(projectId)"),
    "modular pricing ledger state must run BOQ ledger sync before fetching pricing ledger rows"
  );
}

assertIncludes(
  "src/app/api/projects/sync-contract-base/route.ts",
  "ledgerSync",
  "project contract sync API must return BOQ ledger sync evidence to callers"
);
assertIncludes(
  "src/utils/project-contract-base-client.ts",
  "ledgerSync?:",
  "client contract sync type must expose BOQ ledger sync result"
);

assertIncludes(
  "src/utils/pricing-ledger-contract-sync.ts",
  'type: "BASE_CONTRACT"',
  "only BOQ contract sync should create trusted BASE_CONTRACT rows"
);
assertIncludes(
  "src/utils/pricing-ledger-contract-sync.ts",
  'source: "BOQ"',
  "trusted base rows must be sourced from BOQ"
);
assertIncludes(
  "src/utils/pricing-ledger-contract-sync.ts",
  '.eq("contractor_id", options.contractorId)',
  "contract sync must be scoped to the project owner's pricelists when owner is known"
);
assertIncludes(
  "src/app/api/pricing/upload-universal/route.ts",
  "hasContractPricedQuantities",
  "universal upload must only sync priced BOQ-like content"
);
assertIncludes(
  "src/app/api/pricing/upload-universal/route.ts",
  "normalizePricelistItemType",
  "universal upload must normalize AI item types before storing pricelist items"
);
assertIncludes(
  "src/app/api/pricing/upload-universal/route.ts",
  "if (shouldSyncContractBoq)",
  "universal upload must fail project BOQ uploads when item insert fails before ledger sync"
);
assertIncludes(
  "supabase/migrations/0014_add_pricelist_item_note.sql",
  "ADD VALUE IF NOT EXISTS 'NOTE'",
  "database enum must accept NOTE rows emitted by the BOQ parser"
);
assertIncludes(
  "src/app/api/pricing/upload-universal/route.ts",
  ".eq('contractor_id', user.id)",
  "universal upload must verify project ownership before creating project-local BOQs"
);
assertIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "contractor_id: user.id",
  "Excel pricelist upload must persist ownership"
);
assertIncludes(
  "src/components/pricelists/PricelistsPageClient.tsx",
  "forceContractBoq: true",
  "Excel BOQ upload must trigger contract ledger sync"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  '.in("type", ["PENDING_VO", "APPROVED_VO"])',
  "VO letter API must fetch only VO rows server-side"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  "getLedgerRowAmount",
  "VO letter API must recalculate totals server-side"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  "voItemIds.length !== requestedItemIds.length",
  "VO letter API must reject mixed or invalid ledger item IDs"
);
assertIncludes(
  "src/app/api/generate-letter/route.ts",
  ".eq(\"contractor_id\", user.id)",
  "AI letter generation must verify project ownership"
);
assertIncludes(
  "src/app/api/generate-letter/route.ts",
  ".in(\"type\", [\"PENDING_VO\", \"APPROVED_VO\"])",
  "AI letter generation must fetch only VO rows server-side"
);
assertIncludes(
  "src/app/api/generate-letter/route.ts",
  "getLedgerRowAmount(item)",
  "AI letter generation must recalculate totals from server-fetched rows"
);
assertIncludes(
  "src/app/api/generate-letter/route.ts",
  "getAmountVat(totalExclVat, VAT_RATE)",
  "AI letter generation must calculate VAT server-side through shared helper"
);
assertIncludes(
  "src/app/api/generate-letter/route.ts",
  "אל תחשב סכומים מחדש",
  "AI letter prompt must forbid recalculating server financial totals"
);
assertIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "itemIds: selectedItems.map((item) => item.id)",
  "Smart letter generation must send item ids instead of client financial rows"
);
assertIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "canGenerate: Boolean(letterType && selectedItems.length)",
  "Smart letter generation must require at least one selected VO row"
);
assertIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "canSave: Boolean(generatedLetter && projectId && selectedLedgerItems.length)",
  "Smart letter save must require at least one selected VO row"
);
assertNotIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "onNavigate('letters', { contradictionId: c.id })",
  "Contradiction Radar must not open letters directly from a contradiction without pricing"
);
assertNotIncludes(
  "src/components/features/DashboardContent.tsx",
  "viewParams?.contradictionId ? [viewParams.contradictionId] : []",
  "Dashboard must not treat contradiction ids as selected VO letter item ids"
);
assertIncludes(
  "src/components/features/smart-letter/api/smartLetterApi.ts",
  'fetch("/api/pricing/vo-letters"',
  "Smart letter save must use the server VO letter API"
);
assertIncludes(
  "src/components/features/smart-letter/api/smartLetterApi.ts",
  'method: "DELETE"',
  "Smart letter delete must use the server VO letter API"
);
assertIncludes(
  "src/components/features/smart-letter/api/smartLetterApi.ts",
  "body: JSON.stringify({ letterId: id })",
  "Smart letter delete must send only the saved letter id to the server"
);
assertNotIncludes(
  "src/components/features/smart-letter/api/smartLetterApi.ts",
  ".delete()",
  "Smart letter API client must not delete VO letters directly through Supabase"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  "export async function DELETE",
  "VO letter API must expose a server-side delete endpoint"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  ".eq(\"projects.contractor_id\", user.id)",
  "VO letter delete must verify project ownership before deletion"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  ".from(\"vo_letter_items\")",
  "VO letter delete must remove linked letter item rows server-side"
);
assertIncludes(
  "src/app/api/pricing/vo-letters/route.ts",
  ".eq(\"project_id\", letter.project_id)",
  "VO letter delete must constrain deletion to the owned project"
);
assertNotIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  ".update({ type: 'SENT_VO' })",
  "Smart letter save must not update ledger status directly from the client"
);
assertIncludes(
  "src/components/features/SmartLetterGenerator.tsx",
  "items={printableItems}",
  "Smart letter UI must pass normalized printable ledger items into PrintableLetter"
);
assertIncludes(
  "src/components/pricing/PrintableLetter.tsx",
  "const letterItems = items.filter((item) => item.type !== 'BASE_CONTRACT')",
  "printable VO letters must defensively exclude BASE_CONTRACT rows"
);
assertIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "selectedItems.reduce(",
  "Smart letter derived totals must aggregate selected rows through an explicit reducer"
);
assertIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "getMoneySum([sum, getLedgerRowAmount(item)])",
  "Smart letter derived totals must use shared financial helpers instead of client-side row arithmetic"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "fetch('/api/contradictions'",
  "Contradiction Radar mutations must use the server contradiction API"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "export async function fetchRadarContradictions",
  "Contradiction Radar reads must be isolated behind the local API client"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "source_doc: documents!contradictions_source_execution_doc_id_fkey(id, title, file_url, storage_bucket, storage_path)",
  "Contradiction Radar API client must preserve source document evidence joins"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "export async function fetchRadarDocuments",
  "Contradiction Radar document reads must be isolated behind the local API client"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "export async function fetchRadarProjectName",
  "Contradiction Radar project-name reads must be isolated behind the local API client"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "export async function scanRadarProject",
  "Contradiction Radar full scan requests must be isolated behind the local API client"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "export async function rescanRadarItem",
  "Contradiction Radar item rescan requests must be isolated behind the local API client"
);
assertNotIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "fetch('/api/scan'",
  "Contradiction Radar state hook must not call the scan API directly"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "const data = await scanRadarProject(projectId, force)",
  "Contradiction Radar state hook must delegate full scans to the API client"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "const data = await rescanRadarItem(projectId, workDocId)",
  "Contradiction Radar state hook must delegate item rescans to the API client"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "export function useContradictionRadarState",
  "Contradiction Radar state must be isolated behind the local state hook"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "return {\n        state,\n        setters,\n        actions,\n        derived,",
  "Contradiction Radar hook must expose the standard state/setters/actions/derived contract"
);
assertIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "useContradictionRadarState({ projectId, projectName })",
  "Contradiction Radar UI facade must delegate state to the isolated hook"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "const toggleExpanded = useCallback",
  "Contradiction Radar hook must expose a stable expanded-row toggle"
);
assertIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "onToggleExpand={toggleExpanded}",
  "Contradiction Radar facade must pass a stable toggle callback to list rows"
);
assertIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "export default React.memo(ContradictionRadarFeedItem)",
  "Contradiction Radar feed item must be memoized for high-volume finding lists"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "const RADAR_ITEM_MOTION_THRESHOLD = 200",
  "Contradiction Radar hook must define a stable large-list motion threshold"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "shouldAnimateItems: filteredFindings.length <= RADAR_ITEM_MOTION_THRESHOLD",
  "Contradiction Radar derived state must disable row entrance animations for large finding lists"
);
assertIncludes(
  "src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts",
  "filteredFindings = filterRadarFindings(contradictions, activeFilter)",
  "Contradiction Radar derived state must expose the currently filtered finding list"
);
assertIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "onClick={() => handleFilterChange(option.id)}",
  "Contradiction Radar counters must behave as clickable finding filters"
);
assertIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "const findingReference = getRadarFindingReference(c)",
  "Contradiction Radar feed item must show a stable finding reference"
);
assertIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "shouldAnimate={derived.shouldAnimateItems}",
  "Contradiction Radar facade must pass the large-list motion gate to feed rows"
);
assertIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "const RowComponent = (shouldAnimate ? motion.div : 'div') as React.ElementType",
  "Contradiction Radar feed item must bypass framer-motion wrappers for large lists"
);
assertIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "transition: { delay: Math.min(idx, 10) * 0.05 }",
  "Contradiction Radar feed item animation delay must be capped for large lists"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "useState(",
  "Contradiction Radar UI facade must not keep local state after hook extraction"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "useEffect(",
  "Contradiction Radar UI facade must not keep effects after hook extraction"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  "fetchRadarContradictions",
  "Contradiction Radar UI facade must not call the local API client directly"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  ".from('documents')",
  "Contradiction Radar UI must not query project documents directly"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  ".from('projects')",
  "Contradiction Radar UI must not query project metadata directly"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  ".from('contradictions')",
  "Contradiction Radar UI must not query contradiction rows directly"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "method: 'PATCH'",
  "Contradiction Radar status changes must go through the server mutation endpoint"
);
assertIncludes(
  "src/components/features/contradiction-radar/api/contradictionRadarApi.ts",
  "method: 'DELETE'",
  "Contradiction Radar deletes must go through the server mutation endpoint"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  ".from('contradictions')\n                .update({ status: newStatus })",
  "Contradiction Radar must not update contradiction status directly from the client"
);
assertNotIncludes(
  "src/components/features/ContradictionRadar.tsx",
  ".from('contradictions')\n                .delete()",
  "Contradiction Radar must not delete contradictions directly from the client"
);
assertIncludes(
  "src/app/api/contradictions/route.ts",
  "export async function PATCH",
  "Contradiction API must expose a server-side status mutation endpoint"
);
assertIncludes(
  "src/app/api/contradictions/route.ts",
  "export async function DELETE",
  "Contradiction API must expose a server-side delete mutation endpoint"
);
assertIncludes(
  "src/app/api/contradictions/route.ts",
  "auth.getUser()",
  "Contradiction API must authenticate before mutating contradiction rows"
);
assertIncludes(
  "src/app/api/contradictions/route.ts",
  ".eq('contractor_id', user.id)",
  "Contradiction API must verify project ownership before mutation"
);
assertIncludes(
  "src/app/api/contradictions/route.ts",
  ".eq('project_id', projectId)",
  "Contradiction API mutations must be constrained to the requested project"
);
assertIncludes(
  "src/app/api/contradictions/route.ts",
  ".update({ status })",
  "Contradiction API must update status server-side after access checks"
);
assertIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "const updated = await onUpdateStatus(c.id, 'MOVED_TO_PRICING', c)",
  "Contradiction Radar must wait for server status update before navigating to pricing"
);
assertIncludes(
  "src/components/features/ContradictionRadarFeedItem.tsx",
  "if (updated && onNavigate)",
  "Contradiction Radar must navigate to pricing only after a successful server status update"
);

await verifyContractBoqLedgerSyncBehavior();
verifyProjectFinancialHelperBehavior();
verifyServerLetterEvidenceBehavior();
verifyServerDocumentAndLetterBoundaryStatics();
verifyProjectContractBaseBehavior();
await verifyPricingLedgerAiAutomationBehavior();
verifyPricingAiRouteModularizationBehavior();

console.log("Financial invariants verified.");
