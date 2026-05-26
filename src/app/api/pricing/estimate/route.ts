import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { geminiModel } from '@/lib/gemini';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { description, priorityOverride } = body;

        // The estimator must follow the contractor-first pricing hierarchy:
        // BOQ -> Dekel -> Contractor -> Zero-Match.
        const priorityText = priorityOverride ? `Force source exactly to: ${priorityOverride}.` : 'Follow strictly: 1. BOQ (Contract) -> 2. Dekel -> 3. Contractor.';

        const prompt = `
You are the AI Pricing Estimator for the CONTRACTORSYSTEM.
Your task is to analyze the following work description and find the appropriate pricing.
Work Description: "${description}"

RULES:
1. All prices must be EXCLUDING VAT (Pre-VAT).
2. ${priorityText}
3. If there is a direct match, output a unit, a price, and match_found = true.
4. If there is no clear match, still build the best editable draft estimate you can from the description and standard construction logic. Use source = CUSTOM_ANALYSIS, lower confidence, and ask only targeted questions that materially change the amount.
5. If match_found is true, provide a brief reasoning in Hebrew in "ai_rationale".
6. If match_found is false, explain in Hebrew that no direct item was found, but a draft estimate may still be built from the available description.
7. Never invent a confident price without a clear source.
8. You must ONLY output a valid JSON object.

JSON STRUCTURE:
{
  "match_found": boolean,
  "source": "String ('BOQ', 'DEKEL', 'CONTRACTOR', or 'CUSTOM_ANALYSIS')",
  "item_code": "String or null",
  "suggested_description": "String",
  "suggested_unit": "String ('מ\"ר', 'קומפ', 'שעות', etc.)",
  "suggested_quantity": number,
  "suggested_unit_price_excl_vat": number,
  "questions": ["String (Hebrew targeted questions only if a missing parameter truly changes the amount)"],
  "ai_rationale": "String (Hebrew explanation)"
}
`;

        const result = await geminiModel.generateContent(prompt);
        const textResponse = result.response.text();

        let parsedData;
        try {
            parsedData = JSON.parse(textResponse);
        } catch {
            console.error('Failed to parse Gemini JSON for estimator:', textResponse);
            throw new Error('Invalid format from AI Estimator.');
        }

        return NextResponse.json(parsedData);

    } catch (error: unknown) {
        console.error('Error in AI Estimator:', error);
        const message = error instanceof Error ? error.message : 'Unknown AI Estimator error.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
