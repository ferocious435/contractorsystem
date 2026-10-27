"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VAT_RATE } from "@/utils/constants";
import {
  getAmountInclVat,
  getAmountVat,
  getLedgerRowAmount,
  getMoneySum,
} from "@/utils/project-financials";
import { createClient } from "@/utils/supabase/client";

import {
  deleteVoLetter as apiDeleteVoLetter,
  fetchContradictionsByIds,
  fetchLedgerItems as apiFetchLedgerItems,
  fetchProjectName,
  fetchLetterPrintContext,
  fetchSavedLetters as apiFetchSavedLetters,
  generateLetter as apiGenerateLetter,
  saveVoLetter,
} from "../api/smartLetterApi";
import type {
  SavedSmartLetter,
  SmartLetterLedgerItem,
  ToneValue,
  UseSmartLetterStateParams,
  UseSmartLetterStateResult,
  LetterTypeValue,
  SmartLetterState,
} from "../types";
import {blockedLetterPrintContext, type LetterPrintContext} from '../letterPrintContext';

export function useSmartLetterState({
  projectId,
  initialSelectedItems,
}: UseSmartLetterStateParams): UseSmartLetterStateResult {
  const [letterType, setLetterType] = useState<LetterTypeValue | "">("");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [tone, setTone] = useState<ToneValue>("professional");
  const [generatedLetter, setGeneratedLetter] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [ledgerItems, setLedgerItems] = useState<SmartLetterLedgerItem[]>([]);
  const [selectedLedgerItems, setSelectedLedgerItems] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"edit" | "history">("edit");
  const [savedLetters, setSavedLetters] = useState<SavedSmartLetter[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [operationError, setOperationError] = useState<SmartLetterState['operationError']>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(true);
  const [ledgerReadFailed, setLedgerReadFailed] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingPrintContext, setIsLoadingPrintContext] = useState(false);
  const [printContext, setPrintContext] = useState<LetterPrintContext | null>(null);
  const printRequest = useRef(0);

  const supabase = useMemo(() => createClient(), []);

  const loadPrintContext = useCallback(async (letterId: string) => {
    const request = ++printRequest.current;
    setShowPrintPreview(false);
    setIsLoadingPrintContext(true); setPrintContext(null);
    try {
      const context = await fetchLetterPrintContext(supabase, projectId, letterId);
      if (request === printRequest.current) setPrintContext(context);
    } catch (cause) {
      console.error('[PRINT_CONTEXT_ERROR]:', cause);
      if (request === printRequest.current) setPrintContext(blockedLetterPrintContext(letterId, 'לא ניתן לקרוא את הצירוף הכספי של המכתב כרגע. הטקסט והסכומים השמורים לא שונו.'));
    } finally {
      if (request === printRequest.current) setIsLoadingPrintContext(false);
    }
  }, [projectId, supabase]);

  const clearPrintContext = useCallback(() => {
    ++printRequest.current; setPrintContext(null); setIsLoadingPrintContext(false); setShowPrintPreview(false);
  }, []);

  useEffect(() => () => { ++printRequest.current; }, []);

  const fetchContextDetails = useCallback(
    async (ids: string[]) => {
      const contradictions = await fetchContradictionsByIds(supabase, ids);

      if (contradictions.length > 0) {
        const contradiction = contradictions[0];
        const title =
          typeof contradiction.title === "string" ? contradiction.title : "";
        const description =
          typeof contradiction.description === "string"
            ? contradiction.description
            : "";

        setSubject(`הודעה על סתירה/אי-התאמה: ${title}`);
        setKeyPoints(
          `נמצאה סתירה בין מסמכי החוזה לביצוע:\n${description}\n\nנדרשת הנחיה ברורה ותמחור חריג בהתאם לתנאי החוזה.`,
        );
        setLetterType("claim");
      }
    },
    [supabase],
  );

  const fetchLedgerItems = useCallback(async () => {
    setIsLoadingLedger(true);
    setOperationError(previous => previous?.kind === 'ledger' ? null : previous);
    try {
      const voItems = await apiFetchLedgerItems(supabase, projectId);
      setLedgerItems(voItems);
      setLedgerReadFailed(false);

      if (initialSelectedItems?.length) {
        const selectableIds = new Set(voItems.map((item) => item.id));
        setSelectedLedgerItems(
          initialSelectedItems.filter((id) => selectableIds.has(id)),
        );
      }
    } catch (err) {
      console.error("[LEDGER_FETCH_ERROR]:", err);
      setLedgerReadFailed(true);
      setOperationError({kind: 'ledger', message: 'לא ניתן לקרוא את השורות הכספיות כרגע. הבחירה הקודמת נשמרה.'});
    } finally {
      setIsLoadingLedger(false);
    }
  }, [initialSelectedItems, projectId, supabase]);

  const fetchSavedLetters = useCallback(async () => {
    setIsLoadingHistory(true);
    setOperationError(previous => previous?.kind === 'history' ? null : previous);
    try {
      const [nextProjectName, nextSavedLetters] = await Promise.all([
        fetchProjectName(supabase, projectId),
        apiFetchSavedLetters(supabase, projectId),
      ]);

      if (nextProjectName) setProjectName(nextProjectName);
      setSavedLetters(nextSavedLetters);
    } catch (err) {
      console.error("[HISTORY_FETCH_ERROR]:", err);
      setOperationError({kind: 'history', message: 'לא ניתן לקרוא את היסטוריית המכתבים כרגע. אפשר לנסות שוב.'});
    } finally {
      setIsLoadingHistory(false);
    }
  }, [projectId, supabase]);

  useEffect(() => {
    if (initialSelectedItems && initialSelectedItems.length > 0) {
      void fetchContextDetails(initialSelectedItems);
    }
  }, [fetchContextDetails, initialSelectedItems]);

  useEffect(() => {
    if (projectId) {
      void fetchLedgerItems();
      void fetchSavedLetters();
    }
  }, [fetchLedgerItems, fetchSavedLetters, projectId]);

  const selectedItems = useMemo(
    () => ledgerItems.filter((item) => selectedLedgerItems.includes(item.id)),
    [ledgerItems, selectedLedgerItems],
  );

  const subtotal = useMemo(
    () =>
      selectedItems.reduce(
        (sum, item) => getMoneySum([sum, getLedgerRowAmount(item)]),
        0,
      ),
    [selectedItems],
  );

  const vat = useMemo(() => getAmountVat(subtotal, VAT_RATE), [subtotal]);
  const totalInclVat = useMemo(
    () => getAmountInclVat(subtotal, VAT_RATE),
    [subtotal],
  );

  const generateLetter = useCallback(async () => {
    if (!letterType) return;
    setOperationError(null); clearPrintContext();
    setIsGenerating(true);
    setGeneratedLetter("");

    try {
      const data = await apiGenerateLetter({
        projectId,
        letterType,
        recipient,
        subject,
        keyPoints,
        tone,
        itemIds: selectedItems.map((item) => item.id),
      });

      if (data.success) {
        setGeneratedLetter(data.letter || "");
      } else {
        setOperationError({kind: 'generate', message: data.error || 'הכנת הטיוטה לא הושלמה. אפשר לנסות שוב.'});
      }
    } catch (err) {
      console.error("[GENERATE_ERROR]:", err);
      setOperationError({kind: 'generate', message: 'הכנת הטיוטה לא הושלמה בגלל בעיית חיבור. אפשר לנסות שוב.'});
    } finally {
      setIsGenerating(false);
    }
  }, [clearPrintContext, keyPoints, letterType, projectId, recipient, selectedItems, subject, tone]);

  const copyLetter = useCallback(async () => {
    if (!generatedLetter) return;
    setIsCopied(false); setOperationError(null);
    try {
      await navigator.clipboard.writeText(generatedLetter);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      setOperationError({kind: 'copy', message: 'ההעתקה לא הושלמה. אפשר לבחור את הטקסט ולהעתיק ידנית.'});
    }
  }, [generatedLetter]);

  const saveLetter = useCallback(async () => {
    if (!generatedLetter || !projectId) return;
    setSaveSuccess(false); setOperationError(null);
    setIsSaving(true);

    try {
      const letterId = await saveVoLetter({
        projectId,
        subject: subject || `דרישת תשלום ${new Date().getTime()}`,
        recipientName: recipient,
        docType: letterType,
        content: generatedLetter,
        itemIds: selectedLedgerItems,
      });

      setSaveSuccess(true);
      if (letterId) void loadPrintContext(letterId);
      else setPrintContext(blockedLetterPrintContext('', 'המכתב נשמר אך מזההו לא התקבל. אפשר לבחור אותו מההיסטוריה כדי לקרוא את השורות המקושרות.'));
      void fetchSavedLetters();
      void fetchLedgerItems();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("[SAVE_ERROR]:", err);
      setOperationError({kind: 'save', message: 'שמירת המכתב לא הושלמה. ' + (err instanceof Error ? err.message : 'הטקסט נשאר בחלון לבדיקה.')});
    } finally {
      setIsSaving(false);
    }
  }, [
    fetchLedgerItems,
    fetchSavedLetters,
    generatedLetter,
    letterType,
    loadPrintContext,
    projectId,
    recipient,
    selectedLedgerItems,
    subject,
  ]);

  const deleteLetter = useCallback(
    async (id: string, confirmed = false) => {
      if (!confirmed) return;
      setOperationError(null);

      setIsDeleting(id);
      try {
        await apiDeleteVoLetter(id);
        void fetchSavedLetters();
      } catch (err) {
        console.error("[DELETE_ERROR]:", err);
        setOperationError({kind: 'delete', message: 'מחיקת המכתב לא הושלמה. ההיסטוריה נשארה לתצוגה.'});
        throw err;
      } finally {
        setIsDeleting(null);
      }
    },
    [fetchSavedLetters],
  );

  const openPrintPreview = useCallback(() => {
    if (!generatedLetter || isLoadingPrintContext || (printContext ? !printContext.matchesStoredTotals : selectedItems.length === 0)) return;
    setShowPrintPreview(true);
  }, [generatedLetter, isLoadingPrintContext, printContext, selectedItems.length]);

  const closePrintPreview = useCallback(() => {
    setShowPrintPreview(false);
  }, []);

  const selectSavedLetter = useCallback((letter: SavedSmartLetter) => {
    setGeneratedLetter(letter.content);
    setSubject(letter.subject);
    setRecipient(letter.recipient_name || "");
    setViewMode("edit");
    setSelectedLedgerItems([]); setSaveSuccess(false); setOperationError(null);
    void loadPrintContext(letter.id);
  }, [loadPrintContext]);

  const toggleLedgerItem = useCallback((id: string) => {
    clearPrintContext(); setSaveSuccess(false);
    setSelectedLedgerItems((prev) =>
      prev.includes(id)
        ? prev.filter((selectedId) => selectedId !== id)
        : [...prev, id],
    );
  }, [clearPrintContext]);

  return {
    state: {
      operationError,
      isLoadingLedger,
      ledgerReadFailed,
      isLoadingHistory,
      isLoadingPrintContext,
      printContext,
      letterType,
      recipient,
      subject,
      keyPoints,
      tone,
      generatedLetter,
      isGenerating,
      isCopied,
      isSaving,
      saveSuccess,
      ledgerItems,
      selectedLedgerItems,
      viewMode,
      savedLetters,
      isDeleting,
      showPrintPreview,
      projectName,
    },
    setters: {
      setLetterType,
      setRecipient,
      setSubject,
      setKeyPoints,
      setTone,
      setGeneratedLetter,
      setSelectedLedgerItems,
      setViewMode,
    },
    actions: {
      retryPrintContext: async () => {if (printContext?.letterId) await loadPrintContext(printContext.letterId);},
      fetchContextDetails,
      fetchLedgerItems,
      fetchSavedLetters,
      generateLetter,
      copyLetter,
      saveLetter,
      deleteLetter,
      openPrintPreview,
      closePrintPreview,
      selectSavedLetter,
      toggleLedgerItem,
    },
    derived: {
      canPrint: Boolean(generatedLetter && !isLoadingPrintContext && (printContext ? printContext.matchesStoredTotals : selectedItems.length)),
      selectedItems,
      subtotal,
      vat,
      totalInclVat,
      canGenerate: Boolean(letterType && selectedItems.length),
      canSave: Boolean(generatedLetter && projectId && selectedLedgerItems.length),
    },
  };
}
