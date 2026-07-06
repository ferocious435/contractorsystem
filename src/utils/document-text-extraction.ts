const MAX_AI_TEXT_CHARS = 120_000;
import { createRequire } from "node:module";

const MAX_STORED_TEXT_CHARS = 500_000;
const PDF_MIME_TYPE = "application/pdf";

const DIRECT_GEMINI_MIME_TYPES: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
};

const OFFICE_PARSER_FILE_TYPES: Record<string, string> = {
    ".docx": "docx",
    ".xlsx": "xlsx",
    ".pptx": "pptx",
    ".odt": "odt",
    ".ods": "ods",
    ".odp": "odp",
    ".rtf": "rtf",
    ".csv": "csv",
    ".md": "md",
    ".markdown": "md",
    ".html": "html",
    ".htm": "html",
};

const DIRECT_TEXT_EXTENSIONS = new Set([
    ".txt",
    ".text",
    ".log",
    ".json",
    ".jsonl",
    ".xml",
    ".yml",
    ".yaml",
    ".ini",
    ".eml",
    ".tsv",
    ".geojson",
    ".kml",
    ".gml",
    ".ifc",
    ".dxf",
    ".reg",
    ".boq",
    ".bq",
    ".qty",
    ".tlv",
    ".skn",
]);

const BOQ_TEXT_EXTENSIONS = new Set([
    ".boq",
    ".bq",
    ".qty",
    ".tlv",
    ".skn",
]);

const GOOGLE_NATIVE_FORMATS: Record<string, string> = {
    ".gdoc": "Google Docs",
    ".gsheet": "Google Sheets",
    ".gslides": "Google Slides",
    ".gdraw": "Google Drawings",
};

const CONVERTER_REQUIRED_FORMATS: Record<string, { code: string; label: string }> = {
    ".xls": { code: "LEGACY_SPREADSHEET_CONVERSION_REQUIRED", label: "legacy Excel XLS" },
    ".ppt": { code: "LEGACY_PRESENTATION_CONVERSION_REQUIRED", label: "legacy PowerPoint PPT" },
    ".dwg": { code: "CAD_CONVERTER_REQUIRED", label: "AutoCAD DWG" },
    ".dwf": { code: "CAD_CONVERTER_REQUIRED", label: "Autodesk DWF" },
    ".dwfx": { code: "CAD_CONVERTER_REQUIRED", label: "Autodesk DWFx" },
    ".dgn": { code: "CAD_CONVERTER_REQUIRED", label: "MicroStation DGN" },
    ".rvt": { code: "BIM_CONVERTER_REQUIRED", label: "Revit RVT" },
    ".rfa": { code: "BIM_CONVERTER_REQUIRED", label: "Revit family RFA" },
    ".nwd": { code: "BIM_CONVERTER_REQUIRED", label: "Navisworks NWD" },
    ".nwc": { code: "BIM_CONVERTER_REQUIRED", label: "Navisworks NWC" },
    ".skp": { code: "BIM_CONVERTER_REQUIRED", label: "SketchUp SKP" },
    ".mpp": { code: "PROJECT_FILE_CONVERTER_REQUIRED", label: "Microsoft Project MPP" },
};

const KNOWN_FILE_EXTENSIONS = new Set([
    ...Object.keys(DIRECT_GEMINI_MIME_TYPES),
    ...Object.keys(OFFICE_PARSER_FILE_TYPES),
    ...DIRECT_TEXT_EXTENSIONS,
    ...Object.keys(GOOGLE_NATIVE_FORMATS),
    ...Object.keys(CONVERTER_REQUIRED_FORMATS),
    ".doc",
]);

type OfficeParserAst = {
    to(format: "text", config?: Record<string, unknown>): Promise<{ value?: unknown }>;
    toText?: () => string;
};

type OfficeParserModule = {
    OfficeParser: {
        parseOffice(input: Buffer | Uint8Array, config?: Record<string, unknown>): Promise<OfficeParserAst>;
    };
};

