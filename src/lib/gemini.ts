import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing. Gemini API calls will fail.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

// The latest Gemini 3.1 Pro model is recommended for complex reasoning and parsing
export const geminiModel = genAI.getGenerativeModel({
  model: "gemini-3.1-pro",
  generationConfig: {
    // Force JSON output for deterministic parsing
    responseMimeType: "application/json",
  }
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
      "unit": "String - The unit of measurement (e.g., 'מ\"ר', 'יח', 'קומפ'). Provide exactly as written.",
      "quantity": "Number - The quantity (כמות). Convert Hebrew/comma formatting to standard decimal numbers (e.g., 1,000.50 -> 1000.50)",
      "unit_price_excl_vat": "Number - The unit price (מחיר יחידה). Convert to standard decimal."
    }
  ]
}

If a column is missing in the source document, leave the value as null or an empty string, except for numbers which should default to 0 if not present.
Focus specifically on tabular structures and rows that look like ledger items for the 'items' array.
`;
