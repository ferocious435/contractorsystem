import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geminiModel, geminiFlashModel } from "@/lib/gemini";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, documents: clientDocuments, force = false, documentIds = [] } = body;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Проверка кэша (если не force и не частичное сканирование)
        if (!force && documentIds.length === 0) {
            const { data: existingContradictions, error: fetchErr } = await supabase
                .from("contradictions")
                .select("*")
                .eq("project_id", projectId);

            if (!fetchErr && existingContradictions && existingContradictions.length > 0) {
                console.log(`[scan] Returning ${existingContradictions.length} cached contradictions for project ${projectId}`);
                return NextResponse.json({
                    success: true,
                    found: existingContradictions.length,
                    contradictions: existingContradictions,
                    cached: true
                });
            }
        }

        // 2. Получение документов
        let documents = clientDocuments;
        if (!documents || documents.length === 0) {
            const { data, error } = await supabase
                .from("documents")
                .select("id, title, category, ai_status, extracted_text, file_url")
                .eq("project_id", projectId);

            if (!error && data) {
                documents = data;
            }
        }

        if (!documents || documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        // Фильтрация по запрашиваемым ID, если они переданы
        const targetDocs = documentIds.length > 0 
            ? documents.filter((d: any) => documentIds.includes(d.id))
            : documents;

        const contractDocs = targetDocs.filter((d: any) => d.category === "CONTRACT");
        const workDocs = targetDocs.filter((d: any) => d.category === "EXECUTION");

        // Если это частичный скан и не хватает категорий, пробуем добрать из полных доков проекта
        if (documentIds.length > 0) {
            if (contractDocs.length === 0) {
                const globalContracts = documents.filter((d: any) => d.category === "CONTRACT");
                contractDocs.push(...globalContracts);
            }
            if (workDocs.length === 0) {
                const globalWork = documents.filter((d: any) => d.category === "EXECUTION");
                workDocs.push(...globalWork);
            }
        }

        if (contractDocs.length === 0 || workDocs.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "חסרים מסמכי חוזה או ביצוע להשוואה" });
        }

        // 3. Авто-экстракция текста
        for (const doc of [...contractDocs, ...workDocs]) {
            if (doc.extracted_text && doc.extracted_text.length > 50 && !doc.extracted_text.startsWith("[NON-PDF")) {
                continue;
            }

            try {
                const isPDF = doc.title?.toLowerCase().endsWith(".pdf") || (doc.file_url && doc.file_url.toLowerCase().includes(".pdf"));
                if (isPDF && doc.file_url) {
                    const pdfResponse = await fetch(doc.file_url);
                    if (pdfResponse.ok) {
                        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const pdfParse = require("pdf-parse");
                        const pdfData = await pdfParse(pdfBuffer);
                        const extractedText = pdfData.text || "";

                        if (extractedText.length > 0) {
                            await supabase
                                .from("documents")
                                .update({ extracted_text: extractedText, ai_status: "DONE" })
                                .eq("id", doc.id);
                            doc.extracted_text = extractedText;
                        }
                    }
                }
            } catch (extractErr) {
                console.warn(`[scan/auto-extract] Failed for "${doc.title}":`, extractErr);
            }
        }

        // 4. Глобальный анализ через Gemini (Hybrid Model)
        console.log(`[scan] Analyzing: ${contractDocs.length} contracts, ${workDocs.length} work docs. Force: ${force}`);
        
        const foundContradictions = await analyzeWithHybridModels(projectId, contractDocs, workDocs);

        // 5. Сохранение результатов в БД
        if (foundContradictions.length > 0) {
            if (force || documentIds.length === 0) {
                await supabase.from("contradictions").delete().eq("project_id", projectId);
            } else if (documentIds.length > 0) {
                await supabase.from("contradictions")
                    .delete()
                    .eq("project_id", projectId)
                    .in("source_execution_doc_id", documentIds);
            }

            const { error: insertErr } = await supabase
                .from("contradictions")
                .insert(foundContradictions.map(c => ({
                    project_id: projectId,
                    title: c.title,
                    description: c.description,
                    strategy_advice: c.strategy_advice,
                    severity: c.severity,
                    source_execution_doc_id: c.source_doc_id,
                    target_contract_doc_id: c.target_doc_id,
                    evidence_data: c.evidence_data,
                    status: "OPEN"
                })));

            if (insertErr) console.error("[scan] Error saving contradictions:", insertErr);
        }

        return NextResponse.json({
            success: true,
            found: foundContradictions.length,
            contradictions: foundContradictions,
            cached: false
        });

    } catch (error: any) {
        console.error("Scan error:", error);
        return NextResponse.json({ error: error.message || "Scan failed" }, { status: 500 });
    }
}

