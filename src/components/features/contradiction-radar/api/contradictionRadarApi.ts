import { createClient } from '@/utils/supabase/client';
import { isDemoProjectId, isLocalProjectId } from '@/utils/local-projects';
import type { ContradictionItem } from '@/types';

export interface RadarProjectDocument {
    id: string;
    title: string;
    category: string | null;
    ai_status: string | null;
}

interface ContradictionMutationResult {
    success: boolean;
    error?: string;
    deletedId?: string;
    item?: {
        id: string;
        status: string;
    };
}

export interface RadarScanProgress {
    success: boolean;
    active: boolean;
    status: string;
    progress: number;
    processed: number;
    total: number;
    currentStep?: string | null;
    errorMessage?: string | null;
    updatedAt?: string | null;
    completedAt?: string | null;
    found?: number;
}

export interface RadarScanResult {
    success: boolean;
    partial?: boolean;
    found?: number;
    message?: string;
    warnings?: string[];
    scanStatus?: RadarScanProgress;
    memory?: {
        scanned: number;
        unchanged: number;
        total: number;
    };
}

async function parseContradictionMutationResponse(response: Response): Promise<ContradictionMutationResult> {
    const payload = await response.json();

    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Contradiction mutation failed');
    }

    return payload as ContradictionMutationResult;
}

async function parseRadarScanResponse(response: Response): Promise<RadarScanResult> {
    const payload = await response.json();

    if (!response.ok) {
        return {
            success: false,
            message: payload?.error || payload?.message || 'Radar scan failed',
        };
    }

    return payload as RadarScanResult;
}

async function parseRadarScanStatusResponse(response: Response): Promise<RadarScanProgress> {
    const payload = await response.json();

    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load scan status');
    }

    return payload as RadarScanProgress;
}

export async function fetchRadarProjectName(projectId: string): Promise<string | null> {
    if (isLocalProjectId(projectId)) return isDemoProjectId(projectId) ? 'Demo project' : 'Local project';

    const supabase = createClient();
    const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();

    if (error) {
        throw error;
    }

    return data?.name || null;
}

export async function fetchRadarDocuments(projectId: string): Promise<RadarProjectDocument[]> {
    if (isLocalProjectId(projectId)) {
        return isDemoProjectId(projectId) ? [
            { id: 'demo-contract-doc', title: 'Demo contract BOQ.pdf', category: 'CONTRACT', ai_status: 'SCANNED' },
            { id: 'demo-execution-doc', title: 'Demo execution note.pdf', category: 'EXECUTION', ai_status: 'SCANNED' },
        ] : [];
    }

    const supabase = createClient();
    const { data, error } = await supabase
        .from('documents')
        .select('id, title, category, ai_status')
        .eq('project_id', projectId);

    if (error) {
        throw error;
    }

    return (data || []) as RadarProjectDocument[];
}

export async function fetchRadarContradictions(projectId: string): Promise<ContradictionItem[]> {
    if (isLocalProjectId(projectId)) {
        if (!isDemoProjectId(projectId)) return [];
        return [
            {
                id: 'demo-contradiction-1',
                project_id: projectId,
                status: 'OPEN',
                pricing_status: 'PENDING',
                title: 'Demo missing BOQ item',
                description: 'Execution document shows extra preparation work that does not appear in the contract BOQ.',
                category: 'CONTRADICTION',
                severity: 'HIGH',
                created_at: new Date().toISOString(),
                source_doc: { title: 'Demo execution note.pdf' },
                target_doc: { title: 'Demo contract BOQ.pdf' },
                confidence_score: 0.86,
            } as ContradictionItem,
        ];
    }

    const supabase = createClient();
    const { data, error } = await supabase
        .from('contradictions')
        .select(`
            *,
            source_doc: documents!contradictions_source_execution_doc_id_fkey(id, title, file_url, storage_bucket, storage_path),
            target_doc: documents!contradictions_target_contract_doc_id_fkey(id, title, file_url, storage_bucket, storage_path)
        `)
        .eq('project_id', projectId)
        .order('severity', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []) as ContradictionItem[];
}

export async function fetchRadarScanStatus(projectId: string, workDocId?: string): Promise<RadarScanProgress> {
    if (isLocalProjectId(projectId)) {
        return {
            success: true,
            active: false,
            status: 'IDLE',
            progress: 0,
            processed: 0,
            total: 0,
            found: isDemoProjectId(projectId) ? 1 : 0,
        };
    }

    const params = new URLSearchParams({ projectId });
    if (workDocId) {
        params.set('workDocId', workDocId);
    }

    const response = await fetch(`/api/scan?${params.toString()}`);

    return parseRadarScanStatusResponse(response);
}

export async function scanRadarProject(
    projectId: string,
    force = false
): Promise<RadarScanResult> {
    if (isLocalProjectId(projectId)) {
        return { success: true, found: isDemoProjectId(projectId) ? 1 : 0, message: 'Demo scan completed locally.' };
    }

    const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, force }),
    });

    return parseRadarScanResponse(response);
}

export async function rescanRadarItem(
    projectId: string,
    workDocId?: string
): Promise<RadarScanResult> {
    if (isLocalProjectId(projectId)) {
        return { success: true, found: isDemoProjectId(projectId) ? 1 : 0, message: 'Demo rescan completed locally.' };
    }

    const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId,
            force: false,
            workDocId,
        }),
    });

    return parseRadarScanResponse(response);
}

export async function updateContradictionStatus(
    projectId: string,
    id: string,
    status: string
): Promise<ContradictionMutationResult> {
    if (isLocalProjectId(projectId)) {
        return { success: true, item: { id, status } };
    }

    const response = await fetch('/api/contradictions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, id, status }),
    });

    return parseContradictionMutationResponse(response);
}

export async function deleteContradictionById(
    projectId: string,
    id: string
): Promise<ContradictionMutationResult> {
    if (isLocalProjectId(projectId)) {
        return { success: true, deletedId: id };
    }

    const response = await fetch('/api/contradictions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, id }),
    });

    return parseContradictionMutationResponse(response);
}
