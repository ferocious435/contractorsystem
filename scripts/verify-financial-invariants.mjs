import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
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

function installTypeScriptRequireHook() {
  const ts = require("typescript");

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

function verifyProjectContractBaseBehavior() {
  installTypeScriptRequireHook();
  const { resolveProjectContractBase } = require(path.join(root, "src/utils/project-contract-base.ts"));

  const agreementResolution = resolveProjectContractBase([
    {
      title: "הסכם א",
      extracted_text: "סך הכל 100.10 סהכ כללי",
      parsed_json: { type: "חוזה" },
    },
    {
      title: "הסכם ב",
      extracted_text: "סך הכל 0.20 סהכ כללי",
      parsed_json: { type: "חוזה" },
    },
  ]);

  assert(agreementResolution.strategy === "CONTRACT_SUM", "contract resolver must sum agreement documents only in agreement mode");
  assert(agreementResolution.amount === 100.3, "contract resolver must round cumulative agreement totals to two decimals");
}

const filesToScanForInlineTotals = [
  "src/app/api/generate-letter/route.ts",
  "src/app/api/export/route.ts",
  "src/app/api/chat/route.ts",
  "src/components/features/AIPanel.tsx",
  "src/components/features/LedgerTable.tsx",
  "src/components/features/PricingLedgerUI.tsx",
  "src/components/features/SmartLetterGenerator.tsx",
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  "src/components/pricing/GenerateVOLetterModal.tsx",
  "src/components/pricing/AIEstimatorModal.tsx",
  "src/components/pricing/LedgerTable.tsx",
  "src/components/pricing/PricingLedgerTable.tsx",
  "src/components/pricing/PrintableLetter.tsx",
  "src/utils/pdfGenerator.ts",
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
  "return roundMoney(normalizeAmount(row.quantity) * normalizeAmount(row.unit_price_excl_vat))",
  "shared row amount helper must round quantity times unit price"
);
assertIncludes(
  "src/utils/project-financials.ts",
  "if (isTrustedBaseContractRow(row))",
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
  "src/components/pricing/LedgerTable.tsx",
  "total_price_incl_vat",
  "ledger item UI type must not model gross totals as pricing_ledger data"
);
assertNotIncludes(
  "src/components/pricing/LedgerTable.tsx",
  "vat_amount",
  "ledger item UI type must not model VAT amount as pricing_ledger data"
);

assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "requestedType === 'BASE_CONTRACT' ? 'PENDING_VO' : requestedType",
  "manual save-ledger must downgrade BASE_CONTRACT to PENDING_VO"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "unit_price_excl_vat is required",
  "manual save-ledger must require explicit pre-VAT unit price"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
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
  "ALLOWED_TYPES = new Set(['BASE_CONTRACT', 'APPROVED_VO', 'PENDING_VO', 'SENT_VO'])",
  "manual save-ledger must not allow SENT_VO without a VO letter"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  ".eq('contractor_id', user.id)",
  "manual save-ledger must verify project ownership"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "existingLedgerItem.type === 'BASE_CONTRACT'",
  "manual save-ledger must reject updates to existing BASE_CONTRACT rows"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  "export async function DELETE",
  "manual save-ledger API must own ledger deletes server-side"
);
assertIncludes(
  "src/app/api/pricing/save-ledger/route.ts",
  ".neq('type', 'BASE_CONTRACT')",
  "manual save-ledger API must defensively exclude BASE_CONTRACT writes"
);
assertIncludes(
  "src/app/api/pricing/update-status/route.ts",
  "ALLOWED_STATUS_UPDATES",
  "status updates must be allow-listed"
);
assertIncludes(
  "src/app/api/pricing/update-status/route.ts",
  "ledgerItem.type === 'BASE_CONTRACT'",
  "status updates must reject existing BASE_CONTRACT rows"
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
  "src/components/features/PricingLedgerUI.tsx",
  "const isSelectableVariationOrder = (item: LedgerItem)",
  "pricing ledger UI must define a strict selectable VO predicate"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "item.type === 'PENDING_VO' || item.type === 'APPROVED_VO'",
  "letter selection must be restricted to pending or approved VO rows"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "initialSelectedItems={selectedVOIds}",
  "letter modal must receive only VO row ids"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "fetch('/api/pricing/save-ledger'",
  "pricing ledger UI must save ledger rows through the server API"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
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
  "src/components/pricing/PricingLedgerTable.tsx",
  "disabled={!isSelectable}",
  "non-selectable rows must not be selectable for VO letters"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const selectableItems = ledgerItems.filter(isSelectableVariationOrder)",
  "pricing ledger table must allow selecting only pending or approved VO rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "disabled={isBaseContract}",
  "BASE_CONTRACT rows must be read-only in the ledger table"
);
assertIncludes(
  "src/components/pricing/LedgerTable.tsx",
  "const selectableItems = visibleItems.filter(isSelectableVariationOrder)",
  "legacy ledger table must allow selecting only pending or approved VO rows"
);
assertIncludes(
  "src/components/pricing/LedgerTable.tsx",
  "(item.type === 'PENDING_VO' || item.type === 'APPROVED_VO')",
  "legacy ledger selectable predicate must exclude sent VO rows"
);
assertIncludes(
  "src/components/pricing/LedgerTable.tsx",
  "getBaseContractAmount(visibleItems)",
  "legacy ledger table must show base contract total through shared helpers"
);
assertIncludes(
  "src/components/pricing/LedgerTable.tsx",
  "getVariationOrderAmount(visibleItems)",
  "legacy ledger table must show VO total separately through shared helpers"
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
  "src/components/pricing/AIEstimatorModal.tsx",
  "if (!res.ok)",
  "AI estimator modal must not treat failed evaluations as usable prices"
);
assertIncludes(
  "src/components/pricing/AIEstimatorModal.tsx",
  "getLedgerRowAmount",
  "AI estimator modal preview must use the shared ledger amount helper"
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
  ".eq('source', 'BOQ')",
  "AI evaluation must use only BOQ-sourced base contract rows"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "await syncProjectContractBase(supabase as any, projectId)",
  "AI evaluation must refresh project contract amount before building pricing context"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "await syncContractBoqToLedger(supabase as any, projectId, { contractorId: user.id })",
  "AI evaluation must refresh trusted BOQ ledger rows before building pricing context"
);
{
  const evaluateAiRoute = read("src/app/api/pricing/evaluate-ai/route.ts");
  assert(
    evaluateAiRoute.indexOf("await syncContractBoqToLedger") < evaluateAiRoute.indexOf(".from('pricing_ledger')"),
    "AI evaluation must run BOQ ledger sync before fetching contract pricing_ledger rows"
  );
}
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "const trustedLedgerMatches = (ledgerMatches || []).filter(isTrustedBaseContractRow)",
  "AI evaluation must filter contract context through trusted BOQ evidence rules"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "auth.getUser()",
  "AI evaluation must authenticate with getUser before reading project pricing context"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  ".eq('contractor_id', user.id)",
  "AI evaluation must verify project ownership before reading project pricing context"
);
assertRegex(
  "src/app/api/pricing/evaluate-ai/route.ts",
  /\.from\('contradictions'\)[\s\S]*\.eq\('project_id', projectId\)/,
  "AI evaluation must bind contradiction lookup to the requested project"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "isLikelyContractBoqPricelist",
  "AI evaluation must exclude local contract BOQ from external price references"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "description,",
  "AI evaluation must load pricelist descriptions before classifying BOQ price lists"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "pricelistMatches = (matches || []).filter",
  "AI evaluation must filter external pricelist matches before building the prompt"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  ".or(`pricelists.is_global.eq.true,pricelists.project_id.eq.${projectId}`)",
  "AI evaluation parent notes must be limited to global or current-project pricelists"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "const filteredParentNotes = (parentNotes || []).filter",
  "AI evaluation parent notes must use the same contract-BOQ exclusion filter"
);
assertIncludes(
  "src/app/api/pricing/evaluate-ai/route.ts",
  "description,\n                                is_global,\n                                project_id",
  "AI evaluation must load parent-note pricelist metadata before filtering"
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
  "await syncProjectContractBase(supabase as any, projectId)",
  "chat financial context must refresh project contract amount before reading pricing context"
);
assertIncludes(
  "src/app/api/chat/route.ts",
  "await syncContractBoqToLedger(supabase as any, projectId, { contractorId: user.id })",
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
  "חוזה בסיס ללא מע\"מ: ${totalBaseExclVat > 0",
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
  "await syncProjectContractBase(supabase as any, projectId)",
  "export financial context must refresh project contract amount before ledger export"
);
assertIncludes(
  "src/app/api/export/route.ts",
  "await syncContractBoqToLedger(supabase as any, projectId, { contractorId: user.id })",
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
  "src/app/dashboard/[id]/pricing/page.tsx",
  "await syncContractBoqToLedger",
  "pricing server page must sync trusted BOQ base rows before initial ledger load"
);
assertIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "await syncContractBoqToLedger(supabase as any",
  "pricing server page must not silently skip BOQ sync when service role is unavailable"
);
assertNotIncludes(
  "src/app/dashboard/[id]/pricing/page.tsx",
  "SUPABASE_SERVICE_ROLE_KEY",
  "pricing server page refresh sync must use the authenticated server client"
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
  const pricingPage = read("src/app/dashboard/[id]/pricing/page.tsx");
  assert(
    pricingPage.indexOf("await syncContractBoqToLedger") < pricingPage.indexOf(".from('pricing_ledger')"),
    "pricing server page must run BOQ ledger sync before fetching initial pricing_ledger rows"
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
  "src/components/features/smart-letter/api/smartLetterApi.ts",
  'fetch("/api/pricing/vo-letters"',
  "Smart letter save must use the server VO letter API"
);
assertNotIncludes(
  "src/components/features/smart-letter/hooks/useSmartLetterState.ts",
  ".update({ type: 'SENT_VO' })",
  "Smart letter save must not update ledger status directly from the client"
);
assertIncludes(
  "src/components/pricing/GenerateVOLetterModal.tsx",
  "itemIds: selectedItems.map(i => i.id)",
  "VO letter modal must send item ids instead of client financial rows"
);
assertIncludes(
  "src/components/pricing/GenerateVOLetterModal.tsx",
  "i.type !== 'BASE_CONTRACT'",
  "VO letter modal preview totals must defensively exclude BASE_CONTRACT rows"
);
assertIncludes(
  "src/components/pricing/PrintableLetter.tsx",
  "const letterItems = items.filter((item) => item.type !== 'BASE_CONTRACT')",
  "printable VO letters must defensively exclude BASE_CONTRACT rows"
);
assertIncludes(
  "src/utils/pdfGenerator.ts",
  "const letterItems = items.filter((item) => item.type !== 'BASE_CONTRACT')",
  "PDF VO letters must defensively exclude BASE_CONTRACT rows"
);

await verifyContractBoqLedgerSyncBehavior();
verifyProjectFinancialHelperBehavior();
verifyProjectContractBaseBehavior();

console.log("Financial invariants verified.");
