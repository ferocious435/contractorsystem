import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { geminiModelText } from "@/lib/gemini";
import { VAT_RATE } from "@/utils/constants";
import { syncProjectContractBase } from "@/utils/project-contract-base-server";
import { syncContractBoqToLedger } from "@/utils/pricing-ledger-contract-sync";
import {
    getAmountVat,
    getLedgerRowVatAmount,
    getMoneySum,
    getPreferredProjectAmount,
    getVariationOrderAmount,
    isVisibleLedgerRow,
} from "@/utils/project-financials";

type AnyRecord = Record<string, unknown>;
type ChatMessage = { role?: unknown; content?: unknown };

const isRecord = (value: unknown): value is AnyRecord =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toChatMessages = (value: unknown): ChatMessage[] | null =>
    Array.isArray(value)
        ? value.map((item) => (isRecord(item) ? item : {}))
        : null;

const firstRecord = (value: unknown): AnyRecord | null => {
    if (isRecord(value)) return value;
    if (Array.isArray(value)) {
        const [first] = value;
        return isRecord(first) ? first : null;
    }
    return null;
};

const getPricelistName = (value: unknown) => {
    const pricelist = firstRecord(value);
    return typeof pricelist?.name === "string" ? pricelist.name : undefined;
};

const isVerifiedEvidence = (evidenceData: unknown) => {
    if (Array.isArray(evidenceData)) return evidenceData.length > 0;
    if (!evidenceData || typeof evidenceData !== "object") return false;

    const evidence = evidenceData as Record<string, unknown>;
    const comparisonType = String(evidence.comparison_type || '').toLowerCase();
    if (comparisonType.includes('missing_data')) return false;
    return evidence.evidence_status === 'VERIFIED' || Boolean(evidence.contract_quote && evidence.work_quote);
};

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const requestBody = isRecord(body) ? body : {};
        const messages = toChatMessages(requestBody.messages);
        const projectId = typeof requestBody.projectId === "string" ? requestBody.projectId : "";

        if (!messages || !projectId) {
            return NextResponse.json({ error: "messages and projectId are required" }, { status: 400 });
        }

        // Загружаем контекст проекта
        const { data: ownedProject, error: ownershipError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('contractor_id', user.id)
            .maybeSingle();

        if (ownershipError) {
            throw ownershipError;
        }

        if (!ownedProject) {
            return NextResponse.json({ error: "Project not found or forbidden" }, { status: 403 });
        }

        await syncProjectContractBase(supabase, projectId);
        await syncContractBoqToLedger(supabase, projectId, { contractorId: user.id });

        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('name, budget, location, client_name, contractor_name')
            .eq('id', projectId)
            .eq('contractor_id', user.id)
            .maybeSingle();

        if (projectError) {
            throw projectError;
        }

        if (!project) {
            return NextResponse.json({ error: "Project not found or forbidden" }, { status: 403 });
        }

        const { data: documents } = await supabase
            .from('documents')
            .select('id, title, category, ai_status, ocr_status, immutable_code, evidence_index')
            .eq('project_id', projectId)
            .limit(20);

        const { data: contradictions } = await supabase
            .from('contradictions')
            .select('id, title, severity, category, status, description, evidence_data, pricing_status')
            .eq('project_id', projectId)
            .eq('status', 'OPEN')
            .limit(10);

        const { data: pricingSummary } = await supabase
            .from('pricing_ledger')
            .select('id, type, source, item_code, description, unit, quantity, unit_price_excl_vat, total_price_excl_vat, vat_rate, ai_rationale, governing_notes, evidence_data, contradiction_id')
            .eq('project_id', projectId);

        // Fetch project-specific governing notes (סעיפי הערה)
        const { data: governingNotes } = await supabase
            .from('pricelist_items')
            .select(`
                item_code,
                description,
                pricelists!inner (name)
            `)
            .eq('item_type', 'NOTE')
            .eq('pricelists.project_id', projectId)
            .limit(50);
        const governingNoteRows = (governingNotes || []) as unknown as AnyRecord[];

        // Агрегируем данные сметы
        const visiblePricingItems = pricingSummary?.filter(isVisibleLedgerRow) || [];
        const voItems = visiblePricingItems.filter(i => i.type !== 'BASE_CONTRACT');
        const totalBaseExclVat = getPreferredProjectAmount(project?.budget, pricingSummary);
        const totalBaseVat = getAmountVat(totalBaseExclVat, VAT_RATE);
        const totalVoExclVat = getVariationOrderAmount(visiblePricingItems);
        const totalVoVat = voItems.reduce((s, i) => getMoneySum([s, getLedgerRowVatAmount(i, VAT_RATE)]), 0);
        const grandTotalInclVat = getMoneySum([totalBaseExclVat, totalBaseVat, totalVoExclVat, totalVoVat]);
        const verifiedContradictions = contradictions?.filter(c => isVerifiedEvidence(c.evidence_data)).length || 0;
        const needsVerificationContradictions = (contradictions?.length || 0) - verifiedContradictions;
        const zeroMatchItems = visiblePricingItems.filter(i => (i.evidence_data as { pricing_evaluation?: { match_quality?: string } } | null | undefined)?.pricing_evaluation?.match_quality === 'ZERO_MATCH') || [];
        const pendingPricingItems = contradictions?.filter(c => c.pricing_status !== 'ESTIMATED').length || 0;

        // Формируем системный промпт с контекстом
        const systemPrompt = `
אתה יועץ AI מקצועי לקבלני בניה בישראל. 
שמך: "קבלן PRO AI".

הנחיות חשובות:
- ענה תמיד בעברית.
- כל הסכומים בשקלים (₪). 
- הפרד תמיד בין מחיר ללא מע"מ, מע"מ, ומחיר כולל מע"מ.
- תן תשובות מקצועיות אך ידידותיות.
- השתמש בידע שלך על חוזי בניה ישראליים, כתבי כמויות, ותקנות.
- דגש קריטי: סעיפי הערה והנחיות (NOTE) הם המחייבים ביותר בחוזה. אם משתמש שואל על היקף עבודה או מה כלול במחיר, בדוק קודם כל את סעיפי ההערה הרלוונטיים לפני שתענה.

=== נתוני הפרויקט הנוכחי ===
שם הפרויקט: ${project?.name || 'לא ידוע'}
חוזה בסיס ללא מע"מ: ${totalBaseExclVat > 0 ? `₪${totalBaseExclVat.toLocaleString('he-IL')}` : 'לא הוגדר'}
מיקום: ${project?.location || 'לא ידוע'}
לקוח: ${project?.client_name || 'לא ידוע'}
קבלן: ${project?.contractor_name || 'לא ידוע'}

מסמכים (${documents?.length || 0}):
${documents?.map(d => `- ${d.title} (${d.category}, סטטוס AI: ${d.ai_status})`).join('\n') || 'אין מסמכים'}

סתירות פתוחות (${contradictions?.length || 0}):
${contradictions?.map(c => `- [${c.category || c.severity}] ${c.title}: ${c.description || ''}`).join('\n') || 'אין סתירות'}

סיכום תמחור:
- חוזה בסיס ללא מע"מ: ₪${totalBaseExclVat.toLocaleString('he-IL')}
- מע"מ חוזה בסיס (18%): ₪${totalBaseVat.toLocaleString('he-IL')}
- שינויים/חריגים ללא מע"מ: ₪${totalVoExclVat.toLocaleString('he-IL')}
- מע"מ שינויים/חריגים (18%): ₪${totalVoVat.toLocaleString('he-IL')}
- סה"כ כולל מע"מ: ₪${grandTotalInclVat.toLocaleString('he-IL')}

סעיפי הערה והנחיות חשובים מהחוזה (${governingNotes?.length || 0}):
${governingNoteRows.map((n) => `- [${n.item_code || 'כללי'}] (${getPricelistName(n.pricelists)}): ${n.description}`).join('\n') || 'אין הערות מיוחדות'}
=== סוף נתוני פרויקט ===
`;

        // Формируем историю чата для Gemini
        const chatHistory = messages.slice(0, -1).map((msg) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(msg.content || '') }]
        }));

        const lastMessage = messages[messages.length - 1] || {};
        const contractorFirstContext = `
Contractor-first operating rules:
- The system is built for the contractor's benefit. Protect contractor margin, identify extra works (חריגים), and help prepare substantiated claims.
- Answer in Hebrew only, short and practical.
- Separate every answer into: what is known from documents, what is AI inference, what is not verified, financial impact, and next action.
- Never present an AI assumption as a verified fact. If evidence is missing, say exactly what document/photo/site diary/approval is needed.
- All money must be treated as excluding VAT first. Show VAT at 18% separately only when relevant.
- Verified open findings: ${verifiedContradictions}
- Findings requiring verification: ${needsVerificationContradictions}
- Open findings not yet priced: ${pendingPricingItems}
- Zero-match pricing items: ${zeroMatchItems.length}
`;

        const chat = geminiModelText.startChat({
            history: [
                { role: 'user', parts: [{ text: 'מי אתה?' }] },
                { role: 'model', parts: [{ text: systemPrompt }] },
                ...chatHistory
            ]
        });

        const result = await chat.sendMessage(`${contractorFirstContext}\n\nUser question:\n${String(lastMessage.content || '')}`);
        const responseText = result.response.text();

        return NextResponse.json({ success: true, response: responseText });

    } catch (error: unknown) {
        console.error("Error in /api/chat:", error);
        const message = error instanceof Error ? error.message : "Internal Server Error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
