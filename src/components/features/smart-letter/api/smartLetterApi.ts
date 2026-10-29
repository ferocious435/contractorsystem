import {isRecord, isLetterDraftSnapshot as hasSnapshot} from '@/utils/letter-snapshot';
import type { SupabaseClient } from "@supabase/supabase-js";
import {assessLetterPrintContext, blockedLetterPrintContext, type LetterPrintContext} from '../letterPrintContext';
import type { LetterDraftPreview, PreviewLetterRequest, SaveLetterDraftRequest, SavedLetterResult, MarkLetterSentRequest } from '@/utils/letter-draft-types';

import type {
  GenerateSmartLetterPayload,
  GenerateSmartLetterResponse,
  SavedSmartLetter,
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
  const data = await postLetterRequest('/api/generate-letter', payload, 310_000);
  if (typeof data.letter !== 'string' || !data.letter.trim() || !hasSnapshot(data.snapshot)) {
    throw new LetterRequestError('התשובה המקומית אינה מלאה. הטקסט הקודם נשאר זמין.', 'LOCAL_RESPONSE_INVALID', 502);
  }
  return {success: true, letter: data.letter, snapshot: data.snapshot};
}

export class LetterRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

async function postLetterRequest(url: string, payload: unknown, timeoutMs?: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...(timeoutMs ? {signal: AbortSignal.timeout(timeoutMs)} : {}),
  });
  let data: unknown;
  try { data = await response.json(); } catch { throw new LetterRequestError('התשובה אינה מלאה. הטקסט נשאר זמין לניסיון חוזר.', 'LETTER_RESPONSE_INVALID', response.status); }
  if (!response.ok || !isRecord(data) || data.success !== true) {
    throw new LetterRequestError(isRecord(data) && typeof data.error === 'string' ? data.error : 'הפעולה לא הושלמה. אפשר לנסות שוב.',
      isRecord(data) && typeof data.code === 'string' ? data.code : 'LETTER_WRITE_FAILED', response.status);
  }
  return data;
}
function savedResponse(data: Record<string, unknown>): SavedLetterResult {
  if (typeof data.letterId !== 'string' || typeof data.clientDraftId !== 'string' || !Number.isSafeInteger(data.revision)
    || Number(data.revision) < 1 || !['DRAFT', 'SENT'].includes(String(data.status)) || !hasSnapshot(data.snapshot)
    || (data.status === 'SENT' ? typeof data.sentMarkedAt !== 'string' : data.sentMarkedAt !== null)) {
    throw new LetterRequestError('אישור השמירה אינו מלא. הטקסט נשאר זמין לבדיקה ולניסיון חוזר.', 'LETTER_RESPONSE_INVALID', 502);
  }
  return { letterId: data.letterId, clientDraftId: data.clientDraftId, status: data.status as 'DRAFT' | 'SENT',
    revision: data.revision as number, snapshot: data.snapshot, sentMarkedAt: data.sentMarkedAt as string | null };
}
export async function previewVoLetter(payload: PreviewLetterRequest): Promise<LetterDraftPreview> {
  const data = await postLetterRequest('/api/pricing/vo-letters/preview', payload);
  if (!hasSnapshot(data.snapshot) || !isRecord(data.sourceRevisions) || !Object.values(data.sourceRevisions).every(value => typeof value === 'string')) {
    throw new LetterRequestError('בדיקת הסכומים לא הושלמה. אפשר לנסות שוב.', 'LETTER_RESPONSE_INVALID', 502);
  }
  return { snapshot: data.snapshot, sourceRevisions: data.sourceRevisions as Record<string, string> };
}
export async function saveVoLetter(payload: SaveLetterDraftRequest): Promise<SavedLetterResult> {
  if (!('clientDraftId' in payload)) throw new LetterRequestError('יש לבדוק את הסכומים והמקורות לפני שמירת טיוטה.', 'LETTER_PREVIEW_REQUIRED', 400);
  return savedResponse(await postLetterRequest('/api/pricing/vo-letters', payload));
}
export async function markVoLetterSent(payload: MarkLetterSentRequest): Promise<SavedLetterResult> {
  return savedResponse(await postLetterRequest('/api/pricing/vo-letters/sent', payload));
}

/** Reads existing links only after verifying the selected letter belongs to this project. */
export async function fetchLetterPrintContext(supabase: SupabaseClient, projectId: string, letterId: string): Promise<LetterPrintContext> {
  const {data: letter, error: letterError} = await supabase.from('vo_letters')
    .select('*').eq('id', letterId).eq('project_id', projectId).single();
  if (letterError) throw letterError;
  if (!letter || letter.id !== letterId || letter.project_id !== projectId) return blockedLetterPrintContext(letterId, 'המכתב אינו זמין בפרויקט הזה.');
  if (letter.calculation_version !== 'letter-individual-v1') {
    return assessLetterPrintContext({projectId, letterId, letter, links: [], linkedCount: 0});
  }
  const {data: links, error: linkError, count: linkedCount} = await supabase.from('vo_letter_items')
    .select('letter_id, ledger_item_id, sort_order, pricing_snapshot, source_snapshot, source_revision', {count: 'exact'})
    .eq('letter_id', letterId).order('sort_order', {ascending: true});
  if (linkError) throw linkError;
  return assessLetterPrintContext({projectId, letterId, letter, links, linkedCount});
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