async function analyzeWithHybridModels(projectId: string, contractDocs: any[], workDocs: any[]): Promise<any[]> {
    const contractsSummary = contractDocs
        .filter(d => d.extracted_text?.length > 10)
        .map(d => `📄 [CONTRACT ID: ${d.id}] TITLE: ${d.title}\nCONTENT: ${d.extracted_text.substring(0, 100000)}`)
        .join("\n\n---\n\n");
    
    const workSummary = workDocs
        .filter(d => d.extracted_text?.length > 10)
        .map(d => `📄 [WORK ID: ${d.id}] TITLE: ${d.title}\nCONTENT: ${d.extracted_text.substring(0, 100000)}`)
        .join("\n\n---\n\n");

    if (!contractsSummary || !workSummary) return [];

    const detectionPrompt = `אתה מערכת לזיהוי מהיר של סתירות בין חוזה לביצוע.
סרוק את הטקסטים ומצא נקודות שבהן יש שוני טכני או כמותי שיכול להיות שווה כסף.
החזר רשימה תמציתית של סתירות בפורמט JSON:
[{"point": "תיאור קצר", "contract_id": "...", "work_id": "..."}]

### חוזה:
${contractsSummary}

### ביצוע:
${workSummary}`;

    try {
        const detectionResult = await geminiFlashModel.generateContent(detectionPrompt);
        const detectionText = detectionResult.response.text();
        const potentialPoints = parseJsonSafe(detectionText);

        if (!Array.isArray(potentialPoints) || potentialPoints.length === 0) return [];

        const pointsStr = potentialPoints.map(p => `- ${p.point} (Docs: ${p.contract_id} vs ${p.work_id})`).join("\n");
        
        const analysisPrompt = `אתה מומחה משפטי-הנדסי בכיר (Senior Claims Manager). 
הפכנו את הנקודות הבאות כחשודות לסתירות. נתח אותן לעומק, הבא ציטוטים מדויקים ובנה אסטרטגיית הגנה לקבלן.

### נקודות לניתוח:
${pointsStr}

### דגשים:
1. רק סתירות עם ערך כספי ממשי.
2. ציטוטים מדויקים מהטקסט.
3. פורמט JSON בלבד.

### פורמט פלט:
[
  {
    "title": "כותרת",
    "description": "הסבר הכולל [1] ו-[2]",
    "contract_quote": "ציטוט מהחוזה",
    "work_quote": "ציטוט מהביצוע",
    "severity": "HIGH|MEDIUM|LOW",
    "source_doc_id": "UUID של מסמך הביצוע",
    "target_doc_id": "UUID של מסמך החוזה",
    "business_value": "למה זה עוזר לקבלן?",
    "justification": "הצדקה מקצועית",
    "strategy_advice": "מה לעשות?"
  }
]

### טקст מלא של המסמכים הרלוונטיים:
${contractsSummary.substring(0, 500000)}
${workSummary.substring(0, 500000)}`;

        const analysisResult = await geminiModel.generateContent(analysisPrompt);
        const analysisText = analysisResult.response.text();
        const finalResults = parseJsonSafe(analysisText);

        if (!Array.isArray(finalResults)) return [];

        return finalResults.map((item: any) => ({
            ...item,
            evidence_data: {
                contract_quote: item.contract_quote,
                work_quote: item.work_quote,
                business_value: item.business_value,
                justification: item.justification
            }
        }));
    } catch (e) {
        console.error("[scan] Hybrid AI Error:", e);
        return [];
    }
}

function parseJsonSafe(text: string): any {
    try {
        let cleaned = text.trim();
        if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json\s*/, "").replace(/```\s*$/, "");
        else if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```\s*/, "").replace(/```\s*$/, "");
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn("[scan] JSON Parse failed:", e, "Text snippet:", text.substring(0, 100));
        return null;
    }
}
