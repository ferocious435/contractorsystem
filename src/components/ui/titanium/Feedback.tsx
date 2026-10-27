import type { HTMLAttributes, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { StatusTone } from "./StatusChip";

export function Feedback({ tone = "info", children, title, className = "", ...props }: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { tone?: StatusTone; title?: ReactNode }) {
  const Icon = tone === "danger" ? AlertCircle : tone === "warning" ? TriangleAlert : tone === "success" ? CheckCircle2 : Info;
  return <div {...props} role={tone === "danger" ? "alert" : "status"} className={`ti-feedback ti-tone--${tone} ${className}`}>
    <Icon size={19} aria-hidden="true" /><div>{title && <strong className="ti-feedback__title">{title}</strong>}{children}</div>
  </div>;
}
