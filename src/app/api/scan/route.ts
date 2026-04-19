import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const geminiApiKey = process.env.GEMINI_API_KEY!;

// Лимит символов на документ для Gemini 3.1 Pro (поддерживает длинный контекст)
const MAX_TEXT_LENGTH = 15000;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, documents: clientDocuments } = body;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        // Документы приходят с фронтенда (обход RLS без service role key)
        let documents = clientDocuments;

        // Если фронт не передал — пробуем загрузить сами
        if (!documents || documents.length === 0) {
            try {
                const supabase = createClient(supabaseUrl, supabaseKey);
                const { data, error } = await supabase
                    .from("documents")
                    .select("id, title, category, ai_status, extracted_text, file_url")
                    .eq("project_id", projectId);

                if (!error && data && data.length > 0) {
                    documents = data;
                }
            } catch (e) {
                console.warn("Could not fetch documents from DB:", e);
            }
        }

        if (!documents || documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        // Разделяем документы по категориям
        const contractDocs = documents.filter((d: any) => d.category === "CONTRACT");
        const workDocs = documents.filter((d: any) => d.category === "EXECUTION");

        if (contractDocs.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכי חוזה להשוואה" });
        }
        if (workDocs.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכי עבודה להשוואה" });
        }

        // ========================================================
        // AUTO TEXT EXTRACTION: если у документов нет extracted_text —
        // автоматически извлекаем текст из PDF через pdf-parse.
        // Больше не блокируем сканирование с ложным предупреждением OCR.
        // ========================================================
        const supabaseForUpdate = createClient(supabaseUrl, supabaseKey);
        const allDocs = [...contractDocs, ...workDocs];

        for (const doc of allDocs) {
            // Пропускаем если текст уже извлечён
            if (doc.extracted_text && doc.extracted_text.length > 10 && !doc.extracted_text.startsWith("[NON-PDF")) {
                continue;
            }

            // Пробуем автоматически извлечь текст
            try {
                const isPDF = doc.title?.toLowerCase().endsWith(".pdf") || (doc.file_url && doc.file_url.toLowerCase().includes(".pdf"));

                if (isPDF && doc.file_url) {
                    console.log(`[scan/auto-extract] Extracting text from PDF: "${doc.title}"`);
                    const pdfResponse = await fetch(doc.file_url);
                    if (pdfResponse.ok) {
                        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const pdfParse = require("pdf-parse");
                        const pdfData = await pdfParse(pdfBuffer);
                        const extractedText = pdfData.text || "";

                        if (extractedText.length > 0) {
                            // Сохраняем в БД
                            await supabaseForUpdate
                                .from("documents")
                                .update({ extracted_text: extractedText })
                                .eq("id", doc.id);

                            // Обновляем объект в памяти для дальнейшего анализа
                            doc.extracted_text = extractedText;
                            console.log(`[scan/auto-extract] Extracted ${extractedText.length} chars from "${doc.title}"`);
                        }
                    }
                } else if (!isPDF && doc.file_url) {
                    // Для не-PDF файлов (Word и т.д.) — помечаем
                    const marker = `[NON-PDF: ${doc.title}]`;
                    await supabaseForUpdate
                        .from("documents")
                        .update({ extracted_text: marker })
                        .eq("id", doc.id);
                    doc.extracted_text = marker;
                }
            } catch (extractErr) {
                console.warn(`[scan/auto-extract] Failed to extract text from "${doc.title}":`, extractErr);
            }
        }

        // Теперь фильтруем документы с реальным текстом
        const contractsWithText = contractDocs.filter(
            (d: any) => d.extracted_text && d.extracted_text.length > 10 && !d.extracted_text.startsWith("[NON-PDF")
        );
        const workWithText = workDocs.filter(
            (d: any) => d.extracted_text && d.extracted_text.length > 10 && !d.extracted_text.startsWith("[NON-PDF")
        );

        if (contractsWithText.length === 0 || workWithText.length === 0) {
            return NextResponse.json({
                success: false,
                found: 0,
                message: "לא נמצא טקסט מספיק במסמכים לצורך ניתוח. ודאו שהמסמכים מכילים טקסט מוקלד ולא סרוקים כתמונה.",
            });
        }

        // Проверяем наличие API ключа Gemini
        if (!geminiApiKey) {
            return NextResponse.json({
                success: false,
                found: 0,
                message: "מפתח Gemini API חסר. יש להגדיר GEMINI_API_KEY בהגדרות הסביבה.",
            });
        }

        // Проверяем существующие противоречия — для исключения дубликатов
        let existingTitles = new Set<string>();
        try {
            const supabase = createClient(supabaseUrl, supabaseKey);
            const { data: existing } = await supabase
                .from("contradictions")
                .select("title")
                .eq("project_id", projectId)
                .in("status", ["OPEN", "MOVED_TO_PRICING"]);

            if (existing) {
                existingTitles = new Set(existing.map((c: any) => c.title));
            }
        } catch (e) {
            console.warn("Could not check existing contradictions:", e);
        }

        // ========================================================
        // GEMINI AI: анализ реальных текстов — ЕДИНСТВЕННЫЙ метод
        // Без текста — сканирование НЕ запускается (см. pre-flight check выше)
        // ========================================================
        console.log(`[scan] Gemini AI analysis: ${contractsWithText.length} contracts × ${workWithText.length} work docs`);

        let foundContradictions = await analyzeWithGemini(contractsWithText, workWithText);

        // Исключаем дубликаты
        foundContradictions = foundContradictions.filter(c => !existingTitles.has(c.title));

        if (foundContradictions.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "לא נמצאו סתירות מהותיות חדשות" });
        }

        return NextResponse.json({
            success: true,
            found: foundContradictions.length,
            contradictions: foundContradictions,
            method: "gemini_ai",
        });

    } catch (error: any) {
        console.error("Scan error:", error);
        return NextResponse.json(
            { error: error.message || "Scan failed" },
            { status: 500 }
        );
    }
}

