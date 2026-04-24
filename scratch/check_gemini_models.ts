import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const apiKey = "AIzaSyD_-WBOm0OygGhECnk2171bg6TvukHGwDw";
const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    // Note: The SDK doesn't have a direct listModels but we can try common ones
    const models = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.0-flash-exp", "gemini-2.0-flash"];
    for (const m of models) {
      try {
        const model = genAI.getGenerativeModel({ model: m });
        const result = await model.generateContent("test");
        console.log(`✅ ${m} is AVAILABLE`);
      } catch (e: any) {
        console.log(`❌ ${m} is NOT available: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

listModels();
