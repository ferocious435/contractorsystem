'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { isLocalProjectId } from '@/utils/local-projects';
import { generateContradictionPDF } from '@/utils/contradictionPdfGenerator';
import type { ContradictionItem } from '@/types';
import {
    deleteContradictionById,
    fetchRadarContradictions,
    fetchRadarDocuments,
    fetchRadarProjectName,
    rescanRadarItem,
    scanRadarProject,
    type RadarProjectDocument,
    updateContradictionStatus,
} from '../api/contradictionRadarApi';
import {
    buildRadarFindingCounts,
    buildRadarFindingFilterOptions,
    filterRadarFindings,
    type RadarFindingFilter,
} from '../utils/findingClassification';

interface UseContradictionRadarStateOptions {
    projectId: string;
    projectName?: string;
}

const DEFAULT_PROJECT_NAME = 'פרויקט';
const RADAR_ITEM_MOTION_THRESHOLD = 200;

const SCAN_PROGRESS_STEPS = [
    { msg: 'מתחיל בדיקה', p: 10 },
    { msg: 'טוען מסמכי חוזה וביצוע', p: 25 },
    { msg: 'משווה בין המסמכים', p: 60 },
    { msg: 'מארגן ממצאים לתצוגה', p: 90 },
];

type ScanStepStatus = 'success' | 'error' | null;

