// Скрипт для получения ПОЛНОГО списка доступных моделей через Google Generative AI REST API
const API_KEY = "AIzaSyD_-WBOm0OygGhECnk2171bg6TvukHGwDw";

async function listModels() {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`
    );
    const data = await res.json();
    
    if (data.models) {
      console.log(`\n=== Найдено ${data.models.length} моделей ===\n`);
      
      // Фильтруем только модели с поддержкой generateContent
      const contentModels = data.models.filter((m: any) => 
        m.supportedGenerationMethods?.includes("generateContent")
      );
      
      console.log(`Моделей с generateContent: ${contentModels.length}\n`);
      
      for (const model of contentModels) {
        console.log(`✅ ${model.name}`);
        console.log(`   Display: ${model.displayName}`);
        console.log(`   Описание: ${model.description?.substring(0, 100)}`);
        console.log(`   Методы: ${model.supportedGenerationMethods?.join(", ")}`);
        console.log("");
      }
    } else {
      console.log("Ответ API:", JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error("Ошибка:", e);
  }
}

listModels();
