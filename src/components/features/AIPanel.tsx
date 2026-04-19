"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { AlertTriangle, AlertCircle, TrendingUp, Zap, ArrowRight } from "lucide-react";

interface AIInsight {
    id: string;
    type: 'contradiction' | 'risk' | 'opportunity';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    amount?: number;
    actionLabel?: string;
}

export function AIPanel({ projectId }: { projectId: string | null }) {
    const [insights, setInsights] = useState<AIInsight[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        if (!projectId) {
            setInsights([]);
            setIsLoading(false);
            return;
        }
        fetchInsights();
    }, [projectId]);

    const fetchInsights = async () => {
        setIsLoading(true);
        try {
            // 1. Загружаем открытые противоречия
            const { data: contradictions } = await supabase
                .from('contradictions')
                .select('id, title, description, severity, strategy_advice')
                .eq('project_id', projectId)
                .eq('status', 'OPEN')
                .order('severity', { ascending: false })
                .limit(5);

            // 2. Загружаем ожидающие VO (Variation Orders)
            const { data: pendingVOs } = await supabase
                .from('pricing_ledger')
                .select('id, description, total_price_excl_vat, type')
                .eq('project_id', projectId)
                .eq('type', 'PENDING_VO')
                .limit(3);

            // 3. Формируем инсайты
            const newInsights: AIInsight[] = [];

            // Противоречия → инсайты
            if (contradictions) {
                contradictions.forEach(c => {
                    newInsights.push({
                        id: c.id,
                        type: 'contradiction',
                        severity: c.severity as 'HIGH' | 'MEDIUM' | 'LOW',
                        title: c.title,
                        description: c.description || c.strategy_advice || '',
                        actionLabel: 'פתח חלופה לתמחור'
                    });
                });
            }

            // Pending VOs → инсайты о рисках
            if (pendingVOs) {
                pendingVOs.forEach(vo => {
                    newInsights.push({
                        id: vo.id,
                        type: 'risk',
                        severity: 'MEDIUM',
                        title: `חריג בהמתנה: ${vo.description || 'ללא תיאור'}`,
                        description: `סכום משוער של חריג זה`,
                        amount: Number(vo.total_price_excl_vat) || 0,
                        actionLabel: 'בדוק חריג'
                    });
                });
            }

            setInsights(newInsights);
        } catch (err) {
            console.error('Error fetching AI insights:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
    };

    const getSeverityStyle = (severity: string) => {
        switch (severity) {
            case 'HIGH':
                return {
                    bg: 'bg-critical/15',
                    border: 'border-critical/30',
                    shadow: 'shadow-[0_4px_12px_rgba(255,77,79,0.15)]',
                    accent: 'bg-critical',
                    textColor: 'text-critical',
                    btnBg: 'bg-critical/20 hover:bg-critical/40 border-critical/40'
                };
            case 'MEDIUM':
                return {
                    bg: 'bg-warning/10',
                    border: 'border-warning/20',
                    shadow: 'shadow-[0_4px_12px_rgba(249,115,22,0.1)]',
                    accent: 'bg-warning',
                    textColor: 'text-warning',
                    btnBg: 'bg-warning/20 hover:bg-warning/40 border-warning/40'
                };
            default:
                return {
                    bg: 'bg-primary/10',
                    border: 'border-primary/20',
                    shadow: 'shadow-[0_4px_12px_rgba(59,130,246,0.1)]',
                    accent: 'bg-primary',
                    textColor: 'text-primary',
                    btnBg: 'bg-primary/20 hover:bg-primary/40 border-primary/40'
                };
        }
    };

    const getIcon = (type: string, severity: string) => {
        if (type === 'contradiction') {
            return severity === 'HIGH'
                ? <AlertTriangle className="w-4 h-4" />
                : <AlertCircle className="w-4 h-4" />;
        }
        if (type === 'risk') return <TrendingUp className="w-4 h-4" />;
        return <Zap className="w-4 h-4" />;
    };

    if (!projectId) return null;

    return (
        <div className="relative h-full w-full glass-panel rounded-xl flex flex-col p-6 overflow-hidden animate-in slide-in-from-left duration-300 border-l-4 border-l-primary/50 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
                <h3 className="text-base font-bold text-primary flex items-center gap-3 drop-shadow-md">
                    <Zap className="w-5 h-5" />
                    AI Insights
                </h3>
                <span className="text-xs font-medium text-gray-400 bg-black/30 px-2 py-1 rounded">
                    {isLoading ? 'Scanning...' : `${insights.length} ממצאים`}
                </span>
            </div>

            <div className="flex flex-col gap-5 overflow-y-auto custom-scrollbar pr-2">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        <span className="text-sm text-gray-400">סורק מסמכים...</span>
                    </div>
                ) : insights.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                            <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium text-gray-200 mb-1">הכל תקין</h4>
                            <p className="text-xs text-gray-400">לא אותרו סיכונים או סתירות בפרויקט זה</p>
                        </div>
                    </div>
                ) : (
                    insights.map((insight) => {
                        const style = getSeverityStyle(insight.severity);
                        return (
                            <div
                                key={insight.id}
                                className={`p-5 rounded-lg ${style.bg} border ${style.border} ${style.shadow} flex flex-col gap-3 backdrop-blur-md relative overflow-hidden`}
                            >
                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${style.accent}`}></div>
                                <div className="flex items-center gap-2">
                                    <span className={style.textColor}>{getIcon(insight.type, insight.severity)}</span>
                                    <span className={`text-sm ${style.textColor} font-bold tracking-wide line-clamp-1`}>
                                        {insight.title}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-100 leading-relaxed font-medium line-clamp-3">
                                    {insight.description}
                                    {insight.amount ? (
                                        <span className={`font-bold border-b ${style.border} ml-1`}>
                                            {formatCurrency(insight.amount)}
                                        </span>
                                    ) : null}
                                </p>
                                {insight.actionLabel && (
                                    <button className={`text-sm font-semibold ${style.btnBg} border text-white py-2 px-4 rounded w-fit mt-1 transition-colors shadow-sm flex items-center gap-2`}>
                                        {insight.actionLabel}
                                        <ArrowRight className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
