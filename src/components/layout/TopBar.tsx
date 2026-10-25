"use client";

import { ArrowRight, Code2 } from 'lucide-react';
import { WORKSPACE_VIEW_ROLES, useWorkspaceViewRole, type WorkspaceViewRole } from '@/hooks/useWorkspaceViewRole';

interface TopBarProps {
    title?: string;
    onBack?: () => void;
}

export function TopBar({ title, onBack }: TopBarProps) {
    const [viewRole, setViewRole] = useWorkspaceViewRole();
    return (
        <header className="min-h-16 lg:h-20 flex items-center justify-between gap-3 px-3 sm:px-6 lg:px-10 py-3 lg:py-0 bg-[#0B0F14]/95 backdrop-blur-2xl border-b border-white/5 sticky top-0 z-40" dir="rtl">
            <div className="flex items-center gap-3 sm:gap-6 min-w-0 flex-1">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="flex shrink-0 items-center gap-2 px-3 sm:px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all group border border-white/5"
                        aria-label="חזרה לפרויקטים"
                    >
                        <ArrowRight size={16} className="text-gray-400 group-hover:text-white" />
                        <span className="hidden sm:inline text-[10px] font-mono text-gray-400 group-hover:text-white uppercase tracking-widest font-black">חזרה</span>
                    </button>
                )}
                {title && (
                    <div className="flex min-w-0 flex-col border-r border-white/10 pr-3 sm:pr-6">
                        <div className="flex items-center gap-2 mb-0.5">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                            <span className="text-[8px] sm:text-[9px] font-mono text-gray-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] font-black">פרויקט פעיל</span>
                        </div>
                        <h2 className="truncate text-xs sm:text-sm font-black text-white tracking-tight uppercase font-mono">
                            {title}
                        </h2>
                    </div>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-6">
                {viewRole === 'developer' && (
                    <a href="/local-ai-check" className="hidden sm:flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-gray-300 hover:text-white">
                        <Code2 size={16} />
                        בדיקות פיתוח
                    </a>
                )}
                <label className="flex flex-col gap-1 text-[10px] text-gray-400">
                    תצוגת משתמש
                    <select
                        aria-label="תצוגת משתמש"
                        value={viewRole}
                        onChange={(event) => setViewRole(event.target.value as WorkspaceViewRole)}
                        className="rounded-xl border border-white/10 bg-[#151C24] px-3 py-2 text-xs font-bold text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {WORKSPACE_VIEW_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                </label>
            </div>
        </header>
    );
}
