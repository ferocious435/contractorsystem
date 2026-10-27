"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode };

export function Field({ label, hint, error, id, className = "", ...props }: FieldProps) {
  const generated = useId();
  const fieldId = id || generated;
  const description = [props["aria-describedby"], hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className={`ti-field ${className}`}>
    <label className="ti-field__label" htmlFor={fieldId}>{label}</label>
    <input {...props} id={fieldId} className="ti-input" aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={description} />
    {hint && <span id={`${fieldId}-hint`} className="ti-field__hint">{hint}</span>}
    {error && <span id={`${fieldId}-error`} className="ti-field__error">{error}</span>}
  </div>;
}
