import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { parseLocalOcrMcpPage } from '@/utils/local-ocr-mcp-result';
import { ensureLocalOcrLanguageData } from '@/utils/local-document-ocr';

export const LOCAL_OCR_MCP_VERSION = '4.10.4';
export function localOcrMcpExecutable() {
    return process.env.LOCAL_OCR_MCP_PATH || path.join(process.cwd(), 'data', 'tools', 'kreuzberg', LOCAL_OCR_MCP_VERSION, 'bin', 'kreuzberg.exe');
}
export async function localOcrMcpAvailable() {
    try { await access(localOcrMcpExecutable()); return true; } catch { return false; }
}

export async function extractPdfPagesWithLocalMcp(buffer: Buffer, pages: number[]) {
    if (!pages.length || !await localOcrMcpAvailable()) return [];
    const source = await PDFDocument.load(buffer);
    const requestedPages = [...new Set(pages)];
    if (requestedPages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > source.getPageCount())) {
        throw new Error('LOCAL_OCR_MCP_INVALID_PAGE');
    }
    const languageDataPath = await ensureLocalOcrLanguageData();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'contractorsystem-mcp-ocr-'));
    const child = spawn(localOcrMcpExecutable(), ['mcp'], { cwd: directory, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
            TESSDATA_PREFIX: languageDataPath } });
    type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
    const pending = new Map<number, Pending>();
    let id = 0;
    let lastError = '';
    let closed = false;
    const childClosed = new Promise<void>((resolve) => child.on('close', () => { closed = true; resolve(); }));
    const failPending = (error: Error) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
    child.on('error', failPending);
    child.on('exit', () => failPending(new Error(`LOCAL_OCR_MCP_EXIT: ${lastError.slice(-500)}`)));
    child.stdin.on('error', failPending);
    child.stderr.on('data', (value) => { lastError = (lastError + String(value)).slice(-1000); });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(`LOCAL_OCR_MCP_PROTOCOL: ${JSON.stringify(message.error)}`));
        else request.resolve(message.result);
    });
    const call = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
        if (closed || child.exitCode !== null || child.killed) { reject(new Error('LOCAL_OCR_MCP_CLOSED')); return; }
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`LOCAL_OCR_MCP_TIMEOUT: ${method}`)); }, 120_000);
        pending.set(requestId, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    });
    try {
        await call('initialize', { protocolVersion: '2024-11-05', capabilities: {},
            clientInfo: { name: 'ContractorSystem document reader', version: '1' } });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const inventory = await call('tools/list', {}) as { tools?: Array<{ name: string; inputSchema?: { required?: string[] } }> };
        if (!inventory.tools?.some((tool) => tool.name === 'extract_file' && tool.inputSchema?.required?.includes('path'))) {
            throw new Error('LOCAL_OCR_MCP_INCOMPATIBLE_TOOLS');
        }
        const results = [];
        for (const page of requestedPages) {
            try {
                // Send one physical page, so a global text blob or false blank-page
                // metadata cannot mask a missing page in a multi-page file.
                const singlePage = await PDFDocument.create();
                const [copiedPage] = await singlePage.copyPages(source, [page - 1]);
                singlePage.addPage(copiedPage);
                const pagePath = path.join(directory, `page-${page}.pdf`);
                await writeFile(pagePath, await singlePage.save());
                const result = await call('tools/call', { name: 'extract_file', arguments: {
                    path: pagePath, config: { force_ocr: true, use_cache: false,
                        ocr: { backend: 'tesseract', language: 'heb+eng' }, pages: { extract_pages: true } },
                } });
                const recognized = parseLocalOcrMcpPage(result as Parameters<typeof parseLocalOcrMcpPage>[0], page, source.getPage(page - 1).getSize());
                results.push(recognized);
                console.info(`[ocr:mcp] Page ${page}: ${recognized.text.length} characters, confidence ${recognized.confidence.toFixed(1)}%${recognized.requiresVisualReview ? ', large sheet remains unverified' : ''}`);
            } catch (error) {
                console.warn(`[ocr:mcp] Page ${page} remains unverified:`, error instanceof Error ? error.message : error);
            }
        }
        return results;
    } finally {
        failPending(new Error('LOCAL_OCR_MCP_CLOSED')); lines.close(); child.stdin.end(); child.kill();
        await childClosed;
        if (!directory.startsWith(path.join(os.tmpdir(), 'contractorsystem-mcp-ocr-'))) throw new Error('Unsafe OCR temporary directory');
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}
