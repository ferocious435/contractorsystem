"use client";

import { logout } from '@/app/login/actions';
import { User, LogOut, ArrowRight } from 'lucide-react';

interface TopBarProps {
    title?: string;
    onBack?: () => void;
}

export function TopBar({ title, onBack }: TopBarProps) {
    return (
        <header className="h-20 flex items-center justify-between px-10 bg-[#0B0F14]/90 backdrop-blur-2xl border-b border-white/5 sticky top-0 z-40" dir="rtl">
            <div className="flex items-center gap-6">
                {onBack && (
                    <button 
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all group border border-white/5"
                    >
                        <ArrowRight size={16} className="text-gray-400 group-hover:text-white" />
                        <span className="text-[10px] font-mono text-gray-400 group-hover:text-white uppercase tracking-widest font-black">חזרה לפרויקטים</span>
                    </button>
                )}
                {title && (
                    <div className="flex flex-col border-r border-white/10 pr-6">
                        <div className="flex items-center gap-2 mb-0.5">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-[0.3em] font-black">פרויקט פעיל</span>
                        </div>
                        <h2 className="text-sm font-black text-white tracking-tight uppercase font-mono">
                            {title}
                        </h2>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-6">
                <div className="flex items-center gap-4 pr-2 group cursor-pointer">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center group-hover:border-blue-500/50 transition-all">
                            <User size={20} className="text-gray-300" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#0B0F14]" />
                    </div>
                    <div className="hidden md:flex flex-col">
                        <span className="text-[11px] font-black text-gray-100 leading-none uppercase tracking-widest mb-1 group-hover:text-blue-400 transition-colors">מנהל מערכת</span>
                        <span className="text-[8px] font-mono text-gray-500 uppercase leading-none tracking-[0.2em]">גישה: אלפא</span>
                    </div>
                </div>

                <button 
                    type="button"
                    onClick={async () => {
                        await logout();
                        window.location.href = '/login';
                    }}
                    className="group flex items-center gap-3 px-5 py-2.5 bg-red-500/5 border border-red-500/10 rounded-2xl hover:bg-red-500 hover:border-red-500 transition-all duration-300"
                >
                    <span className="text-[10px] font-black text-red-500 group-hover:text-white transition-colors uppercase tracking-[0.2em]">התנתק</span>
                    <LogOut size={14} className="text-red-500 group-hover:text-white transition-colors" />
                </button>
            </div>
        </header>
    );
}
