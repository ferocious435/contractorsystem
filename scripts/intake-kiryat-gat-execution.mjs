import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";

dotenv.config({ path: ".env.local" });

const PROJECT_ID = "d7362181-c47b-46b5-b0c8-3e53bf9058eb";
const CATEGORY = "EXECUTION";
const BASE_URL = process.env.CONTRACTOR_SYSTEM_BASE_URL || "http://127.0.0.1:3000";
const REPORT_PATH = "output/kiryat-gat-execution-intake-report.json";

const SOURCE_DIRS = [
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\התכתבויות",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\לוז",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\מילוי חוזר",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\מיקרוטנלינג",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\מכתבים מקבלן",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\סיכומי ישיבה",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\עבודות מחוץ לקו הכחול",
  "C:\\Users\\SergeyRaihshtat\\Desktop\\sergey\\תבע מזרחית קרית גת\\פיקוח עליון",
];

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".jpg", ".jpeg", ".xlsx", ".txt"]);
const BLOCKED_EXTENSIONS = new Set([".msg", ".dwg", ".mpp", ".gif", ".ctb", ".zip"]);
const READY_STATUSES = new Set(["SCANNED", "VALIDATED"]);
const DIRECT_AI_EXTENSIONS = new Set([".jpg", ".jpeg"]);

const MIME_BY_EXTENSION = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function isIgnoredFile(file) {
  if (BLOCKED_EXTENSIONS.has(file.extension)) return true;
  if (file.name.startsWith("~$")) return true;

  const segments = file.path.toLowerCase().split(/[\\/]+/);
  if (segments.includes("textures")) return true;

  return false;
}

function decodeCredentials(text) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const passwordLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(password|pass|pwd)\s*[:=]/i.test(line));
  const password = passwordLine
    ? passwordLine.replace(/^(password|pass|pwd)\s*[:=]\s*/i, "")
    : text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== email);

  if (!email || !password) {
    throw new Error("Login credentials file is missing email or password");
  }

  return { email, password };
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      files.push({
        path: fullPath,
        name: entry.name,
        extension: extensionOf(entry.name),
        size: info.size,
        folder: dir,
      });
    }
  }
  return files;
}

function inferDocumentType(file) {
  const title = file.name.toLowerCase();
  if (/לוז|לוח|schedule/.test(title)) return "לוח זמנים";
  if (/סיכום|ישיבה|פרוטוקול/.test(title)) return "סיכום ישיבה";
  if (/מכתב|התכתבות|mail|fw_|re_/.test(title)) return "מכתב / התכתבות";
  if (/חשבון|מחיר|כמות|boq|כתב כמויות/.test(title)) return "מסמך כספי";
  return "מסמך ביצוע";
}

function buildParsedJson(file, extractionSource, text) {
  return {
    type: inferDocumentType(file),
    category: CATEGORY,
    summary: "המסמך נקלט ונשמר כטקסט קריא. ניתוח AI מלא ממתין להרצה.",
    analysis_status: "TEXT_EXTRACTED_AI_PENDING",
    analysis_source: "local_bulk_intake",
    extraction_source: extractionSource,
    file_extension: file.extension,
    confidence: 0.2,
    full_markdown: text,
    ai_degraded: true,
    warnings: [
      {
        code: "AI_ANALYSIS_PENDING",
        message: "Text was extracted locally so Gemini can analyze it later.",
      },
    ],
  };
}

async function extractPdfText(buffer) {
  const requireFromHere = createRequire(import.meta.url);
  const { PDFParse } = requireFromHere("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = String(result.text || "").trim();
    if (text.length < 3) return null;
    return { text, extractionSource: "pdf_text_extraction" };
  } finally {
    await parser.destroy();
  }
}

async function extractOfficeText(buffer, fileType) {
  const officeParser = await import("officeparser");
  const ast = await officeParser.OfficeParser.parseOffice(buffer, {
    fileType,
    ocr: false,
    extractAttachments: false,
    newlineDelimiter: "\n",
  });
  const result = await ast.to("text", { textConfig: { preserveLayout: true } });
  const text = String(result.value || ast.toText?.() || "").trim();
  if (text.length < 3) return null;
  return { text, extractionSource: `officeparser_${fileType}` };
}

function extractTextFile(buffer) {
  const text = buffer.toString("utf8").replace(/\u0000/g, "").trim();
  if (text.length < 3) return null;
  return { text, extractionSource: "plain_text_txt" };
}

async function extractReadableText(file, buffer) {
  try {
    if (file.extension === ".pdf") return await extractPdfText(buffer);
    if (file.extension === ".docx") return await extractOfficeText(buffer, "docx");
    if (file.extension === ".xlsx") return await extractOfficeText(buffer, "xlsx");
    if (file.extension === ".txt") return extractTextFile(buffer);
    return null;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getCookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function createAuthenticatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase URL or anon key is missing");

  const credentialsText = await readFile("data/real-login-credentials.txt", "utf8");
  const { email, password } = decodeCredentials(credentialsText);
  const cookieJar = new Map();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          cookieJar.set(name, value);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  return { supabase, cookieHeader: getCookieHeader(cookieJar) };
}

async function fetchExistingDocuments(cookieHeader) {
  const params = new URLSearchParams({ projectId: PROJECT_ID, category: CATEGORY });
  const res = await fetch(`${BASE_URL}/api/documents?${params.toString()}`, {
    headers: { Cookie: cookieHeader },
  });
  const data = await res.json();
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Failed to fetch existing documents");
  }
  return data.documents || [];
}

