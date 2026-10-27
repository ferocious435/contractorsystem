"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

let openDialogs = 0;
let originalOverflow = "";

export function Dialog({ open, labelledBy, onClose, children, className = "" }: { open: boolean; labelledBy: string; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openDialogs++ === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    // Native modal dialogs provide a focus trap, inert background and nested Escape handling.
    dialog.showModal();
    return () => {
      dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = originalOverflow;
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} dir="rtl" tabIndex={-1} aria-labelledby={labelledBy} className={`titanium-theme ti-dialog ${className}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); closeRef.current(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const dialog = event.currentTarget;
    const targets = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const first = targets[0], last = targets[targets.length - 1], active = document.activeElement;
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current();
  }}><div className="ti-dialog__body">{children}</div></dialog>, document.body);
}
