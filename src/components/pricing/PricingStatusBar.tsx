"use client";
import { useAiReadiness } from '@/hooks/useAiReadiness';
export default function PricingStatusBar({ projectId }: {
    projectId: string;
}) { const status = useAiReadiness('pricing'); return <footer className="ti-pricing-status" data-project-id={projectId}><span>חיבור העוזר: {status === null ? 'בודק זמינות…' : status.available ? 'זמין' : 'אינו זמין כרגע'}</span></footer>; }
