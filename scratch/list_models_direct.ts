import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = "AIzaSyD_-WBOm0OygGhECnk2171bg6TvukHGwDw";
const genAI = new GoogleGenerativeAI(apiKey);

async function listAllModels() {
  try {
    // We can't easily list models from the JS SDK, but we can try to fetch them via fetch
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    const data = await response.json();
    console.log("Available Models:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}

listAllModels();
