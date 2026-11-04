"use client";

import type { InputHTMLAttributes } from "react";

type SelectionCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** Keep the native checkbox while giving a table selection its own hit area. */
export function SelectionCheckbox(props: SelectionCheckboxProps) {
  return <label className="ti-selection-checkbox"><input {...props} type="checkbox" /></label>;
}
