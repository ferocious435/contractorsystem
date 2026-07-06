import { genAI, GEMINI_CONFIG } from "@/lib/gemini";
import { createClient } from "@/utils/supabase/server";
import { VAT_RATE } from "@/utils/constants";
import { getAmountVat, getLedgerRowAmount, getMoneySum } from "@/utils/project-financials";
import { formatEvidenceForLetter } from "@/utils/letter-evidence";
import { buildServerBackedLetterEvidence, getOfficialLetterEvidenceBlockers, type ServerLetterContradiction } from "@/utils/server-letter-evidence";
import { NextResponse } from "next/server";

const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.STABLE_FLASH });

type LetterLedgerItem = {
    id: string;
    contradiction_id?: string | null;
    evidence_data?: unknown;
    [key: string]: unknown;
};

function isOfficialLetterType(value: unknown) {
    return String(value || "").toLowerCase() === "official_vo";
}

function formatMoney(value: unknown) {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(numeric);
}


export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const { projectId, letterType, recipient, subject, keyPoints, tone, itemIds } = await req.json();

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ success: false, error: "API Key missing" }, { status: 500 });
        }

        const requestedItemIds = Array.isArray(itemIds)
            ? Array.from(new Set(itemIds.filter((id: unknown) => typeof id === "string" && id.trim())))
            : [];

        if (!projectId || !requestedItemIds.length) {
            return NextResponse.json({ success: false, error: "projectId and itemIds are required" }, { status: 400 });
        }

        const { data: project, error: projectError } = await supabase
            .from("projects")
            .select("id, name, client_name, contractor_id")
            .eq("id", projectId)
            .eq("contractor_id", user.id)
            .maybeSingle();

        if (projectError || !project) {
            return NextResponse.json({ success: false, error: "Project not found or not accessible" }, { status: 404 });
        }

        const { data: ledgerItems, error: ledgerItemsError } = await supabase
            .from("pricing_ledger")
            .select("id, type, item_code, description, unit, quantity, unit_price_excl_vat, total_price_excl_vat, ai_rationale, governing_notes, evidence_data, contradiction_id")
            .eq("project_id", projectId)
            .in("id", requestedItemIds)
            .in("type", ["PENDING_VO", "APPROVED_VO"]);

        if (ledgerItemsError) throw ledgerItemsError;

        const safeLedgerItems = (ledgerItems || []) as LetterLedgerItem[];

        if (safeLedgerItems.length !== requestedItemIds.length) {
            return NextResponse.json({
                success: false,
                error: "Letters can include only pending or approved variation items"
            }, { status: 400 });
        }

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

        const officialEvidenceFailures = isOfficialLetterType(letterType)
            ? safeLedgerItems.flatMap((item) => {
                const contradiction = item.contradiction_id ? contradictionsById.get(item.contradiction_id) : null;
                return getOfficialLetterEvidenceBlockers(item, contradiction).map((reason) => ({ itemId: item.id, reason }));
            })
            : [];

        if (officialEvidenceFailures.length > 0) {
            return NextResponse.json({
                success: false,
                error: "Official VO requires server-verified document evidence for every selected item",
                evidenceFailures: officialEvidenceFailures,
            }, { status: 400 });
        }

        const letterEvidenceByItemId = new Map(
            safeLedgerItems.map((item) => [
                item.id,
                buildServerBackedLetterEvidence(
                    item,
                    item.contradiction_id ? contradictionsById.get(item.contradiction_id) : null,
                ),
            ])
        );

        const totalExclVat = safeLedgerItems.reduce((sum: number, item) => getMoneySum([sum, getLedgerRowAmount(item)]), 0);
        const vatAmount = getAmountVat(totalExclVat, VAT_RATE);
        const totalInclVat = getMoneySum([totalExclVat, vatAmount]);

        const itemsContext = safeLedgerItems.map((item) => {
            const unitPrice = item.unit_price_excl_vat;
            const total = getLedgerRowAmount(item);
            return `
- פריט: ${item.description}
- קוד: ${item.item_code || "NEW"}
- כמות: ${item.quantity} ${item.unit}
- מחיר יחידה לפני מע"מ: ${formatMoney(unitPrice)}
- סה"כ לפני מע"מ: ${formatMoney(total)}
- נימוק: ${item.ai_rationale || "לא צוין"}
- הערות: ${JSON.stringify(item.governing_notes || [])}
- הוכחות:
${formatEvidenceForLetter(letterEvidenceByItemId.get(item.id))}
`;
        }).join("\n");

        const typeInstructions: Record<string, string> = {
            rfi: "זה מכתב הבהרה (RFI). הטון צריך להיות שאלתי, מקצועי וממוקד בהשלמת מידע חסר.",
            vo_request: "זו דרישת תשלום לחריגים. הטון צריך להגן על זכויות הקבלן, אך להישאר מקצועי ומבוסס ראיות.",
            official_vo: "זו פקודת שינויים רשמית. יש לנסח באופן סמכותי ומסכם, רק על בסיס מידע מאומת."
        };

        const prompt = `
אתה מומחה בכיר לניהול פרויקטי בנייה בישראל ולניסוח דרישות קבלן.
המערכת בנויה לטובת הקבלן: להגן על זכויותיו, לבסס חריגים, לשמור על רווחיות ולהציג דרישה מקצועית.

כתוב ${tone === "skeleton" ? "שלד מכתב" : "מכתב"} בעברית בלבד.

פרויקט: ${project.name || projectId}
נמען: ${recipient || "מזמין העבודה"}
סוג מכתב: ${letterType}
הנחיה לסוג: ${typeInstructions[letterType] || "מכתב מקצועי"}
נושא: ${subject || "דרישה לתשלום עבור חריגים ושינויים"}
דגשים מהמשתמש: ${keyPoints || "אין"}

פריטים:
${itemsContext}

סיכום כספי מחייב לפי נתוני השרת:
- סה"כ לפני מע"מ: ${formatMoney(totalExclVat)}
- מע"מ ${(VAT_RATE * 100).toFixed(0)}%: ${formatMoney(vatAmount)}
- סה"כ כולל מע"מ: ${formatMoney(totalInclVat)}

חוקי חובה:
- אל תציג טענה כוודאית אם סטטוס הראיות הוא REQUIRES_VERIFICATION.
- במקרה של ראיות חסרות, כתוב שהדרישה היא טיוטה/דורשת אימות והוסף מה חסר.
- השתמש רק בסיכום הכספי המחייב שמופיע למעלה. אל תחשב סכומים מחדש ואל תשנה מע"מ.
- כל סכום יוצג לפני מע"מ. מע"מ ${(VAT_RATE * 100).toFixed(0)}% יוצג בנפרד בלבד.
- הפרד בין עובדה ממסמך, מסקנת AI, ומה צריך לבדוק עכשיו.
- אל תכניס טקסט טכני על המערכת.

מבנה:
1. פתיחה רשמית.
2. רקע קצר.
3. פירוט החריגים והסימוכין.
4. סיכום כספי לפני מע"מ + מע"מ 18% בנפרד אם רלוונטי.
5. דרישה לפעולה/אישור/השלמת מידע.
6. חתימה.

החזר רק את נוסח המכתב.
`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        return NextResponse.json({ success: true, letter: text });
    } catch (error: unknown) {
        console.error("API Error:", error);
        const message = error instanceof Error ? error.message : "Letter generation failed";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
