"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getLedgerRowAmount, getPreferredProjectAmount } from "@/utils/project-financials";

export function KPIStrip({ projectId }: { projectId: string | null }) {
    const [originalBudget, setOriginalBudget] = useState(0);
    const [approvedExceptions, setApprovedExceptions] = useState(0);
    const [openExceptions, setOpenExceptions] = useState(0);
    const [identifiedRisks, setIdentifiedRisks] = useState(0);
    const [rationaleCoverage, setRationaleCoverage] = useState(0);

    const supabase = createClient();

    useEffect(() => {
        if (!projectId) return;

        const fetchKpiData = async () => {
            // 1. Бюджет: сначала из projects.budget, если нет — считаем из ledger BASE_CONTRACT
            const { data: projectData } = await supabase
                .from('projects')
                .select('budget')
                .eq('id', projectId)
                .single();

            // 2. Загружаем ВСЕ строки pricing_ledger для расчёта KPI
            const { data: ledgerData } = await supabase
                .from('pricing_ledger')
                .select('type, source, quantity, unit_price_excl_vat, total_price_excl_vat, ai_rationale, governing_notes')
                .eq('project_id', projectId);

            if (ledgerData) {
                // Оригинальный бюджет: BASE_CONTRACT строки

                // Утверждённые VO
                const approvedVO = ledgerData
                    .filter(r => r.type === 'APPROVED_VO')
                    .reduce((acc, row) => acc + getLedgerRowAmount(row), 0);

                // Открытые (ожидающие) VO
                const pendingVO = ledgerData
                    .filter(r => r.type === 'PENDING_VO')
                    .reduce((acc, row) => acc + getLedgerRowAmount(row), 0);

                setOriginalBudget(getPreferredProjectAmount(projectData?.budget, ledgerData));
                setApprovedExceptions(approvedVO);
                setOpenExceptions(pendingVO);

                // Расчет покрытия доказательствами
                const totalItems = ledgerData.length;
                const itemsWithRationale = ledgerData.filter(r => r.ai_rationale || r.governing_notes).length;
                setRationaleCoverage(totalItems > 0 ? Math.round((itemsWithRationale / totalItems) * 100) : 0);
            } else if (projectData?.budget) {
                setOriginalBudget(projectData.budget);
            }

            // 3. AI Risk: количество OPEN + HIGH противоречий
            const { count } = await supabase
                .from('contradictions')
                .select('id', { count: 'exact', head: true })
                .eq('project_id', projectId)
                .eq('status', 'OPEN')
                .eq('severity', 'HIGH');

            setIdentifiedRisks(count || 0);
        };

        fetchKpiData();
    }, [projectId]);

    const formatCurrency = (amount: number) => {
        return `₪ ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    };

    const kpis = [
        { label: 'תקציב מקורי', value: formatCurrency(originalBudget), color: 'text-white drop-shadow-md' },
        { label: 'חריגים מאושרים', value: formatCurrency(approvedExceptions), color: 'text-success drop-shadow-[0_0_8px_rgba(0,208,132,0.4)]' },
        { label: 'חריגים פתוחים', value: formatCurrency(openExceptions), color: 'text-warning drop-shadow-[0_0_8px_rgba(249,115,22,0.4)]' },
        { label: 'סיכון מזוהה (AI)', value: `${identifiedRisks}`, color: 'text-critical drop-shadow-[0_0_8px_rgba(255,77,79,0.4)]' },
        { label: 'כיסוי הוכחות', value: `${rationaleCoverage}%`, color: 'text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]' },
    ];

    return (
        <div className="grid grid-cols-5 gap-6 mb-8">
            {kpis.map((kpi, i) => (
                <div
                    key={i}
                    className="bg-workspace border border-border-subtle rounded-xl p-5 flex flex-col gap-2 hover:border-gray-500 hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)] transition-all duration-300 cursor-pointer shadow-lg transform hover:-translate-y-1"
                >
                    <span className="text-sm font-medium text-gray-300">{kpi.label}</span>
                    <span className={`text-3xl font-mono font-bold tracking-tight ${kpi.color}`}>
                        {kpi.value}
                    </span>
                </div>
            ))}
        </div>
    );
}
