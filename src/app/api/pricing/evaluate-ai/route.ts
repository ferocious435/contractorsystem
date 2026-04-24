import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { geminiFlashModel } from '@/lib/gemini';

export async function POST(req: Request) {
    const supabase = await createClient();
    
    try {
        const { contradictionId, projectId } = await req.json();

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
            .eq('category', 'CONTRACT');

        const boqContext = contractDocs
            ?.filter(d => d.parsed_json)
            .map(d => JSON.stringify(d.parsed_json))
            .join('\n') || 'No existing BOQ found.';

        // 3. Поиск в загруженных прайс-листах (Dekel и Contractor)
        // Извлекаем ключевые слова для поиска (Hebrew words > 2 chars)
        const keywords = (contradiction.title || '').split(/[\s,.-]+/).filter((w: string) => w.length > 2);
        
        let pricelistMatches: any[] = [];
        
        if (keywords.length > 0) {
            // Строим OR-фильтр для первых 3 ключевых слов
            // Мы ищем в описании или коде элемента
            const searchTerms = keywords.slice(0, 3);
            const orConditions = searchTerms.map(k => `description.ilike.%${k}%`).join(',');

            const { data: matches } = await supabase
                .from('pricelist_items')
                .select(`
                    id,
                    item_code,
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
                .eq('item_type', 'ITEM')
                .or(`pricelists.is_global.eq.true,pricelists.project_id.eq.${projectId}`)
                .limit(30);
            
            pricelistMatches = matches || [];
        }

        const pricelistContext = pricelistMatches.length > 0 
            ? pricelistMatches.map(m => `[${m.pricelists.name}] Code: ${m.item_code}, Desc: ${m.description}, Price: ${m.rate}, Unit: ${m.unit}`).join('\n')
            : 'No direct matches found in Dekel or Contractor pricelists.';

        // 4. Промпт для оценки (Pricing Engine) - Иерархия Прайсов
        const prompt = `
        You are an Israeli Construction Estimator (תמחירן).
        Analyze the following contradiction/deviation and estimate the financial value for a Variation Order (V.O.).
        
        CONTRADICTION:
        Title: ${contradiction.title}
        Description: ${contradiction.description}
        Evidence: ${JSON.stringify(contradiction.evidence_data)}
        
        PROJECT CONTEXT (Contract BOQ Items):
        ${boqContext.substring(0, 15000)}
        
        EXTERNAL PRICELISTS (Potential matches from Dekel/Contractor):
        ${pricelistContext}
        
        TASK (The Priority Engine):
        1. FIRST: Search the "PROJECT CONTEXT" (Contract BOQ) for exact or similar items. This is the highest priority.
        2. SECOND: If not found in BOQ, check "EXTERNAL PRICELISTS". "Dekel" (מחירון דקל) is the standard industry benchmark in Israel.
        3. THIRD: If not in Dekel, look for "Contractor" custom rates in the external list.
        4. FOURTH: If none of the above, perform a Zero-Match analysis (ניתוח מחיר) based on market knowledge for the Israeli construction industry.
        
        RULES:
        - All prices must be EXCLUDING VAT (לפני מע"מ).
        - If multiple matches exist (American Test), formulate clarification questions in Hebrew.
        - Provide a professional Hebrew rationale in "ai_rationale" field. 
        - The "ai_rationale" should explain WHICH step of the hierarchy was used and why.
        
        OUTPUT FORMAT (Strict JSON):
        {
            "match_found": boolean,
            "source": "BOQ" | "DEKEL" | "CONTRACTOR" | "CUSTOM_ANALYSIS",
            "suggested_unit_price_excl_vat": number,
            "suggested_unit": "string (Hebrew, e.g., מ\"ר, יח', קומפ')",
            "suggested_quantity": number,
            "item_code": "string",
            "ai_rationale": "string (Professional justification in Hebrew referring to the hierarchy)",
            "suggested_description": "string (Professional Hebrew description for the V.O. letter)",
            "questions": ["string"] (Clarification questions in Hebrew, empty if match is certain)
        }
        `;

        const result = await geminiFlashModel.generateContent(prompt);
        const responseText = result.response.text();
        
        const cleanJson = responseText.replace(/```json|```/g, '').trim();
        const evaluation = JSON.parse(cleanJson);

        return NextResponse.json({
            success: true,
            ...evaluation
        });

    } catch (error: any) {
        console.error('Pricing AI Error:', error);
        return NextResponse.json({ 
            error: 'Failed to evaluate pricing',
            details: error.message 
        }, { status: 500 });
    }
}
