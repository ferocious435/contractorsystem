"use client";

import { useEffect, useState } from "react";
import { X, CircleCheck, CircleHelp } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { isLocalProjectId } from "@/utils/local-projects";
import { summarizeOpenContradictions } from "@/components/features/projectOverviewStats";
import { RADAR_FINDINGS_UPDATED_EVENT } from "@/utils/radar-review-disposition";
import { useAiReadiness } from "@/hooks/useAiReadiness";
import { ProjectNavigation, type ProjectView } from "./ProjectNavigation";
import { Dialog } from "@/components/ui/titanium/Dialog";
import { Button } from "@/components/ui/titanium/Button";

export function Sidebar({ currentView = "dashboard", onNavigate, projectId, menuOpen = false, onMenuClose = () => {} }: { currentView?: ProjectView; onNavigate?(view: ProjectView): void; projectId?: string | null; menuOpen?: boolean; onMenuClose?(): void }) {
  const [openContradictionsCount, setOpenContradictionsCount] = useState(0);
  const aiStatus = useAiReadiness();
  const isLocalProject = isLocalProjectId(projectId);
  const displayedOpenContradictionsCount = projectId && !isLocalProject ? openContradictionsCount : 0;

  useEffect(() => {
    if (!projectId || isLocalProject) return;
    const supabase = createClient();
    const fetchCount = async () => {
      const { data } = await supabase.from("contradictions").select("status,severity,evidence_data").eq("project_id", projectId).eq("status", "OPEN").eq("severity", "HIGH");
      setOpenContradictionsCount(summarizeOpenContradictions(data).highRiskOpenCount);
    };
    fetchCount();
    const refreshAfterReview = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) void fetchCount();
    };
    window.addEventListener(RADAR_FINDINGS_UPDATED_EVENT, refreshAfterReview);
    const channel = supabase.channel("sidebar-contradictions")
      .on("postgres_changes", { event: "*", schema: "public", table: "contradictions", filter: `project_id=eq.${projectId}` }, () => { fetchCount(); })
      .subscribe();
    return () => { window.removeEventListener(RADAR_FINDINGS_UPDATED_EVENT, refreshAfterReview); supabase.removeChannel(channel); };
  }, [isLocalProject, projectId]);

  const navigation = <ProjectNavigation currentView={currentView} onNavigate={view => onNavigate?.(view)} radarCount={displayedOpenContradictionsCount} />;
  const available = Boolean(aiStatus?.available);
  const unchecked = aiStatus === null || aiStatus.reason === "STATUS_UNAVAILABLE";
  const connection = <div className={`ti-sidebar-status ${available ? "ti-tone--success" : unchecked ? "ti-tone--neutral" : "ti-tone--warning"}`}>
    {available ? <CircleCheck size={18} aria-hidden="true" /> : <CircleHelp size={18} aria-hidden="true" />}<div className="ti-sidebar-status__text"><span>{aiStatus === null ? "בודק את חיבור העוזר…" : unchecked ? "חיבור העוזר לא נבדק" : available ? "חיבור העוזר זמין" : "חיבור העוזר לא זמין"}</span>{!unchecked && aiStatus?.provider && <bdi dir="auto" className="ti-small ti-secondary">{aiStatus.provider}</bdi>}</div>
  </div>;
  return <><aside className="ti-sidebar"><header className="ti-sidebar-brand"><span className="ti-sidebar-brand__mark" aria-hidden="true">CS</span><div className="ti-sidebar-brand__text"><strong className="ti-sidebar-brand__title">CONTRACTORSYSTEM</strong><p>ניהול חוזים ומסמכים</p></div></header>{navigation}<footer className="ti-sidebar-footer">{connection}</footer></aside>
    <Dialog open={menuOpen} labelledBy="project-menu-title" onClose={onMenuClose} className="ti-nav-dialog"><div id="project-menu" className="ti-nav-dialog__content"><header className="ti-dialog__header"><h2 className="ti-heading" id="project-menu-title">ניווט בפרויקט</h2><Button onClick={onMenuClose} aria-label="סגירת תפריט הפרויקט"><X size={18} aria-hidden="true" /></Button></header>{navigation}<footer className="ti-sidebar-footer">{connection}</footer></div></Dialog>
  </>;
}
