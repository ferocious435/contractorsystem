import {
  FileText,
  Gavel,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";

import type { LetterTypeOption, ToneOption } from "./types";

export const LETTER_TYPES = [
  {
    value: "claim",
    label: "תביעה / דרישה",
    icon: Gavel,
    desc: "מודול תביעות",
    color: "red",
  },
  {
    value: "notice",
    label: "הודעה רשמית",
    icon: Shield,
    desc: "פרוטוקול הודעות",
    color: "blue",
  },
  {
    value: "vo_request",
    label: "בקשת חריג",
    icon: Zap,
    desc: "ועדת חריגים",
    color: "amber",
  },
  {
    value: "response",
    label: "תשובה למזמין",
    icon: Terminal,
    desc: "מענה למזמין",
    color: "emerald",
  },
  {
    value: "general",
    label: "מכתב כללי",
    icon: FileText,
    desc: "מכתב כללי",
    color: "gray",
  },
] as const satisfies readonly LetterTypeOption[];

export const TONE_OPTIONS = [
  { value: "professional", label: "מקצועי" },
  { value: "formal", label: "פורמלי" },
  { value: "firm", label: "תקיף" },
  { value: "aggressive", label: "אגרסיבי" },
  { value: "friendly", label: "נעים" },
  { value: "skeleton", label: "שלד / מבנה בלבד" },
] as const satisfies readonly ToneOption[];
