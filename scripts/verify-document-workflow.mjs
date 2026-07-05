import { readFileSync } from 'node:fs';

const checks = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

function expect(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const processRoute = read('src/app/api/documents/process/route.ts');
const validateRoute = read('src/app/api/documents/validate/route.ts');
const documentsClient = read('src/components/documents/DocumentsPageClient.tsx');
const truthModal = read('src/components/documents/ScreenOfTruthModal.tsx');
const radarState = read('src/components/features/contradiction-radar/hooks/useContradictionRadarState.ts');
const documentsPage = read('src/app/dashboard/[id]/documents/page.tsx');
const documentsRoute = read('src/app/api/documents/route.ts');
const documentFileRoute = read('src/app/api/documents/file/route.ts');
const signedUrlRoute = read('src/app/api/documents/signed-url/route.ts');
const geminiLib = read('src/lib/gemini.ts');
const textExtraction = read('src/utils/document-text-extraction.ts');
const extractTextRoute = read('src/app/api/documents/extract-text/route.ts');
const nextConfig = read('next.config.ts');
const authUtils = read('src/app/api/_utils/auth.ts');
const scanClearRoute = read('src/app/api/scan/clear/route.ts');
const contradictionsRoute = read('src/app/api/contradictions/route.ts');
const scanRoute = read('src/app/api/scan/route.ts');
const radarApi = read('src/components/features/contradiction-radar/api/contradictionRadarApi.ts');
const documentDeleteRoute = read('src/app/api/documents/delete/route.ts');
const contradictionArchiveUtil = read('src/utils/contradiction-archive.ts');

expect('AI processing uses configured key guard', processRoute.includes('requireGeminiApiKey()'));
expect('AI processing uses retry wrapper', processRoute.includes('withRetry(() => model.generateContent'));
expect('AI failure is stored as ERROR', processRoute.includes("ai_status: 'ERROR'"));
expect('AI failure returns success false', processRoute.includes('success: false'));
expect('AI failure is marked as system error', processRoute.includes('parsedData.system_error = aiErrorCode'));
expect('Unsupported document types are not sent as fake PDFs', processRoute.includes('getSupportedGeminiMimeType') && processRoute.includes('UNSUPPORTED_DOCUMENT_TYPE'));
expect('AI rate limit has a distinct error code', processRoute.includes('AI_RATE_LIMIT') && processRoute.includes('getAiErrorStatus(aiErrorCode)'));
expect('Readable text fallback is stored as SCANNED with degraded AI warning', processRoute.includes('TEXT_EXTRACTED_AI_PENDING') && processRoute.includes('canUseTextFallbackAfterAiError') && processRoute.includes('ai_degraded: true') && processRoute.includes("ai_status: 'SCANNED'"));
expect('Document process uses server-side text preparation', processRoute.includes('prepareDocumentAnalysisInput') && processRoute.includes('Extracted document text'));
expect('Document process reports Google native export needs', processRoute.includes('GOOGLE_NATIVE_EXPORT_REQUIRED'));
expect('Document process reports CAD/BIM/BOQ converter needs', processRoute.includes('CAD_CONVERTER_REQUIRED') && processRoute.includes('BIM_CONVERTER_REQUIRED') && processRoute.includes('BOQ_CONVERTER_REQUIRED'));
expect('Document process preserves TLV/SKN as BOQ fallback titles', processRoute.includes("lower.includes('tlv')") && processRoute.includes("lower.includes('skn')"));
expect('Document process fallback stores readable Hebrew', processRoute.includes("type: 'כתב כמויות'") && processRoute.includes("summary: 'מסמך שנקלט למערכת - סיווג לפי שם הקובץ'"));

expect('Validation blocks documents that are not ready', validateRoute.includes('Document is not ready for validation'));
expect('Validation blocks failed AI analysis', validateRoute.includes('Cannot validate a failed AI analysis'));
expect('Validation requires structured object data', validateRoute.includes('validatedData must be an object'));

expect('Document list no longer treats OCR alone as SCANNED', !documentsClient.includes('hasUsefulExtraction'));
expect('Document list has action-first filtering', documentsClient.includes('documentsNeedingAction') && documentsClient.includes('visibleDocuments'));
expect('Document list defaults to showing all saved documents', documentsClient.includes("useState<'ACTION' | 'ALL' | 'ERROR' | 'PENDING' | 'VALIDATED'>('ALL')"));
expect('Document list keeps SSR documents when refresh returns empty', documentsClient.includes('initialDocuments.length > 0') && documentsClient.includes('nextDocuments.length === 0 && prev.length > 0'));
expect('Document list explains empty filtered states', documentsClient.includes('visibleDocuments.length === 0') && documentsClient.includes("setActiveFilter('ALL')"));
expect('Document cards detect system errors', documentsClient.includes('hasSystemError(doc)'));
expect('Document cards show specific system error hints', documentsClient.includes('getSystemErrorHint') && documentsClient.includes('AI_RATE_LIMIT'));
expect('Document cards explain modern file format support', documentsClient.includes('GOOGLE_NATIVE_EXPORT_REQUIRED') && documentsClient.includes('BOQ_CONVERTER_REQUIRED') && documentsClient.includes('TLV/SKN'));
expect('Document titles strip engineering and BOQ extensions', documentsClient.includes('tlv|skn|boq|bq|qty') && documentsClient.includes('dwg|dwf|dwfx'));
expect('Document analysis is single-flight from the UI', documentsClient.includes('if (processingId) return') && documentsClient.includes('disabled={Boolean(processingId)}'));
expect('Document retry only pre-extracts PDF files', documentsClient.includes('const isPdfDocumentTitle') && documentsClient.includes('if (isPdfDocumentTitle(doc.title))'));
expect('Document upload and retry share the PDF title guard', documentsClient.includes('const isPDF = isPdfDocumentTitle(file.name)') && documentsClient.includes('if (isPdfDocumentTitle(doc.title))'));
expect('Document card opens in-app review modal instead of raw signed URL', documentsClient.includes('onClick={() => setSelectedDocForVerification(doc)}') && !documentsClient.includes('window.open(data.signedUrl'));
expect('Document cards hide mojibake document types', documentsClient.includes('looksCorruptText') && documentsClient.includes('inferDocumentType(doc)'));
expect('Validation refreshes documents from the server', documentsClient.includes('const refreshRes = await fetch') && documentsClient.includes('refreshData.documents.map(normalizeDocument)'));
expect('Document review modal receives projectId', documentsClient.includes('projectId={projectId}'));
expect('Documents page allows local demo projects without Supabase user', documentsPage.includes('isLocalProjectId') && documentsPage.includes('!userId && !isLocalProject'));
expect('Documents page relies on Supabase RLS for project access', documentsPage.includes(".from('projects')") && documentsPage.includes(".eq('id', projectId)") && !documentsPage.includes(".eq('contractor_id', user.id)"));
expect('Document API project access relies on Supabase RLS', authUtils.includes('.from("projects")') && authUtils.includes('.eq("id", projectId)') && !authUtils.includes('.eq("contractor_id", auth.user.id)'));
expect('Document API document access relies on Supabase RLS', authUtils.includes('.from("documents")') && authUtils.includes('.select(columns)') && !authUtils.includes('.eq("projects.contractor_id", auth.user.id)'));

expect('Preview signed URL is project-scoped', truthModal.includes('new URLSearchParams({ projectId, documentId: doc.id })'));
expect('Radar document opening is project-scoped', radarState.includes('new URLSearchParams({ projectId, documentId })') && radarState.includes('}, [projectId])'));
expect('Preview API returns inline metadata for UI routing', signedUrlRoute.includes('previewKind') && signedUrlRoute.includes('canPreviewInline') && signedUrlRoute.includes('inlineUrl'));
expect('Preview API inspects stored file bytes when metadata is not enough', signedUrlRoute.includes('downloadDocumentBuffer') && signedUrlRoute.includes('contentType === "application/octet-stream"') && signedUrlRoute.includes('getDocumentContentType(ownership.document, fileBuffer)'));
expect('Document file API serves files inline', documentFileRoute.includes('Content-Disposition') && documentFileRoute.includes('inline; filename=') && documentFileRoute.includes('downloadDocumentBuffer'));
expect('Modal renders PDF/image/text differently and does not iframe Office files', truthModal.includes("previewKind === 'pdf'") && truthModal.includes("previewKind === 'image'") && truthModal.includes("previewKind === 'text'") && truthModal.includes("previewKind === 'office'"));
expect('Modal falls back to saved extracted text when direct preview is unavailable', truthModal.includes('getReadableDocumentText') && truthModal.includes('readablePreviewText') && truthModal.includes('טקסט שמור מהמסמך'));
expect('Modal summary uses saved text when AI summary is only a placeholder', truthModal.includes('getUsefulSummary') && truthModal.includes('isPlaceholderSummary') && truthModal.includes('התחלה מתוך הטקסט שנקרא'));
expect('Modal hides mojibake structured fields', truthModal.includes('looksCorruptText') && truthModal.includes('safeStructuredText'));
expect('Modal blocks validation on system error', truthModal.includes('!hasSystemError && isStructured'));
expect('Modal hides financial fields unless financial data exists', truthModal.includes('shouldShowFinancial = hasFinancialItems || Boolean(totalAmount)'));
expect('Modal filters infrastructure AI errors out of document warnings', truthModal.includes('isDocumentWarning'));
expect('Modal explains modern file format support', truthModal.includes('GOOGLE_NATIVE_EXPORT_REQUIRED') && truthModal.includes('BOQ_CONVERTER_REQUIRED') && truthModal.includes('TLV/SKN'));
expect('Modal titles strip engineering and BOQ extensions', truthModal.includes('tlv|skn|boq|bq|qty') && truthModal.includes('dwg|dwf|dwfx'));
expect('Gemini retry includes short rate-limit bursts', geminiLib.includes('errorInfo.status === 429') && geminiLib.includes('RESOURCE_EXHAUSTED'));
expect('Text extraction supports modern Office and open formats', textExtraction.includes('".docx"') && textExtraction.includes('".xlsx"') && textExtraction.includes('".pptx"') && textExtraction.includes('".odt"') && textExtraction.includes('".ods"') && textExtraction.includes('".odp"'));
expect('Text extraction supports engineering text formats', textExtraction.includes('".dxf"') && textExtraction.includes('".ifc"') && textExtraction.includes('".reg"'));
expect('Text extraction supports BOQ TLV/SKN text formats', textExtraction.includes('".tlv"') && textExtraction.includes('".skn"') && textExtraction.includes('BOQ_TEXT_EXTENSIONS'));
expect('Text extraction blocks proprietary binary BOQ files clearly', textExtraction.includes('BOQ_CONVERTER_REQUIRED'));
expect('Text extraction explains Google native pointer files', textExtraction.includes('GOOGLE_NATIVE_FORMATS') && textExtraction.includes('GOOGLE_NATIVE_EXPORT_REQUIRED'));
expect('Text extraction keeps converter-needed engineering formats explicit', textExtraction.includes('".dwg"') && textExtraction.includes('".dwf"') && textExtraction.includes('".rvt"') && textExtraction.includes('".mpp"'));
expect('Text extraction ignores trailing numeric date suffixes', textExtraction.includes('suffixTokens.every') && textExtraction.includes('/^\\.\\d{1,4}$/'));
expect('Text extraction detects PDF/images from file bytes', textExtraction.includes('getSupportedGeminiMimeTypeFromBuffer') && textExtraction.includes('%PDF-') && textExtraction.includes('RIFF'));
expect('Preview content type detects Office ZIP contents', read('src/utils/document-storage.ts').includes('OFFICE_CONTENT_TYPES_BY_ZIP_MARKER') && read('src/utils/document-storage.ts').includes('word/document.xml') && read('src/utils/document-storage.ts').includes('xl/workbook.xml') && read('src/utils/document-storage.ts').includes('ppt/presentation.xml'));
expect('Text extraction avoids bundled PDF worker path resolution', textExtraction.includes('requireFromHere("pdf-parse")') && !textExtraction.includes('requireFromHere.resolve("pdf-parse")') && !textExtraction.includes('pdf.worker.mjs'));
expect('PDF files prefer server-side text extraction before multimodal AI', textExtraction.includes('pdf_text_extraction') && textExtraction.includes('falling back to Gemini multimodal'));
expect('Text extraction detects Office ZIP contents', textExtraction.includes('detectOfficeParserFileTypeFromBuffer') && textExtraction.includes('word/document.xml') && textExtraction.includes('xl/workbook.xml') && textExtraction.includes('ppt/presentation.xml'));
expect('PDF extract route uses the shared parser helper', extractTextRoute.includes('extractPdfText') && extractTextRoute.includes('pages: pdfData.pages'));
expect('PDF extract route does not write NON-PDF placeholders', !extractTextRoute.includes('[NON-PDF:'));
expect('PDF extract route skips non-PDF files without mutation', extractTextRoute.includes('skipped: true') && extractTextRoute.includes('skipping PDF extraction'));
expect('Next server keeps parser packages external', nextConfig.includes('serverExternalPackages') && nextConfig.includes('"pdf-parse"') && nextConfig.includes('"officeparser"'));
expect('Document upload avoids fake numeric storage extensions', documentsRoute.includes('CONTENT_TYPE_EXTENSIONS') && documentsRoute.includes('getFileExtension(fileName)') && documentsRoute.includes('file.type || ""'));
expect('Document upload removes storage object when insert fails', documentsRoute.includes('if (insertError) {') && documentsRoute.includes('.remove([storagePath])') && documentsRoute.includes('throw insertError'));
expect('Contradiction archive helper preserves previous evidence data', contradictionArchiveUtil.includes('mergeArchiveEvidenceData') && contradictionArchiveUtil.includes('archive_history') && contradictionArchiveUtil.includes('...existing'));
expect('Scan clear archives findings instead of deleting them', scanClearRoute.includes('archiveContradictionRows') && !scanClearRoute.includes(".from('contradictions')\n            .delete()"));
expect('Manual contradiction removal archives findings instead of deleting them', contradictionsRoute.includes('archiveContradictionRows') && !contradictionsRoute.includes(".from('contradictions')\n            .delete()"));
expect('Document delete archives linked findings without replacing evidence inline', documentDeleteRoute.includes('archiveContradictionRows') && documentDeleteRoute.includes("select('id, evidence_data')") && !documentDeleteRoute.includes(".from('contradictions')\n            .update({\n                status: 'ARCHIVED',\n                evidence_data: {"));
expect('Scan cache is invalidated when completed cache has no active findings', scanRoute.includes('cachedContradictions?.length') && scanRoute.includes('.delete()\n                        .eq("scan_signature", scanSignature)'));
expect('Rescan archives findings through shared evidence-preserving helper', scanRoute.includes('archiveContradictionRows') && scanRoute.includes('current_scan_signature: scanSignature'));
expect('Scan route exposes durable progress status', scanRoute.includes('export async function GET') && scanRoute.includes('loadProjectScanState') && scanRoute.includes('requireOwnedProject(supabase, projectId)'));
expect('Scan route persists in-progress checkpoints', scanRoute.includes('status: "IN_PROGRESS"') && scanRoute.includes('processed_work_docs') && scanRoute.includes('total_work_docs'));
expect('Scan route preserves zero-finding completed cache', scanRoute.includes('(scanState.findings_count || 0) === 0') && scanRoute.includes('הושלם ללא ממצאים'));
expect('Radar API can fetch persisted scan progress', radarApi.includes('fetchRadarScanStatus') && radarApi.includes('/api/scan?') && radarApi.includes('RadarScanProgress'));
expect('Radar UI polls persisted scan progress', radarState.includes('refreshScanProgress') && radarState.includes('visibilitychange') && radarState.includes('fetchRadarScanStatus'));
expect('Radar UI no longer relies on fake scan progress steps', !radarState.includes('SCAN_PROGRESS_STEPS') && radarState.includes('שומר התקדמות במערכת'));

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} document workflow checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} document workflow checks passed.`);
