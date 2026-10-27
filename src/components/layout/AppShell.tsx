"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { ProjectView } from "./ProjectNavigation";

export function AppShell({ projectTitle, currentView, onNavigate, onBack, children, projectId }: { projectTitle: string; currentView: ProjectView; onNavigate(view: ProjectView): void; onBack(): void; children: ReactNode; projectId?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = (view: ProjectView) => { onNavigate(view); setMenuOpen(false); };
  return <div className="titanium-theme ti-app" dir="rtl">
    <a href="#project-workspace" className="ti-skip-link">מעבר לתוכן</a>
    <Sidebar currentView={currentView} onNavigate={navigate} projectId={projectId} menuOpen={menuOpen} onMenuClose={() => setMenuOpen(false)} />
    <div className="ti-app__workspace">
      <TopBar title={projectTitle} onBack={onBack} onMenuOpen={() => setMenuOpen(true)} menuOpen={menuOpen} />
      <main id="project-workspace" className="ti-app__main ti-scroll" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
