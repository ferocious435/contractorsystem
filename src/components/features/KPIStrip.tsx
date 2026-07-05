"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getLedgerRowAmount, getMoneySum, getPreferredProjectAmount, isVisibleLedgerRow } from "@/utils/project-financials";
import { syncSingleProjectContractBase } from "@/utils/project-contract-base-client";
import { isLocalProjectId } from "@/utils/local-projects";
import { getLocalDemoProjectProfile } from "@/utils/local-demo-data";

export function KPIStrip({ projectId }: { projectId: string | null }) {
    const [originalBudget, setOriginalBudget] = useState(0);
    const [approvedExceptions, setApprovedExceptions] = useState(0);
    const [openExceptions, setOpenExceptions] = useState(0);
    const [identifiedRisks, setIdentifiedRisks] = useState(0);
    const [rationaleCoverage, setRationaleCoverage] = useState(0);
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

            const { data: projectData } = await supabase
                .from("projects")
                .select("budget")
                .eq("id", projectId)
                .single();

            const { data: ledgerData } = await supabase
                .from("pricing_ledger")
                .select("type, source, quantity, unit_price_excl_vat, total_price_excl_vat, ai_rationale, governing_notes, evidence_data")
                .eq("project_id", projectId);

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

            const { count } = await supabase
                .from("contradictions")
                .select("id", { count: "exact", head: true })
                .eq("project_id", projectId)
                .eq("status", "OPEN")
                .eq("severity", "HIGH");

            setIdentifiedRisks(count || 0);
        };

        fetchKpiData();
    }, [projectId, isLocalProject]);

    const formatCurrency = (amount: number) => {
        return `₪ ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    };

    const kpis = [
        { label: "תקציב מקורי", value: formatCurrency(isLocalProject ? demoProfile.budget : originalBudget), color: "text-white drop-shadow-md" },
        { label: "חריגים מאושרים", value: formatCurrency(isLocalProject ? demoProfile.approvedVO : approvedExceptions), color: "text-success drop-shadow-[0_0_8px_rgba(0,208,132,0.4)]" },
        { label: "חריגים פתוחים", value: formatCurrency(isLocalProject ? demoProfile.pendingVO : openExceptions), color: "text-warning drop-shadow-[0_0_8px_rgba(249,115,22,0.4)]" },
        { label: "סיכון מזוהה (AI)", value: `${isLocalProject ? demoProfile.criticalCount : identifiedRisks}`, color: "text-critical drop-shadow-[0_0_8px_rgba(255,77,79,0.4)]" },
        { label: "כיסוי הוכחות", value: `${isLocalProject ? demoProfile.evidenceCoverage : rationaleCoverage}%`, color: "text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]" },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 lg:gap-6 mb-6 lg:mb-8">
            {kpis.map((kpi, i) => (
                <div
                    key={i}
                    className="bg-workspace border border-border-subtle rounded-xl p-4 sm:p-5 flex flex-col gap-2 hover:border-gray-500 hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)] transition-all duration-300 cursor-pointer shadow-lg transform hover:-translate-y-1"
                >
                    <span className="text-sm font-medium text-gray-300">{kpi.label}</span>
                    <span className={`text-2xl sm:text-3xl font-mono font-bold tracking-tight ${kpi.color}`}>
                        {kpi.value}
                    </span>
                </div>
            ))}
        </div>
    );
}
