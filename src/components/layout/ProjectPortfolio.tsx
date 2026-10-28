"use client";

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowLeft, Building2, Edit2, FolderSearch, MoreHorizontal, Plus, Trash2, RotateCcw } from "lucide-react";
import { TopBar } from "./TopBar";
import { ProjectDeleteDialog } from "./ProjectFormDialog";
import { Button } from "@/components/ui/titanium/Button";
import { Field } from "@/components/ui/titanium/Field";
import { Panel } from "@/components/ui/titanium/Panel";
import { BidiText } from "@/components/ui/titanium/BidiText";
import { Feedback } from "@/components/ui/titanium/Feedback";
import { StatusChip } from "@/components/ui/titanium/StatusChip";

export interface PortfolioProject { id: string; name: string; client_name?: string | null; budget?: number | null; displayAmount?: number; status?: string | null }
export function filterPortfolioProjects<T extends PortfolioProject>(projects: readonly T[], query: string): T[] {
  const term = query.trim().toLocaleLowerCase();
  return projects.filter(project => !term || `${project.name} ${project.client_name || ""}`.toLocaleLowerCase().includes(term));
}
type PortfolioProps<T extends PortfolioProject> = { projects: T[]; isLoading: boolean; error?: string; onRetry?(): void; onOpen(id: string): void; onCreate(): void; onEdit(project: T, event: MouseEvent<HTMLButtonElement>): void; onDelete(id: string, event: MouseEvent<HTMLButtonElement>): Promise<boolean>; openMenuId: string | null; onToggleMenu(id: string | null): void; localAccess?: boolean };

function ProjectActions<T extends PortfolioProject>({ project, open, onToggle, onEdit, onDelete }: { project: T; open: boolean; onToggle(): void; onEdit(project: T, event: MouseEvent<HTMLButtonElement>): void; onDelete(): void }) {
  const id = useId(), ref = useRef<HTMLDivElement>(null);
  const toggleRef = useRef(onToggle);
  useEffect(() => { toggleRef.current = onToggle; }, [onToggle]);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>("[data-project-action]")?.focus();
    const outside = (event: PointerEvent) => { if (document.querySelector("dialog[open]")) return; if (event.target instanceof Node && !ref.current?.contains(event.target)) toggleRef.current(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="ti-project-actions" ref={ref} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); onToggle(); document.getElementById(id)?.focus(); } }}>
    <Button id={id} variant="text" aria-label={`פעולות לפרויקט ${project.name}`} aria-expanded={open} aria-controls={`${id}-actions`} onClick={onToggle}><MoreHorizontal size={20} aria-hidden="true" /></Button>
    {open && <div id={`${id}-actions`} role="group" aria-label={`פעולות לפרויקט ${project.name}`} className="ti-project-action-menu"><Button data-project-action variant="text" onClick={event => { document.getElementById(id)?.focus(); onEdit(project, event); }}><Edit2 size={16} aria-hidden="true" />עריכת פרויקט</Button><Button variant="danger" onClick={onDelete}><Trash2 size={16} aria-hidden="true" />מחיקת פרויקט</Button></div>}
  </div>;
}

