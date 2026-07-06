"use client";

import React from 'react';
import { Activity, Briefcase, Shield } from 'lucide-react';
import { motion } from 'framer-motion';

interface EstimatorExpertStrategyProps {
    isExpertMode: boolean;
    expertStrategy?: unknown;
    expertTechnical?: string | null;
    expertArgument?: string | null;
    expertDiary?: string | null;
}

function EstimatorExpertStrategy({
    isExpertMode,
    expertStrategy,
    expertTechnical,
    expertArgument,
    expertDiary,
}: EstimatorExpertStrategyProps) {
    if (!isExpertMode || !expertStrategy) {
        return null;
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-10 bg-amber-500/[0.07] border border-amber-500/30 rounded-[3rem] relative shadow-[0_20px_60px_rgba(245,158,11,0.1)] overflow-hidden"
        >
            <div className="absolute top-0 right-0 w-full h-1 bg-gradient-to-l from-amber-500/50 to-transparent" />
            <div className="flex items-center gap-4 mb-8">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 flex items-center justify-center">
                    <Briefcase className="w-5 h-5 text-amber-500" />
                </div>
                <h4 className="text-[11px] font-mono font-black text-amber-500 uppercase tracking-[0.4em]">
                    ביסוס הנדסי-מסחרי
                </h4>
            </div>

            <div className="space-y-6">
                <div className="p-6 bg-black/40 rounded-2xl border border-amber-500/10">
                    <div className="text-[10px] font-mono text-amber-500/60 uppercase mb-2">
                        ביסוס מקצועי:
                    </div>
                    <p className="text-lg font-bold text-amber-100 leading-relaxed pr-4 border-r-4 border-amber-500/40" dir="rtl">
                        {expertTechnical}
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                        <div className="text-[9px] font-mono text-gray-500 uppercase mb-1">
                            טיעון מקצועי:
                        </div>
                        <p className="text-sm text-gray-300">{expertArgument}</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                        <div className="text-[9px] font-mono text-gray-500 uppercase mb-1">
                            הנחיה ליומן עבודה:
                        </div>
                        <p className="text-sm text-gray-300 font-mono italic">&quot;{expertDiary}&quot;</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                        <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center border-2 border-[#0B0F14] z-10">
                            <Activity className="w-4 h-4 text-black" />
                        </div>
                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center border-2 border-[#0B0F14]">
                            <Shield className="w-4 h-4 text-white" />
                        </div>
                    </div>
                    <span className="text-[10px] font-mono text-amber-500/60 font-black uppercase tracking-widest">
                        ניתוח מבוסס עובדות הנדסיות
                    </span>
                </div>
            </div>
        </motion.div>
    );
}

export default React.memo(EstimatorExpertStrategy);
