import { hasDocumentBodyText } from '@/utils/document-source-readiness';

type McpResult = { isError?: boolean; content?: Array<{ type?: string; text?: string }> };

export function parseLocalOcrMcpPage(result: McpResult, originalPage: number, pageSize?: { width: number; height: number }) {
    if (result.isError) throw new Error('LOCAL_OCR_MCP_EXTRACTION_FAILED');
    const textBlock = result.content?.find((item) => item.type === 'text' && item.text);
    if (!textBlock?.text) throw new Error('LOCAL_OCR_MCP_EMPTY_RESULT');
    const payload = JSON.parse(textBlock.text);
    if (payload.metadata?.pages?.total_count !== 1) throw new Error('LOCAL_OCR_MCP_PAGE_COUNT_MISMATCH');
    const text = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!hasDocumentBodyText(text)) throw new Error('LOCAL_OCR_MCP_NO_BODY');
    const words = (Array.isArray(payload.ocr_elements) ? payload.ocr_elements : [])
        .filter((word: { level?: string; page_number?: number; text?: string }) => word.level === 'word'
            && word.page_number === 1 && typeof word.text === 'string' && word.text.trim());
    if (!words.length) throw new Error('LOCAL_OCR_MCP_PAGE_EVIDENCE_MISSING');
    const scores = words.map((word: { confidence?: { recognition?: number } }) => word.confidence?.recognition);
    const validScores = scores.every((score: unknown) => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1);
    // The native PDF page may be marked blank even though OCR read its image.
    // Require actual OCR words for that physical page; never trust quality_score.
    const confidence = validScores ? scores.reduce((sum: number, score: number) => sum + score, 0) / words.length * 100 : 0;
    // A whole-sheet pass is not qualified to certify large engineering sheets:
    // it can confidently read the title block and miss the drawing annotations.
    // Keep the text, but require a separate reading method for formats above A3.
    const requiresVisualReview = Boolean(pageSize && Math.max(pageSize.width, pageSize.height) > 1191);
    return { page: originalPage, text, confidence, ...(requiresVisualReview ? { requiresVisualReview: true } : {}) };
}
