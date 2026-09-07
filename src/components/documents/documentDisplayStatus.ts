import type { ProjectDocument } from './types';

export type DocumentDisplayStateKey =
    | 'VALIDATED'
    | 'VALIDATED_WITH_AI_WARNING'
    | 'AI_INCOMPLETE'
    | 'SCANNED'
    | 'PROCESSING'
    | 'TEXT_READ'
    | 'PENDING';

export interface DocumentDisplayState {
    key: DocumentDisplayStateKey;
    humanValidated: boolean;
    textRead: boolean;
    aiCompleted: boolean;
    needsAction: boolean;
}

const AI_FAILURE_PATTERN = /AI_|GEMINI|QUOTA|RATE.?LIMIT|RESOURCE_EXHAUSTED|TOO MANY REQUESTS|ניתוח.*לא|לא.*הושלם/i;

function warningSignalsAiFailure(warning: unknown) {
    if (typeof warning === 'string') return AI_FAILURE_PATTERN.test(warning);
    if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return false;

    const record = warning as Record<string, unknown>;
    return [record.code, record.message, record.technical_message]
        .some((value) => typeof value === 'string' && AI_FAILURE_PATTERN.test(value));
}

export function hasIncompleteAiAnalysis(doc: ProjectDocument) {
    const parsed = doc.parsed_json;
    if (doc.ai_status === 'ERROR') return true;
    if (!parsed) return false;

    const analysisSource = String(parsed.analysis_source || '').toLowerCase();
    const analysisStatus = String(parsed.analysis_status || '').toUpperCase();
    const summary = String(parsed.summary || '');
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];

    return Boolean(
        parsed.system_error
        || (Array.isArray(parsed.system_errors) && parsed.system_errors.length > 0)
        || parsed.ai_degraded === true
        || analysisStatus === 'AI_ERROR'
        || analysisStatus.includes('AI_PENDING')
        || analysisSource.includes('fallback')
        || summary.includes('סיווג לפי שם הקובץ')
        || warnings.some(warningSignalsAiFailure)
    );
}

export function getDocumentDisplayState(doc: ProjectDocument): DocumentDisplayState {
    const humanValidated = doc.ai_status === 'VALIDATED';
    const textRead = Boolean(doc.extracted_text_hash || doc.extracted_text || doc.ocr_status === 'COMPLETED');
    const aiIncomplete = hasIncompleteAiAnalysis(doc);

    if (aiIncomplete) {
        return {
            key: humanValidated ? 'VALIDATED_WITH_AI_WARNING' : 'AI_INCOMPLETE',
            humanValidated,
            textRead,
            aiCompleted: false,
            needsAction: true,
        };
    }

    if (humanValidated) {
        return { key: 'VALIDATED', humanValidated, textRead, aiCompleted: true, needsAction: false };
    }

    if (doc.ai_status === 'SCANNED') {
        return { key: 'SCANNED', humanValidated, textRead, aiCompleted: true, needsAction: true };
    }

    if (doc.ai_status === 'PROCESSING' || doc.ai_status === 'EXTRACTING') {
        return { key: 'PROCESSING', humanValidated, textRead, aiCompleted: false, needsAction: false };
    }

    if (textRead) {
        return { key: 'TEXT_READ', humanValidated, textRead, aiCompleted: false, needsAction: true };
    }

    return { key: 'PENDING', humanValidated, textRead, aiCompleted: false, needsAction: true };
}
