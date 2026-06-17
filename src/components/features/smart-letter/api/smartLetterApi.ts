import type { SupabaseClient } from "@supabase/supabase-js";

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
): Promise<void> {
  const saveRes = await fetch("/api/pricing/vo-letters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!saveRes.ok) {
    const data = await saveRes.json();
    throw new Error(data.error || "שגיאה בשמירת המכתב.");
  }
}

export async function deleteVoLetter(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("vo_letters")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
