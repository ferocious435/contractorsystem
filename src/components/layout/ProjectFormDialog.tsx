"use client";

import { useId, type MouseEvent } from "react";
import { X, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/titanium/Dialog";
import { Button } from "@/components/ui/titanium/Button";
import { Field } from "@/components/ui/titanium/Field";
import { Feedback } from "@/components/ui/titanium/Feedback";

export interface ProjectFormValues { name: string; client_name: string; budget: number }
type FormProps = { mode: "create" | "edit"; values: ProjectFormValues; pending: boolean; error?: string; onChange(values: ProjectFormValues): void; onSave(): void | Promise<void>; onClose(): void };

export function ProjectFormContent({ mode, titleId, values, pending, error, onChange, onSave, onClose }: FormProps & { titleId: string }) {
  const nameError = error === "Project name is required" ? "נדרש שם פרויקט" : undefined;
  return <form className="ti-stack" onSubmit={event => { event.preventDefault(); if (!pending && values.name.trim()) void onSave(); }}>
    <header className="ti-dialog__header"><div><h2 className="ti-heading" id={titleId}>{mode === "create" ? "פרויקט חדש" : "עדכון פרויקט"}</h2><p className="ti-subtitle">פרטי הפרויקט וסכום החוזה הידוע</p></div><Button onClick={onClose} disabled={pending} aria-label="סגירת פרטי הפרויקט"><X size={18} aria-hidden="true" /></Button></header>
    <Field id={`${titleId}-name`} label="שם הפרויקט" value={values.name} onChange={event => onChange({ ...values, name: event.target.value })} required error={nameError} autoComplete="off" />
    <Field id={`${titleId}-client`} label="שם הלקוח" value={values.client_name} onChange={event => onChange({ ...values, client_name: event.target.value })} autoComplete="organization" />
    <Field id={`${titleId}-budget`} label={'סכום חוזה ידוע לפני מע"מ [₪]'} type="number" min={mode === "create" ? 0 : undefined} step="any" dir="ltr" value={values.budget} onChange={event => onChange({ ...values, budget: Number(event.target.value) })} />
    {error && !nameError && <Feedback tone="danger">לא ניתן לשמור את פרטי הפרויקט כרגע. הנתונים שהוזנו נשארו בטופס.</Feedback>}
    <footer className="ti-dialog__footer"><Button onClick={onClose} disabled={pending}>ביטול</Button><Button type="submit" variant="primary" pending={pending} busyLabel={mode === "create" ? "יוצר פרויקט…" : "שומר פרטים…"} disabled={!values.name.trim()} disabledReason={!values.name.trim() ? "יש להזין שם פרויקט" : undefined}>{mode === "create" ? "צור ופתח פרויקט" : "שמירת שינויים"}</Button></footer>
  </form>;
}

export function ProjectFormDialog({ open, ...props }: FormProps & { open: boolean }) {
  const titleId = useId();
  return <Dialog open={open} labelledBy={titleId} className="ti-project-form-dialog" onClose={() => { if (!props.pending) props.onClose(); }}><ProjectFormContent {...props} titleId={titleId} /></Dialog>;
}

type DeleteProps = { project: { id: string; name: string }; pending: boolean; error?: string; onConfirm(event: MouseEvent<HTMLButtonElement>): void | Promise<void>; onClose(): void };

export function ProjectDeleteContent({ project, pending, error, onConfirm, onClose, titleId = "delete-project-title" }: DeleteProps & { titleId?: string }) {
  return <div className="ti-stack"><h2 className="ti-heading" id={titleId}>מחיקת פרויקט</h2><p>למחוק את הפרויקט <strong>{project.name}</strong>?</p><Feedback tone="warning">הפעולה תמחק את הפרויקט ואת כל הנתונים השייכים לו.</Feedback>{error && <Feedback tone="danger">{error}</Feedback>}<footer className="ti-dialog__footer"><Button onClick={onClose} disabled={pending}>ביטול</Button><Button variant="danger" pending={pending} busyLabel="מוחק פרויקט…" onClick={onConfirm}><Trash2 size={16} aria-hidden="true" />מחק פרויקט</Button></footer></div>;
}

export function ProjectDeleteDialog({ project, ...props }: Omit<DeleteProps, "project"> & { project: DeleteProps["project"] | null }) {
  const titleId = useId();
  return <Dialog open={Boolean(project)} labelledBy={titleId} onClose={() => { if (!props.pending) props.onClose(); }}>{project && <ProjectDeleteContent {...props} project={project} titleId={titleId} />}</Dialog>;
}
