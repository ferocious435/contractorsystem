"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { 
    LayoutDashboard, 
    FileText, 
    ClipboardList, 
    AlertTriangle, 
    CircleDollarSign, 
    BookOpen, 
    Mail, 
    Cpu, 
    Settings,
    ChevronLeft,
    Shield,
    Zap,
    Box
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AI_MODEL_BRANDING } from '@/utils/constants';

function NavItem({ icon: Icon, label, badge, active, onClick, disabled }: { icon: any, label: string, badge?: number, active?: boolean, onClick?: () => void, disabled?: boolean }) {
    return (
        <motion.div
            whileHover={disabled ? {} : { x: -4 }}
            onClick={disabled ? undefined : onClick}
            className={`group flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-all relative overflow-hidden mb-1 mx-3 rounded-2xl ${disabled
                    ? 'opacity-30 cursor-not-allowed'
                    : active
                        ? 'bg-blue-500/[0.08] text-blue-400 border border-blue-500/20'
                        : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.03] border border-transparent hover:border-white/5'
                }`}
        >
            {active && (
                <motion.div 
                    layoutId="activeNav"
                    className="absolute right-0 top-0 w-1.5 h-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] rounded-l-full"
                />
            )}
            
            <Icon size={18} className={`transition-colors ${active ? 'text-blue-400' : 'group-hover:text-white'}`} />
            
            <span className={`text-[11px] font-black tracking-[0.1em] uppercase font-mono ${active ? 'text-blue-400' : ''}`}>
                {label}
            </span>

            {badge !== undefined && badge > 0 && (
                <span className="mr-auto bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_15px_rgba(220,38,38,0.4)] animate-pulse">
                    {badge}
                </span>
            )}
            
            {disabled && (
                <span className="mr-auto text-[8px] font-mono text-gray-600 border border-white/10 px-1.5 py-0.5 rounded-md uppercase font-black tracking-widest">בפיתוח</span>
            )}
        </motion.div>
    );
}

export function Sidebar({ currentView = 'dashboard', onNavigate, projectId }: { currentView?: string, onNavigate?: (view: string) => void, projectId?: string | null }) {
    const [openContradictionsCount, setOpenContradictionsCount] = useState(0);

    useEffect(() => {
        if (!projectId) {
            setOpenContradictionsCount(0);
            return;
        }

        const supabase = createClient();

        const fetchCount = async () => {
            const { count } = await supabase
                .from('contradictions')
                .select('id', { count: 'exact', head: true })
                .eq('project_id', projectId)
                .eq('status', 'OPEN')
                .eq('severity', 'HIGH');

            setOpenContradictionsCount(count || 0);
        };

        fetchCount();

        const channel = supabase.channel('sidebar-contradictions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'contradictions', filter: `project_id=eq.${projectId}` }, () => {
                fetchCount();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [projectId]);

    const handleNav = (view: string) => {
        if (onNavigate) onNavigate(view);
    };

    return (
        <aside className="w-72 bg-[#0B0F14] border-l border-white/5 flex flex-col z-30 relative shadow-[20px_0_50px_rgba(0,0,0,0.5)] h-screen overflow-hidden">
            {/* Logo Area */}
            <div className="p-10 border-b border-white/5 relative group">
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
                    <h1 className="text-lg font-black tracking-[0.25em] text-white uppercase font-mono">
                        מערכת קבלן
                    </h1>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-gray-500 font-black uppercase tracking-[0.3em]">ניהול חוזים מתקדם</span>
                    <span className="text-[9px] font-mono text-blue-500/50 font-black tracking-widest">מערכת מאובטחת</span>
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto custom-scrollbar py-8 px-2">
                {/* Section 1 */}
                <div className="mb-10">
                    <div className="px-8 mb-4 flex items-center justify-between">
                        <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.4em] font-mono">בקרה וניהול</span>
                        <div className="h-[1px] flex-1 bg-white/5 mr-4" />
                    </div>
                    <div className="flex flex-col">
                        <NavItem icon={LayoutDashboard} label="לוח בקרה" active={currentView === 'dashboard'} onClick={() => handleNav('dashboard')} />
                        <NavItem icon={FileText} label="מסמכי חוזה" active={currentView === 'contracts'} onClick={() => handleNav('contracts')} />
                        <NavItem icon={ClipboardList} label="ביצוע ושטח" active={currentView === 'execution'} onClick={() => handleNav('execution')} />
                        <NavItem icon={AlertTriangle} label='מכ"ם סתירות' badge={openContradictionsCount} active={currentView === 'radar'} onClick={() => handleNav('radar')} />
                    </div>
                </div>

                {/* Section 2 */}
                <div className="mb-10">
                    <div className="px-8 mb-4 flex items-center justify-between">
                        <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.4em] font-mono">מסחר וכספים</span>
                        <div className="h-[1px] flex-1 bg-white/5 mr-4" />
                    </div>
                    <div className="flex flex-col">
                        <NavItem icon={CircleDollarSign} label="תמחור חריגים" active={currentView === 'pricing'} onClick={() => handleNav('pricing')} />
                        <NavItem icon={BookOpen} label="מחירונים" active={currentView === 'pricelists'} onClick={() => handleNav('pricelists')} />
                        <NavItem icon={Mail} label="מחולל מכתבים" active={currentView === 'letters'} onClick={() => handleNav('letters')} />
                        <NavItem icon={Cpu} label="יועץ בינה מלאכותית" active={currentView === 'consultant'} onClick={() => handleNav('consultant')} />
                    </div>
                </div>
            </nav>

            {/* Bottom Section: System Intelligence */}
            <div className="p-6 border-t border-white/5 bg-black/40 backdrop-blur-xl">
                <NavItem icon={Settings} label="הגדרות מערכת" active={currentView === 'settings'} onClick={() => handleNav('settings')} />
                
                <motion.div 
                    whileHover={{ scale: 1.02 }}
                    className="mt-6 p-5 bg-[#151C24] border border-white/10 rounded-[1.5rem] relative overflow-hidden group shadow-2xl"
                >
                    <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Box className="w-12 h-12 text-blue-400" />
                    </div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Zap className="w-3 h-3 text-blue-400" />
                            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest font-black">ליבת בינה מלאכותית</span>
                        </div>
                        <div className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-md">
                            <span className="text-[8px] font-mono text-blue-500 font-black uppercase">פעיל</span>
                        </div>
                    </div>
                    <p className="text-[11px] font-mono text-gray-300 font-black uppercase tracking-widest text-right">Powered by {AI_MODEL_BRANDING}</p>
                    <div className="mt-2 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                            initial={{ x: '-100%' }}
                            animate={{ x: '100%' }}
                            transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                            className="h-full w-1/3 bg-gradient-to-r from-transparent via-blue-500 to-transparent"
                        />
                    </div>
                </motion.div>
            </div>
        </aside>
    );
}
