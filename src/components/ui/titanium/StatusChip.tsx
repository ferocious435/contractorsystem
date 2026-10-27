import type { HTMLAttributes, ReactNode } from "react";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function StatusChip({ children, tone = "neutral", icon, className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone; icon?: ReactNode }) {
  return <span {...props} className={`ti-chip ti-tone--${tone} ${className}`}>{icon && <span aria-hidden="true" className="ti-chip__icon">{icon}</span>}{children}</span>;
}