type PdfParseConstructor = new (options: { data: Buffer | Uint8Array }) => {
    getText(): Promise<{ text?: string; total?: number }>;
    destroy(): Promise<void>;
};

type PdfParseModule = {
    PDFParse: PdfParseConstructor;
};

export type PreparedDocumentAnalysisInput =
    | {
        kind: "direct";
        mimeType: string;
        fileBuffer: Buffer;
        extractionSource: "direct_multimodal";
        extractedText: "";
        aiText: "";
        wasTruncated: false;
    }
    | {
        kind: "text";
        fileBuffer: Buffer;
        extractionSource: string;
        extractedText: string;
        aiText: string;
        wasTruncated: boolean;
    };

export function getFileExtension(title: string) {
    const lower = title.toLowerCase();
    const finalExtension = lower.match(/\.[a-z0-9]{1,12}$/)?.[0] || "";

    if (KNOWN_FILE_EXTENSIONS.has(finalExtension)) {
        return finalExtension;
    }

    const tokens = lower.split(/[\s._()[\]{}-]+/).filter(Boolean);
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
        const extension = `.${tokens[index]}`;
        if (!KNOWN_FILE_EXTENSIONS.has(extension)) continue;

        const suffixTokens = tokens.slice(index + 1);
        if (suffixTokens.every((token) => /^\d{1,4}$/.test(token))) {
            return extension;
        }
    }

    if (/^\.\d{1,4}$/.test(finalExtension)) {
        return "";
    }

    return finalExtension;
}

export function getSupportedGeminiMimeType(title: string) {
    return DIRECT_GEMINI_MIME_TYPES[getFileExtension(title)] || null;
}

export function getSupportedGeminiMimeTypeFromBuffer(buffer: Buffer) {
    const pdfHeaderWindow = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1");
    if (pdfHeaderWindow.includes("%PDF-")) return DIRECT_GEMINI_MIME_TYPES[".pdf"];

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return DIRECT_GEMINI_MIME_TYPES[".jpg"];
    }

    if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
    ) {
        return DIRECT_GEMINI_MIME_TYPES[".png"];
    }

    if (
        buffer.length >= 12
        && buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return DIRECT_GEMINI_MIME_TYPES[".webp"];
    }

    return null;
}

export function getReadableFormatSummary() {
    return [
        "PDF/images",
        "DOC/DOCX",
        "XLSX/CSV/TSV",
        "PPTX",
        "ODT/ODS/ODP",
        "RTF/HTML/MD/TXT/JSON/XML",
        "DXF/IFC/REG",
        "BOQ/quantity text formats: TLV/SKN/BOQ/BQ/QTY",
    ].join(", ");
}

function normalizeText(value: string) {
    return value
        .replace(/\u0000/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

function truncateText(value: string, limit: number) {
    if (value.length <= limit) {
        return { text: value, wasTruncated: false };
    }

    return {
        text: `${value.slice(0, limit)}\n\n[Document text was truncated for AI analysis. Original length: ${value.length} characters.]`,
        wasTruncated: true,
    };
}

function decodeTextBuffer(buffer: Buffer) {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.toString("utf16le", 2);
    }

    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        const swapped = Buffer.alloc(buffer.length - 2);
        for (let i = 2; i + 1 < buffer.length; i += 2) {
            swapped[i - 2] = buffer[i + 1];
            swapped[i - 1] = buffer[i];
        }
        return swapped.toString("utf16le");
    }

    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    let zeroOdd = 0;
    let zeroEven = 0;
    for (let i = 0; i < sample.length; i += 1) {
        if (sample[i] === 0) {
            if (i % 2 === 0) zeroEven += 1;
            else zeroOdd += 1;
        }
    }

    if (zeroOdd > sample.length / 8 && zeroEven < sample.length / 32) {
        return buffer.toString("utf16le");
    }

    return buffer.toString("utf8");
}

