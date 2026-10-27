"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getPreferredProjectAmount } from "@/utils/project-financials";
import { AppShell } from "../layout/AppShell";
import { ProjectPortfolio } from "../layout/ProjectPortfolio";
import { ProjectFormDialog } from "../layout/ProjectFormDialog";
import { UnavailableView } from "../layout/UnavailableView";
import { resolveProjectView, type ProjectView } from "../layout/ProjectNavigation";
import { Feedback } from "../ui/titanium/Feedback";
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
    status?: string | null;
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


export default function DashboardContent() {
    const [projectId, setProjectId] = useState<string | null>(null);
    const [projects, setProjects] = useState<DashboardProject[]>([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [projectsError, setProjectsError] = useState('');
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
    const [editError, setEditError] = useState('');

    const handleBackToProjects = () => { setProjectId(null); setViewParams(null); };

    const handleNavigate = (view: string, params: DashboardViewParams = null) => {
        if (view === 'projects') { handleBackToProjects(); return; }
        console.log(`[Dashboard] Navigating to: ${view}`, params);
        setCurrentView(resolveProjectView(view) || view);
        setViewParams(params);
    };

    const fetchProjects = useCallback(async () => {
        setIsLoadingProjects(true);
        setProjectsError('');
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
                setProjectsError('לא ניתן לטעון את הפרויקטים כרגע. אפשר לנסות שוב.');
                setIsLoadingProjects(false);
                return;
            }

            setIsLocalAccess(false);

            const { data: projectsList, error } = await supabase
                .from('projects')
                .select('*')
                .eq('contractor_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
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
                    setProjectsError('לא ניתן לעדכן את סכומי הפרויקטים כרגע. אפשר לנסות שוב.');
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
            setProjectsError('לא ניתן לטעון את הפרויקטים כרגע. אפשר לנסות שוב.');
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
            setCreateError('לא ניתן לאמת את הגישה כרגע.');
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

    const handleDeleteProject = async (id: string, e: React.MouseEvent, confirmed = false) => {
        e.stopPropagation();
        if (!confirmed) return false;
        if (isLocalAccess) {
            const nextProjects = projects.filter(p => p.id !== id);
            setProjects(nextProjects);
            persistLocalProjects(nextProjects, projects.some((project) => project.id.startsWith('demo-')) ? DEMO_PROJECTS_STORAGE_KEY : LOCAL_PROJECTS_STORAGE_KEY);
            setOpenMenuId(null);
            return true;
        }

        const supabase = createClient();
        const { error } = await supabase.from('projects').delete().eq('id', id);
        if (error) return false;
        setProjects(projects.filter(p => p.id !== id));
        setOpenMenuId(null);
        return true;
    };


    const handleEditClick = (proj: DashboardProject, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditError('');
        setEditingProject(proj);
        setEditForm({ name: proj.name, client_name: proj.client_name || '', budget: proj.budget || 0 });
        setOpenMenuId(null);
    };

    const selectedLetterItems = useMemo(() => (Array.isArray(viewParams?.items)
        ? viewParams.items.filter((item): item is string => typeof item === "string")
        : []), [viewParams]);

    const handleSaveProject = async () => {
        if (!editingProject) return;
        setEditError('');
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

            if (error) throw error;
            if (!error) {
                setProjects(projects.map(p => p.id === editingProject.id ? {
                    ...p,
                    ...editForm,
                    displayAmount: p.displayAmount,
                } : p));
                setEditingProject(null);
            }
        } catch {
            setEditError('לא ניתן לשמור את פרטי הפרויקט כרגע.');
        } finally {
            setIsSavingProject(false);
        }
    };

    const activeProject = projects.find(p => p.id === projectId);

    if (!projectId) {
        return <>
            <ProjectPortfolio projects={projects} isLoading={isLoadingProjects} error={projectsError} onRetry={() => void fetchProjects()} onOpen={id => { setProjectId(id); setCurrentView('dashboard'); setViewParams(null); }} onCreate={handleCreateProject} onEdit={handleEditClick} onDelete={(id, event) => handleDeleteProject(id, event, true)} openMenuId={openMenuId} onToggleMenu={setOpenMenuId} localAccess={isLocalAccess} />
            <ProjectFormDialog open={isCreateProjectOpen} mode="create" values={createForm} pending={isCreatingProject} error={createError} onChange={setCreateForm} onSave={handleSaveNewProject} onClose={() => setIsCreateProjectOpen(false)} />
            <ProjectFormDialog open={Boolean(editingProject)} mode="edit" values={editForm} pending={isSavingProject} error={editError} onChange={setEditForm} onSave={handleSaveProject} onClose={() => setEditingProject(null)} />
        </>;
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
                return <UnavailableView embedded onBack={handleBackToProjects} />;
        }
    };

    return <AppShell projectTitle={activeProject?.name || 'טוען פרויקט…'} currentView={currentView as ProjectView} projectId={projectId} onNavigate={handleNavigate} onBack={handleBackToProjects}>
        <Suspense fallback={<Feedback tone="info"><span className="ti-spinner" aria-hidden="true" />טוען מסך…</Feedback>}>
            {renderView()}
        </Suspense>
    </AppShell>;
}
