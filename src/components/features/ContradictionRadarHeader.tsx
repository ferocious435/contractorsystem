import React from 'react';
import { Target, Zap, Download, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ContradictionRadarHeaderProps {
    isScanning: boolean;
    progress: number;
    currentStep: string | null;
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
    contractDocsCount,
    executionDocsCount,
    hasContradictions,
    projectName,
    scanProject,
    onExportPDF
}: ContradictionRadarHeaderProps) {
    return (
        <div className="bg-[#151C24]/50 border border-white/5 rounded-[2.5rem] p-10 relative overflow-hidden" dir="rtl">
            <div className="absolute top-[-100px] left-[-100px] w-64 h-64 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-[-100px] right-[-100px] w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />
            
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
                <div className="flex items-center gap-8">
                    <div className="relative">
                        <div className={`w-20 h-20 rounded-[2rem] border flex items-center justify-center transition-all duration-700 ${
                            isScanning ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_40px_rgba(59,130,246,0.3)]' : 'border-white/10 bg-white/5'
                        }`}>
                            <Target className={`w-10 h-10 ${isScanning ? 'text-blue-400 animate-pulse' : 'text-gray-500'}`} />
                        </div>
                        {isScanning && (
                            <motion.div 
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-[-4px] border-2 border-dashed border-blue-500/30 rounded-[2.2rem]"
                            />
                        )}
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-3 mb-2">
                            <span className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-[10px] font-mono text-blue-400 font-black uppercase tracking-widest">
                                ניתוח בקרה הנדסית
                            </span>
                            <div className="h-px w-8 bg-white/10" />
                            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-black">השוואת חוזה מול ביצוע</span>
                        </div>
                        <h2 className="text-3xl font-black text-white tracking-tighter uppercase font-mono mb-2">ראדאר ממצאים</h2>
                        <p className="text-sm text-gray-400 font-medium max-w-md leading-relaxed">
                            המערכת סורקת מסמכי חוזה ודוחות ביצוע כדי לזהות סטיות, שינויים ואירועי שטח המשפיעים על הפרויקט.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-4 min-w-[320px]">
                    <div className="flex flex-col gap-2 p-4 bg-black/40 border border-white/5 rounded-3xl">
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-mono text-gray-600 uppercase tracking-widest font-black">סנכרון נתונים</span>
                                <span className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">מערכת מאובטחת</span>
                            </div>
                            <div className="flex gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/30" />
                            </div>
                        </div>
                        
                        {isScanning && (
                            <div className="space-y-2 mt-2">
                                <div className="flex justify-between items-center text-[10px] font-bold text-blue-400">
                                    <span>{currentStep}</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                    <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progress}%` }}
                                        className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Status & Controls */}
                <div className="flex flex-wrap items-center justify-between gap-6 p-8 bg-white/[0.03] border-t border-white/10">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                            <span className={`w-2 h-2 rounded-full animate-pulse ${isScanning ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-emerald-500'}`} />
                            <span className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                                {isScanning ? 'סריקה אוטונומית פעילה' : 'המערכת מוכנה לסריקה'}
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 font-medium">
                            {isScanning ? currentStep : `נמצאו ${contractDocsCount} חוזים ו-${executionDocsCount} דוחות ביצוע`}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => scanProject(true)}
                            disabled={isScanning}
                            className={`px-8 py-4 rounded-3xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 flex items-center gap-3 shadow-2xl ${
                                isScanning 
                                ? 'bg-white/5 text-gray-500 cursor-not-allowed border border-white/5' 
                                : 'bg-white text-black hover:bg-blue-50 hover:text-blue-600 hover:shadow-blue-500/20'
                            }`}
                        >
                            <Zap className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                            {isScanning ? 'סריקה...' : 'סריקה מלאה (הכל מול הכל)'}
                        </button>
                         <button 
                            className="flex items-center gap-3 px-6 py-4 bg-white/5 border border-white/10 text-gray-400 rounded-3xl hover:bg-white/10 hover:text-white transition-all active:scale-95 disabled:opacity-30"
                            title={hasContradictions ? 'ייצוא דוח מודיעין PDF' : 'אין ממצאים לייצוא'}
                            disabled={!hasContradictions}
                            onClick={onExportPDF}
                        >
                            <Download className="w-5 h-5" />
                            <span className="text-xs font-black uppercase tracking-widest">הפקת דוח PDF</span>
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
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full"
                    >
                        <Check size={12} className="text-emerald-400" />
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">{currentStep}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