export function useContradictionRadarState({
    projectId,
    projectName,
}: UseContradictionRadarStateOptions) {
    const isLocalProject = isLocalProjectId(projectId);
    const [contradictions, setContradictions] = useState<ContradictionItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [rescanningIds, setRescanningIds] = useState<Set<string>>(new Set());
    const [currentStep, setCurrentStep] = useState<string | null>(null);
    const [currentStepStatus, setCurrentStepStatus] = useState<ScanStepStatus>(null);
    const [projectDocuments, setProjectDocuments] = useState<RadarProjectDocument[]>([]);
    const [resolvedProjectName, setResolvedProjectName] = useState<string>(projectName || DEFAULT_PROJECT_NAME);
    const [activeFilter, setActiveFilter] = useState<RadarFindingFilter>('ALL');

    const fetchContradictions = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await fetchRadarContradictions(projectId);
            setContradictions(data);
        } catch (err) {
            console.error('Error fetching contradictions:', err);
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    const fetchDocuments = useCallback(async () => {
        try {
            const data = await fetchRadarDocuments(projectId);

            setProjectDocuments(data);
            const contract = data.find((document) => document.category === 'CONTRACT');
            if (contract?.title && !projectName) {
                setResolvedProjectName(contract.title.replace(/\.pdf$/i, ''));
            }
        } catch (err) {
            console.error('Error fetching docs:', err);
        }
    }, [projectId, projectName]);

    useEffect(() => {
        if (projectName) {
            setResolvedProjectName(projectName);
        }
    }, [projectName]);

    useEffect(() => {
        void fetchContradictions();
        void fetchDocuments();

        if (!projectName) {
            fetchRadarProjectName(projectId)
                .then((name) => {
                    if (name) setResolvedProjectName(name);
                })
                .catch((err) => console.error('Error fetching project name:', err));
        }

        if (isLocalProject) return;

        const supabase = createClient();
        const channel = supabase
            .channel(`public:contradictions:project_id=eq.${projectId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'contradictions',
                filter: `project_id=eq.${projectId}`,
            }, () => {
                void fetchContradictions();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchContradictions, fetchDocuments, isLocalProject, projectId, projectName]);

    const radarOpenDocument = useCallback(async (documentId?: string | null, page?: number | string | null) => {
        if (!documentId) return;

        try {
            const params = new URLSearchParams({ projectId, documentId });
            const res = await fetch(`/api/documents/signed-url?${params.toString()}`);
            const data = await res.json();

            if (!res.ok || !data?.signedUrl) {
                throw new Error(data?.error || "Failed to open document");
            }

            const anchor = page ? `#page=${page}` : '';
            window.open(`${data.signedUrl}${anchor}`, '_blank');
        } catch (error) {
            console.error("Open document error:", error);
        }
    }, [projectId]);

    const toggleExpanded = useCallback((id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    }, []);

    const scanProject = useCallback(async (force = false) => {
        setIsScanning(true);
        setProgress(0);
        setCurrentStepStatus(null);

        let stepIdx = 0;
        const progressInterval = setInterval(() => {
            if (stepIdx < SCAN_PROGRESS_STEPS.length) {
                const step = SCAN_PROGRESS_STEPS[stepIdx];
                setCurrentStep(step.msg);
                setProgress(step.p);
                stepIdx++;
            }
        }, 1000);

        try {
            const data = await scanRadarProject(projectId, force);
            clearInterval(progressInterval);

            if (data.success) {
                await fetchDocuments();
                await fetchContradictions();
                setCurrentStep(`הבדיקה הושלמה: נמצאו ${data.found || 0} ממצאים`);
                setCurrentStepStatus('success');
                setProgress(100);
            } else {
                setCurrentStep(data.message || 'אירעה שגיאה במהלך הבדיקה');
            }
        } catch (err) {
            clearInterval(progressInterval);
            console.error('Scan error:', err);
            setCurrentStep('אירעה שגיאת תקשורת');
        } finally {
            setIsScanning(false);
            setTimeout(() => {
                setProgress(0);
                setCurrentStep(null);
                setCurrentStepStatus(null);
            }, 5000);
        }
    }, [fetchContradictions, fetchDocuments, projectId]);

    const rescanItem = useCallback(async (id: string, workDocId?: string) => {
        setRescanningIds((prev) => new Set(prev).add(id));
        try {
            const data = await rescanRadarItem(projectId, workDocId);
            if (data.success) {
                await fetchContradictions();
            }
        } catch (err) {
            console.error('Rescan error:', err);
        } finally {
            setRescanningIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [fetchContradictions, projectId]);

    const updateStatus = useCallback(async (
        id: string,
        newStatus: string,
        contradiction?: ContradictionItem
    ) => {
        try {
            await updateContradictionStatus(projectId, id, newStatus);

            if (newStatus === 'MOVED_TO_PRICING' && contradiction) {
                console.log('[Radar] Finding moved to pricing queue:', id);
            }

            setContradictions((prev) => prev.map((item) => (
                item.id === id ? { ...item, status: newStatus } : item
            )));
            return true;
        } catch (err) {
            console.error('[Radar] updateStatus error:', err);
            return false;
        }
    }, [projectId]);

    const deleteContradiction = useCallback(async (id: string) => {
        if (!confirm('האם למחוק את הממצא הזה?')) return false;

        try {
            await deleteContradictionById(projectId, id);
            setContradictions((prev) => prev.filter((item) => item.id !== id));
            return true;
        } catch (err) {
            console.error('Error deleting contradiction:', err);
            return false;
        }
    }, [projectId]);

    const handleExportPDF = useCallback(() => {
        if (contradictions.length > 0) {
            generateContradictionPDF({ contradictions, projectName: resolvedProjectName });
        }
    }, [contradictions, resolvedProjectName]);

    const state = useMemo(() => ({
        contradictions,
        isLoading,
        expandedId,
        isScanning,
        progress,
        rescanningIds,
        currentStep,
        currentStepStatus,
        projectDocuments,
        resolvedProjectName,
        activeFilter,
    }), [
        activeFilter,
        contradictions,
        currentStep,
        currentStepStatus,
        expandedId,
        isLoading,
        isScanning,
        progress,
        projectDocuments,
        rescanningIds,
        resolvedProjectName,
    ]);

    const setters = useMemo(() => ({
        setExpandedId,
        setActiveFilter,
    }), []);

    const handleFilterChange = useCallback((filter: RadarFindingFilter) => {
        setActiveFilter(filter);
        setExpandedId(null);
    }, []);

    const actions = useMemo(() => ({
        deleteContradiction,
        fetchContradictions,
        fetchDocuments,
        handleExportPDF,
        radarOpenDocument,
        rescanItem,
        scanProject,
        handleFilterChange,
        toggleExpanded,
        updateStatus,
    }), [
        deleteContradiction,
        fetchContradictions,
        fetchDocuments,
        handleExportPDF,
        radarOpenDocument,
        rescanItem,
        scanProject,
        handleFilterChange,
        toggleExpanded,
        updateStatus,
    ]);

    const derived = useMemo(() => {
        const findingCounts = buildRadarFindingCounts(contradictions);
        const filteredFindings = filterRadarFindings(contradictions, activeFilter);

        return {
            contractDocsCount: projectDocuments.filter((document) => document.category === 'CONTRACT').length,
            executionDocsCount: projectDocuments.filter((document) => document.category === 'EXECUTION').length,
            filterOptions: buildRadarFindingFilterOptions(findingCounts),
            filteredFindings,
            findingCounts,
            hasContradictions: contradictions.length > 0,
            hasFilteredFindings: filteredFindings.length > 0,
            highRiskContradictionCount: findingCounts.contradictions,
            shouldAnimateItems: filteredFindings.length <= RADAR_ITEM_MOTION_THRESHOLD,
            totalContradictions: findingCounts.all,
        };
    }, [activeFilter, contradictions, projectDocuments]);

    return {
        state,
        setters,
        actions,
        derived,
    };
}
