import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { geminiFlashModel } from '@/lib/gemini';

function parseGeminiJsonObject(text: string): any {
    const cleanText = text.replace(/```json|```/g, '').trim();
    const objectMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
        throw new Error('Gemini did not return a JSON object');
    }
    return JSON.parse(objectMatch[0]);
}

export async function POST(req: Request) {
    const supabase = await createClient();
    
    try {
        const { contradictionId, projectId, expertMode = false } = await req.json();

        if (!contradictionId || !projectId) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // 1. Получаем данные противоречия
        const { data: contradiction, error: cError } = await supabase
            .from('contradictions')
            .select('*')
            .eq('id', contradictionId)
            .single();

        if (cError || !contradiction) {
            return NextResponse.json({ error: 'Contradiction not found' }, { status: 404 });
        }

        // 2. Получаем контрактные документы (BOQ) для контекста цен
        const { data: contractDocs } = await supabase
            .from('documents')
            .select('title, parsed_json')
            .eq('project_id', projectId)
            .in('category', ['CONTRACT', 'BOQ', 'SPECS']);

        const boqRawContext = contractDocs
            ?.filter(d => d.parsed_json)
            .map(d => JSON.stringify(d.parsed_json))
            .join('\n') || 'No existing BOQ found.';

        // 1. Извлекаем технические ключевые слова через Gemini для точного поиска
        const keywordPrompt = `
        Извлеки 3-5 ключевых технических терминов на иврите из следующего строительного противоречия.
        Фокусируйся на материалах, видах работ или инженерных терминах.
        Заголовок: ${contradiction.title}
        Описание: ${contradiction.description}
        Верни ТОЛЬКО список слов через запятую.
        `;
        
        const keywordResult = await geminiFlashModel.generateContent(keywordPrompt);
        const extractedKeywords = keywordResult.response.text()
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 2);

        // Если ИИ не смог извлечь, используем старый метод
        const keywords = extractedKeywords.length > 0 
            ? extractedKeywords 
            : (contradiction.title || '').split(/[\s,.-]+/).filter((w: string) => w.length > 2);

        // 2. Получаем контекст цен по контракту из pricing_ledger (BASE_CONTRACT)
        // Это надежнее, чем parsed_json в документах
        const ledgerSearchTerms = keywords.slice(0, 4);
        const ledgerOrConditions = ledgerSearchTerms.map((k: string) => `description.ilike.%${k}%`).join(',');
        
        const { data: ledgerMatches } = await supabase
            .from('pricing_ledger')
            .select('item_code, description, unit, unit_price_excl_vat')
            .eq('project_id', projectId)
            .eq('type', 'BASE_CONTRACT')
            .or(ledgerOrConditions)
            .limit(30);

        const boqContext = ledgerMatches?.length 
            ? ledgerMatches.map(m => `[CONTRACT ITEM] Code: ${m.item_code}, Desc: ${m.description}, Price: ${m.unit_price_excl_vat}, Unit: ${m.unit}`).join('\n')
            : 'No direct contract matches found in Ledger.';

        // 3. Поиск во внешних прайс-листах (Dekel и Contractor)
        let pricelistMatches: any[] = [];
        
        if (keywords.length > 0) {
            const searchTerms = keywords.slice(0, 4);
            const orConditions = searchTerms.map((k: string) => `description.ilike.%${k}%`).join(',');

            const { data: matches } = await supabase
                .from('pricelist_items')
                .select(`
                    id,
                    item_code,
                    item_type,
                    description,
                    unit,
                    rate,
                    pricelists!inner (
                        name,
                        is_global,
                        project_id
                    )
                `)
                .or(orConditions)
                .in('item_type', ['ITEM', 'NOTE'])
                .or(`pricelists.is_global.eq.true,pricelists.project_id.eq.${projectId}`)
                .limit(50);
            
            pricelistMatches = matches || [];

            // 3.1 Иерархический поиск примечаний (Notes)
            const itemMatches = pricelistMatches.filter(m => m.item_type === 'ITEM');
            if (itemMatches.length > 0) {
                const parentPrefixes = new Set<string>();
                itemMatches.forEach(m => {
                    const parts = m.item_code.split('.');
                    if (parts.length >= 1) parentPrefixes.add(`${parts[0]}`);
                    if (parts.length >= 2) parentPrefixes.add(`${parts[0]}.${parts[1]}`);
                    if (parts.length >= 3) parentPrefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
                });

                if (parentPrefixes.size > 0) {
                    const orPrefixes = Array.from(parentPrefixes).map(p => `item_code.ilike.${p}%`).join(',');
                    const { data: parentNotes } = await supabase
                        .from('pricelist_items')
                        .select(`
                            id, item_code, item_type, description,
                            pricelists!inner (name)
                        `)
                        .eq('item_type', 'NOTE')
                        .or(orPrefixes)
                        .limit(40);
                    
                    if (parentNotes) {
                        const existingIds = new Set(pricelistMatches.map(m => m.id));
                        parentNotes.forEach(n => {
                            if (!existingIds.has(n.id)) {
                                pricelistMatches.push(n);
                            }
                        });
                    }
                }
            }
        }

        const itemsContext = pricelistMatches
            .filter(m => m.item_type === 'ITEM')
            .map(m => `[EXTERNAL ITEM] [${m.pricelists.name}] Code: ${m.item_code}, Desc: ${m.description}, Price: ${m.rate}, Unit: ${m.unit}`)
            .join('\n');

        const notesContext = pricelistMatches
            .filter(m => m.item_type === 'NOTE')
            .map(m => `[GOVERNING NOTE] Code: ${m.item_code}, Note: ${m.description}`)
            .join('\n');

        const pricelistContext = `
        --- ACTIONABLE ITEMS (EXTERNAL) ---
        ${itemsContext || 'No direct external matches found.'}
        
        --- GOVERNING INSTRUCTIONS (CRITICAL) ---
        ${notesContext || 'No specific governing notes found.'}
        `;

        // 4. Финальный промпт для Gemini 3.5 Flash - Deep Diagnostic Engine
        const pricingPrompt = `
        Senior Israeli Construction Claims Expert and Estimator (תמחירן ומומחה תביעות בכיר).
        Your goal is to analyze a construction contradiction and build a high-impact financial and commercial justification for a Variation Order (V.O.).
        
        CONTRADICTION:
        Title: ${contradiction.title}
        Description: ${contradiction.description}
        Evidence Trace: ${JSON.stringify(contradiction.evidence_data)}
        
        1. STRATEGIC CONTEXT (Highest Priority - Contractual Baseline):
        ${boqContext}
        
        RAW BOQ DATA:
        ${boqRawContext}
        
        2. EXTERNAL MARKET REFERENCE (Dekel/Contractor Benchmarks):
        ${pricelistContext}
        
        STRICT GUIDELINES:
        1. COMMERICIAL DEFENSE: If the work required is a "Material Change" (שינוי יסודי) or "Extra Work" (עבודה נוספת) not covered by the original scope, you MUST justify why contract prices might not apply (e.g., small quantity, urgent timing, specialized equipment).
        2. RISK ANALYSIS: Identify potential "Hidden Traps" (מלכודות) such as secondary impacts on other trades, logistics overhead, or sequence disruption.
        3. VAT COMPLIANCE: All prices MUST be EXCLUDING VAT (לפני מע"מ).
        4. PRICING HIERARCHY:
           - [CONTRACT ITEM]: Use if direct match exists.
           - [DEKEL]: Use "מחירון דקל" as the industry standard for claims.
           - [CUSTOM]: Synthesize only if no matches found.
        5. ZERO MATCH: If no direct source item exists in the provided context, do not invent a confident source. Return match_found=false, source=CUSTOM_ANALYSIS, item_code="NEW", price 0 unless you can clearly justify a pre-VAT analysis as editable draft only.
        6. EVIDENCE: Separate verified source evidence from AI inference. If evidence is missing, say exactly what must be checked.
        7. LANGUAGE: All output text (Rationale, Description, Notes) MUST be in professional Hebrew.

        OUTPUT FORMAT (JSON ONLY):
        {
            "match_found": boolean,
            "source": "BOQ" | "DEKEL" | "CONTRACTOR" | "CUSTOM_ANALYSIS",
            "confidence": number,
            "match_quality": "DIRECT" | "PARTIAL" | "ZERO_MATCH",
            "suggested_unit_price_excl_vat": number,
            "suggested_unit": "string (Hebrew)",
            "suggested_quantity": number,
            "item_code": "string",
            "ai_rationale": "Deep Hebrew justification including contractual basis",
            "suggested_description": "Professional Hebrew description for the invoice/letter",
            "governing_notes": ["Hebrew strings regarding measurements, inclusions, or risks"],
            "needed_documents": ["Hebrew strings naming documents or approvals needed before saving as confirmed claim"],
            "zero_match_reason": "Hebrew explanation when match_quality is ZERO_MATCH",
            "questions": ["Clarifying questions to maximize claim value"]
        }
        `;

        const pricingResult = await geminiFlashModel.generateContent(pricingPrompt);
        const pricingText = pricingResult.response.text();
        const evaluation = parseGeminiJsonObject(pricingText);
        const hasSourceMatches = Boolean(ledgerMatches?.length || pricelistMatches.some(m => m.item_type === 'ITEM'));
        evaluation.source_trace = {
            contract_matches: ledgerMatches?.length || 0,
            pricelist_item_matches: pricelistMatches.filter(m => m.item_type === 'ITEM').length,
            governing_note_matches: pricelistMatches.filter(m => m.item_type === 'NOTE').length,
            keywords
        };
        evaluation.matched_items = {
            contract: ledgerMatches || [],
            pricelist: pricelistMatches.filter(m => m.item_type === 'ITEM').slice(0, 10),
            notes: pricelistMatches.filter(m => m.item_type === 'NOTE').slice(0, 10)
        };

        if (!hasSourceMatches && evaluation.match_quality !== 'PARTIAL') {
            evaluation.match_found = false;
            evaluation.source = 'CUSTOM_ANALYSIS';
            evaluation.item_code = evaluation.item_code || 'NEW';
            evaluation.match_quality = 'ZERO_MATCH';
            evaluation.confidence = Math.min(Number(evaluation.confidence) || 0.35, 0.45);
            evaluation.suggested_unit_price_excl_vat = 0;
            evaluation.zero_match_reason = evaluation.zero_match_reason || 'לא נמצאה התאמה ישירה בחוזה, בדקל או במחירון הקבלן לפי הנתונים הזמינים. נדרש ניתוח מחיר ידני לפני שמירה כדרישה מאומתת.';
            evaluation.needed_documents = evaluation.needed_documents?.length
                ? evaluation.needed_documents
                : ['אישור מפקח או יומן עבודה', 'צילום/תיעוד שטח', 'סעיף חוזי או כתב כמויות רלוונטי', 'הצעת מחיר או מחירון להשוואה'];
            evaluation.questions = evaluation.questions?.length
                ? evaluation.questions
                : ['מה הכמות המדויקת שבוצעה בפועל?', 'האם קיימת הוראה כתובה או אישור מפקח לעבודה?', 'איזה ציוד, כוח אדם וחומרים נדרשו בפועל?'];
        }

        // 5. Engineering Expert Mode (Deep Technical Strategy)
        let expertStrategy = null;

        if (expertMode) {
            const { ENGINEERING_STRATEGY_PROMPT } = await import('@/lib/gemini');
            const expertPrompt = `
            ${ENGINEERING_STRATEGY_PROMPT}
            
            DIAGNOSTIC FOCUS:
            1. MATERIAL CHANGE: Argue why this is NOT "Contract Work" (עבודות חוזיות) based on technical complexity.
            2. LOGISTICS & RISKS: Detail the "Work Interruption" (עיכובים) or "Disruption" (חוסר יעילות) from an engineering perspective.
            3. DOCUMENTARY LINK: Use the evidence trace ${JSON.stringify(contradiction.evidence_data)} to build an objective "Technical Evidence Chain".
            4. FINAL STAND: Maintain professional, neutral, and firm expert tone.

            CONTEXT:
            Title: ${contradiction.title}
            Suggested Price: ${evaluation.suggested_unit_price_excl_vat} ${evaluation.suggested_unit}
            Rationale: ${evaluation.ai_rationale}
            `;
            
            const expertResult = await geminiFlashModel.generateContent(expertPrompt);
            const expertText = expertResult.response.text();
            expertStrategy = parseGeminiJsonObject(expertText);
        }

        const currentEvidence = contradiction.evidence_data || {};
        const nextEvidenceData = {
            ...currentEvidence,
            pricing_evaluation: {
                match_found: evaluation.match_found,
                source: evaluation.source,
                confidence: evaluation.confidence,
                match_quality: evaluation.match_quality,
                source_trace: evaluation.source_trace,
                matched_items: evaluation.matched_items,
                needed_documents: evaluation.needed_documents || [],
                zero_match_reason: evaluation.zero_match_reason || null
            },
            ...(expertStrategy ? { expert_strategy: expertStrategy } : {})
        };

        // Update the contradiction with pricing evidence for persistence (used in PDF/reports)
        await supabase
            .from('contradictions')
            .update({
                evidence_data: nextEvidenceData
            })
            .eq('id', contradictionId);

        return NextResponse.json({
            success: true,
            ...evaluation,
            expert_strategy: expertStrategy
        });

    } catch (error: any) {
        console.error('Pricing AI Error:', error);
        return NextResponse.json({ 
            error: 'Failed to evaluate pricing',
            details: error.message 
        }, { status: 500 });
    }
}