export function ProjectPortfolio<T extends PortfolioProject>({ projects, isLoading, error, onRetry, onOpen, onCreate, onEdit, onDelete, openMenuId, onToggleMenu, localAccess }: PortfolioProps<T>) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<T | null>(null), [deletePending, setDeletePending] = useState(false), [deleteError, setDeleteError] = useState("");
  const visible = useMemo(() => filterPortfolioProjects(projects, query), [projects, query]);
  const create = () => { document.getElementById("create-project")?.focus(); onCreate(); };
  const confirmDelete = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!deleting || deletePending) return;
    setDeletePending(true); setDeleteError("");
    try {
      if (await onDelete(deleting.id, event)) { setDeleting(null); requestAnimationFrame(() => document.getElementById("projects-search")?.focus()); }
      else setDeleteError("לא ניתן למחוק את הפרויקט כרגע. המידע הקיים נשאר מוצג.");
    } catch { setDeleteError("לא ניתן למחוק את הפרויקט כרגע. אפשר לנסות שוב."); }
    finally { setDeletePending(false); }
  };
  const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return <div className="titanium-theme ti-portfolio-shell" dir="rtl"><TopBar title="ניהול מערכת" /><main className="ti-portfolio ti-page ti-scroll">
    <header className="ti-page-header"><div><div className="ti-toolbar"><h1 className="ti-title">הפרויקטים שלי</h1><StatusChip>{isLoading ? "טוען…" : projects.length === 1 ? "פרויקט אחד" : `${projects.length} פרויקטים`}</StatusChip></div><p className="ti-subtitle">חוזים, מסמכים וכספים בכל פרויקט</p></div><Button id="create-project" variant="primary" onClick={create} disabled={isLoading} disabledReason={isLoading ? "טוען את רשימת הפרויקטים" : undefined}><Plus size={18} aria-hidden="true" />צור פרויקט חדש</Button></header>
    <div className="ti-portfolio__search"><Field id="projects-search" label="חיפוש פרויקט או לקוח" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="שם פרויקט או לקוח" autoComplete="off" /><p className="ti-small ti-secondary">{!isLoading && projects.length > 0 ? projects.length === 1 ? `${visible.length} מתוך פרויקט אחד` : `${visible.length} מתוך ${projects.length} פרויקטים` : "בחירת פרויקט פותחת את סביבת העבודה שלו"}</p></div>
    {localAccess && <Feedback tone="info">סביבת עבודה מקומית. שינויים בפרויקטים אלה נשמרים בדפדפן.</Feedback>}
    {error && <Feedback tone="danger"><div className="ti-toolbar ti-toolbar--between"><span>{error}</span>{onRetry && <Button onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />ניסיון נוסף</Button>}</div></Feedback>}
    {isLoading ? <Panel><div className="ti-empty" role="status"><span className="ti-spinner" aria-hidden="true" />טוען פרויקטים…</div></Panel> : projects.length === 0 ? !error && <Panel><div className="ti-empty"><Building2 size={36} aria-hidden="true" /><h2 className="ti-heading">עדיין אין פרויקטים</h2><p className="ti-secondary">אפשר ליצור פרויקט ולהתחיל לרכז את מסמכיו.</p><Button onClick={create}>יצירת הפרויקט הראשון</Button></div></Panel> : visible.length === 0 ? <Panel><div className="ti-empty"><FolderSearch size={32} aria-hidden="true" /><h2 className="ti-heading">לא נמצאו פרויקטים בחיפוש</h2><p className="ti-secondary">אפשר לשנות את שם הפרויקט או הלקוח לחיפוש.</p><Button onClick={() => setQuery("")}>ניקוי החיפוש</Button></div></Panel> : <div className="ti-project-grid">{visible.map(project => {
      const value = project.displayAmount ?? project.budget;
      const amountKnown = typeof value === "number" && Number.isFinite(value) && (project.budget != null || value !== 0);
      return <article key={project.id} className="ti-project-card"><div className="ti-project-card__edge" aria-hidden="true" /><div className="ti-project-card__body"><div className="ti-toolbar ti-toolbar--between"><StatusChip tone={project.status === "ACTIVE" ? "success" : "neutral"}>{project.status === "ACTIVE" ? "פרויקט פעיל" : project.status || "מצב לא צוין"}</StatusChip><ProjectActions project={project} open={openMenuId === project.id} onToggle={() => onToggleMenu(openMenuId === project.id ? null : project.id)} onEdit={onEdit} onDelete={() => { setDeleting(project); setDeleteError(""); }} /></div><h2 className="ti-heading"><button type="button" className="ti-project-name" onClick={() => onOpen(project.id)}>{project.name}</button></h2><p className="ti-project-client"><Building2 size={16} aria-hidden="true" />{project.client_name || "לקוח לא צוין"}</p><div className="ti-project-amount"><span className="ti-small ti-secondary">סכום החוזה לפני מע״מ</span>{amountKnown ? <BidiText value={money.format(value)} kind="money" /> : <><span aria-label="הסכום לא צוין">—</span><span className="ti-small ti-secondary">הסכום לא צוין</span></>}</div><div className="ti-project-card__footer"><Button onClick={() => onOpen(project.id)} aria-label={`פתיחת הפרויקט ${project.name}`}>כניסה לפרויקט<ArrowLeft size={16} aria-hidden="true" /></Button></div></div></article>;
    })}</div>}
    <ProjectDeleteDialog project={deleting} pending={deletePending} error={deleteError} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />
  </main></div>;
}
