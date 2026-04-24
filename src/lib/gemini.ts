import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing. Gemini API calls will fail.");
}

export const genAI = new GoogleGenerativeAI(apiKey || "");

export const GEMINI_CONFIG = {
  /** Актуальная стабильная модель (апрель 2026). Проверено через API: models/gemini-2.5-flash */
  STABLE_FLASH: "gemini-2.5-flash",
} as const;

// Основная модель для глубокого анализа (Radar)
export const geminiModel = genAI.getGenerativeModel({
  model: GEMINI_CONFIG.STABLE_FLASH,
  generationConfig: {
    responseMimeType: "application/json",
  }
});

// Модель для текстовых задач и чата
export const geminiModelText = genAI.getGenerativeModel({
  model: GEMINI_CONFIG.STABLE_FLASH,
});

// Flash модель для OCR и быстрых задач
export const geminiFlashModel = genAI.getGenerativeModel({
  model: GEMINI_CONFIG.STABLE_FLASH,
});

/**
 * System Prompt designed specifically for parsing Israeli contractor BOQs (Bills of Quantities)
 * It forces the model to ignore conversational text and extract only the tabular financial data.
 */
export const BOQ_PARSING_PROMPT = `
You are an expert AI system designed to parse Israeli construction Bills of Quantities (Сметы / כתב כמויות).
Your task is to extract tabular data and project metadata from the provided document (PDF or Image) and convert it into a strict JSON format.

CRITICAL RULES:
1. ONLY output valid JSON. No markdown, no conversational text, no preambles.
2. Structure the JSON exactly like this:
{
  "project_name": "String - The name of the project. Leave empty if none.",
  "client_name": "String - The name of the client (שם המזמין/לקוח). Leave empty if none.",
  "total_budget": "Number - The total budget or grand total of the BOQ. Convert to standard decimal. 0 if none.",
  "items": [
    {
      "item_code": "String (e.g., '01.01', 'א.1') - The section or item number. Leave empty if none.",
      "description": "String - The description of the work/item (תיאור העבודה/הסעיף)",
      "type": "String - One of: 'CHAPTER' (main heading), 'SUBCHAPTER' (sub-heading), 'ITEM' (regular line item with price/quantity), 'NOTE' (textual comment/note without price).",
      "unit": "String - The unit of measurement (e.g., 'מ\"ר', 'יח', 'קומפ'). Provide exactly as written.",
      "quantity": "Number - The quantity (כמות). Convert Hebrew/comma formatting to standard decimal numbers (e.g., 1,000.50 -> 1000.50)",
      "unit_price_excl_vat": "Number - The unit price (מחיר יחידה). Convert to standard decimal."
    }
  ]
}

If a column is missing in the source document, leave the value as null or an empty string, except for numbers which should default to 0 if not present.
Focus specifically on tabular structures and rows that look like ledger items or headings for the 'items' array.
Preserve the original Hebrew text in description and unit fields.
`;

/**
 * Universal prompt for analyzing ALL types of Israeli construction documents.
 * Works for: contracts, protocols, BOQs, specifications, letters, etc.
 */
export const DOCUMENT_ANALYSIS_PROMPT = `
You are an expert AI system for analyzing Israeli construction documents (מסמכי בנייה).
Your task is to read the provided document and extract structured information.

CRITICAL RULES:
1. ONLY output valid JSON. No markdown, no conversational text, no preambles.
2. First, classify the document type, then extract relevant data.
3. ALL text fields must be in the ORIGINAL language of the document (usually Hebrew).

Structure the JSON exactly like this:
{
  "type": "String - Document type. One of: הסכם, כתב כמויות, מפרט טכני, פרוטוקול ישיבה, מכתב, חשבון, הוראת שינוי, תוכנית, מחירון, אחר",
  "category": "String - One of: CONTRACT, EXECUTION, PRICELIST",
  "summary": "String - 2-3 sentence summary of the document content in Hebrew",
  "date": "String - Document date if found (DD.MM.YYYY format), empty if not found",
  "parties": ["Array of strings - Names of parties/companies mentioned"],
  "key_terms": ["Array of strings - Important terms, conditions, obligations found in the document"],
  "financial_data": {
    "total_amount": "Number - Total amount mentioned, 0 if none",
    "currency": "String - ILS/NIS/₪ if found",
    "items": [
      {
        "item_code": "String - Section/item number if exists",
        "description": "String - Description of work/item",
        "unit": "String - Unit of measurement if exists",
        "quantity": "Number - Quantity if exists, 0 if not",
        "unit_price_excl_vat": "Number - Unit price without VAT if exists, 0 if not"
      }
    ]
  },
  "warnings": ["Array of strings - Any unusual clauses, risks, or important notes found"]
}

If the document is a table/BOQ (כתב כמויות), focus on extracting ALL rows from the table into financial_data.items.
If the document is text-based (contract, protocol, letter), focus on summary, key_terms, and warnings.
Always preserve the original Hebrew text exactly as written.
`;

