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
        const { contradictionId, description, priorityOverride } = body;

        // Extract relevant project pricing info if possible
        // For demonstration and following the PRD, we send the intent to Gemini 
        // to act as the AI Estimator following the hierarchy BOQ -> Dekel -> Contractor -> Zero-Match.

        const priorityText = priorityOverride ? `Force source exactly to: ${priorityOverride}.` : "Follow strictly: 1. BOQ (Contract) -> 2. Dekel -> 3. Contractor.";

        const prompt = `
You are the AI Pricing Estimator for the CONTRACTORSYSTEM.
Your task is to analyze the following work description and find the appropriate pricing.
Work Description: "${description}"

RULES:
1. All prices must be EXCLUDING VAT (Pre-VAT).
2. ${priorityText} 
3. If there is a direct match, output a unit, a price, and match_found = true.
4. If there is no clear match, return match_found = false, 0 for price, and provide a list of 2 clarifying questions (questions array) to build a "Zero-Match" (Custom Analysis) from scratch.
5. If match_found is true, provide a brief reasoning in Hebrew in "ai_rationale".
6. If match_found is false, put "לא נמצאה התאמה במחירונים הקיימים. יש לבנות ניתוח מחיר ידני (מערכת הכינה תבנית ריקה)." in ai_rationale.
7. You must ONLY output a valid JSON object.

JSON STRUCTURE:
{
  "match_found": boolean,
  "source": "String ('BOQ', 'DEKEL', 'CONTRACTOR', or 'CUSTOM_ANALYSIS')",
  "item_code": "String or null",
  "suggested_description": "String",
  "suggested_unit": "String ('מ\"ר', 'קומפ', 'שעות', etc.)",
  "suggested_quantity": number,
  "suggested_unit_price_excl_vat": number,
  "questions": ["String (Hebrew questions if match_found is false)"],
  "ai_rationale": "String (Hebrew explanation)"
}
`;

        const result = await geminiModel.generateContent(prompt);
        const textResponse = result.response.text();

        let parsedData;
        try {
            parsedData = JSON.parse(textResponse);
        } catch (e) {
            console.error("Failed to parse Gemini JSON for estimator:", textResponse);
            throw new Error("Invalid format from AI Estimator.");
        }

        return NextResponse.json(parsedData);

    } catch (error: any) {
        console.error("Error in AI Estimator:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
