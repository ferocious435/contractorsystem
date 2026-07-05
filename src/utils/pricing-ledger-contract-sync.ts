import { VAT_RATE } from "./constants";
import type { SupabaseClient } from "@supabase/supabase-js";

type ContractPricelist = {
    id: string;
    contractor_id?: string | null;
    name?: string | null;
    description?: string | null;
    is_global?: boolean | null;
    project_id?: string | null;
};

type PricelistItem = {
    id: string;
    pricelist_id: string;
    item_type?: string | null;
    item_code?: string | null;
    description?: string | null;
    unit?: string | null;
    quantity?: number | string | null;
    rate?: number | string | null;
    notes?: string | null;
    activity_number?: string | null;
};

export type ContractLedgerSyncResult = {
    projectId: string;
    eligiblePricelists: number;
    candidateItems: number;
    inserted: number;
    updated: number;
    skipped: number;
};

function normalizeSearchText(value: string | null | undefined) {
    return (value || "").toLowerCase().replace(/[^\dA-Za-z\u0590-\u05FF]+/g, " ");
}

function toNumber(value: unknown, fallback = 0) {
    if (typeof value === "string") {
        const parsed = Number(value.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}

export function isLikelyContractBoqPricelist(pricelist: ContractPricelist): boolean {
    if (pricelist.is_global) {
        return false;
    }

    const text = normalizeSearchText(`${pricelist.name || ""} ${pricelist.description || ""}`);
    const boqSignals = [
        "boq",
        "bill of quantities",
        "contract",
        "tender",
        "execution",
        "כתב כמויות",
        "כמויות",
        "חוזה",
        "הסכם",
        "מכרז",
        "לביצוע",
    ];

    return boqSignals.some((signal) => text.includes(normalizeSearchText(signal).trim()));
}

function normalizeContractItem(item: PricelistItem) {
    const itemCode = String(item.item_code || "").trim();
    const description = String(item.description || "").trim();
    const unitPrice = roundMoney(toNumber(item.rate, 0));

    if (String(item.item_type || "ITEM").toUpperCase() !== "ITEM") {
        return null;
    }

    if (!itemCode || !description || unitPrice <= 0) {
        return null;
    }

    return {
        sourceItemId: item.id,
        sourcePricelistId: item.pricelist_id,
        item_code: itemCode,
        description,
        unit: item.unit || null,
        quantity: toNumber(item.quantity, 0),
        unit_price_excl_vat: unitPrice,
    };
}

export async function syncContractBoqToLedger(
    supabase: SupabaseClient,
    projectId: string,
    options: { pricelistIds?: string[]; forceContractBoq?: boolean; contractorId?: string } = {}
): Promise<ContractLedgerSyncResult> {
    const result: ContractLedgerSyncResult = {
        projectId,
        eligiblePricelists: 0,
        candidateItems: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
    };

    let pricelistQuery = supabase
        .from("pricelists")
        .select("id, contractor_id, name, description, is_global, project_id")
        .eq("project_id", projectId)
        .eq("is_global", false);

    if (options.contractorId) {
        pricelistQuery = pricelistQuery.eq("contractor_id", options.contractorId);
    }

    if (options.pricelistIds?.length) {
        pricelistQuery = pricelistQuery.in("id", options.pricelistIds);
    }

    const { data: pricelists, error: pricelistsError } = await pricelistQuery;
    if (pricelistsError) {
        throw pricelistsError;
    }

    const eligiblePricelists = (pricelists || []).filter((pricelist: ContractPricelist) =>
        options.forceContractBoq || isLikelyContractBoqPricelist(pricelist)
    );
    result.eligiblePricelists = eligiblePricelists.length;

    if (!eligiblePricelists.length) {
        return result;
    }

    const eligiblePricelistIds = eligiblePricelists.map((pricelist: ContractPricelist) => pricelist.id);

    const { data: pricelistItems, error: itemsError } = await supabase
        .from("pricelist_items")
        .select("id, pricelist_id, item_type, item_code, description, unit, quantity, rate, notes, activity_number")
        .in("pricelist_id", eligiblePricelistIds)
        .eq("item_type", "ITEM");

    if (itemsError) {
        throw itemsError;
    }

    const normalizedItems = (pricelistItems || [])
        .map(normalizeContractItem)
        .filter((item): item is NonNullable<ReturnType<typeof normalizeContractItem>> => Boolean(item));

    result.candidateItems = normalizedItems.length;

    if (!normalizedItems.length) {
        return result;
    }

    const { data: existingRows, error: existingError } = await supabase
        .from("pricing_ledger")
        .select("id, item_code, evidence_data")
        .eq("project_id", projectId)
        .eq("type", "BASE_CONTRACT")
        .eq("source", "BOQ");

    if (existingError) {
        throw existingError;
    }

    const existingBySourceItemId = new Map<string, { id: string }>();
    const existingByCode = new Map<string, { id: string }>();
    for (const row of existingRows || []) {
        const sourceItemId = row.evidence_data?.pricelist_item_id;
        if (sourceItemId && !existingBySourceItemId.has(sourceItemId)) {
            existingBySourceItemId.set(sourceItemId, { id: row.id });
            continue;
        }

        if (row.item_code && !existingByCode.has(row.item_code)) {
            existingByCode.set(row.item_code, { id: row.id });
        }
    }

    const rowsToInsert = [];
    const claimedLegacyCodes = new Set<string>();

    for (const item of normalizedItems) {
        const ledgerPayload = {
            project_id: projectId,
            type: "BASE_CONTRACT",
            source: "BOQ",
            item_code: item.item_code,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unit_price_excl_vat: item.unit_price_excl_vat,
            vat_rate: VAT_RATE,
            evidence_data: {
                source: "pricelist_items",
                pricelist_id: item.sourcePricelistId,
                pricelist_item_id: item.sourceItemId,
            },
        };

        const legacyCodeMatch = existingByCode.get(item.item_code);
        const existing = existingBySourceItemId.get(item.sourceItemId) ||
            (legacyCodeMatch && !claimedLegacyCodes.has(item.item_code) ? legacyCodeMatch : null);
        if (existing?.id) {
            claimedLegacyCodes.add(item.item_code);
            const { error: updateError } = await supabase
                .from("pricing_ledger")
                .update(ledgerPayload)
                .eq("id", existing.id);

            if (updateError) {
                throw updateError;
            }

            result.updated += 1;
            continue;
        }

        rowsToInsert.push(ledgerPayload);
        existingBySourceItemId.set(item.sourceItemId, { id: "" });
    }

    result.skipped = normalizedItems.length - result.updated - rowsToInsert.length;

    if (rowsToInsert.length) {
        const { error: insertError } = await supabase
            .from("pricing_ledger")
            .insert(rowsToInsert);

        if (insertError) {
            throw insertError;
        }

        result.inserted = rowsToInsert.length;
    }

    return result;
}
