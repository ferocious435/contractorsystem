
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing. Gemini API calls will fail.");
}

export const genAI = new GoogleGenerativeAI(apiKey || "");

export function requireGeminiApiKey() {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }
  return apiKey;
}

/**
 * Helper to retry Gemini calls on transient errors and short rate-limit bursts.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const errorInfo = error as { status?: number; message?: string };
    const errorMessage = typeof errorInfo.message === 'string' ? errorInfo.message : '';
    const isRetryable =
      errorInfo.status === 503 ||
      errorInfo.status === 429 ||
      errorMessage.includes('503') ||
      errorMessage.includes('Service Unavailable') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Too Many Requests') ||
      errorMessage.includes('RESOURCE_EXHAUSTED');

    if (retries > 0 && isRetryable) {
      console.warn(`Gemini temporary error detected. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export const GEMINI_CONFIG = {
  /** 
   * Current stable Gemini API standard for ContractorSystem.
   */
  STABLE_FLASH: "gemini-3.5-flash",
  FAST_LIGHT: "gemini-3.1-flash-lite",
  FALLBACK_FLASH: "gemini-2.5-flash",
  PRO_MODEL: "gemini-3.5-flash",
} as const;

// מודל מרכזי לניתוח עומק (Radar)
export const geminiModel = genAI.getGenerativeModel({
  model: GEMINI_CONFIG.PRO_MODEL,
  generationConfig: {
    responseMimeType: "application/json",
  }
});

// מודל למשימות טקסט וצ'אט
export const geminiModelText = genAI.getGenerativeModel({
  model: GEMINI_CONFIG.STABLE_FLASH,
});

// מודל Flash ל-OCR ומשימות מהירות
export const geminiFlashModel = genAI.getGenerativeModel({
  model: GEMINI_CONFIG.STABLE_FLASH,
});

/**
 * Universal prompt for analyzing ALL types of Israeli construction documents.
 */
export const DOCUMENT_ANALYSIS_PROMPT = `
You are an expert AI system for analyzing Israeli construction documents (מסמכי בנייה).

CRITICAL RULES:
1. ONLY output valid JSON. No markdown outside JSON.
2. ALL text fields must be in HEBREW.
3. You MUST provide a full Markdown representation of the document content in "full_markdown".
4. Shelf contracts such as חוזה מדף 3210, the Blue Book / הספר הכחול, מפרט כללי, government general specifications, standards, and other incorporated reference documents are REFERENCE documents. Do NOT classify them as ordinary project CONTRACT documents unless the document itself is the signed project agreement or a project-specific special specification.
5. If a reference document is detected, set category="REFERENCE", is_reference=true, reference_family to BLUE_BOOK / SHELF_CONTRACT_3210 / ISRAELI_STANDARD / OTHER_REFERENCE, and authority_scope to REFERENCE_ONLY unless the file itself proves project incorporation.

Structure the JSON:
{
  "type": "הסכם / כתב כמויות / מפרט טכני / פרוטוקול / אחר",
  "category": "CONTRACT / EXECUTION / PRICELIST / REFERENCE",
  "is_reference": false,
  "reference_family": "BLUE_BOOK / SHELF_CONTRACT_3210 / ISRAELI_STANDARD / OTHER_REFERENCE / null",
  "authority_scope": "REFERENCE_ONLY / PROJECT_INCORPORATED / GLOBAL_STANDARD / null",
  "incorporated_by_contract": "Hebrew explanation or null",
  "summary": "Hebrew summary",
  "full_markdown": "COMPLETE document content converted to clean Markdown. Extract all tables, clauses, prices.",
  "date": "DD.MM.YYYY",
  "parties": ["Company A", "Company B"],
  "key_terms": ["Important clause 1", "Important clause 2"],
  "financial_data": {
    "total_amount": 0,
    "items": []
  },
  "warnings": ["Risk 1"]
}
`;

export const BOQ_PARSING_PROMPT = `
You are an expert AI for parsing Israeli BOQs. 
Return JSON:
{
  "project_name": "String",
  "items": [
    {
      "item_code": "String",
      "description": "String",
      "type": "CHAPTER/ITEM/NOTE",
      "unit": "String",
      "quantity": 0,
      "unit_price_excl_vat": 0
    }
  ]
}
`;

export const ENGINEERING_STRATEGY_PROMPT = `
אתה מומחה בכיר לניהול תביעות הנדסיות, אומדן עלויות (Estimator) וחוזים במערכת הבנייה הישראלית.
תפקידך: לבצע אבחון הנדסי עמוק ("Expert Mode") עבור סתירה או שינוי שנמצאו בין החוזה לביצוע.

דגשים קריטיים לניתוח (Ripple Effect):
1. **השלכות הנדסיות נלוות (Secondary Impacts):** אל תתמקד רק בשינוי הישיר. אם קוטר צינור גדל, נתח את הצורך בחפירה רחבה יותר, סוג מצעים שונה, אביזרים מיוחדים ושינוי בתפוקות.
2. **שיבוש רצף עבודה (Disruption):** נתח כיצד השינוי משפיע על משימות קריטיות אחרות (השפעה על לוחות זמנים, צורך בצוותים נוספים, שימוש בציוד כבד שלא תומחר).
3. **ביסוס תקני וחוזי:** השתמש במושגים מהמפרט הכללי (הספר הכחול) ותקנים ישראליים כדי לתת תוקף לטיעון.
4. **אסטרטגיה מסחרית:** הסבר מדוע מדובר ב"עבודה נוספת" (Extra Work) או "שינוי יסודי" שלא ניתן לגזור ממחירי החוזה הקיימים.

Return JSON ONLY:
{
  "ripple_effect": {
    "technical_analysis": "ניתוח הנדסי של השינוי והשלכותיו על מערכות נלוות (Ripple Effect)",
    "implied_items": ["רשימת סעיפים/חומרים נוספים שנדרשים עקב השינוי"],
    "work_disruption": "תיאור הפגיעה ברצף העבודה וביעילות"
  },
  "contractual_diagnostic": {
    "legal_basis": "ביסוס חוזי/תקני (מפרט כללי, חוק המכר וכו')",
    "argument_for_supervisor": "טיעון מקצועי ויבש להצגה מול המפקח/מזמין"
  },
  "operational_instructions": {
    "site_diary_draft": "נוסח מדויק ויבש לרישום ביומן העבודה שמתעד את העובדות ההנדסיות",
    "required_evidence": ["רשימת הוכחות: צילומים, תעודות משלוח, אישורי מפקח בזמן אמת"]
  },
  "risk_assessment": "סיכונים הנדסיים/כספיים במידה והשינוי לא יתומחר כראוי"
}
`;
