import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { genAI, GEMINI_CONFIG, DOCUMENT_ANALYSIS_PROMPT } from '@/lib/gemini';

/**
 * POST /api/documents/process
 * 
 * קורא את המסמך באמצעות Gemini AI ומחלץ מידע מובנה.
 * עובד עם כל סוגי המסמכים: חוזים, כתבי כמויות, פרוטוקולים, מכתבים וכו'.
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

        // 1. Получаем документ из БД
        const { data: doc, error: fetchError } = await supabase
            .from('documents')
            .select('*')
            .eq('id', documentId)
            .single();

        if (fetchError || !doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        // 2. Обновляем статус на PROCESSING
        await supabase
            .from('documents')
            .update({ ai_status: 'PROCESSING' })
            .eq('id', documentId);

        // 3. Анализируем документ через Gemini AI
        let parsedData: any;

        try {
            const model = genAI.getGenerativeModel({
                model: GEMINI_CONFIG.STABLE_FLASH,
                generationConfig: {
                    responseMimeType: "application/json",
                },
            });

            // Проверяем, есть ли уже извлечённый текст
            if (doc.extracted_text && doc.extracted_text.length > 50) {
                // Текстовый документ — отправляем текст в Gemini
                console.log(`[process] Analyzing text for "${doc.title}" (${doc.extracted_text.length} chars)`);

                const result = await model.generateContent([
                    DOCUMENT_ANALYSIS_PROMPT,
                    `Document title: "${doc.title}"\nDocument category set by user: ${doc.category}\n\nDocument content:\n${doc.extracted_text.substring(0, 30000)}`
                ]);

                const responseText = result.response.text();
                parsedData = JSON.parse(responseText);

            } else if (doc.file_url) {
                // Скан/изображение — скачиваем и отправляем как изображение в Gemini Vision
                console.log(`[process] Vision analysis for "${doc.title}"`);

                const fileResponse = await fetch(doc.file_url);
                if (!fileResponse.ok) {
                    throw new Error(`Failed to download file: ${fileResponse.status}`);
                }

                const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
                const contentType = fileResponse.headers.get('content-type') || 'application/pdf';

                // Определяем MIME тип для Gemini
                let mimeType = contentType;
                if (doc.title?.toLowerCase().endsWith('.pdf')) mimeType = 'application/pdf';
                else if (doc.title?.toLowerCase().match(/\.(jpg|jpeg)$/)) mimeType = 'image/jpeg';
                else if (doc.title?.toLowerCase().endsWith('.png')) mimeType = 'image/png';

                const result = await model.generateContent([
                    DOCUMENT_ANALYSIS_PROMPT,
                    `Document title: "${doc.title}"\nDocument category set by user: ${doc.category}`,
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: fileBuffer.toString('base64'),
                        }
                    }
                ]);

                const responseText = result.response.text();
                parsedData = JSON.parse(responseText);

            } else {
                // Нет ни текста, ни файла
                parsedData = {
                    type: doc.category === 'CONTRACT' ? 'מסמך חוזי' : 'מסמך עבודה',
                    category: doc.category,
                    summary: 'לא ניתן לקרוא את המסמך — אין קובץ או טקסט',
                    warnings: ['לא נמצא תוכן לקריאה'],
                    status: 'נקלט ✓'
                };
            }

            // Добавляем статус
            parsedData.status = 'נקלט ✓';

        } catch (aiError: any) {
            console.error("[process] Gemini AI error:", aiError);

            // Fallback — если AI упал, сохраняем базовую классификацию
            parsedData = classifyByTitle(doc.title, doc.category);
            parsedData.warnings = [`שגיאת AI: ${aiError.message || 'שגיאה לא ידועה'}. סיווג בוצע לפי שם הקובץ.`];
        }

        // 4. Сохраняем результат — документ VALIDATED (проверен и подключён)
        const { error: updateError } = await supabase
            .from('documents')
            .update({
                ai_status: 'VALIDATED',
                parsed_json: parsedData
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

        // Обновляем статус на ERROR
        try {
            const supabase = await createClient();
            const { documentId } = await (error as any)._req?.json?.() || {};
            if (documentId) {
                await supabase
                    .from('documents')
                    .update({ ai_status: 'ERROR' })
                    .eq('id', documentId);
            }
        } catch { /* ignore cleanup errors */ }

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * Fallback: סיווג לפי שם הקובץ (כשה-AI לא זמין)
 */
function classifyByTitle(title: string, category: string): any {
    const lower = title.toLowerCase();

    if (lower.includes('כמות') || lower.includes('כמויות') || lower.includes('boq')) {
        return { type: 'כתב כמויות', category: 'CONTRACT', summary: 'כתב כמויות — סווג לפי שם הקובץ' };
    }
    if (lower.includes('הסכם') || lower.includes('חוזה')) {
        return { type: 'הסכם', category: 'CONTRACT', summary: 'הסכם — סווג לפי שם הקובץ' };
    }
    if (lower.includes('מפרט')) {
        return { type: 'מפרט טכני', category: 'CONTRACT', summary: 'מפרט טכני — סווג לפי שם הקובץ' };
    }
    if (lower.includes('פרוטוקול') || lower.includes('סיכום ישיבה')) {
        return { type: 'פרוטוקול ישיבה', category: 'EXECUTION', summary: 'פרוטוקול ישיבה — סווג לפי שם הקובץ' };
    }
    if (lower.includes('מחירון') || lower.includes('דקל')) {
        return { type: 'מחירון', category: 'PRICELIST', summary: 'מחירון — סווג לפי שם הקובץ' };
    }

    return {
        type: category === 'CONTRACT' ? 'מסמך חוזי' : category === 'PRICELIST' ? 'מחירון' : 'מסמך עבודה',
        category,
        summary: 'מסמך שנקלט למערכת — סווג לפי שם הקובץ'
    };
}
