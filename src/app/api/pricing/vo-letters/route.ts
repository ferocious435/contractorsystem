import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { VAT_RATE } from "@/utils/constants";
import { getAmountVat, getLedgerRowAmount, getMoneySum } from "@/utils/project-financials";
import { formatEvidenceForLetter } from "@/utils/letter-evidence";
import {
    buildServerBackedLetterEvidence,
    getOfficialLetterEvidenceBlockers,
    type ServerLetterContradiction,
} from "@/utils/server-letter-evidence";

type VoLetterLedgerItem = {
    id: string;
    contradiction_id?: string | null;
    evidence_data?: unknown;
    item_code?: string | null;
    description?: string | null;
    unit?: string | null;
    quantity?: number | null;
    unit_price_excl_vat?: number | null;
    total_price_excl_vat?: number | null;
    ai_rationale?: string | null;
    governing_notes?: unknown;
    [key: string]: unknown;
};

function isOfficialLetterType(value: unknown) {
    return String(value || "").toLowerCase() === "official_vo";
}

function formatMoney(value: unknown) {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(numeric);
}

function textValue(value: unknown, fallback = "") {
    return typeof value === "string" && value.trim() ? value : fallback;
}

function formatNotes(value: unknown) {
    if (Array.isArray(value)) {
        return value.map((note) => String(note)).filter(Boolean).join("; ");
    }

    if (typeof value === "string") {
        return value;
    }

    if (value && typeof value === "object") {
        return JSON.stringify(value);
    }

    return "";
}

function buildOfficialVoSubject(items: VoLetterLedgerItem[]) {
    const firstDescription = textValue(items[0]?.description, "server verified variation items");
    return `Official VO - ${firstDescription}`;
}

