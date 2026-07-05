"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
    MoreVertical, Trash2, Edit2, Plus,
    ArrowRight, Building2, LayoutDashboard, FileText, ClipboardList, AlertTriangle,
    CircleDollarSign, BookOpen, Mail, Cpu, Settings, type LucideIcon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getPreferredProjectAmount } from "@/utils/project-financials";
import { Sidebar } from "../layout/Sidebar";
import { TopBar } from "../layout/TopBar";
import { KPIStrip } from "./KPIStrip";
import ProjectOverview from "./ProjectOverview";

const ContradictionRadar = lazy(() => import('./ContradictionRadar'));
const PricingLedgerUI = lazy(() => import('./PricingLedgerUI'));
const AIConsultant = lazy(() => import('./AIConsultant'));
const SmartLetterGenerator = lazy(() => import('./SmartLetterGenerator'));
const DocumentsPageClient = lazy(() => import('../documents/DocumentsPageClient'));
const PricelistsPageClient = lazy(() => import('../pricelists/PricelistsPageClient'));
const SettingsView = lazy(() => import('./SettingsView'));

type DashboardViewParams = {
    items?: unknown[];
    [key: string]: unknown;
} | null;

interface DashboardProject {
    id: string;
    name: string;
    client_name?: string | null;
    budget?: number | null;
    image_index?: number | null;
    displayAmount?: number;
    [key: string]: unknown;
}

interface DashboardLedgerRow {
    project_id: string;
    type?: string | null;
    source?: string | null;
    quantity?: number | null;
    unit_price_excl_vat?: number | null;
    total_price_excl_vat?: number | null;
    evidence_data?: {
        source?: string | null;
        pricelist_item_id?: string | null;
    } | null;
}

const LOCAL_PROJECTS_STORAGE_KEY = 'contractorsystem.localProjects.v1';
const DEMO_PROJECTS_STORAGE_KEY = 'contractorsystem.demoProjects.v1';

const PROJECT_IMAGES = [
    'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1531834685032-c34bf0d84c77?q=80&w=600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1590496739818-a681a298a09f?q=80&w=600&auto=format&fit=crop'
];

const normalizeDashboardProjects = (items: DashboardProject[]) => items.map((project) => ({
    ...project,
    displayAmount: Number(project.displayAmount ?? project.budget ?? 0),
}));

const readStoredLocalProjects = (fallbackProjects: DashboardProject[], storageKey = LOCAL_PROJECTS_STORAGE_KEY) => {
    if (typeof window === 'undefined') return normalizeDashboardProjects(fallbackProjects);

    try {
        const storedProjects = window.localStorage.getItem(storageKey);
        if (!storedProjects) return normalizeDashboardProjects(fallbackProjects);

        const parsedProjects = JSON.parse(storedProjects);
        if (!Array.isArray(parsedProjects)) return normalizeDashboardProjects(fallbackProjects);

        return normalizeDashboardProjects(parsedProjects as DashboardProject[]);
    } catch {
        return normalizeDashboardProjects(fallbackProjects);
    }
};

const persistLocalProjects = (items: DashboardProject[], storageKey = LOCAL_PROJECTS_STORAGE_KEY) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(items));
};


const MOBILE_PROJECT_NAV_ITEMS: Array<{ view: string; label: string; icon: LucideIcon }> = [
    { view: 'dashboard', label: '\u05dc\u05d5\u05d7', icon: LayoutDashboard },
    { view: 'contracts', label: '\u05d7\u05d5\u05d6\u05d4', icon: FileText },
    { view: 'execution', label: '\u05e9\u05d8\u05d7', icon: ClipboardList },
    { view: 'radar', label: '\u05e1\u05ea\u05d9\u05e8\u05d5\u05ea', icon: AlertTriangle },
    { view: 'pricing', label: '\u05ea\u05de\u05d7\u05d5\u05e8', icon: CircleDollarSign },
    { view: 'pricelists', label: '\u05de\u05d7\u05d9\u05e8\u05d5\u05df', icon: BookOpen },
    { view: 'letters', label: '\u05de\u05db\u05ea\u05d1', icon: Mail },
    { view: 'consultant', label: 'AI', icon: Cpu },
    { view: 'settings', label: '\u05d4\u05d2\u05d3\u05e8\u05d5\u05ea', icon: Settings },
];

