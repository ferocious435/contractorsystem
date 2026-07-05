"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
} from "../types";

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

  const supabase = useMemo(() => createClient(), []);

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
    try {
      const voItems = await apiFetchLedgerItems(supabase, projectId);
      setLedgerItems(voItems);

      if (initialSelectedItems?.length) {
        const selectableIds = new Set(voItems.map((item) => item.id));
        setSelectedLedgerItems(
          initialSelectedItems.filter((id) => selectableIds.has(id)),
        );
      }
    } catch (err) {
      console.error("[LEDGER_FETCH_ERROR]:", err);
    }
  }, [initialSelectedItems, projectId, supabase]);

  const fetchSavedLetters = useCallback(async () => {
    try {
      const [nextProjectName, nextSavedLetters] = await Promise.all([
        fetchProjectName(supabase, projectId),
        apiFetchSavedLetters(supabase, projectId),
      ]);

      if (nextProjectName) setProjectName(nextProjectName);
      setSavedLetters(nextSavedLetters);
    } catch (err) {
      console.error("[HISTORY_FETCH_ERROR]:", err);
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
        setGeneratedLetter(
          `שגיאה ביצירת המכתב: ${data.error || "תקלה לא ידועה"}`,
        );
      }
    } catch (err) {
      console.error("[GENERATE_ERROR]:", err);
      setGeneratedLetter(
        "שגיאה בחיבור - אנא בדוק את החיבור ל-Gemini ונסה שנית.",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [keyPoints, letterType, projectId, recipient, selectedItems, subject, tone]);

  const copyLetter = useCallback(() => {
    if (!generatedLetter) return;
    void navigator.clipboard.writeText(generatedLetter);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [generatedLetter]);

  const saveLetter = useCallback(async () => {
    if (!generatedLetter || !projectId) return;
    setIsSaving(true);

    try {
      await saveVoLetter({
        projectId,
        subject: subject || `דרישת תשלום ${new Date().getTime()}`,
        recipientName: recipient,
        docType: letterType,
        content: generatedLetter,
        itemIds: selectedLedgerItems,
      });

      setSaveSuccess(true);
      void fetchSavedLetters();
      void fetchLedgerItems();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("[SAVE_ERROR]:", err);
    } finally {
      setIsSaving(false);
    }
  }, [
    fetchLedgerItems,
    fetchSavedLetters,
    generatedLetter,
    letterType,
    projectId,
    recipient,
    selectedLedgerItems,
    subject,
  ]);

  const deleteLetter = useCallback(
    async (id: string) => {
      if (
        !confirm(
          "בטל מחיקת המסמך מהארכיון המוגן. האם אתה בטוח?",
        )
      ) {
        return;
      }

      setIsDeleting(id);
      try {
        await apiDeleteVoLetter(id);
        void fetchSavedLetters();
      } catch (err) {
        console.error("[DELETE_ERROR]:", err);
      } finally {
        setIsDeleting(null);
      }
    },
    [fetchSavedLetters],
  );

  const openPrintPreview = useCallback(() => {
    if (!generatedLetter) return;
    setShowPrintPreview(true);
  }, [generatedLetter]);

  const closePrintPreview = useCallback(() => {
    setShowPrintPreview(false);
  }, []);

  const selectSavedLetter = useCallback((letter: SavedSmartLetter) => {
    setGeneratedLetter(letter.content);
    setSubject(letter.subject);
    setRecipient(letter.recipient_name || "");
    setViewMode("edit");
  }, []);

  const toggleLedgerItem = useCallback((id: string) => {
    setSelectedLedgerItems((prev) =>
      prev.includes(id)
        ? prev.filter((selectedId) => selectedId !== id)
        : [...prev, id],
    );
  }, []);

  return {
    state: {
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
      selectedItems,
      subtotal,
      vat,
      totalInclVat,
      canGenerate: Boolean(letterType && selectedItems.length),
      canSave: Boolean(generatedLetter && projectId && selectedLedgerItems.length),
    },
  };
}