/**
 * Gemini AI: анализирует реальный текст документов — ищет МЯСНЫЕ противоречия
 * Принцип: הבדל ≠ סתירה (Различие ≠ Противоречие)
 */
async function analyzeWithGemini(contractDocs: any[], workDocs: any[]): Promise<any[]> {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro" });

    const allContradictions: any[] = [];

    // Prepare all valid pairs to analyze
    const pairs: any[] = [];
    for (const contractDoc of contractDocs) {
        const contractText = (contractDoc.extracted_text || "").substring(0, MAX_TEXT_LENGTH);
        if (!contractText || contractText.startsWith("[NON-PDF")) continue;

        for (const workDoc of workDocs) {
            const workText = (workDoc.extracted_text || "").substring(0, MAX_TEXT_LENGTH);
            if (!workText || workText.startsWith("[NON-PDF")) continue;

            pairs.push({ contractDoc, contractText, workDoc, workText });
        }
    }

    // Process in batches to balance speed and avoid API rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async ({ contractDoc, contractText, workDoc, workText }) => {
            try {
                const prompt = buildAnalysisPrompt(contractDoc.title, contractText, workDoc.title, workText);
                const result = await model.generateContent(prompt);
                const response = result.response.text();

                const parsed = parseGeminiResponse(response, contractDoc, workDoc);
                console.log(`[scan] ${contractDoc.title} vs ${workDoc.title}: ${parsed.length} contradictions`);
                return parsed;
            } catch (err: any) {
                console.error(`[scan] Gemini error for ${contractDoc.title} vs ${workDoc.title}:`, err.message);
                return [];
            }
        });

        // Wait for current batch to complete
        const results = await Promise.all(batchPromises);

        // Append all found contradictions
        for (const parsed of results) {
            allContradictions.push(...parsed);
        }
    }

    return allContradictions;
}

/**
 * Промпт для Gemini — с чётким определением: הבדל ≠ סתירה
 */
