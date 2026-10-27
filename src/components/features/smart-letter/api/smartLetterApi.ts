import type { SupabaseClient } from "@supabase/supabase-js";
import {assessLetterPrintContext, blockedLetterPrintContext, type LetterPrintContext} from '../letterPrintContext';

import type {
  GenerateSmartLetterPayload,
  GenerateSmartLetterResponse,
  SavedSmartLetter,
  SaveSmartLetterPayload,
  SmartLetterLedgerItem,
} from "../types";

export type SmartLetterContradiction = Record<string, unknown> & {
  id: string;
  title?: string | null;
  description?: string | null;
};

export async function fetchContradictionsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<SmartLetterContradiction[]> {
  const { data: contradictions } = await supabase
    .from("contradictions")
    .select("*")
    .in("id", ids);

  return (contradictions || []) as SmartLetterContradiction[];
}

export async function fetchLedgerItems(
  supabase: SupabaseClient,
  projectId: string,
): Promise<SmartLetterLedgerItem[]> {
  const { data, error } = await supabase
    .from("pricing_ledger")
    .select("*")
    .eq("project_id", projectId)
    .in("type", ["PENDING_VO", "APPROVED_VO"]);

  if (error) throw error;
  return (data || []) as SmartLetterLedgerItem[];
}

export async function fetchProjectName(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string> {
  const { data: projectData } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  return typeof projectData?.name === "string" ? projectData.name : "";
}

export async function fetchSavedLetters(
  supabase: SupabaseClient,
  projectId: string,
): Promise<SavedSmartLetter[]> {
  const { data, error } = await supabase
    .from("vo_letters")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as SavedSmartLetter[];
}

export async function generateLetter(
  payload: GenerateSmartLetterPayload,
): Promise<GenerateSmartLetterResponse> {
  const response = await fetch("/api/generate-letter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return (await response.json()) as GenerateSmartLetterResponse;
}

export async function saveVoLetter(
  payload: SaveSmartLetterPayload,
): Promise<string | null> {
  const saveRes = await fetch("/api/pricing/vo-letters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!saveRes.ok) {
    const data = await saveRes.json();
    throw new Error(data.error || "שגיאה בשמירת המכתב.");
  }
  const saved = await saveRes.json();
  return typeof saved.letterId === 'string' ? saved.letterId : null;
}

/** Reads existing links only after verifying the selected letter belongs to this project. */
export async function fetchLetterPrintContext(supabase: SupabaseClient, projectId: string, letterId: string): Promise<LetterPrintContext> {
  const {data: letter, error: letterError} = await supabase.from('vo_letters')
    .select('*').eq('id', letterId).eq('project_id', projectId).single();
  if (letterError) throw letterError;
  if (!letter || letter.id !== letterId || letter.project_id !== projectId) return blockedLetterPrintContext(letterId, 'המכתב אינו זמין בפרויקט הזה.');
  const {data: links, error: linkError, count: linkedCount} = await supabase.from('vo_letter_items')
    .select('ledger_item_id, sort_order', {count: 'exact'}).eq('letter_id', letterId).order('sort_order', {ascending: true});
  if (linkError) throw linkError;
  if (!Array.isArray(links) || linkedCount === null || linkedCount !== links.length) {
    return assessLetterPrintContext({projectId, letterId, letter, links, rows: [], linkedCount: linkedCount ?? null});
  }
  const ids = Array.isArray(links) ? links.map(link => link.ledger_item_id).filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  if (!ids.length) return assessLetterPrintContext({projectId, letterId, letter, links, rows: [], linkedCount});
  const rows: SmartLetterLedgerItem[] = [];
  // Keep each read bounded even when a letter contains many linked rows.
  for (let index = 0; index < ids.length; index += 100) {
    const {data, error} = await supabase.from('pricing_ledger').select('*').eq('project_id', projectId).in('id', ids.slice(index, index + 100));
    if (error) throw error;
    if (data) rows.push(...data as SmartLetterLedgerItem[]);
  }
  return assessLetterPrintContext({projectId, letterId, letter, links, rows, linkedCount});
}

export async function deleteVoLetter(
  id: string,
): Promise<void> {
  const deleteRes = await fetch("/api/pricing/vo-letters", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ letterId: id }),
  });

  if (!deleteRes.ok) {
    const data = await deleteRes.json();
    throw new Error(data.error || "שגיאה במחיקת המכתב.");
  }
}
