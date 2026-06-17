import type { Dispatch, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";

export type LetterTypeValue =
  | "claim"
  | "notice"
  | "vo_request"
  | "response"
  | "general";

export type ToneValue =
  | "professional"
  | "formal"
  | "firm"
  | "aggressive"
  | "friendly"
  | "skeleton";

export type SmartLetterViewMode = "edit" | "history";

export type LetterTypeColor = "red" | "blue" | "amber" | "emerald" | "gray";

export interface SmartLetterGeneratorProps {
  projectId: string;
  initialSelectedItems?: string[];
  onClose?: () => void;
}

export interface LetterTypeOption {
  value: LetterTypeValue;
  label: string;
  icon: LucideIcon;
  desc: string;
  color: LetterTypeColor;
}

export interface ToneOption {
  value: ToneValue;
  label: string;
}

export interface SmartLetterLedgerItem {
  id: string;
  project_id?: string;
  contradiction_id?: string | null;
  item_code?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  total_amount?: number | null;
  unit_price_excl_vat?: number | null;
  total_price_excl_vat?: number | null;
  vat_rate?: number | null;
  type?: string | null;
  status?: string | null;
  source?: string | null;
  price_source?: string | null;
  ai_rationale?: string | null;
  governing_notes?: string | null;
  evidence_data?: {
    source?: string | null;
    pricelist_item_id?: string | null;
    [key: string]: unknown;
  } | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface SavedSmartLetter {
  id: string;
  project_id: string;
  letter_number?: string | null;
  subject: string;
  recipient_name?: string | null;
  doc_type?: string | null;
  content: string;
  total_amount?: number | null;
  total_amount_incl_vat?: number | null;
  created_at: string;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface GenerateSmartLetterPayload {
  projectId: string;
  letterType: LetterTypeValue | string;
  recipient: string;
  subject: string;
  keyPoints: string;
  tone: ToneValue | string;
  itemIds: string[];
}

export interface GenerateSmartLetterResponse {
  success?: boolean;
  letter?: string;
  error?: string;
}

export interface SaveSmartLetterPayload {
  projectId: string;
  subject: string;
  recipientName: string;
  docType: LetterTypeValue | string;
  content: string;
  itemIds: string[];
}

export interface SmartLetterState {
  letterType: LetterTypeValue | "";
  recipient: string;
  subject: string;
  keyPoints: string;
  tone: ToneValue;
  generatedLetter: string;
  isGenerating: boolean;
  isCopied: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  ledgerItems: SmartLetterLedgerItem[];
  selectedLedgerItems: string[];
  viewMode: SmartLetterViewMode;
  savedLetters: SavedSmartLetter[];
  isDeleting: string | null;
  showPrintPreview: boolean;
  projectName: string;
}

export interface UseSmartLetterStateParams {
  projectId: string;
  initialSelectedItems?: string[];
}

export interface SmartLetterSetters {
  setLetterType: Dispatch<SetStateAction<LetterTypeValue | "">>;
  setRecipient: Dispatch<SetStateAction<string>>;
  setSubject: Dispatch<SetStateAction<string>>;
  setKeyPoints: Dispatch<SetStateAction<string>>;
  setTone: Dispatch<SetStateAction<ToneValue>>;
  setGeneratedLetter: Dispatch<SetStateAction<string>>;
  setSelectedLedgerItems: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<SmartLetterViewMode>>;
}

export interface SmartLetterDerivedState {
  selectedItems: SmartLetterLedgerItem[];
  subtotal: number;
  vat: number;
  totalInclVat: number;
  canGenerate: boolean;
  canSave: boolean;
}

export interface SmartLetterActions {
  fetchContextDetails: (ids: string[]) => Promise<void>;
  fetchLedgerItems: () => Promise<void>;
  fetchSavedLetters: () => Promise<void>;
  generateLetter: () => Promise<void>;
  copyLetter: () => void;
  saveLetter: () => Promise<void>;
  deleteLetter: (id: string) => Promise<void>;
  openPrintPreview: () => void;
  closePrintPreview: () => void;
  selectSavedLetter: (letter: SavedSmartLetter) => void;
  toggleLedgerItem: (id: string) => void;
}

export interface UseSmartLetterStateResult {
  state: SmartLetterState;
  setters: SmartLetterSetters;
  actions: SmartLetterActions;
  derived: SmartLetterDerivedState;
}