async function uploadDocument(file, buffer, cookieHeader) {
  const formData = new FormData();
  formData.set("projectId", PROJECT_ID);
  formData.set("category", CATEGORY);
  formData.set("file", new Blob([buffer], { type: MIME_BY_EXTENSION[file.extension] || "application/octet-stream" }), file.name);

  const res = await fetch(`${BASE_URL}/api/documents`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Failed to upload document");
  }
  return data.document;
}

async function markTextScanned(supabase, document, file, buffer, extraction) {
  const extractedTextHash = sha256(extraction.text);
  const contentHash = sha256(buffer);
  const parsedJson = buildParsedJson(file, extraction.extractionSource, extraction.text);

  const { error } = await supabase
    .from("documents")
    .update({
      ai_status: "SCANNED",
      parsed_json: parsedJson,
      extracted_text: extraction.text,
      ocr_status: "COMPLETED",
      content_hash: contentHash,
      extracted_text_hash: extractedTextHash,
      processed_at: new Date().toISOString(),
    })
    .eq("id", document.id)
    .eq("project_id", PROJECT_ID);

  if (error) throw error;
}

async function processDirectDocument(document, cookieHeader) {
  const res = await fetch(`${BASE_URL}/api/documents/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ projectId: PROJECT_ID, documentId: document.id }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.success !== false, status: res.status, data };
}

async function main() {
  const allFiles = (await Promise.all(SOURCE_DIRS.map(walk))).flat();
  const consideredFiles = allFiles.filter((file) => !isIgnoredFile(file));
  const allowed = consideredFiles.filter((file) => ALLOWED_EXTENSIONS.has(file.extension));
  const skippedOther = consideredFiles.filter((file) => !ALLOWED_EXTENSIONS.has(file.extension));

  const seenLocal = new Set();
  const uniqueAllowed = [];
  const duplicateLocal = [];
  for (const file of allowed) {
    const key = `${normalizeTitle(file.name)}::${file.size}`;
    if (seenLocal.has(key)) {
      duplicateLocal.push(file);
      continue;
    }
    seenLocal.add(key);
    uniqueAllowed.push(file);
  }

  const { supabase, cookieHeader } = await createAuthenticatedClient();
  const existingDocuments = await fetchExistingDocuments(cookieHeader);
  const existingByTitle = new Map(existingDocuments.map((doc) => [normalizeTitle(doc.title), doc]));

  const report = {
    projectId: PROJECT_ID,
    category: CATEGORY,
    sourceFolders: SOURCE_DIRS,
    totalFilesConsidered: consideredFiles.length,
    skippedOtherExtensions: skippedOther.map((file) => file.name),
    eligibleFiles: allowed.length,
    eligibleUniqueFiles: uniqueAllowed.length,
    duplicateLocalSkipped: duplicateLocal.map((file) => ({ name: file.name, path: file.path, size: file.size })),
    alreadyPresentSkipped: [],
    uploaded: [],
    scannedText: [],
    pendingDirectAi: [],
    processErrors: [],
    extractionErrors: [],
  };

  let directAiPaused = false;

  for (const file of uniqueAllowed) {
    const titleKey = normalizeTitle(file.name);
    let document = existingByTitle.get(titleKey);
    const alreadyReady = document && READY_STATUSES.has(String(document.ai_status || ""));

    if (alreadyReady) {
      report.alreadyPresentSkipped.push({ title: file.name, status: document.ai_status });
      continue;
    }

    const buffer = await readFile(file.path);

    if (!document) {
      document = await uploadDocument(file, buffer, cookieHeader);
      existingByTitle.set(titleKey, document);
      report.uploaded.push({ title: file.name, id: document.id, size: file.size });
    }

    const extraction = await extractReadableText(file, buffer);
    if (extraction?.text) {
      await markTextScanned(supabase, document, file, buffer, extraction);
      report.scannedText.push({
        title: file.name,
        id: document.id,
        textLength: extraction.text.length,
        extractionSource: extraction.extractionSource,
      });
      continue;
    }

    if (extraction?.error) {
      report.extractionErrors.push({ title: file.name, id: document.id, error: extraction.error });
    }

    if (DIRECT_AI_EXTENSIONS.has(file.extension) && !directAiPaused) {
      const directResult = await processDirectDocument(document, cookieHeader);
      if (directResult.ok) {
        report.scannedText.push({
          title: file.name,
          id: document.id,
          textLength: 0,
          extractionSource: "gemini_direct_multimodal",
        });
      } else {
        report.processErrors.push({
          title: file.name,
          id: document.id,
          status: directResult.status,
          error: directResult.data?.error || directResult.data?.parsed_json?.system_error || "direct AI processing failed",
        });
        if (directResult.status === 429 || directResult.data?.parsed_json?.system_error === "AI_RATE_LIMIT") {
          directAiPaused = true;
        }
      }
      continue;
    }

    report.pendingDirectAi.push({
      title: file.name,
      id: document.id,
      reason: directAiPaused ? "AI_RATE_LIMIT_PAUSED" : "NO_LOCAL_TEXT_EXTRACTION",
    });
  }

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({
    totalFilesConsidered: report.totalFilesConsidered,
    eligibleUniqueFiles: report.eligibleUniqueFiles,
    alreadyPresentSkipped: report.alreadyPresentSkipped.length,
    uploaded: report.uploaded.length,
    scannedText: report.scannedText.length,
    pendingDirectAi: report.pendingDirectAi.length,
    processErrors: report.processErrors.length,
    extractionErrors: report.extractionErrors.length,
    reportPath: REPORT_PATH,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
