import { execFile } from "node:child_process";
import {
    copyFile,
    access,
    readFile,
    mkdir,
    mkdtemp,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { hasRenderedEmptyPageProof, isPageNumberOnly, type RecognizedPdfPage, type RenderedEmptyPageProof } from '@/utils/document-source-readiness';

import { createWorker } from "tesseract.js";

const execFileAsync = promisify(execFile);
const LOCAL_OCR_LANGUAGES = "heb+eng";
const LOCAL_OCR_MIN_TEXT_LENGTH = 250;
const LOCAL_OCR_MAX_BATCH_PAGES = 40;
const LOCAL_OCR_RENDER_DPI = 150;
const LOCAL_OCR_DATA_VERSION = "best-int-v1";

type LocalOcrOptions = {
    pageCount?: number;
    tempRoot?: string;
    batchSize?: number;
    rendererPath?: string;
    pdfInfoPath?: string;
    pageNumbers?: number[];
};

export type LocalOcrResult = {
    text: string;
    pages: number;
    confidence: number;
    pageResults: RecognizedPdfPage[];
};

type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

/** Certify rendered whitespace, never infer an empty page from missing OCR text. */
export async function getRenderedEmptyPageProof(image: Buffer, page: number, ocr: { text: string; words: OcrWord[] }): Promise<RenderedEmptyPageProof | undefined> {
    if (!Number.isInteger(page) || page < 1) return undefined;
    try {
        const { data, info } = await sharp(image, { limitInputPixels: 16_000_000 }).flatten({ background: '#ffffff' })
            .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
        if (info.channels !== 3) return undefined;
        const base = { version: 'rendered-empty-v1' as const, page, imageSha256: createHash('sha256').update(image).digest('hex'), width: info.width, height: info.height };
        if (data.every(value => value === 255)) return { ...base, kind: 'BLANK' };
        if (!isPageNumberOnly(ocr.text) || !ocr.words.length || ocr.words.some(word => !Number.isFinite(word.confidence) || word.confidence < 65 || word.confidence > 100)
            || ocr.words.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim() !== ocr.text.replace(/\s+/g, ' ').trim()) return undefined;
        const numberBounds = ocr.words.map(word => ({
            x0: Math.max(0, Math.floor(word.bbox.x0) - 2), y0: Math.max(0, Math.floor(word.bbox.y0) - 2),
            x1: Math.min(info.width, Math.ceil(word.bbox.x1) + 2), y1: Math.min(info.height, Math.ceil(word.bbox.y1) + 2),
        }));
        const proof: RenderedEmptyPageProof = { ...base, kind: 'PAGE_NUMBER_ONLY', numberText: ocr.text.trim(), numberConfidence: Math.min(...ocr.words.map(word => word.confidence)), numberBounds };
        if (!hasRenderedEmptyPageProof({page, text: ocr.text, confidence: 0, emptyPageProof: proof})) return undefined;
        for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
            const offset = pixel * 3;
            if (data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255) continue;
            const x = pixel % info.width, y = Math.floor(pixel / info.width);
            if (!numberBounds.some(box => x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1)) return undefined;
        }
        return proof;
    } catch { return undefined; }
}

