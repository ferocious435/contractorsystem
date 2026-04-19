import DashboardContent from "@/components/features/DashboardContent";

export default function Home() {
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Workspace Primary - Interactive React Component Wrapper */}
      {/* The entire layout including Sidebar/TopBar logic is now inside DashboardContent to manage "Project List" vs "Project Dashboard" modes cleanly */}
      <DashboardContent />
    </div>
  );
}
