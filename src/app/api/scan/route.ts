import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geminiModel, withRetry } from "@/lib/gemini";
import { createHash } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAX_CONTRACT_CONTEXT_CHARS = 180_000;
const MAX_WORK_CONTEXT_CHARS = 80_000;
const MAX_CHARS_PER_CONTRACT_DOC = 35_000;
const CONTRACT_ROLES = new Set(["CONTRACT", "BOQ", "SPECS", "TENDER", "PRICELIST"]);
const WORK_ROLES = new Set(["EXECUTION", "SITE_REPORT", "PROTOCOL", "INVOICE", "CHANGE_ORDER", "PHOTO", "VIDEO", "LETTER"]);

function extractFirstJsonArray(text: string) {
    const cleanText = text.replace(/```json|```/g, "").trim();
    const start = cleanText.indexOf("[");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < cleanText.length; i++) {
        const char = cleanText[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === "\\") {
            escapeNext = true;
            continue;
        }

        if (char === "\"") {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === "[") depth++;
        if (char === "]") depth--;

        if (depth === 0) {
            return cleanText.slice(start, i + 1);
        }
    }

    return null;
}

function parseGeminiJsonArray(text: string): any[] {
    const jsonArray = extractFirstJsonArray(text);
    if (!jsonArray) {
        throw new Error("Gemini did not return a JSON array");
    }
    return JSON.parse(jsonArray);
}

function sha256(input: string) {
    return createHash("sha256").update(input).digest("hex");
}

function getDocumentSignature(doc: any) {
    const textHash = doc.extracted_text_hash || sha256(String(doc.extracted_text || ""));
    return `${doc.id}:${doc.content_hash || "no-file-hash"}:${textHash}:${doc.updated_at || doc.processed_at || doc.created_at || ""}`;
}

function buildContractSignature(contractDocs: any[]) {
    return sha256(contractDocs.map(getDocumentSignature).sort().join("|"));
}

function buildScanSignature(projectId: string, contractSignature: string, workSignature: string) {
    return sha256(`${projectId}:${contractSignature}:${workSignature}`);
}

function getDocumentRole(doc: any): "CONTRACT_BASE" | "WORK_EVIDENCE" | "UNKNOWN" {
    const rawCategory = String(doc.category || doc.parsed_json?.category || "").toUpperCase();
    const title = String(doc.title || "").toLowerCase();
    const parsedType = String(doc.parsed_json?.type || "").toLowerCase();
    const searchText = `${title} ${parsedType}`;

    if (
        CONTRACT_ROLES.has(rawCategory) ||
        /contract|boq|tender|spec|price\s*list|dekel|חוזה|הסכם|כתב\s*כמויות|מפרט|מכרז|מחירון|דקל/.test(searchText)
    ) {
        return "CONTRACT_BASE";
    }

    if (
        WORK_ROLES.has(rawCategory) ||
        /execution|site|report|protocol|invoice|change|photo|video|letter|ביצוע|יומן|שטח|פרוטוקול|חשבון|חריג|מכתב|תמונה|וידאו/.test(searchText)
    ) {
        return "WORK_EVIDENCE";
    }

    return "UNKNOWN";
}

function buildBoundedDocumentContext(docs: any[], maxTotalChars: number, maxPerDoc: number) {
    let usedChars = 0;
    const includedDocs: any[] = [];
    const sections: string[] = [];

    for (const doc of docs) {
        const rawText = String(doc.extracted_text || "").trim();
        if (!rawText) continue;
        const remaining = maxTotalChars - usedChars;
        if (remaining <= 0) break;

        const sliceLength = Math.min(rawText.length, maxPerDoc, remaining);
        const textSlice = rawText.slice(0, sliceLength);
        usedChars += textSlice.length;
        includedDocs.push(doc);
        sections.push(`--- Document ID: ${doc.id}
Title: ${doc.title}
Category: ${doc.category}
Chars included: ${textSlice.length}/${rawText.length} ---
${textSlice}`);
    }

    return {
        context: sections.join("\n\n"),
        includedDocs,
        usedChars,
        truncated: docs.some(doc => String(doc.extracted_text || "").length > maxPerDoc) || usedChars >= maxTotalChars
    };
}

function cleanAiText(text: string) {
    return text?.replace(/\s*Powered by[^\.\n]*/gi, "").replace(/\s*מופעל על ידי[^\.\n]*/gi, "").trim() || text;
}

function normalizeConfidence(value: unknown) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
    if (numericValue <= 1) return numericValue;
    if (numericValue <= 100) return numericValue / 100;
    return 1;
}

function normalizeEvidenceStatus(item: any) {
    const category = String(item.category || "").toLowerCase();
    const comparisonType = String(item.comparison_type || "").toLowerCase();
    const hasQuotes = Boolean(item.contract_quote && item.work_quote);

    if (!hasQuotes) {
        return "REQUIRES_VERIFICATION";
    }

    if (category.includes("חוסר נתונים") || comparisonType.includes("missing_data")) {
        return "REQUIRES_VERIFICATION";
    }

    return "VERIFIED";
}

