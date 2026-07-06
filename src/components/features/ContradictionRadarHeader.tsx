import React from 'react';
import { Target, Zap, Download, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ContradictionRadarHeaderProps {
    isScanning: boolean;
    progress: number;
    currentStep: string | null;
    currentStepStatus?: 'success' | 'error' | null;
    contractDocsCount: number;
    executionDocsCount: number;
    hasContradictions: boolean;
    projectName: string;
    scanProject: (force: boolean) => void;
    onExportPDF: () => void;
}

export default function ContradictionRadarHeader({
    isScanning,
    progress,
    currentStep,
    currentStepStatus,
    contractDocsCount,
    executionDocsCount,
    hasContradictions,
    projectName,
    scanProject,
    onExportPDF,
}: ContradictionRadarHeaderProps) {
    const isResultSuccess = currentStepStatus === 'success';

    return (
        <div className="bg-[#151C24]/55 border border-white/5 rounded-[2.5rem] p-8 md:p-10 relative overflow-hidden" dir="rtl">
            <div className="absolute top-[-100px] left-[-100px] w-64 h-64 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-[-100px] right-[-100px] w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />

            <div className="relative z-10 flex flex-col gap-8">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                    <div className="flex items-start gap-6">
                        <div className={`w-18 h-18 min-w-18 rounded-[1.75rem] border flex items-center justify-center transition-all duration-700 ${
                            isScanning ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_40px_rgba(59,130,246,0.3)]' : 'border-white/10 bg-white/5'
                        }`}>
                            <Target className={`w-9 h-9 ${isScanning ? 'text-blue-400 animate-pulse' : 'text-gray-400'}`} />
                        </div>

                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-300 font-bold">
                                    רדאר סתירות
                                </span>
                                <span className="text-sm text-gray-500">הפרויקט: {projectName}</span>
                            </div>
                            <h2 className="text-3xl md:text-4xl font-black text-white leading-tight">
                                בדיקת פערים בין החוזה לביצוע
                            </h2>
                            <p className="text-base text-gray-300 max-w-2xl leading-8">
                                המערכת בודקת מה לא מסתדר בין מסמכי החוזה, המפרט והשטח, כדי לעזור לקבלן להבין מה דורש טיפול, תיעוד או דרישה מסחרית.
                            </p>
                        </div>
                    </div>

                    <div className="min-w-[280px] bg-black/35 border border-white/5 rounded-3xl p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-xs text-gray-500 font-bold">מצב הבדיקה</div>
                                <div className="text-sm text-white font-bold mt-1">
                                    {isScanning ? 'המערכת סורקת עכשיו מסמכים' : 'המערכת מוכנה לבדיקה'}
                                </div>
                            </div>
                            <div className={`w-3 h-3 rounded-full ${isScanning ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-emerald-500'}`} />
                        </div>

                        <div className="mt-4 text-sm text-gray-400">
                            {isScanning ? currentStep : `נמצאו ${contractDocsCount} מסמכים חוזיים ו-${executionDocsCount} מסמכי ביצוע`}
                        </div>

                        {isScanning && (
                            <div className="mt-4 space-y-2">
                                <div className="flex justify-between text-sm text-blue-300 font-bold">
                                    <span>{currentStep}</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progress}%` }}
                                        className="h-full bg-blue-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 p-6 bg-white/[0.03] border border-white/5 rounded-[2rem]">
                    <div>
                        <div className="text-sm font-bold text-white">
                            {isScanning ? 'הבדיקה רצה עכשיו' : 'אפשר להריץ בדיקה חדשה או לייצא דוח'}
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                            בדיקה חכמה משתמשת בתוצאות הקיימות וסורקת רק מה שבאמת צריך.
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={() => scanProject(false)}
                            disabled={isScanning}
                            className={`px-7 py-4 rounded-2xl font-black text-sm transition-all active:scale-95 flex items-center gap-3 ${
                                isScanning
                                    ? 'bg-white/5 text-gray-500 cursor-not-allowed border border-white/5'
                                    : 'bg-white text-black hover:bg-blue-50 hover:text-blue-600'
                            }`}
                        >
                            <Zap className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                            {isScanning ? 'הבדיקה פועלת...' : 'בדיקה חכמה'}
                        </button>

                        <button
                            className="flex items-center gap-3 px-6 py-4 bg-white/5 border border-white/10 text-gray-300 rounded-2xl hover:bg-white/10 hover:text-white transition-all active:scale-95 disabled:opacity-30"
                            disabled={!hasContradictions}
                            onClick={onExportPDF}
                        >
                            <Download className="w-5 h-5" />
                            <span className="text-sm font-bold">ייצוא דוח PDF</span>
                        </button>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {currentStep && !isScanning && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-2 rounded-full ${
                            isResultSuccess
                                ? 'bg-emerald-500/10 border border-emerald-500/20'
                                : 'bg-red-500/10 border border-red-500/20'
                        }`}
                    >
                        <Check size={12} className={isResultSuccess ? 'text-emerald-400' : 'text-red-400'} />
                        <span className={`text-xs font-bold ${isResultSuccess ? 'text-emerald-400' : 'text-red-400'}`}>{currentStep}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
