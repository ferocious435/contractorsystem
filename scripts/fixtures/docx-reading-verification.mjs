// Synthetic fixture: the native text was checked and the package has no image references.
export const completeDocx = { parsed_json: { source_reading: {
  version: 'docx-image-coverage-v1', complete: true, sourceHash: 'a'.repeat(64),
  expectedImageReferences: 0, images: [], issues: [],
} } };

// Replay saved extracted TEXT, not the original DOCX package. Never fabricate
// image coverage for real sources. Production readiness still rejects the original.
export function replayExtractedDocxText(document) {
  if (![document.title, document.storage_path, document.file_url].some(value => /\.docx(?:$|[?#\s._()\d-])/iu.test(value || ''))) return document;
  return { ...document, original_docx_title: document.title,
    title: String(document.title || 'saved-source').replace(/\.docx/giu, '') + '.txt',
    storage_path: null, file_url: null, text_replay_only: true };
}
