"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
    MoreVertical, Trash2, Edit2, Plus, LayoutDashboard, 
    FileText, Search, Settings, ArrowRight, Activity, 
    Shield, Target, Zap, Layers, Loader2, Calendar, 
    User, Briefcase, ChevronRight, Sparkles, Building2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Sidebar } from "../layout/Sidebar";
import { TopBar } from "../layout/TopBar";
import ContradictionRadar from './ContradictionRadar';
import PricingLedgerUI from './PricingLedgerUI';
import AIConsultant from './AIConsultant';
import SmartLetterGenerator from './SmartLetterGenerator';
import DocumentsPageClient from '../documents/DocumentsPageClient';
import PricelistsPageClient from '../pricelists/PricelistsPageClient';
import SettingsView from './SettingsView';
import { KPIStrip } from "./KPIStrip";
import ProjectOverview from "./ProjectOverview";

const PROJECT_IMAGES = [
    'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1531834685032-c34bf0d84c77?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1590496739818-a681a298a09f?q=80&w=600&auto=format&fit=crop'
];

const getProjectImage = (proj: any) => {
    if (proj.image_index !== undefined && proj.image_index !== null) {
        return PROJECT_IMAGES[proj.image_index % PROJECT_IMAGES.length];
    }
    const idStr = proj.id || '';
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    return PROJECT_IMAGES[Math.abs(hash) % PROJECT_IMAGES.length];
};

