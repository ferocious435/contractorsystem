'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { isLocalProjectId } from '@/utils/local-projects';
import { generateContradictionPDF } from '@/utils/contradictionPdfGenerator';
import type { ContradictionItem } from '@/types';
import { useAiReadiness } from '@/hooks/useAiReadiness';
import {
    deleteContradictionById,
    fetchRadarContradictions,
    fetchRadarDocuments,
    fetchRadarProjectName,
    fetchRadarScanStatus,
    rescanRadarItem,
    scanRadarProject,
    type RadarScanProgress,
    type RadarProjectDocument,
    updateContradictionStatus,
} from '../api/contradictionRadarApi';
import {
    buildRadarFindingCounts,
    buildRadarFindingFilterOptions,
    buildRadarStatusFilterOptions,
    filterRadarFindings,
    type RadarFindingFilter,
    type RadarStatusFilter,
} from '../utils/findingClassification';
import { normalizeDocumentPage } from '../utils/documentPage';

interface UseContradictionRadarStateOptions {
    projectId: string;
    projectName?: string;
}

const DEFAULT_PROJECT_NAME = 'פרויקט';
const RADAR_ITEM_MOTION_THRESHOLD = 200;
const SCAN_STATUS_POLL_MS = 3000;

type ScanStepStatus = 'success' | 'error' | null;

