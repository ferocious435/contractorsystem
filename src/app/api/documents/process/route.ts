import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * POST /api/documents/process
 * 
 * כל המסמכים נקלטים אוטומטית (VALIDATED).
 * המערכת לא מבקשת אימות ידני — המשתמש לא אמור לקרוא ולאשר מסמכים.
 * 
 * התראה מופיעה רק אם מזוהות סתירות בין מסמכים באותה קטגוריה.
 */
export async function POST(req: Request) {
    try {
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { documentId } = await req.json();

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        // Получаем данные документа
        const { data: doc, error: fetchError } = await supabase
            .from('documents')
            .select('*')
            .eq('id', documentId)
            .single();

        if (fetchError || !doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        // Обновляем статус на PROCESSING
        await supabase
            .from('documents')
            .update({ ai_status: 'PROCESSING' })
            .eq('id', documentId);

        // Имитация обработки AI (2 секунды)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Генерируем метаданные на основе типа документа
        const parsedData = classifyDocument(doc.title, doc.category);

        // ВСЕ документы автоматически VALIDATED — пользователь никогда не должен вручную проверять
        const { error: updateError } = await supabase
            .from('documents')
            .update({
                ai_status: 'VALIDATED',
                parsed_json: parsedData
                // Удалено обновление category, чтобы не перезаписывать изначальный выбор пользователя
            })
            .eq('id', documentId);

        if (updateError) throw updateError;

        return NextResponse.json({
            success: true,
            autoValidated: true,
            message: `המסמך "${parsedData.type}" נסרק ונקלט בהצלחה ✓`,
            parsed_json: parsedData
        });

    } catch (error: any) {
        console.error("Error processing document:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * סיווג מסמך לפי שם ומאפיינים
 * כל המסמכים נקלטים אוטומטית — אין סטטוס "דורש אימות"
 */
function classifyDocument(title: string, category: string): any {
    const lowerTitle = title.toLowerCase();

    // --- מסמכי חוזה ---

    // הסכם
    if (lowerTitle.includes('הסכם')) {
        return {
            type: 'הסכם',
            category: 'CONTRACT',
            summary: 'הסכם עבודה בין הצדדים',
            status: 'נקלט ✓'
        };
    }

    // מפרט
    if (lowerTitle.includes('מפרט')) {
        return {
            type: 'מפרט טכני',
            category: 'CONTRACT',
            summary: 'מפרט טכני לביצוע עבודות',
            status: 'נקלט ✓'
        };
    }

    // כתב כמויות / BOQ
    if (lowerTitle.includes('כמות') || lowerTitle.includes('כמויות') || lowerTitle.includes('boq')) {
        return {
            type: 'כתב כמויות',
            category: 'CONTRACT',
            summary: 'כתב כמויות ומחירים',
            status: 'נקלט ✓'
        };
    }

    // מכרז
    if (lowerTitle.includes('מכרז')) {
        return {
            type: 'חוברת מכרז',
            category: 'CONTRACT',
            summary: 'מסמך מכרז עם תנאים מסחריים',
            status: 'נקלט ✓'
        };
    }

    // אבני דרך
    if (lowerTitle.includes('אבני דרך')) {
        return {
            type: 'אבני דרך',
            category: 'CONTRACT',
            summary: 'לוח אבני דרך לביצוע',
            status: 'נקלט ✓'
        };
    }

    // --- מסמכי עבודה ---

    // פרוטוקול ישיבה (MUST be BEFORE תבע check)
    if (lowerTitle.includes('פרוטוקול') || lowerTitle.includes('סיכום ישיבה')) {
        return {
            type: 'פרוטוקול ישיבה',
            category: 'EXECUTION',
            summary: 'פרוטוקול ישיבת מעקב',
            date: extractDateFromTitle(title),
            status: 'נקלט ✓'
        };
    }

    // תבע / תשתיות
    if (lowerTitle.includes('תבע') || lowerTitle.includes('תשתיות')) {
        return {
            type: category === 'CONTRACT' ? 'כתב כמויות תשתיות' : 'דוח תשתיות',
            category,
            summary: 'מסמך הנדסי הקשור לתשתיות הפרויקט',
            status: 'נקלט ✓'
        };
    }

    // חשבון
    if (lowerTitle.includes('חשבון') || lowerTitle.includes('חשבונית')) {
        return {
            type: 'חשבון/חשבונית',
            category: 'EXECUTION',
            summary: 'חשבון ביצוע לתקופה',
            status: 'נקלט ✓'
        };
    }

    // --- מחירונים ---
    if (category === 'PRICELIST' || lowerTitle.includes('מחירון') || lowerTitle.includes('דקל') || lowerTitle.includes('price')) {
        let priceType = 'מחירון כללי';
        if (lowerTitle.includes('דקל')) priceType = 'מחירון דקל';
        if (lowerTitle.includes('קבלן')) priceType = 'מחירון קבלן';
        if (lowerTitle.includes('ענפי')) priceType = 'מחירון ענפי';
        if (lowerTitle.includes('משרד')) priceType = 'מחירון משרד השיכון';

        return {
            type: priceType,
            category: 'PRICELIST',
            summary: `${priceType} — ישמש לחישוב ותמחור פריטים`,
            status: 'נקלט ✓'
        };
    }

    // Default
    return {
        type: category === 'CONTRACT' ? 'מסמך חוזי' : category === 'PRICELIST' ? 'מחירון' : 'מסמך עבודה',
        category,
        summary: 'מסמך שנקלט למערכת',
        status: 'נקלט ✓'
    };
}

/**
 * חילוץ תאריך משם הקובץ
 */
function extractDateFromTitle(title: string): string {
    const dateMatch = title.match(/(\d{2}\.\d{2}\.\d{2,4})/);
    if (dateMatch) return dateMatch[1];
    return '';
}