function MobileProjectNav({ currentView, onNavigate }: { currentView: string; onNavigate: (view: string) => void }) {
    return (
        <nav className="lg:hidden border-t border-white/10 bg-[#0B0F14]/95 backdrop-blur-2xl px-2 py-2" dir="rtl" aria-label="\u05e0\u05d9\u05d5\u05d5\u05d8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8">
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                {MOBILE_PROJECT_NAV_ITEMS.map(({ view, label, icon: Icon }) => {
                    const active = currentView === view;
                    return (
                        <button
                            key={view}
                            type="button"
                            onClick={() => onNavigate(view)}
                            className={`min-w-[4.6rem] rounded-2xl border px-3 py-2.5 text-[10px] font-black transition-all flex flex-col items-center gap-1 ${active
                                ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                                : 'border-white/5 bg-white/[0.03] text-gray-500 hover:text-white'}`}
                        >
                            <Icon size={16} />
                            <span className="leading-none">{label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}

const getProjectImage = (proj: DashboardProject) => {
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
    const [projects, setProjects] = useState<DashboardProject[]>([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [isLocalAccess, setIsLocalAccess] = useState(false);
    const [currentView, setCurrentView] = useState('dashboard');
    const [viewParams, setViewParams] = useState<DashboardViewParams>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
    const [createForm, setCreateForm] = useState({ name: '', client_name: '', budget: 0 });
    const [createError, setCreateError] = useState('');
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [editingProject, setEditingProject] = useState<DashboardProject | null>(null);
    const [editForm, setEditForm] = useState({ name: '', client_name: '', budget: 0 });
    const [isSavingProject, setIsSavingProject] = useState(false);

    const handleNavigate = (view: string, params: DashboardViewParams = null) => {
        console.log(`[Dashboard] Navigating to: ${view}`, params);
        setCurrentView(view);
        setViewParams(params);
    };

    const fetchProjects = useCallback(async () => {
        setIsLoadingProjects(true);
        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                const localProjectsResponse = await fetch('/api/local/projects', { cache: 'no-store' });
                if (localProjectsResponse.ok) {
                    const payload = await localProjectsResponse.json() as { mode?: string; projects?: DashboardProject[] };
                    setIsLocalAccess(true);
                    const storageKey = payload.mode === 'demo' ? DEMO_PROJECTS_STORAGE_KEY : LOCAL_PROJECTS_STORAGE_KEY;
                    setProjects(readStoredLocalProjects(payload.projects || [], storageKey));
                    setIsLoadingProjects(false);
                    return;
                }

                setIsLocalAccess(false);
                setProjects([]);
                setIsLoadingProjects(false);
                return;
            }

            setIsLocalAccess(false);

            const { data: projectsList, error } = await supabase
                .from('projects')
                .select('*')
                .eq('contractor_id', user.id)
                .order('created_at', { ascending: false });

            if (error) console.error("Error fetching projects:", error);
            if (projectsList?.length) {
                setProjects(
                    projectsList.map((project) => ({
                        ...project,
                        displayAmount: Number(project.budget || 0),
                    }))
                );
                setIsLoadingProjects(false);

                const projectIds = projectsList.map((project) => project.id);
                const { data: ledgerRows, error: ledgerError } = await supabase
                    .from('pricing_ledger')
                    .select('project_id, type, source, quantity, unit_price_excl_vat, total_price_excl_vat, evidence_data')
                    .in('project_id', projectIds);

                if (ledgerError) {
                    console.error("Error fetching project contract totals:", ledgerError);
                }

                const ledgerByProject = new Map<string, DashboardLedgerRow[]>();
                for (const row of ledgerRows || []) {
                    const currentRows = ledgerByProject.get(row.project_id) || [];
                    currentRows.push(row);
                    ledgerByProject.set(row.project_id, currentRows);
                }

                setProjects((currentProjects) => currentProjects.map((project) => ({
                    ...project,
                    displayAmount: getPreferredProjectAmount(
                        project.budget,
                        ledgerByProject.get(project.id)
                    ),
                })));
            } else {
                setProjects(projectsList || []);
            }
        } catch (error) {
            console.error("Error in fetchProjects:", error);
        } finally {
            setIsLoadingProjects(false);
        }
    }, []);

    useEffect(() => {
        void fetchProjects();
    }, [fetchProjects]);

    const handleCreateProject = () => {
        setCreateForm({ name: '', client_name: '', budget: 0 });
        setCreateError('');
        setIsCreateProjectOpen(true);
    };

    const handleSaveNewProject = async () => {
        const projectName = createForm.name.trim();
        if (!projectName) {
            setCreateError('Project name is required');
            return;
        }

        setIsCreatingProject(true);
        setCreateError('');
        const randomImageIndex = Math.floor(Math.random() * 100);

        if (isLocalAccess) {
            const localProject: DashboardProject = {
                id: `local-${Date.now()}`,
                name: projectName,
                client_name: createForm.client_name.trim() || null,
                budget: Number(createForm.budget) || 0,
                displayAmount: Number(createForm.budget) || 0,
                image_index: randomImageIndex,
            };
            const nextProjects = [localProject, ...projects];
            setProjects(nextProjects);
            persistLocalProjects(nextProjects, projects.some((project) => project.id.startsWith('demo-')) ? DEMO_PROJECTS_STORAGE_KEY : LOCAL_PROJECTS_STORAGE_KEY);
            setIsCreateProjectOpen(false);
            setIsCreatingProject(false);
            return;
        }

        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setIsCreatingProject(false);
            return;
        }

        try {
            const { data: newProject, error } = await supabase.from('projects').insert({
                name: projectName,
                client_name: createForm.client_name.trim() || null,
                budget: Number(createForm.budget) || 0,
                contractor_id: user.id,
                status: 'ACTIVE',
                image_index: randomImageIndex
            }).select().single();

            if (error) throw error;
            if (newProject) {
                setProjects([{ ...newProject, displayAmount: Number(newProject.budget || 0) }, ...projects]);
                setProjectId(newProject.id);
                setCurrentView('dashboard');
                setIsCreateProjectOpen(false);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create project';
            setCreateError(message);
        } finally {
            setIsCreatingProject(false);
        }
    };

    const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('האם אתה בטוח שברצונך למחוק פרויקט זה? כל הנתונים יאבדו.')) return;
        if (isLocalAccess) {
            const nextProjects = projects.filter(p => p.id !== id);
            setProjects(nextProjects);
            persistLocalProjects(nextProjects, projects.some((project) => project.id.startsWith('demo-')) ? DEMO_PROJECTS_STORAGE_KEY : LOCAL_PROJECTS_STORAGE_KEY);
            setOpenMenuId(null);
            return;
        }

        const supabase = createClient();
        const { error } = await supabase.from('projects').delete().eq('id', id);
        if (!error) setProjects(projects.filter(p => p.id !== id));
        setOpenMenuId(null);
    };


    const handleEditClick = (proj: DashboardProject, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingProject(proj);
        setEditForm({ name: proj.name, client_name: proj.client_name || '', budget: proj.budget || 0 });
        setOpenMenuId(null);
    };

    const selectedLetterItems = useMemo(() => (Array.isArray(viewParams?.items)
        ? viewParams.items.filter((item): item is string => typeof item === "string")
        : []), [viewParams]);

    const handleSaveProject = async () => {
        if (!editingProject) return;
        setIsSavingProject(true);
        if (isLocalAccess) {
            const nextProjects = projects.map(p => p.id === editingProject.id ? {
                ...p,
                ...editForm,
                displayAmount: Number(editForm.budget) || 0,
            } : p);
            setProjects(nextProjects);
            persistLocalProjects(nextProjects, projects.some((project) => project.id.startsWith('demo-')) ? DEMO_PROJECTS_STORAGE_KEY : LOCAL_PROJECTS_STORAGE_KEY);
            setEditingProject(null);
            setIsSavingProject(false);
            return;
        }

        try {
            const supabase = createClient();
            const { error } = await supabase
                .from('projects')
                .update({
                    name: editForm.name,
                    client_name: editForm.client_name,
                    budget: editForm.budget
                })
                .eq('id', editingProject.id);

            if (!error) {
                setProjects(projects.map(p => p.id === editingProject.id ? {
                    ...p,
                    ...editForm,
                    displayAmount: p.displayAmount,
                } : p));
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
            <div className="flex h-dvh w-full bg-[#0B0F14] text-white overflow-hidden" dir="rtl">
                <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
                    <TopBar title="ניהול מערכת" />
                    
                    <div className="flex-1 p-4 sm:p-6 lg:p-10 overflow-y-auto custom-scrollbar space-y-6 lg:space-y-12">
                        {/* Hero Section */}
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-[#151C24]/50 border border-white/5 rounded-[2rem] lg:rounded-[3rem] p-5 sm:p-8 lg:p-12 relative overflow-hidden group"
                        >
                            <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-500/10 to-transparent pointer-events-none" />
                            <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px]" />
                            
                            <div className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 lg:gap-10">
                                <div className="flex flex-col gap-4 text-right">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                                        <span className="text-[10px] font-mono font-black text-gray-500 uppercase tracking-[0.3em]">בקרת תשתית מתקדמת</span>
                                    </div>
                                    <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tighter uppercase font-mono">
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
                                    className="w-full sm:w-auto justify-center bg-white text-black px-6 sm:px-10 py-4 rounded-[1.5rem] font-black text-[11px] uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(255,255,255,0.1)] hover:bg-blue-500 hover:text-white transition-all flex items-center gap-3 group/btn"
                                >
                                    <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform" />
                                    צור פרויקט חדש
                                </motion.button>
                            </div>
                        </motion.div>

                        {/* Projects Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-8">
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
                                        transition={{ delay: Math.min(idx, 4) * 0.02 }}
                                        onClick={() => setProjectId(proj.id)}
                                        className={`group relative h-[320px] sm:h-[360px] lg:h-[420px] bg-[#151C24]/50 border border-white/5 rounded-[2rem] lg:rounded-[2.5rem] overflow-hidden transition-all cursor-pointer hover:bg-white/[0.03] hover:shadow-[0_30px_60px_rgba(0,0,0,0.5)] hover:-translate-y-2`}
                                    >
                                        {/* Project Image Background */}
                                        <div className="absolute inset-0 z-0">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
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
                                        <div className="absolute inset-0 z-10 p-6 sm:p-8 lg:p-10 flex flex-col justify-end gap-4 text-right">
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
                                                    <span className="text-sm font-black text-emerald-500 font-mono">₪{(proj.displayAmount || 0).toLocaleString()}</span>
                                                </div>
                                                <div className="flex flex-col items-start">
                                                    <span className="text-[9px] font-mono text-gray-600 uppercase font-black tracking-widest">סטטוס בדיקה</span>
                                                    <span className="text-sm font-black text-amber-400 font-mono">נדרש סנכרון</span>
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
                    {isCreateProjectOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-4 sm:p-6">
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.95, opacity: 0 }}
                                className="bg-[#151C24] w-full max-w-xl max-h-[90dvh] border border-white/10 rounded-[2rem] sm:rounded-[3rem] overflow-y-auto"
                            >
                                <div className="p-6 sm:p-10 space-y-8">
                                    <div className="flex items-center justify-between">
                                        <button
                                            onClick={() => setIsCreateProjectOpen(false)}
                                            className="p-3 text-gray-500 hover:text-white"
                                            aria-label="סגור"
                                        >
                                            <XCircle size={24} />
                                        </button>
                                        <div className="flex flex-col gap-1 text-right">
                                            <span className="text-[10px] font-mono text-blue-500 uppercase font-black tracking-widest">פתיחת תיק עבודה</span>
                                            <h3 className="text-2xl font-black text-white font-mono uppercase tracking-tighter">פרויקט חדש</h3>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest block px-1 text-right" htmlFor="new-project-name">
                                                שם הפרויקט
                                            </label>
                                            <input
                                                id="new-project-name"
                                                value={createForm.name}
                                                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                                className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold text-white focus:border-blue-500 outline-none transition-all text-right"
                                                autoFocus
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest block px-1 text-right" htmlFor="new-client-name">
                                                שם הלקוח
                                            </label>
                                            <input
                                                id="new-client-name"
                                                value={createForm.client_name}
                                                onChange={(e) => setCreateForm({ ...createForm, client_name: e.target.value })}
                                                className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold text-white focus:border-blue-500 outline-none transition-all text-right"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest block px-1 text-right" htmlFor="new-project-budget">
                                                סכום חוזה ידוע לפני מע&quot;מ [₪]
                                            </label>
                                            <input
                                                id="new-project-budget"
                                                type="number"
                                                min={0}
                                                value={createForm.budget}
                                                onChange={(e) => setCreateForm({ ...createForm, budget: Number(e.target.value) })}
                                                className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-black text-emerald-500 font-mono focus:border-emerald-500 outline-none transition-all text-right"
                                            />
                                        </div>
                                    </div>

                                    {createError && (
                                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-sm font-bold text-red-300 text-right">
                                            {createError}
                                        </div>
                                    )}

                                    <button
                                        onClick={handleSaveNewProject}
                                        disabled={isCreatingProject || !createForm.name.trim()}
                                        className="w-full bg-blue-500 text-black py-5 rounded-2xl font-black text-[12px] uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
                                    >
                                        {isCreatingProject ? 'יוצר פרויקט...' : 'צור ופתח פרויקט'}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}

                    {editingProject && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-4 sm:p-6">
                            <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-[#151C24] w-full max-w-xl max-h-[90dvh] border border-white/10 rounded-[2rem] sm:rounded-[3rem] overflow-y-auto"
                            >
                                <div className="p-6 sm:p-10 space-y-10">
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
                return <PricingLedgerUI projectId={projectId} initialParams={viewParams ?? undefined} onNavigate={handleNavigate} />;
            
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
                return <SmartLetterGenerator projectId={projectId} initialSelectedItems={selectedLetterItems} />;
            
            case 'settings':
            case 'הגדרות': 
                return <SettingsView projectId={projectId} project={activeProject} />;
            
            default: 
                return <div className="text-white p-10 font-mono uppercase tracking-widest opacity-20">מדור לא זמין</div>;
        }
    };

    return (
        <div className="flex h-dvh w-full bg-[#0B0F14] text-white overflow-hidden" dir="rtl">
            <Sidebar 
                onNavigate={handleNavigate} 
                currentView={currentView} 
                projectId={projectId}
            />
            <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden bg-[#0B0F14]">
                <TopBar 
                    title={`${activeProject?.name || 'טוען פרויקט...'}`} 
                    onBack={() => setProjectId(null)}
                />
                <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto custom-scrollbar">
                    <Suspense fallback={<div className="p-4 sm:p-8 text-sm font-black text-gray-500 animate-pulse">טוען מסך...</div>}>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.12, ease: "easeOut" }}
                        >
                            {renderView()}
                        </motion.div>
                    </Suspense>
                </div>
                <MobileProjectNav currentView={currentView} onNavigate={handleNavigate} />
            </main>
        </div>
    );
}

function XCircle({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
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
