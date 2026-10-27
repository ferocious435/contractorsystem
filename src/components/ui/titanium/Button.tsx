"use client";

import { useId, type ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "text" | "danger";
  pending?: boolean;
  busyLabel?: string;
  disabledReason?: string;
};

export function Button({ variant = "secondary", pending = false, busyLabel = "טוען…", disabledReason, disabled, type = "button", className = "", children, ...props }: ButtonProps) {
  const reasonId = useId();
  const unavailable = disabled || pending;
  const reason = unavailable && disabledReason;
  const describedBy = [props["aria-describedby"], reason ? reasonId : undefined].filter(Boolean).join(" ") || undefined;
  const control = <button {...props} type={type} disabled={unavailable} aria-busy={pending || undefined} aria-describedby={describedBy} className={`ti-button ti-button--${variant} ${className}`}>
    {pending && <span className="ti-spinner" aria-hidden="true" />}
    <span className="ti-button__label">{pending ? busyLabel : children}</span>
  </button>;
  return reason ? <span className="ti-action-with-reason">{control}<span className="ti-action-reason" id={reasonId}>{disabledReason}</span></span> : control;
}