function buildAnalysisPrompt(
    contractTitle: string, contractText: string,
    workTitle: string, workText: string
): string {
    return `אתה מומחה משפטי-הנדסי בתחום חוזי בנייה ותשתיות בישראל.

## כלל ליבה: הבדל ≠ סתירה

סתירה מהותית מתקיימת אך ורק כאשר מתקיימים **כל שלושת התנאים יחד:**
1. **אותו אלמנט** — שני המסמכים מדברים על אותו פריט/רכיב/חומר/עבודה
2. **אותו הקשר** — אותו מיקום, אותו תחום, אותו סעיף חוזי
3. **דרישות סותרות** — הדרישות אינן יכולות להתקיים יחד

### דוגמה — זו לא סתירה:
- חוזה: "אבן שפה בתוך המפעל — סוג A"
- ביצוע: "אבן שפה מחוץ למפעל — סוג B"
→ זה **לא** סתירה! אלו שני פריטים שונים במיקומים שונים.

### דוגמה — זו כן סתירה:
- חוזה: "אבן שפה באזור X — סוג A"
- ביצוע: "אבן שפה באזור X — סוג B"
→ זו **כן** סתירה! אותו אלמנט, אותו מיקום, דרישות שונות.

### סוגי סתירות מהותיות שיש לזהות:
1. **שינוי פריט באותו הקשר** — חומר/סוג/מידה שונה עבור אותה עבודה
2. **שינוי דרישה טכנית באותו סעיף** — תקן/שיטה/איכות שונה
3. **הוראה חדשה הסותרת הוראה מחייבת** — פרוטוקול שסותר תנאי חוזה
4. **שינוי כמויות** — כמות שונה עבור אותו פריט עבודה
5. **שינוי מחיר/תנאי תשלום** — תנאים כספיים שונים לאותה עבודה
6. **ביטול/החלפה ללא תיעוד** — שינוי הגדרה קיימת ללא שינוי צו או מכתב שינויים

### מה לא לדווח:
- הבדלים בהקשרים שונים (מיקומים שונים, עבודות שונות)
- מידע קיים במסמך אחד וחסר בשני (זה השלמה, לא סתירה)
- ניסוחים שונים של אותו רעיון
- פרטים כלליים שאינם ספציפיים (כמו "חומרים, שיטות ביצוע, תקנים")

---

## מסמכים לבדיקה:

📄 **מסמך חוזי:** "${contractTitle}"
---
${contractText}
---

📄 **מסמך עבודה/ביצוע:** "${workTitle}"
---
${workText}
---

## פורמט תשובה — JSON בלבד:
[
  {
    "title": "כותרת קצרה ומדויקת של הסתירה",
    "description": "תיאור מפורט: מה בדיוק סותר, באיזה הקשר, ומדוע זו סתירה",
    "contract_quote": "ציטוט מדויק מתוך מסמך החוזה",
    "work_quote": "ציטוט מדויק מתוך מסמך העבודה",
    "severity": "HIGH | MEDIUM | LOW",
    "strategy_advice": "המלצה אסטרטגית לקבלן — מה לעשות, האם לדרוש שינוי צו"
  }
]

**אם אין סתירות מהותיות — החזר מערך ריק: []**
אל תמציא סתירות. אל תדווח על הבדלים הקשריים. רק סתירות מהותיות מבוססות על הטקסט.
החזר JSON בלבד, ללא markdown, ללא הסברים נוספים.`;
}

/**
 * פרסור תשובת Gemini → מערך contradictions עם ציטוטים
 */
function parseGeminiResponse(response: string, contractDoc: any, workDoc: any): any[] {
    try {
        // Чистим ответ от markdown-блоков
        let cleaned = response.trim();
        if (cleaned.startsWith("```json")) {
            cleaned = cleaned.replace(/^```json\s*/, "").replace(/```\s*$/, "");
        } else if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```\s*/, "").replace(/```\s*$/, "");
        }

        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) return [];

        return parsed.map((item: any) => ({
            title: item.title || "סתירה שזוהתה",
            description: buildRichDescription(item),
            strategy_advice: item.strategy_advice || "",
            severity: ["HIGH", "MEDIUM", "LOW"].includes(item.severity) ? item.severity : "MEDIUM",
            source_doc_id: workDoc.id,
            target_doc_id: contractDoc.id,
        }));
    } catch (e) {
        console.error("[scan] Failed to parse Gemini response:", e);
        console.error("[scan] Raw response:", response.substring(0, 500));
        return [];
    }
}

/**
 * Собираем богатое описание с цитатами из обоих документов
 */
function buildRichDescription(item: any): string {
    let desc = item.description || "";

    // Добавляем цитаты если AI их вернул
    if (item.contract_quote || item.work_quote) {
        desc += "\n\n";
        if (item.contract_quote) {
            desc += `📄 מסמך חוזי: "${item.contract_quote}"\n`;
        }
        if (item.work_quote) {
            desc += `📄 מסמך ביצוע: "${item.work_quote}"\n`;
        }
    }

    return desc;
}
