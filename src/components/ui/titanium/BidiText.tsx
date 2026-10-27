import type { HTMLAttributes } from "react";

export type BidiKind = "money" | "code" | "date" | "percent" | "file";

// Values arrive already formatted by their existing domain formatter.
export function BidiText({ value, kind, className = "", ...props }: { value: string; kind: BidiKind } & Omit<HTMLAttributes<HTMLElement>, "children" | "dir">) {
  return <bdi {...props} dir={kind === "money" ? "rtl" : kind === "file" ? "auto" : "ltr"} className={`ti-bidi ti-bidi--${kind} ${className}`}>{value}</bdi>;
}
