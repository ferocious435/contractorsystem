import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geminiModel, withRetry } from "@/lib/gemini";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, force = false, workDocId = null } = body;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Проверка кэша или очистка при force/granular rescan
        if (!force && !workDocId) {
            const { data: existing } = await supabase.from("contradictions").select("*").eq("project_id", projectId);
            if (existing && existing.length > 0) {
                return NextResponse.json({ success: true, found: existing.length, contradictions: existing, cached: true });
            }
        } else if (force) {
            console.log(`[scan] Clearing old contradictions for project ${projectId} due to force scan`);
            await supabase.from("contradictions").delete().eq("project_id", projectId);
        } else if (workDocId) {
            console.log(`[scan] Clearing old contradictions for doc ${workDocId} for granular rescan`);
            await supabase.from("contradictions").delete().eq("project_id", projectId).eq("source_execution_doc_id", workDocId);
        }

        // 2. Получение документов
        const { data: documents } = await supabase.from("documents").select("*").eq("project_id", projectId);
        if (!documents || documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        let contractDocs = documents.filter((d: any) => ["CONTRACT", "BOQ", "SPECS"].includes(d.category));
        let workDocs = documents.filter((d: any) => ["EXECUTION", "SITE_REPORT"].includes(d.category));

        if (workDocId) {
            workDocs = workDocs.filter((d: any) => d.id === workDocId);
        }

        if (workDocs.length === 0) {
            return NextResponse.json({ success: false, error: workDocId ? "מסמך הביצוע המבוקש לא נמצא" : "לא נמצאו דוחות ביצוע לסריקה" });
        }

        // 3. Прямой анализ (Digital Twin Scan)
        const foundContradictions = await analyzeDirectly(supabase, projectId, contractDocs, workDocs);

        return NextResponse.json({
            success: true,
            found: foundContradictions.length,
            contradictions: foundContradictions
        });

    } catch (error: any) {
        console.error("[scan] API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

async function analyzeDirectly(supabase: any, projectId: string, contractDocs: any[], workDocs: any[]): Promise<any[]> {
    const results: any[] = [];
    
    const contractContext = contractDocs
        .filter(d => d.extracted_text)
        .map(d => `--- Document: ${d.title} ---\n${d.extracted_text}`)
        .join("\n\n");

    for (const workDoc of workDocs) {
        if (!workDoc.extracted_text) continue;

        try {
            const prompt = `אתה מומחה בכיר לניהול תביעות הנדסיות, אומדן עלויות (Estimator) וחוזים במערכת הבנייה הישראלית.
מטרה: ביצוע השוואה מקצועית בין מסמכי החוזה לבין דוחות הביצוע וייצור אסטרטגיה הנדסית-מסחרית להגנה על רווחיות הקבלן.

מסמכי חוזה (Contractual Base):
${contractContext}

דוח ביצוע נוכחי / מסמך שטח:
${workDoc.extracted_text}

הנחיה קריטית לניתוח הנדסי:
שים לב: תגלית של תשתיות תת קרקעיות (כגון: צינורות, כבלים, שוחות) במהלך עבודות חפירה *אינה* מוגדרת כסתירה (Contradiction) לנתוני סוג הקרקע בחוזה. סוג קרקע מתייחס למאפיינים הגיאוטכניים (סלע, חול, חרסית). גילוי תשתיות הוא 'אירוע שטח' (Site Event) נפרד המצריך התייחסות למכשולים ולפגיעה ברצף העבודה, ויש לסווגו כ'אירוע שטח' ולא כ'סתירה'.

עליך לזהות ממצאים (סתירות, שינויים או אירועי שטח) ולהחזיר JSON במבנה הבא בלבד:
[
  {
    "title": "כותרת קצרה ומקצועית",
    "description": "תיאור הממצא הכולל השוואה עובדתית בין [1] ל-[2]",
    "category": "סתירה / שינוי/הנחיה / אירוע שטח",
    "advice": "המלצה אופרטיבית לקבלן (למשל: עדכון יומן עבודה, שליחת מכתב)",
    "clause_reference": "סעיף החוזה הרלוונטי",
    "expert_strategy": {
       "ripple_effect": {
         "technical_analysis": "ניתוח הנדסי של השינוי והשלכותיו על מערכות נלוות (Ripple Effect)",
         "work_disruption": "תיאור הפגיעה ברצף העבודה וביעילות",
         "implied_items": ["רשימת סעיפים/חומרים נוספים שנדרשים עקב השינוי"]
       },
       "contractual_diagnostic": {
         "legal_basis": "ביסוס חוזי/תקני (מפרט כללי, חוק המכר וכו')",
         "argument_for_supervisor": "טיעון מקצועי ויבש להצגה מול המפקח/מזמין"
       },
       "operational_instructions": {
         "site_diary_draft": "נוסח מדויק ויבש לרישום ביומן העבודה שמתעד את העובדות ההנדסיות",
         "required_evidence": ["רשימת הוכחות: צילומים, תעודות משלוח, אישורי מפקח בזמן אמת"]
       },
       "financial_impact_desc": "הסבר מסחרי על המשמעות הכספית (למה מדובר בתוספת תשלום)",
       "risk_assessment": "סיכונים במידה והשינוי לא יתומחר כראוי"
    },
    "contract_page": "עמוד בחוזה",
    "work_page": "עמוד במסמך השטח",
    "original_instruction": "מה שנדרש לפי החוזה",
    "new_requirement": "מה שקרה בפועל",
    "contract_quote": "ציטוט מדויק מהחוזה [1] או null אם אין מקור ישיר",
    "work_quote": "ציטוט מדויק מהדוח [2] או null אם אין מקור ישיר",
    "evidence_status": "VERIFIED / REQUIRES_VERIFICATION",
    "missing_evidence": ["רשימת מסמכים/בדיקות שחסרים לפני קביעה ודאית"]
  }
]`;

            const result = await withRetry(() => geminiModel.generateContent(prompt));
            const responseText = result.response.text();
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);

            if (jsonMatch) {
                const points = JSON.parse(jsonMatch[0]);
                // Очистка текста от подписей AI модели
                const cleanText = (text: string) => text?.replace(/\s*Powered by[^\.\n]*/gi, '').replace(/\s*מופעל על ידי[^\.\n]*/gi, '').trim() || text;

                for (const p of points) {
                    let severity = "LOW";
                    if (p.category?.includes("סתירה")) severity = "HIGH";
                    else if (p.category?.includes("שינוי")) severity = "MEDIUM";

                    const { data, error } = await supabase.from("contradictions").insert({
                        project_id: projectId,
                        title: cleanText(p.title),
                        description: cleanText(p.description),
                        severity: severity,
                        category: p.category,
                        strategy_advice: cleanText(p.advice),
                        source_execution_doc_id: workDoc.id,
                        target_contract_doc_id: contractDocs[0]?.id,
                        status: "OPEN",
                        evidence_data: {
                            evidence_status: p.contract_quote && p.work_quote ? "VERIFIED" : "REQUIRES_VERIFICATION",
                            missing_evidence: p.missing_evidence || [],
                            clause_reference: p.clause_reference,
                            contract_page: p.contract_page || null,
                            work_page: p.work_page || null,
                            original_instruction: p.original_instruction,
                            new_requirement: p.new_requirement,
                            contract_quote: p.contract_quote,
                            work_quote: p.work_quote,
                            contract_title: contractDocs[0]?.title || "חוזה",
                            work_title: workDoc.title,
                            contract_url: contractDocs[0]?.file_url || null,
                            work_url: workDoc.file_url || null,
                            expert_strategy: p.expert_strategy || {}
                        }
                    }).select().single();
                    if (!error && data) results.push(data);
                }
            }
        } catch (err) {
            console.error(`[scan] Analysis error for ${workDoc.title}:`, err);
        }
    }
    return results;
}
