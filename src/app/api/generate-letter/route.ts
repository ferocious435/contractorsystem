import { genAI, GEMINI_CONFIG } from "@/lib/gemini";
import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.STABLE_FLASH });

function isVerifiedEvidence(evidenceData: any) {
    if (Array.isArray(evidenceData)) {
        return evidenceData.length > 0;
    }

    if (!evidenceData || typeof evidenceData !== "object") {
        return false;
    }

    const comparisonType = String(evidenceData.comparison_type || "").toLowerCase();
    if (comparisonType.includes("missing_data")) {
        return false;
    }

    return evidenceData.evidence_status === "VERIFIED" || Boolean(evidenceData.contract_quote && evidenceData.work_quote);
}

function formatEvidenceForLetter(evidenceData: any) {
    if (Array.isArray(evidenceData) && evidenceData.length > 0) {
        return evidenceData
            .map((ev: any) => `- ${ev.document_title || "מסמך"} (עמ' ${ev.page || "?"})`)
            .join("\n");
    }

    if (!evidenceData || typeof evidenceData !== "object") {
        return "- אין הוכחות מתועדות. יש לנסח כטיוטה הדורשת אימות.";
    }

    const lines: string[] = [];
            const evidenceStatus = isVerifiedEvidence(evidenceData) ? "VERIFIED" : "REQUIRES_VERIFICATION";
    lines.push(`- סטטוס ראיות: ${evidenceStatus}`);

    if (evidenceData.contract_title || evidenceData.contract_quote) {
        lines.push(`- חוזה/BOQ: ${evidenceData.contract_title || "מסמך חוזי"}${evidenceData.contract_page ? `, עמ' ${evidenceData.contract_page}` : ""}`);
        if (evidenceData.contract_quote) lines.push(`  ציטוט חוזי: "${evidenceData.contract_quote}"`);
    }

    if (evidenceData.work_title || evidenceData.work_quote) {
        lines.push(`- ביצוע/שטח: ${evidenceData.work_title || "מסמך ביצוע"}${evidenceData.work_page ? `, עמ' ${evidenceData.work_page}` : ""}`);
        if (evidenceData.work_quote) lines.push(`  ציטוט ביצוע: "${evidenceData.work_quote}"`);
    }

    if (evidenceData.pricing_evaluation) {
        lines.push(`- תמחור: ${evidenceData.pricing_evaluation.match_quality || "לא ידוע"} / מקור: ${evidenceData.pricing_evaluation.source || "לא ידוע"}`);
        if (evidenceData.pricing_evaluation.quantity_basis) {
            lines.push(`- בסיס כמות: ${evidenceData.pricing_evaluation.quantity_basis}`);
        }
        if (evidenceData.pricing_evaluation.quantity_review_required) {
            lines.push(`- כמות לתמחור: דורשת אימות סופי לפני אישור מלא`);
        }
        if (evidenceData.pricing_evaluation.ancillary_scope && evidenceData.pricing_evaluation.ancillary_scope !== "NONE") {
            lines.push(`- עבודות נלוות: ${evidenceData.pricing_evaluation.ancillary_scope}`);
        }
    }

    if (Array.isArray(evidenceData.missing_evidence) && evidenceData.missing_evidence.length > 0) {
        lines.push(`- חסר לאימות: ${evidenceData.missing_evidence.join(", ")}`);
    }

    return lines.join("\n");
}

function formatMoney(value: any) {
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

        const { projectId, letterType, recipient, subject, keyPoints, tone, items } = await req.json();

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ success: false, error: "API Key missing" }, { status: 500 });
        }

        if (!projectId || !Array.isArray(items)) {
            return NextResponse.json({ success: false, error: "projectId and items are required" }, { status: 400 });
        }

        const hasUnverifiedItems = items.some((item: any) => {
            const evidenceData = item.evidence_data;
            if (Array.isArray(evidenceData)) return evidenceData.length === 0;
            return !isVerifiedEvidence(evidenceData);
        });

        if (letterType === "official_vo" && hasUnverifiedItems) {
            return NextResponse.json({
                success: false,
                error: "Official VO requires verified evidence for every selected item"
            }, { status: 400 });
        }

        const { data: project, error: projectError } = await supabase
            .from("projects")
            .select("id, name, client_name, contractor_id")
            .eq("id", projectId)
            .single();

        if (projectError || !project) {
            return NextResponse.json({ success: false, error: "Project not found or not accessible" }, { status: 404 });
        }

        const itemsContext = items.map((item: any) => {
            const unitPrice = item.price ?? item.unit_price_excl_vat;
            const total = item.total ?? item.total_price_excl_vat;
            return `
- פריט: ${item.description}
- קוד: ${item.code || item.item_code || "NEW"}
- כמות: ${item.quantity} ${item.unit}
- מחיר יחידה לפני מע"מ: ${formatMoney(unitPrice)}
- סה"כ לפני מע"מ: ${formatMoney(total)}
- נימוק: ${item.ai_rationale || "לא צוין"}
- הערות: ${JSON.stringify(item.governing_notes || [])}
- הוכחות:
${formatEvidenceForLetter(item.evidence_data)}
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

חוקי חובה:
- אל תציג טענה כוודאית אם סטטוס הראיות הוא REQUIRES_VERIFICATION.
- במקרה של ראיות חסרות, כתוב שהדרישה היא טיוטה/דורשת אימות והוסף מה חסר.
- כל סכום יוצג לפני מע"מ. מע"מ 18% יוצג בנפרד בלבד.
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
    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
