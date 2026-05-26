import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { geminiModelText } from "@/lib/gemini";

const isVerifiedEvidence = (evidenceData: any) => {
    if (Array.isArray(evidenceData)) return evidenceData.length > 0;
    const comparisonType = String(evidenceData?.comparison_type || '').toLowerCase();
    if (comparisonType.includes('missing_data')) return false;
    return evidenceData?.evidence_status === 'VERIFIED' || Boolean(evidenceData?.contract_quote && evidenceData?.work_quote);
};

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { messages, projectId } = body;

        if (!messages || !projectId) {
            return NextResponse.json({ error: "messages and projectId are required" }, { status: 400 });
        }

        // Загружаем контекст проекта
        const { data: project } = await supabase
            .from('projects')
            .select('name, budget, location, client_name, contractor_name')
            .eq('id', projectId)
            .single();

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
            .select('id, type, source, item_code, description, unit, quantity, unit_price_excl_vat, total_price_excl_vat, vat_amount, total_price_incl_vat, ai_rationale, governing_notes, evidence_data, contradiction_id')
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

        // Агрегируем данные сметы
        const baseItems = pricingSummary?.filter(i => i.type === 'BASE_CONTRACT') || [];
        const voItems = pricingSummary?.filter(i => i.type !== 'BASE_CONTRACT') || [];
        const totalBaseExclVat = baseItems.reduce((s, i) => s + Number(i.total_price_excl_vat || 0), 0);
        const totalBaseVat = baseItems.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
        const totalVoExclVat = voItems.reduce((s, i) => s + Number(i.total_price_excl_vat || 0), 0);
        const totalVoVat = voItems.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
        const verifiedContradictions = contradictions?.filter(c => isVerifiedEvidence(c.evidence_data)).length || 0;
        const needsVerificationContradictions = (contradictions?.length || 0) - verifiedContradictions;
        const zeroMatchItems = pricingSummary?.filter(i => (i.evidence_data as any)?.pricing_evaluation?.match_quality === 'ZERO_MATCH') || [];
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
תקציב: ${project?.budget ? `₪${Number(project.budget).toLocaleString('he-IL')}` : 'לא הוגדר'}
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
- סה"כ כולל מע"מ: ₪${(totalBaseExclVat + totalBaseVat + totalVoExclVat + totalVoVat).toLocaleString('he-IL')}

סעיפי הערה והנחיות חשובים מהחוזה (${governingNotes?.length || 0}):
${governingNotes?.map((n: any) => `- [${n.item_code || 'כללי'}] (${n.pricelists?.name}): ${n.description}`).join('\n') || 'אין הערות מיוחדות'}
=== סוף נתוני פרויקט ===
`;

        // Формируем историю чата для Gemini
        const chatHistory = messages.slice(0, -1).map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const lastMessage = messages[messages.length - 1];
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

        const result = await chat.sendMessage(`${contractorFirstContext}\n\nUser question:\n${lastMessage.content}`);
        const responseText = result.response.text();

        return NextResponse.json({ success: true, response: responseText });

    } catch (error: any) {
        console.error("Error in /api/chat:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
