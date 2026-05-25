import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geminiModel, withRetry } from "@/lib/gemini";
import { createHash } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAX_CONTRACT_CONTEXT_CHARS = 180_000;
const MAX_WORK_CONTEXT_CHARS = 80_000;
const MAX_CHARS_PER_CONTRACT_DOC = 35_000;

function parseGeminiJsonArray(text: string): any[] {
    const cleanText = text.replace(/```json|```/g, '').trim();
    const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
        throw new Error('Gemini did not return a JSON array');
    }
    return JSON.parse(arrayMatch[0]);
}

function sha256(input: string) {
    return createHash("sha256").update(input).digest("hex");
}

function getDocumentSignature(doc: any) {
    const textHash = doc.extracted_text_hash || sha256(String(doc.extracted_text || ''));
    return `${doc.id}:${doc.content_hash || 'no-file-hash'}:${textHash}:${doc.updated_at || doc.processed_at || doc.created_at || ''}`;
}

function buildContractSignature(contractDocs: any[]) {
    return sha256(contractDocs.map(getDocumentSignature).sort().join('|'));
}

function buildScanSignature(projectId: string, contractSignature: string, workSignature: string) {
    return sha256(`${projectId}:${contractSignature}:${workSignature}`);
}

function buildBoundedDocumentContext(docs: any[], maxTotalChars: number, maxPerDoc: number) {
    let usedChars = 0;
    const includedDocs: any[] = [];
    const sections: string[] = [];

    for (const doc of docs) {
        const rawText = String(doc.extracted_text || '').trim();
        if (!rawText) continue;
        const remaining = maxTotalChars - usedChars;
        if (remaining <= 0) break;

        const sliceLength = Math.min(rawText.length, maxPerDoc, remaining);
        const textSlice = rawText.slice(0, sliceLength);
        usedChars += textSlice.length;
        includedDocs.push(doc);
        sections.push(`--- Document ID: ${doc.id}\nTitle: ${doc.title}\nCategory: ${doc.category}\nChars included: ${textSlice.length}/${rawText.length} ---\n${textSlice}`);
    }

    return {
        context: sections.join("\n\n"),
        includedDocs,
        usedChars,
        truncated: docs.some(doc => String(doc.extracted_text || '').length > maxPerDoc) || usedChars >= maxTotalChars
    };
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, force = false, workDocId = null } = body;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Проверка кэша или очистка при force/granular rescan
        if (force) {
            console.log(`[scan] Clearing old contradictions for project ${projectId} due to force scan`);
            await supabase.from("contradictions").delete().eq("project_id", projectId);
            await supabase.from("document_scan_state").delete().eq("project_id", projectId);
        } else if (workDocId) {
            console.log(`[scan] Clearing old contradictions for doc ${workDocId} for granular rescan`);
            await supabase.from("contradictions").delete().eq("project_id", projectId).eq("source_execution_doc_id", workDocId);
            await supabase.from("document_scan_state").delete().eq("project_id", projectId).eq("work_doc_id", workDocId);
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
        const foundContradictions = await analyzeDirectly(supabase, projectId, contractDocs, workDocs, force);

        return NextResponse.json({
            success: true,
            found: foundContradictions.length,
            contradictions: foundContradictions,
            cached: foundContradictions.length > 0 && foundContradictions.every((item: any) => item.__cached === true)
        });

    } catch (error: any) {
        console.error("[scan] API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

async function analyzeDirectly(supabase: any, projectId: string, contractDocs: any[], workDocs: any[], force = false): Promise<any[]> {
    const results: any[] = [];
    const contractSignature = buildContractSignature(contractDocs);
    const contractDocIds = contractDocs.map((doc: any) => String(doc.id)).sort();
    
    const contractContextBundle = buildBoundedDocumentContext(
        contractDocs.filter(d => d.extracted_text),
        MAX_CONTRACT_CONTEXT_CHARS,
        MAX_CHARS_PER_CONTRACT_DOC
    );
    const contractContext = contractContextBundle.context;

    for (const workDoc of workDocs) {
        if (!workDoc.extracted_text) continue;
        const workText = String(workDoc.extracted_text || '').slice(0, MAX_WORK_CONTEXT_CHARS);
        const workSignature = getDocumentSignature(workDoc);
        const scanSignature = buildScanSignature(projectId, contractSignature, workSignature);

        try {
            if (!force) {
                const { data: existingForWorkDoc } = await supabase
                    .from("contradictions")
                    .select("*")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id);

                if (existingForWorkDoc?.length) {
                    existingForWorkDoc.forEach((item: any) => results.push({
                        ...item,
                        __cached: true,
                        __legacy_cache: !item.scan_signature
                    }));
                    continue;
                }

                const { data: scanState } = await supabase
                    .from("document_scan_state")
                    .select("*")
                    .eq("scan_signature", scanSignature)
                    .maybeSingle();

                if (scanState?.status === "COMPLETED") {
                    const { data: cachedContradictions } = await supabase
                        .from("contradictions")
                        .select("*")
                        .eq("project_id", projectId)
                        .eq("scan_signature", scanSignature);

                    if (cachedContradictions?.length) {
                        cachedContradictions.forEach((item: any) => results.push({ ...item, __cached: true }));
                        continue;
                    }
                }

                await supabase
                    .from("contradictions")
                    .delete()
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id);
                await supabase
                    .from("document_scan_state")
                    .delete()
                    .eq("project_id", projectId)
                    .eq("work_doc_id", workDoc.id);
            }

            const prompt = `אתה מומחה בכיר לניהול תביעות הנדסיות, אומדן עלויות (Estimator) וחוזים במערכת הבנייה הישראלית.
מטרה: ביצוע השוואה מקצועית בין מסמכי החוזה לבין דוחות הביצוע וייצור אסטרטגיה הנדסית-מסחרית להגנה על רווחיות הקבלן.

מסמכי חוזה (Contractual Base):
${contractContext}

דוח ביצוע נוכחי / מסמך שטח:
--- Document ID: ${workDoc.id}
Title: ${workDoc.title}
Category: ${workDoc.category}
Chars included: ${workText.length}/${String(workDoc.extracted_text || '').length} ---
${workText}

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
    "contract_document_id": "Document ID from the contract context, or null",
    "work_document_id": "Document ID from the work context, or null",
    "evidence_status": "VERIFIED / REQUIRES_VERIFICATION",
    "missing_evidence": ["רשימת מסמכים/בדיקות שחסרים לפני קביעה ודאית"]
  }
]`;

            const contractorFirstScanRules = `

Mandatory contractor-first rules:
- The finding must help the contractor protect payment, margin, time, and proof.
- evidence_status can be VERIFIED only when both contract_quote and work_quote exist.
- If proof is partial, use REQUIRES_VERIFICATION and list the missing evidence.
- Distinguish a true contradiction from a site event, missing data, or AI assumption.
- Add these JSON fields to every item: comparison_type, risk_reason, confidence, next_check.
`;
            const result = await withRetry(() => geminiModel.generateContent(`${prompt}\n${contractorFirstScanRules}`));
            const responseText = result.response.text();
            const points = parseGeminiJsonArray(responseText);
            if (points.length > 0) {
                // Очистка текста от подписей AI модели
                const cleanText = (text: string) => text?.replace(/\s*Powered by[^\.\n]*/gi, '').replace(/\s*מופעל על ידי[^\.\n]*/gi, '').trim() || text;

                for (const p of points) {
                    let severity = "LOW";
                    if (p.category?.includes("סתירה")) severity = "HIGH";
                    else if (p.category?.includes("שינוי")) severity = "MEDIUM";

                    const matchedContractDoc = contractDocs.find((doc: any) => doc.id === p.contract_document_id) || contractContextBundle.includedDocs[0] || contractDocs[0];
                    const { data, error } = await supabase.from("contradictions").insert({
                        project_id: projectId,
                        title: cleanText(p.title),
                        description: cleanText(p.description),
                        severity: severity,
                        category: p.category,
                        strategy_advice: cleanText(p.advice),
                        source_execution_doc_id: workDoc.id,
                        target_contract_doc_id: matchedContractDoc?.id,
                        status: "OPEN",
                        scan_signature: scanSignature,
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
                            contract_title: matchedContractDoc?.title || "חוזה",
                            work_title: workDoc.title,
                            contract_url: matchedContractDoc?.file_url || null,
                            work_url: workDoc.file_url || null,
                            comparison_type: p.comparison_type || null,
                            risk_reason: p.risk_reason || null,
                            confidence: typeof p.confidence === 'number' ? p.confidence : null,
                            next_check: p.next_check || null,
                            document_pair: {
                                contract_doc_id: matchedContractDoc?.id || null,
                                contract_title: matchedContractDoc?.title || null,
                                work_doc_id: workDoc.id,
                                work_title: workDoc.title
                            },
                            context_window: {
                                contract_chars_used: contractContextBundle.usedChars,
                                contract_context_truncated: contractContextBundle.truncated,
                                work_chars_used: workText.length,
                                work_context_truncated: String(workDoc.extracted_text || '').length > workText.length
                            },
                            expert_strategy: p.expert_strategy || {}
                        }
                    }).select().single();
                    if (!error && data) results.push(data);
                }

                await supabase
                    .from("document_scan_state")
                    .upsert({
                        project_id: projectId,
                        contract_doc_ids: contractDocIds,
                        work_doc_id: workDoc.id,
                        contract_signature: contractSignature,
                        work_signature: workSignature,
                        scan_signature: scanSignature,
                        status: "COMPLETED",
                        findings_count: points.length,
                        scanned_at: new Date().toISOString()
                    }, { onConflict: "scan_signature" });
            }
        } catch (err) {
            console.error(`[scan] Analysis error for ${workDoc.title}:`, err);
            await supabase
                .from("document_scan_state")
                .upsert({
                    project_id: projectId,
                    contract_doc_ids: contractDocIds,
                    work_doc_id: workDoc.id,
                    contract_signature: contractSignature,
                    work_signature: workSignature,
                    scan_signature: scanSignature,
                    status: "ERROR",
                    findings_count: 0,
                    scanned_at: new Date().toISOString()
                }, { onConflict: "scan_signature" });
        }
    }
    return results;
}
