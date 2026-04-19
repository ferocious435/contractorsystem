"use client";

import { useState, useEffect } from "react";
import { KPIStrip } from "./KPIStrip";
import { LedgerTable } from "./LedgerTable";
import { createClient } from "@/utils/supabase/client";
import { MoreVertical, Trash2, Edit2 } from "lucide-react";

import { Sidebar } from "../layout/Sidebar";
import { TopBar } from "../layout/TopBar";
import { AIPanel } from "./AIPanel";
import ContradictionRadar from './ContradictionRadar';
import PricingLedgerUI from './PricingLedgerUI';
import AIConsultant from './AIConsultant';
import SmartLetterGenerator from './SmartLetterGenerator';
import DocumentsPageClient from '../documents/DocumentsPageClient';
import SettingsView from './SettingsView';

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

    // Project Context Menu and Delete
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
    const [currentView, setCurrentView] = useState('לוח בקרה');

    // Edit Project Modal
    const [editingProject, setEditingProject] = useState<any | null>(null);
    const [editForm, setEditForm] = useState({ name: '', client_name: '', budget: 0 });
    const [isSavingProject, setIsSavingProject] = useState(false);

    const supabase = createClient();

    useEffect(() => {
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        setIsLoadingProjects(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        let { data: projectsList, error } = await supabase
            .from('projects')
            .select('*')
            .eq('contractor_id', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching projects:", error);
        }

        if (projectsList) {
            setProjects(projectsList);
        }
        setIsLoadingProjects(false);
    };

    const handleCreateProject = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const newProjectName = `NEW-${Math.floor(Math.random() * 1000)}`;
        const randomImageIndex = Math.floor(Math.random() * 100);
        const { data: newProject, error } = await supabase.from('projects').insert({
            name: newProjectName,
            contractor_id: user.id,
            status: 'ACTIVE',
            image_index: randomImageIndex
        }).select().single();

        if (error) {
            alert("שגיאה ביצירת פרויקט: " + error.message);
            return;
        }

        if (newProject) {
            setProjects([newProject, ...projects]);
            // Do NOT automatically go into the project, let the user click it as PRD "Instant 1-click creation of a new card" implies it just adds to list.
        }
    };

    const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const { error } = await supabase.from('projects').delete().eq('id', id);
        if (error) {
            alert("שגיאה במחיקת הפרויקט: " + error.message);
        } else {
            setProjects(projects.filter(p => p.id !== id));
            setProjectToDelete(null);
            setOpenMenuId(null);
        }
    };

    const handleEditClick = (proj: any, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingProject(proj);
        setEditForm({
            name: proj.name || '',
            client_name: proj.client_name || '',
            budget: proj.budget || 0
        });
        setOpenMenuId(null);
    };

    const handleSaveProject = async () => {
        console.log("Save button clicked");
        if (!editingProject) return;

        if (!editForm.name.trim()) {
            alert("שם הפרויקט לא יכול להיות ריק (Project name cannot be empty)");
            return;
        }

        setIsSavingProject(true);
        console.log("Saving Project Payload:", editForm);
        try {
            const { error } = await supabase
                .from('projects')
                .update({
                    name: editForm.name,
                    client_name: editForm.client_name,
                    budget: editForm.budget
                })
                .eq('id', editingProject.id);

            if (error) {
                console.error("Supabase update error:", JSON.stringify(error, null, 2));
                alert("שגיאה בעדכון הפרויקט: " + (error.message || JSON.stringify(error)));
            } else {
                console.log("Project updated successfully");
                setProjects(projects.map(p => p.id === editingProject.id ? { ...p, ...editForm } : p));
                setEditingProject(null);
            }
        } catch (err: any) {
            console.error("Unexpected error during save:", err);
            alert("שגיאה בלתי צפויה: " + err.message);
        } finally {
            setIsSavingProject(false);
        }
    };

    // --- VIEW: Project List (Home) ---
    if (!projectId) {
        return (
            <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
                <main className="flex-1 flex flex-col relative bg-background">
                    <TopBar />
                    <div className="flex-1 p-8 overflow-y-auto custom-scrollbar flex flex-col gap-8">
                        <div className="flex justify-between items-center bg-workspace p-6 rounded-lg border border-border-subtle shadow-md">
                            <div>
                                <h2 className="text-2xl font-rubik font-bold text-white mb-1">הפרויקטים שלי</h2>
                                <p className="text-secondary text-sm">נהל את פרויקטי הבנייה והתשתיות שלך</p>
                            </div>
                            <button
                                onClick={handleCreateProject}
                                className="btn-primary flex items-center gap-2"
                            >
                                <span>+</span> פרויקט חדש
                            </button>
                        </div>

                        {isLoadingProjects ? (
                            <div className="flex justify-center items-center h-32">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="glass-panel p-12 text-center rounded-lg flex flex-col items-center justify-center border-dashed border-2 border-border-subtle">
                                <div className="text-4xl mb-4">🏗️</div>
                                <h3 className="text-xl text-white font-bold mb-2">אין פרויקטים פעילים</h3>
                                <p className="text-gray-400 mb-6">לחץ על הכפתור למעלה כדי לפתוח פרויקט חדש ולהתחיל לעבוד.</p>
                                <button onClick={handleCreateProject} className="btn-primary">+ פרויקט ראשון</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 justify-items-center">
                                {projects.map((proj) => {
                                    const imageSrc = getProjectImage(proj);
                                    return (
                                        <div
                                            key={proj.id}
                                            onClick={() => setProjectId(proj.id)}
                                            className="bg-workspace rounded-xl border border-border-subtle cursor-pointer hover:border-primary/50 transition-all hover:shadow-[0_4px_20px_rgba(59,130,246,0.1)] group relative overflow-hidden flex flex-col"
                                        >
                                            {/* Header Image Area */}
                                            <div className="h-32 w-full relative overflow-hidden bg-gray-800">
                                                <img src={imageSrc} alt={proj.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-xs text-white border border-white/10">
                                                    {proj.name.split(' ')[0]} {/* Badge/ID */}
                                                </div>

                                                {/* Context Menu Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuId(openMenuId === proj.id ? null : proj.id);
                                                    }}
                                                    className="absolute top-2 left-2 p-1.5 bg-black/40 hover:bg-black/80 backdrop-blur-md rounded-md text-white border border-white/10 transition-colors"
                                                >
                                                    <MoreVertical size={16} />
                                                </button>

                                                {/* Context Menu Dropdown */}
                                                {openMenuId === proj.id && (
                                                    <div className="absolute top-10 left-2 bg-workspace border border-border-subtle shadow-xl rounded-md py-1 z-10 w-32">
                                                        <button
                                                            onClick={(e) => handleEditClick(proj, e)}
                                                            className="w-full text-right px-4 py-2 text-sm text-gray-300 hover:bg-white/5 flex items-center justify-between"
                                                        >
                                                            <span>עריכה</span>
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setProjectToDelete(proj.id);
                                                            }}
                                                            className="w-full text-right px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center justify-between"
                                                        >
                                                            <span>מחיקה</span>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Card Content Area */}
                                            <div className="p-4 flex-1 flex flex-col">
                                                <h3 className="font-bold text-lg text-white mb-3 line-clamp-1" title={proj.name}>{proj.name}</h3>

                                                <div className="mt-auto space-y-2 text-sm">
                                                    <div className="flex justify-between items-center pb-2 border-b border-border-subtle/50">
                                                        <span className="text-gray-500">לקוח/מזמין</span>
                                                        <span className="text-gray-200">{proj.client_name || 'לא הוגדר'}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-primary font-medium">
                                                        <span className="text-gray-500 text-sm font-normal">תקציב</span>
                                                        <span>₪{proj.budget ? proj.budget.toLocaleString() : '0'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Edit Project Dialog */}
                        {editingProject && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                                <div className="bg-workspace p-6 rounded-xl border border-border-subtle shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
                                    <h3 className="text-xl font-bold text-white mb-4">עריכת פרויקט</h3>

                                    <div className="space-y-4 mb-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1 text-right">שם הפרויקט</label>
                                            <input
                                                type="text"
                                                value={editForm.name}
                                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                                className="w-full bg-background border border-border-subtle rounded-md px-3 py-2 text-white outline-none focus:border-primary text-right"
                                                dir="rtl"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1 text-right">לקוח / שם המזמין</label>
                                            <input
                                                type="text"
                                                value={editForm.client_name}
                                                onChange={(e) => setEditForm({ ...editForm, client_name: e.target.value })}
                                                className="w-full bg-background border border-border-subtle rounded-md px-3 py-2 text-white outline-none focus:border-primary text-right"
                                                dir="rtl"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1 text-right">תקציב (₪)</label>
                                            <input
                                                type="number"
                                                value={editForm.budget}
                                                onChange={(e) => setEditForm({ ...editForm, budget: parseFloat(e.target.value) || 0 })}
                                                className="w-full bg-background border border-border-subtle rounded-md px-3 py-2 text-white outline-none focus:border-primary text-left"
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-3">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setEditingProject(null); }}
                                            className="px-4 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-white/5 transition-colors"
                                            disabled={isSavingProject}
                                        >
                                            ביטול
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => handleSaveProject()}
                                            className="px-4 py-2 bg-primary hover:bg-primary-hover rounded-md text-sm font-medium text-white shadow-lg shadow-primary/20 transition-all flex items-center justify-center disabled:opacity-50"
                                            disabled={isSavingProject}
                                        >
                                            {isSavingProject ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : 'שמירה'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Delete Confirmation Dialog */}
                        {projectToDelete && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <div className="bg-workspace p-6 rounded-xl border border-border-subtle shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
                                    <h3 className="text-xl font-bold text-white mb-2">?האם אתה בטוח</h3>
                                    <p className="text-gray-400 mb-6 text-sm">פעולה זו תמחק את הפרויקט לחלוטין ולא ניתנת לביטול.</p>
                                    <div className="flex justify-end gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setProjectToDelete(null)}
                                            className="px-4 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-white/5 transition-colors"
                                        >
                                            ביטול
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => handleDeleteProject(projectToDelete, e as any)}
                                            className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded-md text-sm font-medium text-white shadow-lg shadow-red-500/20 transition-all"
                                        >
                                            כן, מחק פרויקט
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}


                    </div>
                </main>
            </div>
        );
    }

    // --- VIEW: Project Dashboard (Inside a project) ---
    const currentProject = projects.find(p => p.id === projectId);

    const renderDashboardView = () => {
        switch (currentView) {
            case 'לוח בקרה':
                return (
                    <>
                        <KPIStrip projectId={projectId} />
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                            <div className="md:col-span-3">
                                <LedgerTable projectId={projectId} />
                            </div>
                        </div>
                    </>
                );
            case 'מסמכי חוזה':
                return (
                    <div className="mt-4 bg-workspace/50 rounded-2xl border border-border-subtle overflow-hidden h-full min-h-[600px] flex flex-col p-6">
                        <DocumentsPageClient projectId={projectId} category="CONTRACT" />
                    </div>
                );
            case 'מסמכי עבודה':
                return (
                    <div className="mt-4 bg-workspace/50 rounded-2xl border border-border-subtle overflow-hidden h-full min-h-[600px] flex flex-col p-6">
                        <DocumentsPageClient projectId={projectId} category="EXECUTION" />
                    </div>
                );
            case 'בקרת סתירות':
                return (
                    <div className="bg-workspace/50 p-6 rounded-2xl border border-border-subtle mt-4">
                        <ContradictionRadar projectId={projectId} />
                    </div>
                );
            case 'תמחור':
                return (
                    <div className="bg-workspace/50 p-6 rounded-2xl border border-border-subtle mt-4">
                        <PricingLedgerUI projectId={projectId} />
                    </div>
                );
            case 'מחולל מכתבים':
                return (
                    <div className="bg-workspace/50 p-6 rounded-2xl border border-border-subtle mt-4">
                        <SmartLetterGenerator projectId={projectId!} />
                    </div>
                );
            case 'יועץ AI':
                return (
                    <div className="bg-workspace/50 p-6 rounded-2xl border border-border-subtle mt-4">
                        <AIConsultant projectId={projectId!} />
                    </div>
                );
            case 'מחירונים':
                return (
                    <div className="mt-4">
                        <DocumentsPageClient projectId={projectId!} category="PRICELIST" />
                    </div>
                );
            case 'הגדרות':
                return <SettingsView project={currentProject} projectId={projectId} />;
            default:
                return (
                    <div className="glass-panel p-12 text-center rounded-lg border border-border-subtle mt-4">
                        <div className="text-5xl mb-6">🚧</div>
                        <h2 className="text-2xl font-bold text-white mb-4">{currentView}</h2>
                        <p className="text-gray-400">פיצ'ר זה יהיה זמין בגרסאות הבאות.</p>
                    </div>
                );
        }
    };

    return (
        <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
            <Sidebar projectId={projectId} currentView={currentView} onNavigate={setCurrentView} />

            <main className="flex-1 flex flex-col relative bg-background h-screen overflow-hidden">
                <TopBar title={currentProject?.name} />

                <div className="flex-1 flex overflow-hidden">
                    {/* Left Side - AI Panel (Visible on large screens) */}
                    {projectId && (
                        <div className="hidden xl:block w-80 lg:w-96 flex-shrink-0 p-6 overflow-y-auto custom-scrollbar">
                            <AIPanel projectId={projectId} />
                        </div>
                    )}

                    {/* Right Side - Main Content */}
                    <div className="flex-1 p-8 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                        <div className="flex justify-between items-center mb-2">
                            <div>
                                <button onClick={() => setProjectId(null)} className="text-primary hover:text-white transition-colors text-sm mb-2 text-right w-full block">
                                    &rarr; חזור לרשימת הפרויקטים
                                </button>
                                <h2 className="text-2xl font-bold text-white">{currentProject?.name}</h2>
                            </div>
                        </div>

                        {renderDashboardView()}
                    </div>
                </div>
            </main>
        </div>
    );
}
