"use client";

import { AlertCircle, ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/components/ui/titanium/Panel";
import { Button } from "@/components/ui/titanium/Button";

export function UnavailableView({ title = "המסך אינו זמין", message = "לא ניתן להציג את המידע כרגע. אפשר לנסות שוב או לחזור לפרויקטים.", onRetry, onBack, embedded = false }: { title?: string; message?: string; onRetry?(): void; onBack?(): void; embedded?: boolean }) {
  return <div className={`titanium-theme ti-unavailable ${embedded ? "ti-unavailable--embedded" : ""}`} dir="rtl"><Panel>
    <div className="ti-empty"><AlertCircle size={32} aria-hidden="true" /><h1 className="ti-title">{title}</h1><p className="ti-secondary">{message}</p><div className="ti-toolbar">
      {onRetry && <Button variant="primary" onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />ניסיון נוסף</Button>}
      {onBack ? <Button onClick={onBack}><ArrowRight size={16} aria-hidden="true" />חזרה לפרויקטים</Button> : <Link href="/" prefetch={false} className="ti-button">חזרה לפרויקטים</Link>}
    </div></div>
  </Panel></div>;
}