function mapSeverity(category: string) {
    if (/סתירה|contradiction/i.test(category)) return "HIGH";
    if (/שינוי|change|חריג|extra/i.test(category)) return "MEDIUM";
    return "LOW";
}

function buildScanPrompt(params: {
    contractContext: string;
    workDoc: any;
    workText: string;
    contractContextBundle: ReturnType<typeof buildBoundedDocumentContext>;
}) {
    const { contractContext, workDoc, workText, contractContextBundle } = params;

    return `
You are ContractorSystem's construction-claims analyst for an Israeli contractor.
The system exists for the contractor: protect payment, margin, schedule, and evidence.

Compare the contractual base documents against the current work/site document.
Return only a valid JSON array. All user-facing text must be short, practical Hebrew.

CONTRACTUAL BASE:
${contractContext}

WORK / SITE DOCUMENT:
--- Document ID: ${workDoc.id}
Title: ${workDoc.title}
Category: ${workDoc.category}
Chars included: ${workText.length}/${String(workDoc.extracted_text || "").length} ---
${workText}

IMPORTANT SCAN RULES:
1. Classify every finding as one of: סתירה, שינוי/חריג, אירוע שטח, חוסר נתונים, אין התאמה ישירה.
2. A true contradiction requires conflict between a contract/BOQ/spec instruction and actual work/site evidence.
3. Do not treat every site event as a contradiction. If it is only a field event, say so.
4. Evidence status can be VERIFIED only when both contract_quote and work_quote are real quotes from the provided context.
5. If one quote is missing, use REQUIRES_VERIFICATION and list exactly what is missing.
6. Never invent a clause, document, page, price, or confident conclusion without evidence.
7. If no direct contract/BOQ match exists, create a Zero-Match finding: explain that no direct match was found, why it matters to the contractor, what to check next, and confidence.
8. Mention financial impact only as a practical direction unless a price appears in the documents.
9. Keep outputs businesslike and useful for a contractor, not technical noise.
10. The contract context may be truncated: ${contractContextBundle.truncated ? "yes" : "no"}. If this limits certainty, say that verification is required.

Return JSON array with this exact object shape:
[
  {
    "title": "כותרת קצרה בעברית",
    "description": "מה לא מסתדר ומה המשמעות לקבלן",
    "category": "סתירה / שינוי/חריג / אירוע שטח / חוסר נתונים / אין התאמה ישירה",
    "advice": "מה הקבלן צריך לבדוק או לעשות עכשיו",
    "clause_reference": "סעיף רלוונטי או null",
    "contract_page": "עמוד/מיקום במסמך החוזי או null",
    "work_page": "עמוד/מיקום במסמך העבודה או null",
    "original_instruction": "מה נדרש לפי החוזה או null",
    "new_requirement": "מה קרה בפועל או מה נדרש בשטח",
    "contract_quote": "ציטוט מדויק מהחוזה/BOQ או null",
    "work_quote": "ציטוט מדויק ממסמך העבודה/שטח או null",
    "contract_document_id": "Document ID from contractual base or null",
    "work_document_id": "${workDoc.id}",
    "evidence_status": "VERIFIED / REQUIRES_VERIFICATION",
    "missing_evidence": ["מסמכים/בדיקות שחסרים לאימות"],
    "comparison_type": "contract_vs_execution / boq_vs_execution / specs_vs_execution / zero_match / missing_data / site_event",
    "risk_reason": "למה זה חשוב לקבלן",
    "confidence": 0.0,
    "next_check": "בדיקה מעשית הבאה",
    "expert_strategy": {
      "ripple_effect": {
        "technical_analysis": "השפעה הנדסית קצרה",
        "work_disruption": "השפעה על רצף עבודה/זמן",
        "implied_items": ["סעיפים או עבודות נלוות אפשריות"]
      },
      "contractual_diagnostic": {
        "legal_basis": "בסיס חוזי/מסחרי או נדרש אימות",
        "argument_for_supervisor": "טיעון קצר מול מפקח/מזמין"
      },
      "operational_instructions": {
        "site_diary_draft": "נוסח קצר ליומן עבודה",
        "required_evidence": ["תמונות", "אישור מפקח", "מדידות", "מסמך נוסף"]
      },
      "financial_impact_desc": "משמעות כספית אפשרית ללא המצאת מחיר",
      "risk_assessment": "סיכון אם לא יתועד/יתומחר"
    }
  }
]`;
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, force = false, workDocId = null } = body;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        if (force) {
            await supabase.from("contradictions").update({
                status: "ARCHIVED",
                evidence_data: {
                    archive_reason: "Project was rescanned. Previous findings are kept only as historical evidence.",
                    archived_at: new Date().toISOString()
                }
            }).eq("project_id", projectId);
            await supabase.from("document_scan_state").delete().eq("project_id", projectId);
        } else if (workDocId) {
            await supabase.from("contradictions").update({
                status: "ARCHIVED",
                evidence_data: {
                    archive_reason: "Work document was rescanned. Previous findings are kept only as historical evidence.",
                    archived_at: new Date().toISOString(),
                    rescanned_work_doc_id: workDocId
                }
            }).eq("project_id", projectId).eq("source_execution_doc_id", workDocId);
            await supabase.from("document_scan_state").delete().eq("project_id", projectId).eq("work_doc_id", workDocId);
        }

        const { data: documents } = await supabase.from("documents").select("*").eq("project_id", projectId);
        if (!documents || documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        const documentsWithRoles = documents.map((doc: any) => ({ ...doc, __scanRole: getDocumentRole(doc) }));
        const contractDocs = documentsWithRoles.filter((d: any) => d.__scanRole === "CONTRACT_BASE");
        let workDocs = documentsWithRoles.filter((d: any) => d.__scanRole === "WORK_EVIDENCE");

        if (workDocId) {
            workDocs = workDocs.filter((d: any) => d.id === workDocId);
        }

        if (contractDocs.length === 0) {
            return NextResponse.json({
                success: false,
                error: "לא נמצאו מסמכי בסיס להשוואה. יש להעלות או לסווג חוזה, כתב כמויות, מפרט או מכרז לפני סריקת סתירות."
            }, { status: 400 });
        }

        if (workDocs.length === 0) {
            return NextResponse.json({
                success: false,
                error: workDocId ? "מסמך הביצוע המבוקש לא נמצא" : "לא נמצאו מסמכי ביצוע או שטח לסריקה"
            }, { status: 400 });
        }

        const foundContradictions = await analyzeDirectly(supabase, projectId, contractDocs, workDocs, force);

        return NextResponse.json({
            success: true,
            found: foundContradictions.length,
            contradictions: foundContradictions,
            cached: foundContradictions.length > 0 && foundContradictions.every((item: any) => item.__cached === true)
        });

    } catch (error: unknown) {
        console.error("[scan] API Error:", error);
        const message = error instanceof Error ? error.message : "Scan failed";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
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

    if (!contractContext.trim()) {
        throw new Error("Contract documents exist, but no extracted text is available for comparison.");
    }

    for (const workDoc of workDocs) {
        if (!workDoc.extracted_text) continue;
        const workText = String(workDoc.extracted_text || "").slice(0, MAX_WORK_CONTEXT_CHARS);
        const workSignature = getDocumentSignature(workDoc);
        const scanSignature = buildScanSignature(projectId, contractSignature, workSignature);

        try {
            if (!force) {
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
                        .eq("scan_signature", scanSignature)
                        .neq("status", "ARCHIVED");

                    if (cachedContradictions?.length) {
                        cachedContradictions.forEach((item: any) => results.push({ ...item, __cached: true }));
                    }
                    continue;
                }

                const { data: oldFindings } = await supabase
                    .from("contradictions")
                    .select("id, scan_signature")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id)
                    .neq("status", "ARCHIVED");

                if (oldFindings?.length) {
                    await supabase
                        .from("contradictions")
                        .update({
                            status: "ARCHIVED",
                            evidence_data: {
                                archive_reason: "Finding was created before the current scan cache signature or documents changed.",
                                archived_at: new Date().toISOString(),
                                current_scan_signature: scanSignature
                            }
                        })
                        .eq("project_id", projectId)
                        .eq("source_execution_doc_id", workDoc.id)
                        .or(`scan_signature.is.null,scan_signature.neq.${scanSignature}`);
                }
            }

            const prompt = buildScanPrompt({ contractContext, workDoc, workText, contractContextBundle });
            const result = await withRetry(() => geminiModel.generateContent(prompt));
            const responseText = result.response.text();
            const points = parseGeminiJsonArray(responseText);

            for (const p of points) {
                const category = String(p.category || "");
                const matchedContractDoc =
                    contractDocs.find((doc: any) => doc.id === p.contract_document_id) ||
                    contractContextBundle.includedDocs[0] ||
                    contractDocs[0];

                const { data, error } = await supabase.from("contradictions").insert({
                    project_id: projectId,
                    title: cleanAiText(p.title),
                    description: cleanAiText(p.description),
                    severity: mapSeverity(category),
                    category,
                    strategy_advice: cleanAiText(p.advice),
                    source_execution_doc_id: workDoc.id,
                    target_contract_doc_id: matchedContractDoc?.id,
                    status: "OPEN",
                    scan_signature: scanSignature,
                    evidence_data: {
                        evidence_status: normalizeEvidenceStatus(p),
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
                        confidence: normalizeConfidence(p.confidence),
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
                            work_context_truncated: String(workDoc.extracted_text || "").length > workText.length
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