function isProbablyUtf16Text(buffer: Buffer) {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return true;
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return true;

    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    if (sample.length < 8) return false;

    let zeroOdd = 0;
    let zeroEven = 0;
    for (let i = 0; i < sample.length; i += 1) {
        if (sample[i] === 0) {
            if (i % 2 === 0) zeroEven += 1;
            else zeroOdd += 1;
        }
    }

    return (
        (zeroOdd > sample.length / 8 && zeroEven < sample.length / 32)
        || (zeroEven > sample.length / 8 && zeroOdd < sample.length / 32)
    );
}

function isProbablyText(buffer: Buffer) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    if (sample.length === 0) return false;

    let control = 0;
    let zero = 0;
    for (const byte of sample) {
        if (byte === 0) zero += 1;
        if (byte < 32 && ![9, 10, 12, 13].includes(byte)) control += 1;
    }

    return zero / sample.length < 0.08 && control / sample.length < 0.18;
}

function isProbablyDecodableText(buffer: Buffer) {
    return isProbablyText(buffer) || isProbablyUtf16Text(buffer);
}

function detectOfficeParserFileTypeFromBuffer(buffer: Buffer) {
    const isZip = buffer.length >= 4
        && buffer[0] === 0x50
        && buffer[1] === 0x4b
        && [0x03, 0x05, 0x07].includes(buffer[2]);

    if (!isZip) return null;

    const zipDirectorySample = buffer.subarray(0, Math.min(buffer.length, 2_000_000)).toString("latin1");
    if (zipDirectorySample.includes("word/document.xml")) return "docx";
    if (zipDirectorySample.includes("xl/workbook.xml")) return "xlsx";
    if (zipDirectorySample.includes("ppt/presentation.xml")) return "pptx";
    if (zipDirectorySample.includes("mimetypeapplication/vnd.oasis.opendocument.text")) return "odt";
    if (zipDirectorySample.includes("mimetypeapplication/vnd.oasis.opendocument.spreadsheet")) return "ods";
    if (zipDirectorySample.includes("mimetypeapplication/vnd.oasis.opendocument.presentation")) return "odp";

    return null;
}

function requireUsefulText(text: string, code = "DOCUMENT_TEXT_EXTRACTION_EMPTY") {
    const normalized = normalizeText(text);
    if (normalized.length < 3) {
        throw new Error(`${code}: extracted text is empty`);
    }
    return normalized;
}

async function loadPdfParse() {
    const requireFromHere = createRequire(import.meta.url);
    const pdfParse = requireFromHere("pdf-parse") as PdfParseModule;
    return pdfParse.PDFParse;
}

export async function extractPdfText(buffer: Buffer) {
    const PDFParse = await loadPdfParse();
    const parser = new PDFParse({ data: buffer });

    try {
        const pdfData = await parser.getText();
        return {
            text: requireUsefulText(pdfData.text || ""),
            pages: pdfData.total || 0,
        };
    } finally {
        await parser.destroy();
    }
}

async function extractWithOfficeParser(buffer: Buffer, fileType: string) {
    const officeParser = await import("officeparser") as unknown as OfficeParserModule;
    const ast = await officeParser.OfficeParser.parseOffice(buffer, {
        fileType,
        ocr: false,
        extractAttachments: false,
        newlineDelimiter: "\n",
    });
    const result = await ast.to("text", { textConfig: { preserveLayout: true } });
    const text = typeof result.value === "string" ? result.value : ast.toText?.() || "";
    return requireUsefulText(text);
}

async function extractWithWordExtractor(buffer: Buffer) {
    const WordExtractor = (await import("word-extractor")).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    return requireUsefulText([
        doc.getBody(),
        doc.getHeaders(),
        doc.getFooters(),
        doc.getFootnotes(),
        doc.getEndnotes(),
        doc.getAnnotations(),
        doc.getTextboxes(),
    ].filter(Boolean).join("\n\n"));
}

