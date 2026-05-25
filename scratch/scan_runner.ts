
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const geminiApiKey = process.env.GEMINI_API_KEY!;

async function withRetry(fn: any, retries = 3, delay = 2000) {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error.status === 429 || error.status === 503)) {
            console.log(`Error ${error.status}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

async function main() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const projectId = "d7362181-c47b-46b5-b0c8-3e53bf9058eb";

    console.log("Cleaning old contradictions...");
    await supabase.from("contradictions").delete().eq("project_id", projectId);

    console.log("Fetching documents...");
    const { data: documents } = await supabase.from("documents").select("*").eq("project_id", projectId);
    
    if (!documents || documents.length === 0) return;

    const contractDocs = documents.filter(d => ["CONTRACT", "BOQ", "SPECS"].includes(d.category));
    const workDocs = documents.filter(d => ["EXECUTION", "SITE_REPORT"].includes(d.category));

    console.log(`Found ${contractDocs.length} contracts and ${workDocs.length} work docs.`);

    const contractContext = contractDocs
        .filter(d => d.extracted_text)
        .slice(0, 1) // Только один контракт
        .map(d => `--- Document: ${d.title} ---\n${d.extracted_text.substring(0, 2000)}`)
        .join("\n\n");

    // Берем только первый документ для анализа в качестве примера
    const workDoc = workDocs.find(d => d.extracted_text);
    if (!workDoc) {
        console.log("No work doc with text found.");
        return;
    }

    console.log(`Analyzing ${workDoc.title} against contracts (trimmed)...`);

    const workText = workDoc.extracted_text.substring(0, 2000);

    const prompt = `אתה מנהל תביעות (Claims Manager) בכיר ומומחה לחוזי בנייה בישראל.
מטרה: ביצוע ביקורת Digital Twin מעמיקה ואיתור כל עילות ההגנה לטובת הקבלן.
הפלט חייב להיות אגרסיבי לטובת הקבלן.

מסמכי חוזה (רקע):
${contractContext}

דוח ביצוע נוכחי / מסמך שטח:
${workText}

החזר רק JSON (מערך של אובייקטים):
[
  {
    "title": "כותרת",
    "description": "ניתוח מפורט. סיום ב: Powered by Gemini 3 Flash",
    "severity": "HIGH/MEDIUM/LOW",
    "advice": "נוסח ליומן עבודה: '...'. המלצה: '...'",
    "clause_reference": "סעיף",
    "financial_impact_desc": "הערכה כספית",
    "schedule_impact_desc": "השפעה על לו\"ז",
    "legal_foundation": "בסיס משפטי",
    "site_diary_entry": "נוסח ליומן",
    "commercial_risk": "סיכון",
    "financial_impact": 1000
  }
]`;

    try {
        const result = await withRetry(() => model.generateContent(prompt));
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
            const points = JSON.parse(jsonMatch[0]);
            console.log(`Found ${points.length} points.`);
            
            for (const p of points) {
                await supabase.from("contradictions").insert({
                    project_id: projectId,
                    title: p.title,
                    description: p.description,
                    severity: p.severity,
                    strategy_advice: p.advice,
                    source_execution_doc_id: workDoc.id,
                    target_contract_doc_id: contractDocs[0]?.id,
                    status: "OPEN",
                    evidence_data: {
                        clause_reference: p.clause_reference || p.legal_foundation,
                        contract_title: contractDocs[0]?.title || "חוזה",
                        work_title: workDoc.title,
                        financial_impact: p.financial_impact || 0,
                        financial_impact_desc: p.financial_impact_desc || "",
                        schedule_impact_desc: p.schedule_impact_desc || "",
                        site_diary_entry: p.site_diary_entry || "",
                        legal_foundation: p.legal_foundation || ""
                    }
                });
            }
        }
    } catch (err: any) {
        console.error("Analysis error:", err.message);
    }
    console.log("Scan complete.");
}

main();
