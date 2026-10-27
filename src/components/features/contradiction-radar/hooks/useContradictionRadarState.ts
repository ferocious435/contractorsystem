'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RADAR_FINDINGS_UPDATED_EVENT } from '@/utils/radar-review-disposition';
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
    fetchRadarSupportSources,
    rescanRadarItem,
    scanRadarProject,
    type RadarScanProgress,
    type RadarProjectDocument,
    type RadarSupportSources,
    updateContradictionStatus,
    revalidateRadarSavedEvidence,
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
const SCAN_RESULT_VISIBLE_MS = 15_000;

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
    const [retryableDocsCount, setRetryableDocsCount] = useState(0);
    const [rescanningIds, setRescanningIds] = useState<Set<string>>(new Set());
    const [currentStep, setCurrentStep] = useState<string | null>(null);
    const [currentStepStatus, setCurrentStepStatus] = useState<ScanStepStatus>(null);
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewMessage, setReviewMessage] = useState<string | null>(null);
    const [reviewError, setReviewError] = useState(false);
    const [projectDocuments, setProjectDocuments] = useState<RadarProjectDocument[]>([]);
    const [supportSources, setSupportSources] = useState<RadarSupportSources | null>(null);
    const [resolvedProjectName, setResolvedProjectName] = useState<string>(projectName || DEFAULT_PROJECT_NAME);
    const [activeFilter, setActiveFilter] = useState<RadarFindingFilter>('ALL');
    const [activeStatusFilter, setActiveStatusFilter] = useState<RadarStatusFilter>('OPEN');
    const scanWasActiveRef = useRef(false);
    const scanRequestPendingRef = useRef(false);
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

    useEffect(() => {
        let mounted = true;
        const onFindingsUpdated = (event: Event) => {
            if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId !== projectId) return;
            // Refresh counts without unmounting the open card and its saved-record preview.
            void fetchRadarContradictions(projectId).then(data => {
                if (mounted) setContradictions(data);
            }).catch(error => console.error('Error refreshing linked findings:', error));
        };
        window.addEventListener(RADAR_FINDINGS_UPDATED_EVENT, onFindingsUpdated);
        return () => { mounted = false; window.removeEventListener(RADAR_FINDINGS_UPDATED_EVENT, onFindingsUpdated); };
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

    const fetchSupportSources = useCallback(async () => {
        try {
            setSupportSources(await fetchRadarSupportSources(projectId));
        } catch (err) {
            console.error('Error fetching support sources:', err);
            setSupportSources(null);
        }
    }, [projectId]);

    const scheduleScanBannerReset = useCallback(() => {
        if (scanResetTimerRef.current) {
            clearTimeout(scanResetTimerRef.current);
        }

        scanResetTimerRef.current = setTimeout(() => {
            setProgress(0);
            setCurrentStep(null);
            setCurrentStepStatus(null);
        }, SCAN_RESULT_VISIBLE_MS);
    }, []);

    const applyScanProgress = useCallback(async (
        scanStatus: RadarScanProgress,
        options: { showFinished?: boolean } = {}
    ) => {
        // Polling may return the previous completed run while the start request
        // is still being accepted. It must not announce that the new run ended.
        if (scanRequestPendingRef.current && !scanStatus.active) return;
        setRetryableDocsCount((scanStatus.skipped || 0) + (scanStatus.failed || 0));
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

        if (scanStatus.status === 'ERROR' || (scanStatus.failed || 0) > 0) {
            setProgress(scanStatus.progress);
            setCurrentStep(scanStatus.errorMessage || `הבדיקה הסתיימה עם ${scanStatus.failed || 0} מסמכים שדורשים ניסיון נוסף.`);
            setCurrentStepStatus('error');
        } else if (scanStatus.status === 'PAUSED') {
            setProgress(scanStatus.progress);
            setCurrentStep(`הבדיקה נעצרה אחרי ${scanStatus.processed}/${scanStatus.total} מסמכים. לחיצה נוספת תמשיך מאותה נקודה.`);
            setCurrentStepStatus('error');
        } else if ((scanStatus.skipped || 0) > 0) {
            setProgress(scanStatus.progress);
            setCurrentStep(`הבדיקה הסתיימה. ${scanStatus.skipped || 0} מסמכים לא נקראו וסומנו לבדיקה.`);
            setCurrentStepStatus('error');
        } else if ((scanStatus.excluded || 0) > 0) {
            setProgress(scanStatus.total > 0 ? 100 : scanStatus.progress);
            setCurrentStep(`המעבר הסתיים. ${scanStatus.excluded} טיוטות או קטעי מסמכים לא שימשו כהוראות מחייבות; נדרש בירור גרסה והקשר.`);
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
        void fetchSupportSources();

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
    }, [fetchContradictions, fetchDocuments, fetchSupportSources, isLocalProject, projectId, projectName]);

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
            if (data.previewKind === 'reference') {
                window.open(`${data.signedUrl}${normalizedPage ? `&page=${normalizedPage}` : ''}`, '_blank');
                return;
            }
            const anchor = normalizedPage ? `#page=${normalizedPage}` : '';
            window.open(`${data.signedUrl}${anchor}`, '_blank');
        } catch (error) {
            console.error("Open document error:", error);
        }
    }, [projectId]);

    const toggleExpanded = useCallback((id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    }, []);

    const scanProject = useCallback(async (force = false, retrySkipped = false) => {
        if (!aiAvailable) {
            setCurrentStep('חיבור ה-AI לא מוגדר. המסמכים הקיימים לא השתנו.');
            setCurrentStepStatus('error');
            return;
        }

        if (scanRequestPendingRef.current) {
            return;
        }

        setIsScanning(true);
        setProgress(0);
        setCurrentStepStatus(null);
        setCurrentStep('מתחיל בדיקה ושומר התקדמות במערכת');
        scanWasActiveRef.current = true;
        scanRequestPendingRef.current = true;

        try {
            const data = await scanRadarProject(projectId, force, 0, true, retrySkipped);
            scanRequestPendingRef.current = false;

            if (!data.success) {
                throw new Error(data.message || 'אירעה שגיאה במהלך הבדיקה');
            }

            const latestStatus = data.scanStatus || await refreshScanProgress();
            if (latestStatus) {
                await applyScanProgress(latestStatus);
            }
        } catch (err) {
            console.error('Scan error:', err);
            scanRequestPendingRef.current = false;
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

    const deleteContradiction = useCallback(async (id: string, confirmed = false) => {
        if (!confirmed) return false;

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

    const reviewSavedEvidence = useCallback(async (issueHistoryOnly = false) => {
        setIsReviewing(true);
        setReviewMessage(null);
        setReviewError(false);
        try {
            const result = await revalidateRadarSavedEvidence(projectId, issueHistoryOnly);
            await fetchContradictions();
            setReviewMessage(result.message);
            window.dispatchEvent(new CustomEvent(RADAR_FINDINGS_UPDATED_EVENT, { detail: { projectId } }));
        } catch (error) {
            setReviewError(true);
            setReviewMessage(error instanceof Error ? error.message : 'בדיקת הראיות נכשלה');
        } finally { setIsReviewing(false); }
    }, [projectId, fetchContradictions]);

    const state = useMemo(() => ({
        contradictions,
        isLoading,
        expandedId,
        isScanning,
        progress,
        retryableDocsCount,
        rescanningIds,
        currentStep,
        currentStepStatus,
        projectDocuments,
        supportSources,
        resolvedProjectName,
        activeFilter,
        activeStatusFilter,
        aiAvailable: aiStatus === null && !isLocalProject ? null : aiAvailable,
        isReviewing,
        reviewMessage,
        reviewError,
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
        retryableDocsCount,
        projectDocuments,
        supportSources,
        rescanningIds,
        resolvedProjectName,
        isLocalProject,
        isReviewing,
        reviewMessage,
        reviewError,
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
        fetchSupportSources,
        handleExportPDF,
        radarOpenDocument,
        rescanItem,
        scanProject,
        handleFilterChange,
        handleStatusFilterChange,
        toggleExpanded,
        updateStatus,
        reviewSavedEvidence,
    }), [
        deleteContradiction,
        fetchContradictions,
        fetchDocuments,
        fetchSupportSources,
        handleExportPDF,
        radarOpenDocument,
        rescanItem,
        scanProject,
        handleFilterChange,
        handleStatusFilterChange,
        toggleExpanded,
        updateStatus,
        reviewSavedEvidence,
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
