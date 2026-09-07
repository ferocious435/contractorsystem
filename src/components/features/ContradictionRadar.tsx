import { Activity, Shield, Zap, ArrowRight } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import ContradictionRadarHeader from './ContradictionRadarHeader';
import ContradictionRadarFeedItem from './ContradictionRadarFeedItem';
import { useContradictionRadarState } from './contradiction-radar/hooks/useContradictionRadarState';

interface ContradictionRadarProps {
    projectId: string;
    projectName?: string;
    onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}

export default function ContradictionRadar({ projectId, projectName, onNavigate }: ContradictionRadarProps) {
    const { state, actions, derived } = useContradictionRadarState({ projectId, projectName });
    const {
        currentStep,
        currentStepStatus,
        expandedId,
        isLoading,
        isScanning,
        progress,
        rescanningIds,
        resolvedProjectName,
        activeFilter,
        activeStatusFilter,
        aiAvailable,
    } = state;
    const {
        deleteContradiction,
        handleExportPDF,
        handleFilterChange,
        handleStatusFilterChange,
        radarOpenDocument,
        rescanItem,
        scanProject,
        toggleExpanded,
        updateStatus,
    } = actions;

    const getFilterButtonClass = (tone: string, isActive: boolean) => {
        const activeToneClasses: Record<string, string> = {
            red: 'bg-red-500/15 border-red-500/35 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.12)]',
            blue: 'bg-blue-500/15 border-blue-500/35 text-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.12)]',
            emerald: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.12)]',
            amber: 'bg-amber-500/15 border-amber-500/35 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.12)]',
            slate: 'bg-slate-500/15 border-slate-500/35 text-slate-200',
            neutral: 'bg-white/10 border-white/20 text-white',
        };

        if (isActive) {
            return activeToneClasses[tone] || activeToneClasses.neutral;
        }

        return 'bg-white/[0.03] border-white/10 text-gray-400 hover:bg-white/[0.07] hover:text-white';
    };

    return (
        <div className="flex flex-col gap-10 p-2" dir="rtl">
            {onNavigate && (
                <div className="flex items-center -mb-6">
                    <button
                        onClick={() => onNavigate('projects')}
                        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
                    >
                        <ArrowRight className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        <span className="text-sm font-bold">חזרה לרשימת פרויקטים</span>
                    </button>
                </div>
            )}

            <ContradictionRadarHeader
                isScanning={isScanning}
                progress={progress}
                currentStep={currentStep}
                currentStepStatus={currentStepStatus}
                contractDocsCount={derived.contractDocsCount}
                executionDocsCount={derived.executionDocsCount}
                hasContradictions={derived.hasContradictions}
                aiAvailable={aiAvailable}
                projectName={resolvedProjectName}
                scanProject={scanProject}
                onExportPDF={handleExportPDF}
            />

            <div className="flex flex-col gap-6">
                <div className="flex items-center gap-2 flex-wrap" aria-label="מצב ממצאים">
                    {derived.statusFilterOptions.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => handleStatusFilterChange(option.id)}
                            className={`px-4 py-2 border rounded-xl text-sm font-bold transition-all active:scale-95 ${activeStatusFilter === option.id
                                ? 'bg-blue-500/15 border-blue-500/35 text-blue-300'
                                : 'bg-white/[0.03] border-white/10 text-gray-400 hover:bg-white/[0.07] hover:text-white'
                            }`}
                            aria-pressed={activeStatusFilter === option.id}
                        >
                            {option.label} ({option.count})
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <h3 className="text-2xl font-black text-white">ממצאים מול מסמכי הביצוע</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                        {derived.filterOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => handleFilterChange(option.id)}
                                className={`px-3 py-1.5 border rounded-lg text-xs font-bold transition-all active:scale-95 ${getFilterButtonClass(option.tone, activeFilter === option.id)}`}
                                aria-pressed={activeFilter === option.id}
                            >
                                {option.count} {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-28 gap-5 opacity-30">
                        <div className="p-8 border-2 border-dashed border-white/10 rounded-[2.5rem]">
                            <Activity size={42} className="text-white animate-spin" />
                        </div>
                        <span className="text-sm text-gray-500 font-bold">טוען ממצאים מהמערכת...</span>
                    </div>
                ) : !derived.hasContradictions ? (
                    <div className="bg-[#151C24]/30 border border-dashed border-white/5 rounded-[2.5rem] py-24 flex flex-col items-center gap-5">
                        <div className="p-8 bg-white/[0.02] rounded-full">
                            <Shield className="w-12 h-12 text-gray-700" />
                        </div>
                        <div className="flex flex-col items-center gap-2 text-center px-6">
                            <span className="text-xl font-black text-gray-300">לא נמצאו כרגע סתירות פתוחות</span>
                            <span className="text-sm text-gray-500 max-w-xl">אם נוספו מסמכים חדשים, כדאי להריץ שוב בדיקה כדי לראות אם עלו פערים חדשים בין החוזה לביצוע.</span>
                        </div>
                    </div>
                ) : !derived.hasFilteredFindings ? (
                    <div className="bg-[#151C24]/30 border border-dashed border-white/5 rounded-[2.5rem] py-20 flex flex-col items-center gap-4">
                        <div className="p-6 bg-white/[0.02] rounded-full">
                            <Shield className="w-10 h-10 text-gray-700" />
                        </div>
                        <div className="flex flex-col items-center gap-2 text-center px-6">
                            <span className="text-lg font-black text-gray-300">אין ממצאים בסינון הזה</span>
                            <button
                                type="button"
                                onClick={() => handleFilterChange('ALL')}
                                className="mt-2 px-4 py-2 bg-white/[0.05] border border-white/10 rounded-xl text-sm font-bold text-gray-300 hover:text-white hover:bg-white/10 transition-all"
                            >
                                הצג את כל הממצאים
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        <AnimatePresence mode="popLayout">
                            {derived.filteredFindings.map((finding, idx) => (
                                <ContradictionRadarFeedItem
                                    key={finding.id}
                                    item={finding}
                                    idx={idx}
                                    isExpanded={expandedId === finding.id}
                                    isItemRescanning={rescanningIds.has(finding.id)}
                                    isScanning={isScanning}
                                    aiAvailable={aiAvailable === true}
                                    shouldAnimate={derived.shouldAnimateItems}
                                    onToggleExpand={toggleExpanded}
                                    onRescanItem={rescanItem}
                                    onUpdateStatus={updateStatus}
                                    onDelete={deleteContradiction}
                                    onNavigate={onNavigate}
                                    onRadarOpenDocument={radarOpenDocument}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            <div className="pt-8 pb-4 flex flex-col items-center gap-3 border-t border-white/5">
                <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
                    <span className="text-sm text-gray-400 font-bold">בדיקת פערים בין החוזה לביצוע</span>
                </div>
                <p className="text-sm text-gray-500 text-center max-w-2xl leading-relaxed">
                    המערכת נועדה לעזור לקבלן להבין מה לא מסתדר, למה זה חשוב, ואיזה צעד כדאי לעשות עכשיו כדי לשמור על זמן, כסף ותיעוד.
                </p>
            </div>
        </div>
    );
}
