"use client";

import { LayoutDashboard, FileText, ClipboardList, AlertTriangle, CircleDollarSign, BookOpen, Mail, Cpu, Settings, type LucideIcon } from "lucide-react";

export type ProjectView = "dashboard" | "contracts" | "execution" | "radar" | "pricing" | "pricelists" | "letters" | "consultant" | "settings";

export const PROJECT_NAV_ITEMS: ReadonlyArray<{ view: ProjectView; label: string; icon: LucideIcon }> = [
  { view: "dashboard", label: "לוח בקרה", icon: LayoutDashboard },
  { view: "contracts", label: "מסמכי חוזה", icon: FileText },
  { view: "execution", label: "ביצוע ושטח", icon: ClipboardList },
  { view: "radar", label: 'מכ"ם סתירות', icon: AlertTriangle },
  { view: "pricing", label: "תמחור חריגים", icon: CircleDollarSign },
  { view: "pricelists", label: "מחירונים", icon: BookOpen },
  { view: "letters", label: "מחולל מכתבים", icon: Mail },
  { view: "consultant", label: "יועץ בינה מלאכותית", icon: Cpu },
  { view: "settings", label: "הגדרות מערכת", icon: Settings },
];

export function resolveProjectView(view: string): ProjectView | undefined {
  const aliases: Partial<Record<string, ProjectView>> = { "לוח בקרה": "dashboard", "בקרת סתירות": "radar", "תמחור": "pricing", "מסמכי חוזה": "contracts", "מסמכי עבודה": "execution", "מחירונים": "pricelists", "יועץ AI": "consultant", "מחולל מכתבים": "letters", "הגדרות": "settings" };
  return PROJECT_NAV_ITEMS.find(item => item.view === view)?.view || aliases[view];
}

export function ProjectNavigation({ currentView, onNavigate, radarCount = 0 }: { currentView: ProjectView; onNavigate(view: ProjectView): void; radarCount?: number }) {
  return <nav className="ti-project-navigation ti-scroll" aria-label="ניווט בפרויקט">
    {PROJECT_NAV_ITEMS.map(({ view, label, icon: Icon }) => <button key={view} type="button" aria-label={label} aria-current={currentView === view ? "page" : undefined} title={label} onClick={() => onNavigate(view)} className={`ti-nav-item ${view === "pricing" ? "ti-nav-item--section" : ""} ${view === "settings" ? "ti-nav-item--last" : ""}`}>
      <Icon size={19} aria-hidden="true" /><span className="ti-nav-label">{label}</span>
      {view === "radar" && radarCount > 0 && <span className="ti-nav-count" aria-label={`${radarCount} ממצאים בסיכון גבוה`}>{radarCount}</span>}
    </button>)}
  </nav>;
}
