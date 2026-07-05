"use client";

import React from 'react';
import { Brain } from 'lucide-react';
import { motion } from 'framer-motion';

interface EstimatorLoadingStateProps {
    isExpertMode: boolean;
    themeHex: string;
}

function EstimatorLoadingState({ isExpertMode, themeHex }: EstimatorLoadingStateProps) {
    const accentBorder = isExpertMode ? 'border-amber-500/10' : 'border-emerald-500/10';
    const accentSpin = isExpertMode ? 'border-amber-500' : 'border-emerald-500';
    const accentText = isExpertMode ? 'text-amber-500' : 'text-emerald-500';

    return (
        <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center py-24"
        >
            <div className="relative w-32 h-32 mb-12">
                <div className={`absolute inset-0 border-[3px] ${accentBorder} rounded-full`} />
                <div className={`absolute inset-0 border-t-[3px] ${accentSpin} rounded-full animate-spin shadow-[0_0_20px_${themeHex}]`} />
                <Brain className={`absolute inset-0 m-auto w-10 h-10 ${accentText} animate-pulse`} />
            </div>
            <div className="flex flex-col items-center gap-4">
                <span className={`text-sm font-mono font-black ${accentText} uppercase tracking-[0.5em] animate-pulse`}>
                    מבצע ניתוח מעמיק
                </span>
            </div>
        </motion.div>
    );
}

export default React.memo(EstimatorLoadingState);