export function useContradictionRadarState({
    projectId,
    projectName,
}: UseContradictionRadarStateOptions) {
    const isLocalProject = isLocalProjectId(projectId);
    const aiStatus = useAiReadiness();
    const aiAvailable = isLocalProject || aiStatus?.available === true;
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
    const [activeStatusFilter, setActiveStatusFilter] = useState<RadarStatusFilter>('OPEN');
    const scanWasActiveRef = useRef(false);
    const scanResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const scheduleScanBannerReset = useCallback(() => {
        if (scanResetTimerRef.current) {
            clearTimeout(scanResetTimerRef.current);
        }

        scanResetTimerRef.current = setTimeout(() => {
            setProgress(0);
            setCurrentStep(null);
            setCurrentStepStatus(null);
        }, 5000);
    }, []);

    const applyScanProgress = useCallback(async (
        scanStatus: RadarScanProgress,
        options: { showFinished?: boolean } = {}
    ) => {
        if (scanStatus.active) {
            scanWasActiveRef.current = true;
            if (scanResetTimerRef.current) {
                clearTimeout(scanResetTimerRef.current);
                scanResetTimerRef.current = null;
            }

            setIsScanning(true);
            setCurrentStepStatus(null);
            setProgress(scanStatus.progress);
            setCurrentStep(
                scanStatus.currentStep ||
                `הבדיקה מתקדמת: ${scanStatus.processed}/${scanStatus.total} מסמכים`
            );
            return;
        }

        const shouldShowFinished = scanWasActiveRef.current || options.showFinished || scanStatus.status === 'PAUSED';
        scanWasActiveRef.current = false;
        setIsScanning(false);

        if (!shouldShowFinished) {
            return;
        }

        await fetchDocuments();
        await fetchContradictions();

        if (scanStatus.status === 'ERROR') {
            setProgress(scanStatus.progress);
            setCurrentStep(scanStatus.errorMessage || 'הבדיקה נעצרה בגלל שגיאה. אפשר להמשיך מהנקודה האחרונה.');
            setCurrentStepStatus('error');
        } else if (scanStatus.status === 'PAUSED') {
            setProgress(scanStatus.progress);
            setCurrentStep(`הבדיקה נעצרה אחרי ${scanStatus.processed}/${scanStatus.total} מסמכים. לחיצה נוספת תמשיך מאותה נקודה.`);
            setCurrentStepStatus('error');
        } else {
            setProgress(scanStatus.total > 0 ? 100 : scanStatus.progress);
            setCurrentStep(`הבדיקה הושלמה: נמצאו ${scanStatus.found || 0} ממצאים`);
            setCurrentStepStatus('success');
        }

        scheduleScanBannerReset();
    }, [fetchContradictions, fetchDocuments, scheduleScanBannerReset]);

    const refreshScanProgress = useCallback(async (options: { showFinished?: boolean } = {}) => {
        if (isLocalProject) return null;

        const scanStatus = await fetchRadarScanStatus(projectId);
        await applyScanProgress(scanStatus, options);

        return scanStatus;
    }, [applyScanProgress, isLocalProject, projectId]);

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

    useEffect(() => {
        if (isLocalProject) return;

        let cancelled = false;

        const checkStatus = async () => {
            try {
                if (!cancelled) {
                    await refreshScanProgress();
                }
            } catch (err) {
                console.error('Error fetching scan progress:', err);
            }
        };

        void checkStatus();

        const intervalId = window.setInterval(checkStatus, SCAN_STATUS_POLL_MS);
        const onFocus = () => void checkStatus();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void checkStatus();
            }
        };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [isLocalProject, refreshScanProgress]);

    useEffect(() => {
        return () => {
            if (scanResetTimerRef.current) {
                clearTimeout(scanResetTimerRef.current);
            }
        };
    }, []);

    const radarOpenDocument = useCallback(async (documentId?: string | null, page?: number | string | null) => {
        if (!documentId) return;

        try {
            const params = new URLSearchParams({ projectId, documentId });
            const res = await fetch(`/api/documents/signed-url?${params.toString()}`);
            const data = await res.json();

            if (!res.ok || !data?.signedUrl) {
                throw new Error(data?.error || "Failed to open document");
            }

            const normalizedPage = normalizeDocumentPage(page);
            const anchor = normalizedPage ? `#page=${normalizedPage}` : '';
            window.open(`${data.signedUrl}${anchor}`, '_blank');
        } catch (error) {
            console.error("Open document error:", error);
        }
    }, [projectId]);

    const toggleExpanded = useCallback((id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    }, []);

    const scanProject = useCallback(async (force = false) => {
        if (!aiAvailable) {
            setCurrentStep('חיבור ה-AI לא מוגדר. המסמכים הקיימים לא השתנו.');
            setCurrentStepStatus('error');
            return;
        }

        setIsScanning(true);
        setProgress(0);
        setCurrentStepStatus(null);
        setCurrentStep('מתחיל בדיקה ושומר התקדמות במערכת');
        scanWasActiveRef.current = true;

        try {
            const data = await scanRadarProject(projectId, force);
            const latestStatus = data.scanStatus || await refreshScanProgress({ showFinished: true });

            if (data.success || data.partial) {
                await fetchDocuments();
                await fetchContradictions();
                const memorySummary = data.memory
                    ? ` נסרקו ${data.memory.scanned} מסמכים חדשים או שהשתנו; ${data.memory.unchanged} מסמכים לא השתנו.`
                    : '';
                setCurrentStep(`הבדיקה הושלמה: נמצאו ${data.found || 0} ממצאים.${memorySummary}`);
                setCurrentStepStatus('success');
                setProgress(100);
                setIsScanning(false);
                scanWasActiveRef.current = false;
                scheduleScanBannerReset();
            } else if (latestStatus?.active) {
                await applyScanProgress(latestStatus);
            } else {
                setCurrentStep(data.message || 'אירעה שגיאה במהלך הבדיקה');
                setCurrentStepStatus('error');
                setIsScanning(false);
                scanWasActiveRef.current = false;
                scheduleScanBannerReset();
            }
        } catch (err) {
            console.error('Scan error:', err);
            try {
                const latestStatus = await refreshScanProgress({ showFinished: true });
                if (!latestStatus?.active) {
                    setCurrentStep('אירעה שגיאת תקשורת. אם הבדיקה נעצרה, לחיצה נוספת תמשיך מהנקודה האחרונה.');
                    setCurrentStepStatus('error');
                    setIsScanning(false);
                    scanWasActiveRef.current = false;
                    scheduleScanBannerReset();
                }
            } catch {
                setCurrentStep('אירעה שגיאת תקשורת. אם הבדיקה נעצרה, לחיצה נוספת תמשיך מהנקודה האחרונה.');
                setCurrentStepStatus('error');
                setIsScanning(false);
                scanWasActiveRef.current = false;
                scheduleScanBannerReset();
            }
        }
    }, [
        applyScanProgress,
        aiAvailable,
        fetchContradictions,
        fetchDocuments,
        projectId,
        refreshScanProgress,
        scheduleScanBannerReset,
    ]);

    const rescanItem = useCallback(async (id: string, workDocId?: string) => {
        if (!aiAvailable) {
            setCurrentStep('חיבור ה-AI לא מוגדר. אי אפשר לסרוק מחדש כרגע.');
            setCurrentStepStatus('error');
            return;
        }

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
    }, [aiAvailable, fetchContradictions, projectId]);

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
        activeStatusFilter,
        aiAvailable: aiStatus === null && !isLocalProject ? null : aiAvailable,
    }), [
        activeFilter,
        activeStatusFilter,
        aiAvailable,
        aiStatus,
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
        isLocalProject,
    ]);

    const setters = useMemo(() => ({
        setExpandedId,
        setActiveFilter,
        setActiveStatusFilter,
    }), []);

    const handleFilterChange = useCallback((filter: RadarFindingFilter) => {
        setActiveFilter(filter);
        setExpandedId(null);
    }, []);

    const handleStatusFilterChange = useCallback((filter: RadarStatusFilter) => {
        setActiveStatusFilter(filter);
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
        handleStatusFilterChange,
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
        handleStatusFilterChange,
        toggleExpanded,
        updateStatus,
    ]);

    const derived = useMemo(() => {
        const findingsForStatus = filterRadarFindings(contradictions, 'ALL', activeStatusFilter);
        const findingCounts = buildRadarFindingCounts(findingsForStatus);
        const filteredFindings = filterRadarFindings(findingsForStatus, activeFilter);

        return {
            contractDocsCount: projectDocuments.filter((document) => document.category === 'CONTRACT').length,
            executionDocsCount: projectDocuments.filter((document) => document.category === 'EXECUTION').length,
            filterOptions: buildRadarFindingFilterOptions(findingCounts),
            statusFilterOptions: buildRadarStatusFilterOptions(contradictions),
            filteredFindings,
            findingCounts,
            hasContradictions: contradictions.length > 0,
            hasFilteredFindings: filteredFindings.length > 0,
            highRiskContradictionCount: findingCounts.contradictions,
            shouldAnimateItems: filteredFindings.length <= RADAR_ITEM_MOTION_THRESHOLD,
            totalContradictions: findingCounts.all,
        };
    }, [activeFilter, activeStatusFilter, contradictions, projectDocuments]);

    return {
        state,
        setters,
        actions,
        derived,
    };
}