function normalizeComparableText(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

export function shouldAttemptLocalOcr(value: string, minimumLength = LOCAL_OCR_MIN_TEXT_LENGTH) {
    return normalizeComparableText(value).length < minimumLength;
}

export function mergeExtractedAndOcrText(extractedText: string, ocrText: string) {
    const extracted = extractedText.trim();
    const ocr = ocrText.trim();
    if (!extracted) return ocr;
    if (!ocr) return extracted;

    const comparableExtracted = normalizeComparableText(extracted);
    const comparableOcr = normalizeComparableText(ocr);
    if (comparableOcr.includes(comparableExtracted)) return ocr;
    if (comparableExtracted.includes(comparableOcr)) return extracted;

    return `${extracted}\n\n${ocr}`;
}

function getLanguagePackageDirectory(packageName: string) {
    // These are installed runtime data files, not JavaScript modules. Access
    // them directly so Next does not rewrite createRequire/resolve into a
    // generated module context. The service starts in the application root.
    return path.join(process.cwd(), 'node_modules', packageName);
}

export async function ensureLocalOcrLanguageData() {
    const targetDirectory = path.join(os.tmpdir(), `contractorsystem-ocr-${LOCAL_OCR_DATA_VERSION}`);
    await mkdir(targetDirectory, { recursive: true });

    const packages = [
        { name: "@tesseract.js-data/heb", code: "heb" },
        { name: "@tesseract.js-data/eng", code: "eng" },
    ];

    await Promise.all(packages.map(async ({ name, code }) => {
        const source = path.join(getLanguagePackageDirectory(name), "4.0.0_best_int", `${code}.traineddata.gz`);
        const target = path.join(targetDirectory, `${code}.traineddata.gz`);
        await copyFile(source, target);
        const nativeTarget = path.join(targetDirectory, `${code}.traineddata`);
        try { await access(nativeTarget); } catch {
            await writeFile(nativeTarget, await promisify(gunzip)(await readFile(source)));
        }
    }));

    return targetDirectory;
}

/** Read an embedded image with the same offline engine and language files as PDF OCR. */
export async function extractImageTextLocally(imageBuffer: Buffer): Promise<{ text: string; confidence: number; words: OcrWord[] }> {
    const languageDataPath = await ensureLocalOcrLanguageData();
    const worker = await createWorker(LOCAL_OCR_LANGUAGES, 1, {
        langPath: languageDataPath, cachePath: languageDataPath, logger: () => undefined,
    });
    try {
        const result = await worker.recognize(imageBuffer, {}, { blocks: true });
        const words = result.data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words))) || [];
        return { text: String(result.data.text || '').trim(), confidence: result.data.confidence, words };
    } finally {
        await worker.terminate();
    }
}

function getPageNumber(fileName: string) {
    return Number(fileName.match(/-(\d+)\.png$/i)?.[1] || Number.MAX_SAFE_INTEGER);
}

function getErrorCode(error: unknown) {
    return error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
}