function buildOfficialVoServerContent({
    projectId,
    recipientName,
    items,
    contradictionsById,
    totalExclVat,
    vatAmount,
    totalInclVat,
}: {
    projectId: string;
    recipientName?: unknown;
    items: VoLetterLedgerItem[];
    contradictionsById: Map<string, ServerLetterContradiction>;
    totalExclVat: number;
    vatAmount: number;
    totalInclVat: number;
}) {
    const itemLines = items.map((item, index) => {
        const contradiction = item.contradiction_id ? contradictionsById.get(item.contradiction_id) : null;
        const evidence = buildServerBackedLetterEvidence(item, contradiction);
        const quantityLine = `   Quantity: ${String(item.quantity || "")} ${textValue(item.unit)}`.trim();

        return [
            `${index + 1}. ${textValue(item.description, "Variation item")}`,
            `   Code: ${textValue(item.item_code, "NEW")}`,
            quantityLine,
            `   Unit price excl. VAT: ${formatMoney(item.unit_price_excl_vat)}`,
            `   Total excl. VAT: ${formatMoney(getLedgerRowAmount(item))}`,
            `   Rationale: ${textValue(item.ai_rationale, "Server-priced item")}`,
            `   Notes: ${formatNotes(item.governing_notes) || "None"}`,
            "   Server evidence:",
            formatEvidenceForLetter(evidence)
                .split("\n")
                .map((line) => `   ${line}`)
                .join("\n"),
        ].join("\n");
    });

    return [
        "OFFICIAL VARIATION ORDER",
        "",
        `Project ID: ${projectId}`,
        `Recipient: ${textValue(recipientName, "Project owner")}`,
        "",
        "This official VO was generated on the server from verified project ledger rows and server-loaded contradiction evidence.",
        "Client-provided letter text is not used for this official document.",
        "",
        "Items:",
        itemLines.join("\n\n"),
        "",
        "Financial summary:",
        `Total excl. VAT: ${formatMoney(totalExclVat)}`,
        `VAT ${(VAT_RATE * 100).toFixed(0)}%: ${formatMoney(vatAmount)}`,
        `Total incl. VAT: ${formatMoney(totalInclVat)}`,
    ].join("\n");
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const {
            projectId,
            subject,
            recipientName,
            content,
            itemIds,
            docType
        } = await req.json();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        if (!projectId) {
            return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 });
        }

        const requestedItemIds = Array.isArray(itemIds)
            ? Array.from(new Set(itemIds.filter((id: unknown) => typeof id === "string" && id.trim())))
            : [];

        if (!requestedItemIds.length) {
            return NextResponse.json({ success: false, error: "At least one VO item is required" }, { status: 400 });
        }

        const { data: project, error: projectError } = await supabase
            .from("projects")
            .select("id")
            .eq("id", projectId)
            .eq("contractor_id", user.id)
            .maybeSingle();

        if (projectError) throw projectError;

        if (!project) {
            return NextResponse.json({ success: false, error: "Project not found or forbidden" }, { status: 403 });
        }

        const { data: ledgerItems, error: ledgerItemsError } = await supabase
            .from("pricing_ledger")
            .select("id, type, item_code, description, unit, quantity, unit_price_excl_vat, total_price_excl_vat, vat_rate, ai_rationale, governing_notes, contradiction_id, evidence_data")
            .eq("project_id", projectId)
            .in("id", requestedItemIds)
            .in("type", ["PENDING_VO", "APPROVED_VO"]);

        if (ledgerItemsError) throw ledgerItemsError;

        const safeLedgerItems = (ledgerItems || []) as VoLetterLedgerItem[];
        const voItemIds = safeLedgerItems.map((item) => item.id);
        if (voItemIds.length !== requestedItemIds.length) {
            return NextResponse.json(
                { success: false, error: "VO letters can include only pending or approved variation items" },
                { status: 400 }
            );
        }

        const isOfficial = isOfficialLetterType(docType);
        const contradictionIds = Array.from(new Set(
            safeLedgerItems
                .map((item) => item.contradiction_id)
                .filter((id): id is string => typeof id === "string" && id.length > 0)
        ));
        const contradictionsById = new Map<string, ServerLetterContradiction>();

        if (contradictionIds.length > 0) {
            const { data: contradictions, error: contradictionsError } = await supabase
                .from("contradictions")
                .select("id, status, source_execution_doc_id, target_contract_doc_id, evidence_data")
                .eq("project_id", projectId)
                .in("id", contradictionIds);

            if (contradictionsError) throw contradictionsError;
            ((contradictions || []) as ServerLetterContradiction[]).forEach((contradiction) => {
                if (typeof contradiction.id === "string") {
                    contradictionsById.set(contradiction.id, contradiction);
                }
            });
        }

        if (isOfficial) {
            const evidenceFailures = safeLedgerItems.flatMap((item) => {
                const contradiction = item.contradiction_id ? contradictionsById.get(item.contradiction_id) : null;
                return getOfficialLetterEvidenceBlockers(item, contradiction).map((reason) => ({ itemId: item.id, reason }));
            });

            if (evidenceFailures.length > 0) {
                return NextResponse.json({
                    success: false,
                    error: "Official VO requires server-verified document evidence for every selected item",
                    evidenceFailures,
                }, { status: 400 });
            }
        }

        const totalExclVat = safeLedgerItems.reduce((sum, item) => getMoneySum([sum, getLedgerRowAmount(item)]), 0);
        const vatAmount = getAmountVat(totalExclVat, VAT_RATE);
        const totalInclVat = getMoneySum([totalExclVat, vatAmount]);
        const subjectToStore = isOfficial ? buildOfficialVoSubject(safeLedgerItems) : subject;
        const contentToStore = isOfficial
            ? buildOfficialVoServerContent({
                projectId,
                recipientName,
                items: safeLedgerItems,
                contradictionsById,
                totalExclVat,
                vatAmount,
                totalInclVat,
            })
            : content;

        // 1. Create the VO Letter
        const { data: letter, error: letterError } = await supabase
            .from('vo_letters')
            .insert({
                project_id: projectId,
                subject: subjectToStore,
                recipient_name: recipientName,
                status: 'SENT',
                content: contentToStore,
                total_amount_excl_vat: totalExclVat,
                vat_amount: vatAmount,
                total_amount_incl_vat: totalInclVat,
                letter_number: `VO-${Math.floor(Date.now() / 1000)}`
            })
            .select()
            .single();

        if (letterError) throw letterError;

        // 2. Link items to the letter
        const letterItems = voItemIds.map((id: string, index: number) => ({
            letter_id: letter.id,
            ledger_item_id: id,
            sort_order: index
        }));

        const { error: itemsError } = await supabase
            .from('vo_letter_items')
            .insert(letterItems);

        if (itemsError) throw itemsError;

        // 3. Update status in pricing_ledger
        const { error: ledgerError } = await supabase
            .from('pricing_ledger')
            .update({ type: 'SENT_VO' })
            .eq('project_id', projectId)
            .in('id', voItemIds)
            .in('type', ['PENDING_VO', 'APPROVED_VO']);

        if (ledgerError) throw ledgerError;

        return NextResponse.json({ success: true, letterId: letter.id });
    } catch (error: unknown) {
        console.error("VO Letter Save Error:", error);
        const message = error instanceof Error ? error.message : "Failed to save VO letter";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const supabase = await createClient();
        const { letterId } = await req.json();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        if (!letterId || typeof letterId !== "string") {
            return NextResponse.json({ success: false, error: "letterId is required" }, { status: 400 });
        }

        const { data: letter, error: lookupError } = await supabase
            .from("vo_letters")
            .select("id, project_id, projects!inner(contractor_id)")
            .eq("id", letterId)
            .eq("projects.contractor_id", user.id)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (!letter) {
            return NextResponse.json({ success: false, error: "VO letter not found or forbidden" }, { status: 404 });
        }

        const { error: deleteItemsError } = await supabase
            .from("vo_letter_items")
            .delete()
            .eq("letter_id", letterId);

        if (deleteItemsError) throw deleteItemsError;

        const { error: deleteLetterError } = await supabase
            .from("vo_letters")
            .delete()
            .eq("id", letterId)
            .eq("project_id", letter.project_id);

        if (deleteLetterError) throw deleteLetterError;

        return NextResponse.json({ success: true, deletedId: letterId });
    } catch (error: unknown) {
        console.error("VO Letter Delete Error:", error);
        const message = error instanceof Error ? error.message : "Failed to delete VO letter";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
