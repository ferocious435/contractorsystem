import assert from "node:assert/strict";
import test from "node:test";

let readinessModule = null;
let ollamaModule = null;

try {
  readinessModule = await import("../src/utils/ai-readiness.ts");
} catch {
  // The first run should fail clearly until local AI readiness exists.
}

try {
  ollamaModule = await import("../src/lib/ollama.ts");
} catch {
  // The first run should fail clearly until the local Ollama client exists.
}

test("local AI is available only when Ollama and the configured model are ready", () => {
  assert.ok(readinessModule?.getAiReadiness, "AI readiness helper must exist");

  const state = readinessModule.getAiReadiness(
    {
      AI_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_MODEL: "qwen3:4b",
    },
    { reachable: true, modelInstalled: true }
  );

  assert.deepEqual(state, {
    available: true,
    provider: "Local AI · qwen3:4b",
    reason: null,
  });
});

test("local AI reports a stopped Ollama service", () => {
  assert.ok(readinessModule?.getAiReadiness, "AI readiness helper must exist");

  const state = readinessModule.getAiReadiness(
    { AI_PROVIDER: "ollama", OLLAMA_MODEL: "qwen3:4b" },
    { reachable: false, modelInstalled: false }
  );

  assert.equal(state.available, false);
  assert.equal(state.reason, "AI_UNAVAILABLE");
});

test("Ollama generation stays on the loopback interface and requests JSON", async () => {
  assert.ok(ollamaModule?.generateOllamaText, "Ollama generation helper must exist");

  let requestUrl = "";
  let requestBody = null;
  const fetchImpl = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ response: '[{"title":"בדיקה"}]' }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const response = await ollamaModule.generateOllamaText("Return JSON", {
    environment: {
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_MODEL: "qwen3:4b",
    },
    fetchImpl,
  });

  assert.equal(requestUrl, "http://127.0.0.1:11434/api/generate");
  assert.equal(requestBody.model, "qwen3:4b");
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.format, "json");
  assert.equal(requestBody.think, false);
  assert.equal(requestBody.options.num_ctx, 8192);
  assert.ok(requestBody.options.num_predict <= 1024);
  assert.equal(response, '[{"title":"בדיקה"}]');
});

test("Ollama client rejects a non-local server URL", async () => {
  assert.ok(ollamaModule?.generateOllamaText, "Ollama generation helper must exist");

  await assert.rejects(
    ollamaModule.generateOllamaText("test", {
      environment: {
        OLLAMA_BASE_URL: "https://example.com",
        OLLAMA_MODEL: "qwen3:4b",
      },
      fetchImpl: async () => new Response("{}"),
    }),
    /loopback/i
  );
});
