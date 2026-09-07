import { createHash } from 'crypto';

export type ScanMemoryDocument = {
    id: string;
    title?: string | null;
    category?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
    file_url?: string | null;
    content_hash?: string | null;
    extracted_text?: string | null;
    extracted_text_hash?: string | null;
};

export function hashScanValue(value: string) {
    return createHash('sha256').update(value).digest('hex');
}

export function buildDocumentFingerprint(document: ScanMemoryDocument) {
    const extractedText = String(document.extracted_text || '');
    const extractedTextHash = document.extracted_text_hash || hashScanValue(extractedText);
    const parts = [
        document.id,
        document.content_hash || 'no-file-hash',
        extractedTextHash,
        String(Buffer.byteLength(extractedText, 'utf8')),
        document.storage_bucket || '',
        document.storage_path || document.file_url || '',
        document.title || '',
        document.category || '',
    ];
    return hashScanValue(parts.join('\u001f'));
}

export function buildDocumentSetFingerprint(documents: ScanMemoryDocument[]) {
    return hashScanValue(documents.map(buildDocumentFingerprint).sort().join('|'));
}

export function buildScanMemorySignature(input: {
    engineVersion: string;
    projectId: string;
    contractFingerprint: string;
    workFingerprint: string;
    relatedWorkFingerprint: string;
    aiIdentity: string;
}) {
    return hashScanValue([
        input.engineVersion,
        input.projectId,
        input.contractFingerprint,
        input.workFingerprint,
        input.relatedWorkFingerprint,
        input.aiIdentity,
    ].join(':'));
}
