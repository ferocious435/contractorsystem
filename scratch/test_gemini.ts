
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const geminiApiKey = process.env.GEMINI_API_KEY!;

async function testModel(modelName: string) {
    console.log(`Testing model: ${modelName}`);
    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hi");
        console.log(`Success with ${modelName}: ${result.response.text()}`);
        return true;
    } catch (err: any) {
        console.log(`Failed with ${modelName}: ${err.message}`);
        return false;
    }
}

async function main() {
    await testModel("gemini-3-flash-preview");
    await testModel("gemini-1.5-flash");
    await testModel("gemini-1.5-pro");
}

main();
