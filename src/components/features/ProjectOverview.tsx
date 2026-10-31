"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getLedgerRowAmount, getMoneySum, getPreferredProjectAmount, isVisibleLedgerRow, isTrustedBaseContractRow } from "@/utils/project-financials";
import { isLocalProjectId } from "@/utils/local-projects";
import { getLocalDemoProjectProfile } from "@/utils/local-demo-data";
import { useAiReadiness } from '@/hooks/useAiReadiness';
import { summarizeOpenContradictions } from './projectOverviewStats';
import { OverviewView, emptyOverviewStats, type OverviewStats } from './overview/OverviewView';

interface ProjectOverviewProps {
    projectId: string;
    onNavigate: (view: string) => void;
}

export default function ProjectOverview({ projectId, onNavigate }: ProjectOverviewProps) {
    const aiStatus = useAiReadiness('consultant');
    const [stats, setStats] = useState<OverviewStats>(emptyOverviewStats);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const fetchProjectStats = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            if (isLocalProjectId(projectId)) {
                const demoProfile = getLocalDemoProjectProfile(projectId);
                setStats({
                    originalBudget: demoProfile.budget,
                    approvedVO: demoProfile.approvedVO,
                    pendingVO: demoProfile.pendingVO,
                    criticalCount: demoProfile.criticalCount,
                    totalDiscrepancies: demoProfile.totalDiscrepancies,
                    documentCount: demoProfile.documentCount,
                    evidenceCoverage: demoProfile.evidenceCoverage,
                    clientName: demoProfile.clientName,
                });
                return;
            }

            const supabase = createClient();
            const [
                { data: project, error: projectError },
                { data: ledger, error: ledgerError },
                { data: contradictions, error: contradictionError },
                { count: docCount, error: documentsError },
            ] = await Promise.all([
                supabase
                    .from('projects')
                    .select('budget, client_name')
                    .eq('id', projectId)
                    .single(),
                supabase
                    .from('pricing_ledger')
                    .select('type, source, total_price_excl_vat, quantity, unit_price_excl_vat, ai_rationale, governing_notes, evidence_data')
                    .eq('project_id', projectId),
                supabase
                    .from('contradictions')
                    .select('status, category, severity, evidence_data')
                    .eq('project_id', projectId),
                supabase
                    .from('documents')
                    .select('id', { count: 'exact', head: true })
                    .eq('project_id', projectId),
            ]);

            if (projectError || ledgerError || contradictionError || documentsError || !project || !ledger) throw new Error('OVERVIEW_READ_FAILED');
            if (ledger) {
                const visibleLedgerRows = ledger.filter(isVisibleLedgerRow);

                const approved = visibleLedgerRows
                    .filter(r => r.type === 'APPROVED_VO' || r.type === 'SENT_VO')
                    .reduce((acc, r) => getMoneySum([acc, getLedgerRowAmount(r)]), 0);

                const pending = visibleLedgerRows
                    .filter(r => r.type === 'PENDING_VO')
                    .reduce((acc, r) => getMoneySum([acc, getLedgerRowAmount(r)]), 0);

                const withEvidence = visibleLedgerRows.filter(r => r.ai_rationale || r.governing_notes).length;
                const coverage = visibleLedgerRows.length > 0 ? Math.round((withEvidence / visibleLedgerRows.length) * 100) : 0;

                const contradictionSummary = summarizeOpenContradictions(contradictions);

                setStats({
                    originalBudget: project?.budget !== null && project?.budget !== undefined || ledger.some(isTrustedBaseContractRow) ? getPreferredProjectAmount(project?.budget, ledger) : null,
                    approvedVO: approved,
                    pendingVO: pending,
                    criticalCount: contradictionSummary.highRiskOpenCount,
                    totalDiscrepancies: contradictionSummary.openCount,
                    documentCount: docCount ?? null,
                    evidenceCoverage: coverage,
                    clientName: project?.client_name || "לקוח לא ידוע"
                });
            }
        } catch (error) {
            console.error('Project overview read failed:', error);
            setLoadError('לא ניתן לקרוא את נתוני הפרויקט כרגע. הנתונים אינם מוצגים כסכומי אפס.');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        void fetchProjectStats();
    }, [fetchProjectStats]);

    return <OverviewView stats={stats} loading={isLoading} error={loadError} aiStatus={aiStatus} onNavigate={onNavigate} />;
}
