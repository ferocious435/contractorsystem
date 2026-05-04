"use client";

import React from 'react';
import { Activity, Database, Shield, Zap } from 'lucide-react';
import { VAT_RATE } from '@/utils/constants';

interface PricingStatusBarProps {
    projectId: string;
}

export default function PricingStatusBar({ projectId }: PricingStatusBarProps) {
    return (
        <div className="h-10 bg-[#0B0F14] border-t border-white/5 flex items-center justify-between px-8 shrink-0 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
            
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                    <Activity size={12} className="text-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-mono font-black text-emerald-500 uppercase tracking-[0.2em]">ליבה_פיננסית_פעילה</span>
                </div>
                <div className="h-4 w-px bg-white/5" />
                <div className="flex items-center gap-2">
                    <Database size={12} className="text-gray-600" />
                    <span className="text-[9px] font-mono text-gray-600 font-black uppercase tracking-widest">צומת_פרויקט:</span>
                    <span className="text-[9px] font-mono text-blue-400 font-black uppercase">{projectId.substring(0, 8)}</span>
                </div>
                <div className="h-4 w-px bg-white/5" />
                <div className="flex items-center gap-2">
                    <Shield size={12} className="text-gray-600" />
                    <span className="text-[9px] font-mono text-gray-600 font-black uppercase tracking-widest">מגן_פיננסי:</span>
                    <span className="text-[9px] font-mono text-emerald-500 font-black uppercase tracking-widest">מוגן</span>
                </div>
            </div>

            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-gray-600 font-black uppercase tracking-widest">נעילת_מע&quot;מ:</span>
                    <span className="text-[9px] font-mono text-emerald-500 font-black uppercase tracking-widest">{(VAT_RATE * 100).toFixed(2)}%</span>
                </div>
                <div className="h-4 w-px bg-white/5" />
                <div className="flex items-center gap-2">
                    <Zap size={12} className="text-blue-500" />
                    <span className="text-[9px] font-mono text-gray-600 font-black uppercase tracking-widest">בינה מלאכותית:</span>
                    <span className="text-[9px] font-mono text-blue-400 font-black uppercase tracking-widest">מופעל על ידי Gemini 3 Flash</span>
                </div>
            </div>
        </div>
    );
}
