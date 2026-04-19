import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/utils/supabase/server";

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey || "");

const letterModel = genAI.getGenerativeModel({
    model: "gemini-3.1-pro",
});

const LETTER_TYPES: Record<string, string> = {
    claim: 'מכתב תביעה / דרישה (претензия)',
    notice: 'הודעה רשמית (официальное уведомление)',
    vo_request: 'בקשת חריג / שינוי (запрос на дополнительную работу)',
    response: 'תשובה ללקוח / מזמין (ответ заказчику)',
    general: 'מכתב כללי (общее письмо)'
};

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { projectId, letterType, recipient, subject, keyPoints, tone } = body;

        if (!projectId || !letterType) {
            return NextResponse.json({ error: "projectId and letterType are required" }, { status: 400 });
        }

        // Контекст проекта
        const { data: project } = await supabase
            .from('projects')
            .select('name, client_name, contractor_name, location')
            .eq('id', projectId)
            .single();

        const prompt = `
אתה כותב מכתבים מקצועי לקבלני בניה בישראל.

כתוב ${LETTER_TYPES[letterType] || 'מכתב'} עבור הפרויקט הבא:
- שם הפרויקט: ${project?.name || 'לא ידוע'}
- שם הקבלן (שולח): ${project?.contractor_name || '[שם הקבלן]'}
- שם הלקוח/מזמין: ${project?.client_name || '[שם המזמין]'}
- מיקום: ${project?.location || 'לא ידוע'}

פרטי המכתב:
- נמען: ${recipient || '[נמען]'}
- נושא: ${subject || '[נושא]'}
- נקודות מפתח: ${keyPoints || 'לא צוינו'}
- טון: ${tone === 'formal' ? 'פורמלי ומקצועי' : tone === 'firm' ? 'תקיף אך מקצועי' : 'ידידותי ומקצועי'}

הנחיות:
1. כתוב בעברית תקנית מקצועית.
2. כלול תאריך, כותרת, גוף, וחתימה.
3. התייחס לסעיפי חוזה רלוונטיים אם מתאים.
4. סכומים תמיד בשקלים (₪).
5. הפרד בין סכומים ללא מע"מ ועם מע"מ כשרלוונטי.
6. תן מכתב מוכן לשליחה — לא טיוטה.
`;

        const result = await letterModel.generateContent(prompt);
        const responseText = result.response.text();

        return NextResponse.json({ success: true, letter: responseText });

    } catch (error: any) {
        console.error("Error in /api/generate-letter:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
