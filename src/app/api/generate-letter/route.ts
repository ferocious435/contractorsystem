import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { geminiModel } from "@/lib/gemini";

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
        const { projectId, letterType, recipient, subject, keyPoints, tone, items } = body;

        if (!projectId || !letterType) {
            return NextResponse.json({ error: "projectId and letterType are required" }, { status: 400 });
        }

        // Контекст проекта
        const { data: project } = await supabase
            .from('projects')
            .select('name, client_name, contractor_name, location')
            .eq('id', projectId)
            .single();

        // Подготовка списка работ для промпта
        const itemsList = items && Array.isArray(items) 
            ? items.map((i: any) => `- ${i.description} (קוד: ${i.code || '---'}): ${i.quantity} ${i.unit} x ${i.price} ₪ = ${i.total} ₪`).join('\n')
            : 'לא צוינו סעיפים ספציפיים';

        // Расчет итогов для AI (чтобы он не ошибся в арифметике)
        const totalExclVat = items?.reduce((sum: number, i: any) => sum + i.total, 0) || 0;
        const vat = totalExclVat * 0.18;
        const totalInclVat = totalExclVat + vat;

        const prompt = `
אתה כותב מכתבים מקצועי ומומחה לניהול תביעות ושינויים (Variation Orders - V.O) עבור קבלני בניה בישראל.
המטרה: להוציא מכתב רשמי, משפטי וברור שדורש תשלום או מודיע על שינויים בלו"ז/תקציב.

סוג המכתב: ${LETTER_TYPES[letterType] || 'מכתב'}
טון: ${tone === 'formal' ? 'פורמלי ומקצועי' : tone === 'firm' ? 'תקיף וחד משמעי (התראה)' : 'ענייני ומקצועי'}

פרטי הפרויקט:
- שם הפרויקט: ${project?.name || 'לא ידוע'}
- הקבלן המבצע (השולח): ${project?.contractor_name || '[שם הקבלן]'}
- המזמין/לקוח: ${project?.client_name || '[שם המזמין]'}
- מיקום: ${project?.location || 'לא ידוע'}

פרטי הנמען והנושא:
- נמען: ${recipient || '[נמען]'}
- נושא: ${subject || '[נושא]'}

פירוט הסעיפים והעבודות (הכנס את זה לתוך תוכן המכתב בצורה זורמת):
${itemsList}

נתונים כספיים לסיכום (חובה להשתמש בהם במדויק):
- סה"כ לפני מע"מ: ${totalExclVat.toLocaleString()} ₪
- מע"מ (18%): ${vat.toLocaleString()} ₪
- סה"כ כולל מע"מ: ${totalInclVat.toLocaleString()} ₪

הנחיות כתיבה:
1. כתוב בעברית ברמה גבוהה (High-level Hebrew).
2. פתח בברכה רשמית (לכבוד... א.נ...).
3. בגוף המכתב, הסבר את הצורך בביצוע העבודות החריגות/נוספות ואזכר את הסעיפים שצוינו.
4. ציין במפורש שהמחירים אינם כוללים מע"מ ושיש להוסיף מע"מ כחוק (18%).
5. סיים בדרישה לתיאום חשבון או אישור העבודות ובחתימה רשמית.
6. אל תשתמש בסימנים של Markdown (כמו **) בתוך הטקסט של המכתב עצמו - תן טקסט נקי שניתן להעתיק.

המכתב המבוקש:
`;

        const result = await geminiModel.generateContent(prompt);
        const responseText = result.response.text();

        return NextResponse.json({ success: true, letter: responseText });

    } catch (error: any) {
        console.error("Error in /api/generate-letter:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
