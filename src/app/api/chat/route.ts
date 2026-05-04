import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { geminiModelText } from "@/lib/gemini";

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
            .select('title, doc_type, ai_status')
            .eq('project_id', projectId)
            .limit(20);

        const { data: contradictions } = await supabase
            .from('contradictions')
            .select('title, severity, category, status, description')
            .eq('project_id', projectId)
            .eq('status', 'OPEN')
            .limit(10);

        const { data: pricingSummary } = await supabase
            .from('pricing_ledger')
            .select('type, total_price_excl_vat, vat_amount, total_price_incl_vat')
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
        const totalBase = pricingSummary?.filter(i => i.type === 'BASE_CONTRACT')
            .reduce((s, i) => s + Number(i.total_price_incl_vat), 0) || 0;
        const totalVO = pricingSummary?.filter(i => i.type !== 'BASE_CONTRACT')
            .reduce((s, i) => s + Number(i.total_price_incl_vat), 0) || 0;

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
${documents?.map(d => `- ${d.title} (${d.doc_type}, סטטוס AI: ${d.ai_status})`).join('\n') || 'אין מסמכים'}

סתירות פתוחות (${contradictions?.length || 0}):
${contradictions?.map(c => `- [${c.category || c.severity}] ${c.title}: ${c.description || ''}`).join('\n') || 'אין סתירות'}

סיכום תמחור:
- חוזה בסיס כולל מע"מ: ₪${totalBase.toLocaleString('he-IL')}
- שינויים/חריגים כולל מע"מ: ₪${totalVO.toLocaleString('he-IL')}
- סה"כ: ₪${(totalBase + totalVO).toLocaleString('he-IL')}

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

        const chat = geminiModelText.startChat({
            history: [
                { role: 'user', parts: [{ text: 'מי אתה?' }] },
                { role: 'model', parts: [{ text: systemPrompt }] },
                ...chatHistory
            ]
        });

        const result = await chat.sendMessage(lastMessage.content);
        const responseText = result.response.text();

        return NextResponse.json({ success: true, response: responseText });

    } catch (error: any) {
        console.error("Error in /api/chat:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
