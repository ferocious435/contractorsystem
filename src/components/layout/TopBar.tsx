"use client";

import { logout } from '@/app/login/actions';
import { Activity, LogOut, ShieldCheck, User, Search, Bell, Command, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface TopBarProps {
    title?: string;
}

export function TopBar({ title }: TopBarProps) {
    return (
        <header className="h-20 flex items-center justify-between px-10 bg-[#0B0F14]/90 backdrop-blur-2xl border-b border-white/5 sticky top-0 z-40">
            <div className="flex items-center gap-10">
                {title && (
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-0.5">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-[0.3em] font-black">פרויקט פעיל</span>
                        </div>
                        <h2 className="text-sm font-black text-white tracking-tight uppercase font-mono">
                            {title}
                        </h2>
                    </div>
                )}
                
                <div className="hidden lg:flex items-center gap-3 px-4 py-2 bg-white/[0.03] border border-white/5 rounded-2xl group focus-within:border-blue-500/50 transition-all w-80">
                    <Search size={14} className="text-gray-500 group-hover:text-blue-400 transition-colors" />
                    <input 
                        type="text" 
                        placeholder="חיפוש במערכת..." 
                        className="bg-transparent border-none outline-none text-[11px] font-mono font-black text-gray-300 placeholder:text-gray-600 w-full uppercase tracking-widest"
                    />
                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-black/40 border border-white/10 rounded-md">
                        <Command size={8} className="text-gray-500" />
                        <span className="text-[8px] font-mono text-gray-500 font-black">K</span>
                    </div>
                </div>

                <div className="hidden xl:flex items-center gap-3 px-4 py-2 bg-emerald-500/[0.03] border border-emerald-500/10 rounded-2xl">
                    <div className="relative">
                        <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-20" />
                        <Activity size={12} className="text-emerald-500 relative z-10" />
                    </div>
                    <span className="text-[10px] font-mono font-black text-emerald-500 uppercase tracking-widest">מערכת מסונכרנת</span>
                </div>
            </div>

            <div className="flex items-center gap-8">
                {/* Global Metrics */}
                <div className="hidden md:flex items-center gap-6">
                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">ניתוח סיכונים</span>
                            <ShieldCheck size={12} className="text-amber-500/70" />
                        </div>
                        <span className="text-[11px] font-black text-amber-500 uppercase tracking-tighter">סיכון בינוני</span>
                    </div>

                    <div className="h-10 w-[1px] bg-white/5" />

                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">עומס מערכת</span>
                            <Zap size={12} className="text-blue-400/70" />
                        </div>
                        <span className="text-[11px] font-black text-blue-400 uppercase tracking-tighter">אופטימלי</span>
                    </div>
                </div>

                <div className="h-10 w-[1px] bg-white/5 mx-2" />

                {/* User & Actions */}
                <div className="flex items-center gap-6">
                    <button className="relative p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-gray-500 hover:text-white hover:bg-white/10 transition-all">
                        <Bell size={18} />
                        <div className="absolute top-2 right-2 w-2 h-2 bg-red-600 rounded-full border-2 border-[#0B0F14]" />
                    </button>

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
            </div>
        </header>
    );
}
