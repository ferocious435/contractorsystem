"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

function NavItem({ icon, label, badge, active, onClick, disabled }: { icon: string, label: string, badge?: number, active?: boolean, onClick?: () => void, disabled?: boolean }) {
    return (
        <div
            onClick={disabled ? undefined : onClick}
            className={`flex items-center gap-3 p-2.5 rounded cursor-pointer transition-all duration-200 ${disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : active
                        ? 'bg-primary/10 border border-primary/30 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                        : 'hover:bg-workspace hover:border hover:border-border-subtle border border-transparent'
                }`}
        >
            <span className="text-lg w-6 text-center">{icon}</span>
            <span className={`text-sm font-medium tracking-wide ${active ? 'text-white font-bold' : disabled ? 'text-gray-600' : 'text-gray-300'}`}>
                {label}
            </span>
            {badge !== undefined && badge > 0 && (
                <span className="mr-auto bg-critical text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">
                    {badge}
                </span>
            )}
            {disabled && (
                <span className="mr-auto text-[9px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">בקרוב</span>
            )}
        </div>
    );
}

export function Sidebar({ currentView = 'לוח בקרה', onNavigate, projectId }: { currentView?: string, onNavigate?: (view: string) => void, projectId?: string | null }) {
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

        // Subscribe to real-time updates for contradictions
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
        <aside className="w-64 bg-secondary border-l border-border-subtle flex flex-col items-center justify-start p-5 shadow-[4px_0_24px_rgba(0,0,0,0.6)] z-10 relative overflow-y-auto custom-scrollbar">
            <h1 className="text-2xl font-bold tracking-wider text-primary mb-8 drop-shadow-md cursor-pointer hover:opacity-80 transition-opacity w-full text-center">
                קבלן<span className="text-white">PRO</span>
            </h1>

            <nav className="w-full flex inset-0 flex-col gap-0 flex-1">
                {/* ===== ZONE 1: Base — מסמכים ובקרה ===== */}
                <div className="mb-5">
                    <h3 className="text-[11px] font-bold text-gray-400 mb-2 px-2 uppercase tracking-wider relative after:content-[''] after:absolute after:bottom-[-4px] after:right-2 after:w-8 after:h-[1px] after:bg-gray-600">
                        📦 מסמכים ובקרה
                    </h3>
                    <div className="flex flex-col gap-1 mt-3">
                        <NavItem icon="📊" label="לוח בקרה" active={currentView === 'לוח בקרה'} onClick={() => handleNav('לוח בקרה')} />
                        <NavItem icon="📋" label="מסמכי חוזה" active={currentView === 'מסמכי חוזה'} onClick={() => handleNav('מסמכי חוזה')} />
                        <NavItem icon="📄" label="מסמכי עבודה" active={currentView === 'מסמכי עבודה'} onClick={() => handleNav('מסמכי עבודה')} />
                        <NavItem icon="⚖️" label="בקרת סתירות" badge={openContradictionsCount} active={currentView === 'בקרת סתירות'} onClick={() => handleNav('בקרת סתירות')} />
                    </div>
                </div>

                {/* ===== ZONE 2: Pro — כלים מסחריים ===== */}
                <div className="mb-5">
                    <h3 className="text-[11px] font-bold text-gray-400 mb-2 px-2 uppercase tracking-wider relative after:content-[''] after:absolute after:bottom-[-4px] after:right-2 after:w-8 after:h-[1px] after:bg-gray-600">
                        💎 כלים מסחריים
                    </h3>
                    <div className="flex flex-col gap-1 mt-3">
                        <NavItem icon="💰" label="תמחור" active={currentView === 'תמחור'} onClick={() => handleNav('תמחור')} />
                        <NavItem icon="📚" label="מחירונים" active={currentView === 'מחירונים'} onClick={() => handleNav('מחירונים')} />
                        <NavItem icon="✉️" label="מחולל מכתבים" active={currentView === 'מחולל מכתבים'} onClick={() => handleNav('מחולל מכתבים')} />
                        <NavItem icon="🤖" label="יועץ AI" active={currentView === 'יועץ AI'} onClick={() => handleNav('יועץ AI')} />
                    </div>
                </div>
            </nav>

            <div className="w-full mt-auto pt-4 border-t border-border-subtle">
                <NavItem icon="⚙️" label="הגדרות" active={currentView === 'הגדרות'} onClick={() => handleNav('הגדרות')} />
            </div>
        </aside>
    );
}