export default function DashboardContent() {
    const [projectId, setProjectId] = useState<string | null>(null);
    const [projects, setProjects] = useState<any[]>([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [currentView, setCurrentView] = useState('dashboard');
    const [viewParams, setViewParams] = useState<any>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [editingProject, setEditingProject] = useState<any | null>(null);
    const [editForm, setEditForm] = useState({ name: '', client_name: '', budget: 0 });
    const [isSavingProject, setIsSavingProject] = useState(false);

    const handleNavigate = (view: string, params: any = null) => {
        console.log(`[Dashboard] Navigating to: ${view}`, params);
        setCurrentView(view);
        setViewParams(params);
    };

    const supabase = createClient();

    useEffect(() => {
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        setIsLoadingProjects(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setIsLoadingProjects(false);
                return;
            }

            let { data: projectsList, error } = await supabase
                .from('projects')
                .select('*')
                .eq('contractor_id', user.id)
                .order('created_at', { ascending: false });

            if (error) console.error("Error fetching projects:", error);
            if (projectsList) setProjects(projectsList || []);
        } catch (error) {
            console.error("Error in fetchProjects:", error);
        } finally {
            setIsLoadingProjects(false);
        }
    };

    const handleCreateProject = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const newProjectName = `פרויקט_${Math.floor(Math.random() * 1000)}`;
        const randomImageIndex = Math.floor(Math.random() * 100);
        const { data: newProject, error } = await supabase.from('projects').insert({
            name: newProjectName,
            contractor_id: user.id,
            status: 'ACTIVE',
            image_index: randomImageIndex
        }).select().single();

        if (error) return;
        if (newProject) setProjects([newProject, ...projects]);
    };

    const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('האם אתה בטוח שברצונך למחוק פרויקט זה? כל הנתונים יאבדו.')) return;
        const { error } = await supabase.from('projects').delete().eq('id', id);
        if (!error) setProjects(projects.filter(p => p.id !== id));
        setOpenMenuId(null);
    };

    const handleNav = (view: string) => {
        console.log(`[Dashboard] Switching to view: ${view}`);
        setCurrentView(view);
    };

    const handleEditClick = (proj: any, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingProject(proj);
        setEditForm({ name: proj.name, client_name: proj.client_name || '', budget: proj.budget || 0 });
        setOpenMenuId(null);
    };

    const handleSaveProject = async () => {
        if (!editingProject) return;
        setIsSavingProject(true);
        try {
            const { error } = await supabase
                .from('projects')
                .update({
                    name: editForm.name,
                    client_name: editForm.client_name,
                    budget: editForm.budget
                })
                .eq('id', editingProject.id);

            if (!error) {
                setProjects(projects.map(p => p.id === editingProject.id ? { ...p, ...editForm } : p));
                setEditingProject(null);
            }
        } finally {
            setIsSavingProject(false);
        }
    };

    const activeProject = projects.find(p => p.id === projectId);

    // --- VIEW: Project List (Home) ---
    if (!projectId) {
        return (
            <div className="flex h-screen w-full bg-[#0B0F14] text-white overflow-hidden" dir="rtl">
                <main className="flex-1 flex flex-col relative overflow-hidden">
                    <TopBar title="ניהול מערכת" />
                    
                    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar space-y-12">
                        {/* Hero Section */}
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-[#151C24]/50 border border-white/5 rounded-[3rem] p-12 relative overflow-hidden group"
                        >
                            <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-500/10 to-transparent pointer-events-none" />
                            <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px]" />
                            
                            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                                        <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-[0.3em]">בקרת תשתית מתקדמת</span>
                                    </div>
                                    <h2 className="text-4xl font-black text-white tracking-tighter uppercase font-mono">
                                        הפרויקטים שלי
                                    </h2>
                                    <p className="text-gray-500 text-sm font-medium max-w-lg leading-relaxed text-right">
                                        ניהול מתקדם של תשתיות בנייה וחוזים. המערכת סורקת ומנטרת את כל הפעילות המסחרית שלך בזמן אמת.
                                    </p>
                                </div>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={handleCreateProject}
                                    className="bg-white text-black px-10 py-4 rounded-[1.5rem] font-black text-[11px] uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(255,255,255,0.1)] hover:bg-blue-500 hover:text-white transition-all flex items-center gap-3 group/btn"
                                >
                                    <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform" />
                                    צור פרויקט חדש
                                </motion.button>
                            </div>
                        </motion.div>

                        {/* Projects Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                            <AnimatePresence mode="popLayout">
                                {isLoadingProjects ? (
                                    Array(4).fill(0).map((_, i) => (
                                        <div key={i} className="h-80 bg-white/5 animate-pulse rounded-[2.5rem] border border-white/5" />
                                    ))
                                ) : projects.map((proj, idx) => (
                                    <motion.div 
                                        key={proj.id}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: idx * 0.05 }}
                                        onClick={() => setProjectId(proj.id)}
                                        className="group relative h-[420px] bg-[#151C24]/50 border border-white/5 rounded-[2.5rem] overflow-hidden cursor-pointer hover:bg-white/[0.03] transition-all hover:shadow-[0_30px_60px_rgba(0,0,0,0.5)] hover:-translate-y-2"
                                    >
                                        {/* Project Image Background */}
                                        <div className="absolute inset-0 z-0">
                                            <img 
                                                src={getProjectImage(proj)} 
                                                alt={proj.name}
                                                className="w-full h-full object-cover opacity-20 grayscale group-hover:grayscale-0 group-hover:scale-110 transition-all duration-700 brightness-50"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F14] via-[#0B0F14]/60 to-transparent" />
                                        </div>

                                        {/* Status Tag */}
                                        <div className="absolute top-6 left-6 z-10">
                                            <div className="px-3 py-1 bg-black/60 backdrop-blur-md border border-white/10 rounded-full flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                                                <span className="text-[9px] font-mono font-black text-gray-300 uppercase tracking-widest">פרויקט פעיל</span>
                                            </div>
                                        </div>

                                        {/* Actions Menu */}
                                        <div className="absolute top-6 right-6 z-20">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === proj.id ? null : proj.id); }}
                                                className="p-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
                                            >
                                                <MoreVertical size={16} />
                                            </button>
                                            <AnimatePresence>
                                                {openMenuId === proj.id && (
                                                    <motion.div 
                                                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                                        className="absolute top-12 right-0 w-48 bg-[#151C24] border border-white/10 rounded-2xl p-2 shadow-2xl overflow-hidden"
                                                    >
                                                        <button 
                                                            onClick={(e) => { handleEditClick(proj, e); }}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-[10px] font-black uppercase text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                                                        >
                                                            <Edit2 size={14} /> הגדרות
                                                        </button>
                                                        <button 
                                                            onClick={(e) => handleDeleteProject(proj.id, e)}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-[10px] font-black uppercase text-red-500/70 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all"
                                                        >
                                                            <Trash2 size={14} /> מחק פרויקט
                                                        </button>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>

                                        {/* Content */}
                                        <div className="absolute inset-0 z-10 p-10 flex flex-col justify-end gap-4 text-right">
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-widest">{proj.client_name || 'לקוח לא ידוע'}</span>
                                                    <Building2 size={12} className="text-blue-400" />
                                                </div>
                                                <h3 className="text-2xl font-black text-white font-mono tracking-tighter uppercase group-hover:text-blue-400 transition-colors line-clamp-1">
                                                    {proj.name}
                                                </h3>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 mt-2">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[9px] font-mono text-gray-600 uppercase font-black tracking-widest">תקציב</span>
                                                    <span className="text-sm font-black text-emerald-500 font-mono">₪{proj.budget?.toLocaleString() || '0.00'}</span>
                                                </div>
                                                <div className="flex flex-col items-start">
                                                    <span className="text-[9px] font-mono text-gray-600 uppercase font-black tracking-widest">סנכרון</span>
                                                    <span className="text-sm font-black text-blue-400 font-mono">100%</span>
                                                </div>
                                            </div>

                                            <div className="pt-6 border-t border-white/5 mt-2 flex items-center justify-between group-hover:border-blue-500/30 transition-all">
                                                <div className="p-2 bg-white/5 rounded-xl group-hover:bg-blue-500 group-hover:text-black transition-all">
                                                    <ArrowRight size={16} />
                                                </div>
                                                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-black">כניסה לפרויקט</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                </main>

                {/* Edit Modal */}
                <AnimatePresence>
                    {editingProject && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-6">
                            <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-[#151C24] w-full max-w-xl border border-white/10 rounded-[3rem] overflow-hidden"
                            >
                                <div className="p-10 space-y-10">
                                    <div className="flex items-center justify-between">
                                        <button onClick={() => setEditingProject(null)} className="p-3 text-gray-500 hover:text-white"><XCircle size={24} /></button>
                                        <div className="flex flex-col gap-1 text-right">
                                            <span className="text-[10px] font-mono text-blue-500 uppercase font-black tracking-widest">הגדרות מערכת</span>
                                            <h3 className="text-2xl font-black text-white font-mono uppercase tracking-tighter">עדכון פרויקט</h3>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest block px-1 text-right">שם הפרויקט</label>
                                            <input 
                                                value={editForm.name}
                                                onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                                                className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold text-white focus:border-blue-500 outline-none transition-all text-right"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest block px-1 text-right">שם הלקוח</label>
                                            <input 
                                                value={editForm.client_name}
                                                onChange={(e) => setEditForm({...editForm, client_name: e.target.value})}
                                                className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold text-white focus:border-blue-500 outline-none transition-all text-right"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest block px-1 text-right">תקציב הפרויקט [₪]</label>
                                            <input 
                                                type="number"
                                                value={editForm.budget}
                                                onChange={(e) => setEditForm({...editForm, budget: Number(e.target.value)})}
                                                className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-black text-emerald-500 font-mono focus:border-emerald-500 outline-none transition-all text-right"
                                            />
                                        </div>
                                    </div>

                                    <button 
                                        onClick={handleSaveProject}
                                        disabled={isSavingProject}
                                        className="w-full bg-blue-500 text-black py-5 rounded-2xl font-black text-[12px] uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                                    >
                                        {isSavingProject ? 'מעדכן נתונים...' : 'אשר ועדכן'}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </div>
        );
    }

    // --- VIEW: Inside Project ---
    const renderView = () => {
        switch (currentView) {
            case 'dashboard':
            case 'לוח בקרה': 
                return projectId ? <ProjectOverview projectId={projectId} onNavigate={handleNavigate} /> : <KPIStrip projectId={null} />;
            
            case 'radar':
            case 'בקרת סתירות': 
                return <ContradictionRadar projectId={projectId} projectName={activeProject?.name} onNavigate={handleNavigate} />;
            
            case 'pricing':
            case 'תמחור': 
                return <PricingLedgerUI projectId={projectId} initialParams={viewParams} onNavigate={handleNavigate} />;
            
            case 'contracts':
            case 'מסמכי חוזה': 
                return <DocumentsPageClient projectId={projectId} category="CONTRACT" />;
            
            case 'execution':
            case 'מסמכי עבודה': 
                return <DocumentsPageClient projectId={projectId} category="EXECUTION" />;
            
            case 'pricelists':
            case 'מחירונים': 
                return <PricelistsPageClient projectId={projectId} />;
            
            case 'consultant':
            case 'יועץ AI': 
                return <AIConsultant projectId={projectId} />;
            
            case 'letters':
            case 'מחולל מכתבים': 
                return <SmartLetterGenerator projectId={projectId} initialSelectedItems={viewParams?.items || (viewParams?.contradictionId ? [viewParams.contradictionId] : [])} />;
            
            case 'settings':
            case 'הגדרות': 
                return <SettingsView projectId={projectId} project={activeProject} />;
            
            default: 
                return <div className="text-white p-10 font-mono uppercase tracking-widest opacity-20">מדור לא זמין</div>;
        }
    };

    return (
        <div className="flex h-screen w-full bg-[#0B0F14] text-white overflow-hidden" dir="rtl">
            <Sidebar 
                onNavigate={handleNavigate} 
                currentView={currentView} 
                projectId={projectId}
            />
            <main className="flex-1 flex flex-col relative overflow-hidden bg-[#0B0F14]">
                <TopBar 
                    title={`${activeProject?.name || 'טוען פרויקט...'}`} 
                    onBack={() => setProjectId(null)}
                />
                <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                    <motion.div
                        key={currentView}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                        {renderView()}
                    </motion.div>
                </div>
            </main>
        </div>
    );
}

function XCircle(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
        </svg>
    )
}
