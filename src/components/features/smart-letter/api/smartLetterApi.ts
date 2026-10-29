import type { SupabaseClient } from "@supabase/supabase-js";
import {assessLetterPrintContext, blockedLetterPrintContext, type LetterPrintContext} from '../letterPrintContext';
import type { LetterDraftPreview, LetterDraftSnapshot, PreviewLetterRequest, SaveLetterDraftRequest, SavedLetterResult, MarkLetterSentRequest } from '@/utils/letter-draft-types';

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

export class LetterRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function hasSnapshot(value: unknown): value is LetterDraftSnapshot {
  if (!isRecord(value) || value.calculationVersion !== 'letter-individual-v1' || !isRecord(value.totals)
    || !['net', 'vat', 'gross'].every(key => typeof (value.totals as Record<string, unknown>)[key] === 'number'
      && Number.isFinite((value.totals as Record<string, number>)[key])) || !Array.isArray(value.items) || !value.items.length) return false;
  const seen = new Set<string>(), sums = {net: 0, vat: 0, gross: 0};
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.ledgerItemId !== 'string' || !item.ledgerItemId || seen.has(item.ledgerItemId)
      || !['quantity', 'unitPriceExclVat', 'vatRate'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
      || Number(item.quantity) <= 0 || Number(item.vatRate) < 0 || Number(item.vatRate) > 1
      || !['manual', 'source', 'confirmed-zero'].includes(String(item.conditionBasis))
      || typeof item.conditionNote !== 'string' || !item.conditionNote.trim()
      || !Array.isArray(item.sources) || !item.sources.length) return false;
    seen.add(item.ledgerItemId);
    for (const key of ['net', 'vat', 'gross'] as const) {
      if (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || !Number.isSafeInteger(Math.round(item[key] * 100))) return false;
      sums[key] += Math.round(item[key] * 100);
      if (!Number.isSafeInteger(sums[key])) return false;
    }
    for (const source of item.sources) {
      if (!isRecord(source) || !['DOCUMENT', 'MANUAL'].includes(String(source.basis))
        || !['VERIFIED', 'REQUIRES_VERIFICATION'].includes(String(source.status))
        || !['documentId', 'title', 'pageLabel', 'quote', 'manualNote'].every(key => source[key] === null || typeof source[key] === 'string')
        || (source.status === 'VERIFIED' && (source.basis !== 'DOCUMENT' || !source.documentId || !source.quote))
        || (source.basis === 'MANUAL' && (typeof source.manualNote !== 'string' || !source.manualNote.trim()))) return false;
    }
  }
  return (['net', 'vat', 'gross'] as const).every(key => sums[key] === Math.round(Number((value.totals as Record<string, unknown>)[key]) * 100));
}
async function postLetterRequest(url: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
export function saveVoLetter(payload: SaveLetterDraftRequest): Promise<SavedLetterResult>;
/** The pre-draft UI remains type-compatible until its state is migrated; it cannot write an incomplete request. */
export function saveVoLetter(payload: SaveSmartLetterPayload): Promise<string | null>;
export async function saveVoLetter(payload: SaveLetterDraftRequest | SaveSmartLetterPayload): Promise<SavedLetterResult | string | null> {
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