export async function extractScannedPdfTextLocally(
    fileBuffer: Buffer,
    options: LocalOcrOptions = {},
): Promise<LocalOcrResult> {
    const baseTempRoot = options.tempRoot || os.tmpdir();
    await mkdir(baseTempRoot, { recursive: true });
    const workDirectory = await mkdtemp(path.join(baseTempRoot, "contractorsystem-ocr-job-"));
    const pdfPath = path.join(workDirectory, "document.pdf");
    const outputPrefix = path.join(workDirectory, "page");
    const rendererPath = options.rendererPath || process.env.PDFTOPPM_PATH || "pdftoppm";
    const batchSize = Math.max(1, Math.min(options.batchSize || 8, LOCAL_OCR_MAX_BATCH_PAGES));

    try {
        await writeFile(pdfPath, fileBuffer);
        let pageCount = options.pageCount;
        if (!pageCount) {
            const pdfInfoPath = options.pdfInfoPath
                || process.env.PDFINFO_PATH
                || (rendererPath === "pdftoppm"
                    ? "pdfinfo"
                    : path.join(path.dirname(rendererPath), process.platform === "win32" ? "pdfinfo.exe" : "pdfinfo"));
            try {
                const { stdout } = await execFileAsync(pdfInfoPath, [pdfPath], {
                    timeout: 30_000,
                    windowsHide: true,
                    maxBuffer: 1024 * 1024,
                });
                pageCount = Number(stdout.match(/^Pages:\s+(\d+)/mi)?.[1] || 0);
            } catch (error) {
                if (getErrorCode(error) === "ENOENT") {
                    throw new Error("LOCAL_OCR_RENDERER_UNAVAILABLE: pdfinfo was not found");
                }
                throw new Error(`LOCAL_OCR_PAGE_COUNT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (!pageCount || pageCount < 1) {
            throw new Error("LOCAL_OCR_PAGE_COUNT_FAILED: PDF page count is unavailable");
        }

        const requestedPages = options.pageNumbers
            ? [...new Set(options.pageNumbers)].sort((left, right) => left - right)
            : Array.from({ length: pageCount }, (_, index) => index + 1);
        if (!requestedPages.length || requestedPages.some((number) => !Number.isInteger(number) || number < 1 || number > pageCount!)) {
            throw new Error('LOCAL_OCR_INVALID_PAGE_RANGE');
        }

        const languageDataPath = await ensureLocalOcrLanguageData();
        const worker = await createWorker(LOCAL_OCR_LANGUAGES, 1, {
            langPath: languageDataPath,
            cachePath: languageDataPath,
            logger: () => undefined,
        });

        try {
            const recognizedPages: string[] = [];
            const pageConfidences: number[] = [];
            const pageResults: LocalOcrResult['pageResults'] = [];
            for (let index = 0; index < requestedPages.length;) {
                const firstPage = requestedPages[index];
                let endIndex = index;
                while (endIndex + 1 < requestedPages.length && endIndex - index + 1 < batchSize
                    && requestedPages[endIndex + 1] === requestedPages[endIndex] + 1) endIndex += 1;
                const lastPage = requestedPages[endIndex];
                index = endIndex + 1;
                const batchPrefix = `${outputPrefix}-${firstPage}`;
                try {
                    await execFileAsync(rendererPath, [
                        "-png",
                        "-r",
                        String(LOCAL_OCR_RENDER_DPI),
                        "-f",
                        String(firstPage),
                        "-l",
                        String(lastPage),
                        pdfPath,
                        batchPrefix,
                    ], {
                        timeout: 120_000,
                        windowsHide: true,
                        maxBuffer: 4 * 1024 * 1024,
                    });
                } catch (error) {
                    if (getErrorCode(error) === "ENOENT") {
                        throw new Error("LOCAL_OCR_RENDERER_UNAVAILABLE: pdftoppm was not found");
                    }
                    throw new Error(`LOCAL_OCR_RENDER_FAILED: pages ${firstPage}-${lastPage}: ${error instanceof Error ? error.message : String(error)}`);
                }

                const batchPattern = new RegExp(`^page-${firstPage}-\\d+\\.png$`, "i");
                const pageFiles = (await readdir(workDirectory))
                    .filter((fileName) => batchPattern.test(fileName))
                    .sort((left, right) => getPageNumber(left) - getPageNumber(right));

                if (pageFiles.length !== lastPage - firstPage + 1) {
                    throw new Error(`LOCAL_OCR_RENDER_EMPTY: expected pages ${firstPage}-${lastPage}, received ${pageFiles.length}`);
                }

                for (const pageFile of pageFiles) {
                    const pagePath = path.join(workDirectory, pageFile);
                    let result: Awaited<ReturnType<typeof worker.recognize>> | null = null;
                    let lastError: unknown = null;
                    for (let attempt = 1; attempt <= 2; attempt += 1) {
                        try {
                            result = await worker.recognize(pagePath, {}, { blocks: true });
                            break;
                        } catch (error) {
                            lastError = error;
                        }
                    }
                    if (!result) {
                        throw new Error(`LOCAL_OCR_RECOGNITION_FAILED: ${pageFile}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
                    }

                    const number = getPageNumber(pageFile);
                    const words = result.data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words))) || [];
                    const emptyPageProof = await getRenderedEmptyPageProof(await readFile(pagePath), number, { text: result.data.text || '', words });
                    const pageText = emptyPageProof?.kind === 'BLANK' ? '' : String(result.data.text || "").trim();
                    pageResults.push({ page: number, text: pageText, confidence: result.data.confidence, ...(emptyPageProof ? { emptyPageProof } : {}) });
                    if (pageText) {
                        recognizedPages.push(pageText);
                        if (!emptyPageProof && Number.isFinite(result.data.confidence)) {
                            pageConfidences.push(result.data.confidence);
                        }
                    }
                    await rm(pagePath, { force: true });
                }
            }

            const text = recognizedPages.join("\n\n").trim();
            if (!text && !pageResults.some(hasRenderedEmptyPageProof)) {
                throw new Error("LOCAL_OCR_EMPTY: no readable text was recognized");
            }

            const confidence = pageConfidences.length > 0
                ? pageConfidences.reduce((sum, value) => sum + value, 0) / pageConfidences.length
                : 0;

            return { text, pages: pageCount, confidence, pageResults };
        } finally {
            await worker.terminate();
        }
    } finally {
        if (!workDirectory.startsWith(path.join(baseTempRoot, 'contractorsystem-ocr-job-'))) throw new Error('Unsafe OCR temporary directory');
        await rm(workDirectory, { recursive: true, force: true });
    }
}
