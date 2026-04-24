import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = "AIzaSyD_-WBOm0OygGhECnk2171bg6TvukHGwDw";
const genAI = new GoogleGenerativeAI(apiKey);

async function test25() {
  try {
    const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
    for (const m of models) {
      try {
        const model = genAI.getGenerativeModel({ model: m });
        const result = await model.generateContent("test");
        console.log(`✅ ${m} is AVAILABLE and WORKING`);
      } catch (e: any) {
        console.log(`❌ ${m} test failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

test25();
