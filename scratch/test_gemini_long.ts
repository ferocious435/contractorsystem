
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const geminiApiKey = process.env.GEMINI_API_KEY!;

async function main() {
    console.log(`Testing model with longer text...`);
    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const result = await model.generateContent("Analyze this contract snippet: 'The contractor shall complete the works within 12 months.' and this report: 'Site handover delayed by 2 months'. Find a contradiction. Respond in JSON.");
        console.log(`Success: ${result.response.text()}`);
    } catch (err: any) {
        console.log(`Failed: ${err.message}`);
    }
}

main();
