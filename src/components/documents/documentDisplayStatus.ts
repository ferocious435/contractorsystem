import type { ProjectDocument } from './types';
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';
import type {JobDto} from '@/server/ai/contracts';
import {VISUAL_READING_VERSION} from '@/utils/visual-source-reading';

export function documentJobStatusText(job:JobDto):string {
    const reading=job.progress?.phase==='reading'||job.operation==='read_source';
    if(job.state==='QUEUED')return reading?'ממתין לקריאת המקור…':'ממתין לקריאה וניתוח…';
    if(reading)return job.progress?.totalUnits?`קורא את המקור: ${job.progress.completedUnits} / ${job.progress.totalUnits} חלקים אומתו`:'מכין את המקור לקריאה…';
    return 'מנתח את תוכן המקור שנשמר…';
}

export type DocumentDisplayStateKey =
    | 'VALIDATED'
    | 'VALIDATED_WITH_AI_WARNING'
    | 'AI_INCOMPLETE'
    | 'SOURCE_INCOMPLETE'
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
const AI_TECHNICAL_FAILURE_PATTERN = /AI_|GEMINI|QUOTA|RATE.?LIMIT|RESOURCE_EXHAUSTED|TOO MANY REQUESTS/i;

function warningSignalsAiFailure(warning: unknown, narrative = true) {
    const pattern=narrative?AI_FAILURE_PATTERN:AI_TECHNICAL_FAILURE_PATTERN;
    if (typeof warning === 'string') return pattern.test(warning);
    if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return false;

    const record = warning as Record<string, unknown>;
    return [record.code, record.message, record.technical_message]
        .some((value) => typeof value === 'string' && pattern.test(value));
}

export function hasIncompleteAiAnalysis(doc: ProjectDocument) {
    const parsed = doc.parsed_json;
    if (doc.ai_status === 'ERROR') return true;
    if (!parsed) return false;

    const analysisSource = String(parsed.analysis_source || '').toLowerCase();
    const analysisStatus = String(parsed.analysis_status || '').toUpperCase();
    const summary = String(parsed.summary || '');
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    const reading=parsed.source_reading&&typeof parsed.source_reading==='object'&&!Array.isArray(parsed.source_reading)
        ?parsed.source_reading as Record<string,unknown>:null;
    const structuredImageComplete=Boolean(analysisSource==='codex'&&analysisStatus==='COMPLETE'&&parsed.autoValidated===false
        &&reading?.version===VISUAL_READING_VERSION&&['IMAGE','XLSX'].includes(String(reading.format))&&assessDocumentSourceReadiness(doc).extractionComplete);

    return Boolean(
        parsed.system_error
        || parsed.analysis_stale === true
        || (Array.isArray(parsed.system_errors) && parsed.system_errors.length > 0)
        || parsed.ai_degraded === true
        || analysisStatus === 'AI_ERROR'
        || analysisStatus === 'PARTIAL'
        || analysisStatus.includes('AI_PENDING')
        || analysisSource.includes('fallback')
        || summary.includes('סיווג לפי שם הקובץ')
        || warnings.some(warning=>warningSignalsAiFailure(warning,!structuredImageComplete))
    );
}

export function getDocumentDisplayState(doc: ProjectDocument): DocumentDisplayState {
    const humanValidated = doc.ai_status === 'VALIDATED';
    const textRead = assessDocumentSourceReadiness(doc).extractionComplete;
    const aiIncomplete = hasIncompleteAiAnalysis(doc);

    const hasReadingAttempt = Boolean(doc.extracted_text_hash || doc.extracted_text
        || doc.ocr_status === 'COMPLETED' || doc.ocr_status === 'REQUIRES_REVIEW');
    if (hasReadingAttempt && !textRead && !['PROCESSING', 'EXTRACTING'].includes(String(doc.ai_status || ''))) {
        return { key: 'SOURCE_INCOMPLETE', humanValidated, textRead: false, aiCompleted: false, needsAction: true };
    }

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
