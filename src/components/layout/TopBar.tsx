"use client";

import { ArrowRight, Code2, Menu } from "lucide-react";
import Link from "next/link";
import { WORKSPACE_VIEW_ROLES, useWorkspaceViewRole, type WorkspaceViewRole } from "@/hooks/useWorkspaceViewRole";
import { Button } from "@/components/ui/titanium/Button";

interface TopBarProps { title?: string; onBack?(): void; onMenuOpen?(): void; menuOpen?: boolean }

export function TopBar({ title, onBack, onMenuOpen, menuOpen = false }: TopBarProps) {
  const [viewRole, setViewRole] = useWorkspaceViewRole();
  return <header className="ti-topbar" dir="rtl"><div className="ti-topbar__identity">
    {onMenuOpen && <Button className="ti-menu-toggle" aria-label="פתיחת תפריט הפרויקט" aria-expanded={menuOpen} aria-controls="project-menu" onClick={onMenuOpen}><Menu size={19} aria-hidden="true" /></Button>}
    {onBack && <Button onClick={onBack} aria-label="חזרה לפרויקטים"><ArrowRight size={18} aria-hidden="true" /><span className="ti-back-label">פרויקטים</span></Button>}
    {title && <div className="ti-topbar__title"><span className="ti-small ti-secondary">{onBack ? "פרויקט נבחר" : "סביבת העבודה"}</span><h2>{title}</h2></div>}
  </div><div className="ti-topbar__tools">{viewRole === "developer" && <Link href="/local-ai-check" prefetch={false} className="ti-button ti-dev-link" aria-label="בדיקות פיתוח"><Code2 size={18} aria-hidden="true" /><span className="ti-dev-label">בדיקות פיתוח</span></Link>}<label className="ti-topbar__role">תצוגת משתמש<select className="ti-select" aria-label="תצוגת משתמש" value={viewRole} onChange={event => setViewRole(event.target.value as WorkspaceViewRole)}>{WORKSPACE_VIEW_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label></div></header>;
}
