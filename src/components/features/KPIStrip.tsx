"use client";

import { useEffect, useState } from "react";
import { Panel } from '@/components/ui/titanium/Panel';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { createClient } from "@/utils/supabase/client";
import { getLedgerRowAmount, getMoneySum, getPreferredProjectAmount, isVisibleLedgerRow } from "@/utils/project-financials";
import { syncSingleProjectContractBase } from "@/utils/project-contract-base-client";
import { isLocalProjectId } from "@/utils/local-projects";
import { getLocalDemoProjectProfile } from "@/utils/local-demo-data";
import { summarizeOpenContradictions } from './projectOverviewStats';

export function KPIStrip({ projectId }: { projectId: string | null }) {
    const [originalBudget, setOriginalBudget] = useState<number | null>(null);
    const [approvedExceptions, setApprovedExceptions] = useState<number | null>(null);
    const [openExceptions, setOpenExceptions] = useState<number | null>(null);
    const [identifiedRisks, setIdentifiedRisks] = useState<number | null>(null);
    const [rationaleCoverage, setRationaleCoverage] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const isLocalProject = isLocalProjectId(projectId);
    const demoProfile = getLocalDemoProjectProfile(projectId);

    useEffect(() => {
        if (!projectId) return;
        if (isLocalProject) return;

        const fetchKpiData = async () => {
            const supabase = createClient();
            let resolvedBudget: number | null = null;
            try {
                const synced = await syncSingleProjectContractBase(projectId);
                resolvedBudget = synced?.amount ?? null;
            } catch (syncError) {
                console.error("Error syncing project contract amount:", syncError);
            }

            const { data: projectData, error: projectError } = await supabase
                .from("projects")
                .select("budget")
                .eq("id", projectId)
                .single();

            const { data: ledgerData, error: ledgerError } = await supabase
                .from("pricing_ledger")
                .select("type, source, quantity, unit_price_excl_vat, total_price_excl_vat, ai_rationale, governing_notes, evidence_data")
                .eq("project_id", projectId);

            if (projectError || ledgerError) throw new Error('KPI_READ_FAILED');
            if (ledgerData) {
                const visibleLedgerRows = ledgerData.filter(isVisibleLedgerRow);

                const approvedVO = visibleLedgerRows
                    .filter((row) => row.type === "APPROVED_VO" || row.type === "SENT_VO")
                    .reduce((sum, row) => getMoneySum([sum, getLedgerRowAmount(row)]), 0);

                const pendingVO = visibleLedgerRows
                    .filter((row) => row.type === "PENDING_VO")
                    .reduce((sum, row) => getMoneySum([sum, getLedgerRowAmount(row)]), 0);

                setOriginalBudget(getPreferredProjectAmount(resolvedBudget ?? projectData?.budget, ledgerData));
                setApprovedExceptions(approvedVO);
                setOpenExceptions(pendingVO);

                const totalItems = visibleLedgerRows.length;
                const itemsWithRationale = visibleLedgerRows.filter((row) => row.ai_rationale || row.governing_notes).length;
                setRationaleCoverage(totalItems > 0 ? Math.round((itemsWithRationale / totalItems) * 100) : 0);
            } else if ((resolvedBudget ?? projectData?.budget)) {
                setOriginalBudget(Number(resolvedBudget ?? projectData?.budget));
            }

            const { data: riskRows, error: riskError } = await supabase
                .from("contradictions")
                .select("status,severity,evidence_data")
                .eq("project_id", projectId)
                .eq("status", "OPEN")
                .eq("severity", "HIGH");

            if (riskError) throw new Error('KPI_RISK_READ_FAILED');
            setIdentifiedRisks(summarizeOpenContradictions(riskRows).highRiskOpenCount);
        };

        void fetchKpiData().catch(error => {
            console.error('KPI read failed:', error);
            setLoadError('לא ניתן לקרוא את מדדי הפרויקט כרגע.');
        });
    }, [projectId, isLocalProject]);

    const formatCurrency = (amount: number | null) => {
        if (amount === null) return "—";
        return `₪ ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    };

    const kpis = [
        { label: "תקציב מקורי", value: formatCurrency(isLocalProject ? demoProfile.budget : originalBudget), color: "text-white drop-shadow-md" },
        { label: "חריגים מאושרים", value: formatCurrency(isLocalProject ? demoProfile.approvedVO : approvedExceptions), color: "text-success drop-shadow-[0_0_8px_rgba(0,208,132,0.4)]" },
        { label: "חריגים פתוחים", value: formatCurrency(isLocalProject ? demoProfile.pendingVO : openExceptions), color: "text-warning drop-shadow-[0_0_8px_rgba(249,115,22,0.4)]" },
        { label: "סיכון מזוהה (AI)", value: `${isLocalProject ? demoProfile.criticalCount : identifiedRisks ?? "—"}`, color: "text-critical drop-shadow-[0_0_8px_rgba(255,77,79,0.4)]" },
        { label: "פריטי תמחור עם הסבר", value: isLocalProject ? `${demoProfile.evidenceCoverage}%` : rationaleCoverage === null ? "—" : `${rationaleCoverage}%`, color: "text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]" },
    ];

    return <>{loadError && <Feedback tone="danger">{loadError}</Feedback>}<div className="ti-kpi-strip" dir="rtl">{kpis.map((kpi,index)=><Panel key={kpi.label} material="metal"><span className="ti-meta">{kpi.label}</span><strong><BidiText kind={index < 3 ? 'money' : index === 4 ? 'percent' : 'code'} value={loadError ? '—' : kpi.value}/></strong></Panel>)}</div></>;
}
