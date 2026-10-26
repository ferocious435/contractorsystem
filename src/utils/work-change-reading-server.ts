import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadDocumentBuffer } from '@/utils/document-storage';
import { prepareDocumentAnalysisInput } from '@/utils/document-text-extraction';
import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import type { WorkChangeDocument } from './work-change-sources.ts';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const hash = (input: Buffer | string) => createHash('sha256').update(input).digest('hex');

function needsReading(document: WorkChangeDocument) {
    const metadata = object(document.parsed_json), proof = object(metadata.source_reading);
    const recordedHash = typeof metadata.source_reading_content_hash === 'string' ? metadata.source_reading_content_hash : proof.sourceHash;
    const sameBytes = typeof recordedHash === 'string' && recordedHash === document.content_hash;
    const sameText = !document.extracted_text_hash || document.extracted_text_hash === hash(document.extracted_text || '');
    if (sameBytes && sameText && ['docx-image-coverage-v1', 'page-coverage-v1'].includes(String(proof.version))) return false;
    if (recordedHash && recordedHash !== document.content_hash) return true;
    return !assessDocumentSourceReadiness(document).extractionComplete;
}

/** Scoped extraction deliberately has no project-budget/ledger synchronisation. */
export async function refreshWorkChangeReading(supabase: SupabaseClient, projectId: string, sources: WorkChangeDocument[]) {
    const updatedIds: string[] = [], failedIds: string[] = [];
    for (const source of sources) {
        if (source.project_id !== projectId || source.deleted_at || !needsReading(source)) continue;
        try {
            const before = { id: source.id, project_id: source.project_id, title: source.title,
                extracted_text: source.extracted_text, parsed_json: source.parsed_json, ocr_status: source.ocr_status,
                content_hash: source.content_hash, extracted_text_hash: source.extracted_text_hash, processed_at: source.processed_at };
            const history = path.join(process.cwd(), 'data', 'work-change-cache', 'reading-history');
            await mkdir(history, { recursive: true });
            const backup = path.join(history, `${hash(JSON.stringify(before))}.json`);
            try { await writeFile(backup, JSON.stringify({ recordedAt: new Date().toISOString(), before }), { flag: 'wx', mode: 0o600 }); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            const buffer = await downloadDocumentBuffer(supabase, source);
            const prepared = await prepareDocumentAnalysisInput(buffer, source.title || 'document');
            if (prepared.kind !== 'text' || !prepared.readingVerification) { failedIds.push(source.id); continue; }
            const current = await supabase.from('documents').select('content_hash,parsed_json,processed_at,deleted_at')
                .eq('project_id', projectId).eq('id', source.id).maybeSingle();
            if (current.error || !current.data || current.data.deleted_at
                || current.data.content_hash !== (source.content_hash || null)) { failedIds.push(source.id); continue; }
            const contentHash = hash(buffer);
            const parsedJson = { ...object(current.data.parsed_json), source_reading: prepared.readingVerification,
                source_reading_content_hash: contentHash };
            const reading = assessDocumentSourceReadiness({ ...source, extracted_text: prepared.extractedText,
                content_hash: contentHash, parsed_json: parsedJson });
            const patch = { extracted_text: prepared.extractedText, content_hash: contentHash,
                extracted_text_hash: hash(prepared.extractedText), parsed_json: parsedJson,
                ocr_status: prepared.requiresReview || !reading.extractionComplete ? 'REQUIRES_REVIEW' : 'COMPLETED',
                processed_at: new Date().toISOString() };
            let update = supabase.from('documents').update(patch).eq('project_id', projectId).eq('id', source.id);
            update = source.content_hash ? update.eq('content_hash', source.content_hash) : update.is('content_hash', null);
            update = current.data.processed_at ? update.eq('processed_at', current.data.processed_at) : update.is('processed_at', null);
            const result = await update.select('id').maybeSingle();
            if (result.error || !result.data) failedIds.push(source.id); else updatedIds.push(source.id);
        } catch { failedIds.push(source.id); }
    }
    return { updatedIds, failedIds };
}