function throwGoogleNativeFormat(extension: string) {
    const label = GOOGLE_NATIVE_FORMATS[extension] || "Google native file";
    throw new Error(`GOOGLE_NATIVE_EXPORT_REQUIRED: ${label} files contain a Drive pointer, not the document body`);
}

function throwConverterRequired(extension: string) {
    const item = CONVERTER_REQUIRED_FORMATS[extension];
    if (!item) {
        throw new Error(`UNSUPPORTED_DOCUMENT_TYPE: ${extension || "unknown"}`);
    }

    throw new Error(`${item.code}: ${item.label} requires a converter or export`);
}

function makeTextInput(fileBuffer: Buffer, extractionSource: string, text: string): PreparedDocumentAnalysisInput {
    const extracted = requireUsefulText(text);
    const ai = truncateText(extracted, MAX_AI_TEXT_CHARS);
    const stored = truncateText(extracted, MAX_STORED_TEXT_CHARS);

    return {
        kind: "text",
        fileBuffer,
        extractionSource,
        extractedText: stored.text,
        aiText: ai.text,
        wasTruncated: ai.wasTruncated || stored.wasTruncated,
    };
}

export async function prepareDocumentAnalysisInput(fileBuffer: Buffer, title: string): Promise<PreparedDocumentAnalysisInput> {
    const extension = getFileExtension(title);
    const directMimeType = getSupportedGeminiMimeTypeFromBuffer(fileBuffer);

    if (directMimeType === PDF_MIME_TYPE) {
        try {
            const pdfText = await extractPdfText(fileBuffer);
            return makeTextInput(fileBuffer, "pdf_text_extraction", pdfText.text);
        } catch (error) {
            console.warn("[document-text-extraction] PDF text extraction failed; falling back to Gemini multimodal.", error);
        }
    }

    if (directMimeType) {
        return {
            kind: "direct",
            mimeType: directMimeType,
            fileBuffer,
            extractionSource: "direct_multimodal",
            extractedText: "",
            aiText: "",
            wasTruncated: false,
        };
    }

    if (GOOGLE_NATIVE_FORMATS[extension]) {
        throwGoogleNativeFormat(extension);
    }

    if (extension === ".doc") {
        return makeTextInput(fileBuffer, "word_extractor_doc", await extractWithWordExtractor(fileBuffer));
    }

    const officeParserFileType = OFFICE_PARSER_FILE_TYPES[extension] || detectOfficeParserFileTypeFromBuffer(fileBuffer);
    if (officeParserFileType) {
        return makeTextInput(fileBuffer, `officeparser_${officeParserFileType}`, await extractWithOfficeParser(fileBuffer, officeParserFileType));
    }

    if (DIRECT_TEXT_EXTENSIONS.has(extension)) {
        if (!isProbablyDecodableText(fileBuffer)) {
            if (BOQ_TEXT_EXTENSIONS.has(extension)) {
                throw new Error(`BOQ_CONVERTER_REQUIRED: ${extension} appears to be a binary/proprietary quantity file`);
            }

            throw new Error(`DOCUMENT_TEXT_EXTRACTION_FAILED: ${extension} is not readable as text`);
        }

        return makeTextInput(fileBuffer, `plain_text_${extension.slice(1)}`, decodeTextBuffer(fileBuffer));
    }

    if (CONVERTER_REQUIRED_FORMATS[extension]) {
        if (isProbablyDecodableText(fileBuffer)) {
            return makeTextInput(fileBuffer, `plain_text_fallback_${extension.slice(1)}`, decodeTextBuffer(fileBuffer));
        }
        throwConverterRequired(extension);
    }

    if (isProbablyDecodableText(fileBuffer)) {
        return makeTextInput(fileBuffer, "plain_text_unknown_extension", decodeTextBuffer(fileBuffer));
    }

    throw new Error(`UNSUPPORTED_DOCUMENT_TYPE: ${extension || "unknown"}`);
}
