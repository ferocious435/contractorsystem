import type { HTMLAttributes } from "react";

export function Panel({ material = "glass", className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { material?: "metal" | "glass" | "plain" }) {
  return <div {...props} className={`ti-panel ti-panel--${material} ${className}`}><div className="ti-panel__body">{children}</div></div>;
}
