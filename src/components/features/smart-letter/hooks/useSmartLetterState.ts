"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createClient} from '@/utils/supabase/client';
import {prepareLetterFinancialSnapshot} from '@/utils/letter-financials';
import {stableLetterValue} from '@/utils/letter-snapshot';
import type {LetterDraftPreview} from '@/utils/letter-draft-types';
import {deleteVoLetter as apiDeleteVoLetter, fetchContradictionsByIds, fetchLedgerItems as apiFetchLedgerItems,
  fetchProjectName, fetchLetterPrintContext, fetchSavedLetters as apiFetchSavedLetters, generateLetter as apiGenerateLetter,
  previewVoLetter, saveVoLetter, markVoLetterSent, LetterRequestError} from '../api/smartLetterApi';
import type {SavedSmartLetter, SmartLetterLedgerItem, ToneValue, UseSmartLetterStateParams, UseSmartLetterStateResult, LetterTypeValue, SmartLetterState} from '../types';
import {blockedLetterPrintContext, type LetterPrintContext} from '../letterPrintContext';
import {LetterDraftSession, letterDraftSignature} from '../letterDraftSession';

function selectionKey(projectId: string, docType: string, ids: string[], rows: SmartLetterLedgerItem[]): string {
  return stableLetterValue([projectId, docType, ids, ids.map(id => rows.find(row => row.id === id) || null)]);
}
function matchesCurrentSnapshot(preview: LetterDraftPreview, rows: SmartLetterLedgerItem[]): boolean {
  const ids = preview.snapshot.items.map(item => item.ledgerItemId);
  const selected = ids.map(id => rows.find(row => row.id === id));
  if (selected.some(row => !row)) return false;
  const current = prepareLetterFinancialSnapshot(selected as SmartLetterLedgerItem[]);
  const financial = preview.snapshot.items.map(item => ({ledgerItemId: item.ledgerItemId, quantity: item.quantity,
    unitPriceExclVat: item.unitPriceExclVat, net: item.net, vatRate: item.vatRate, vat: item.vat, gross: item.gross,
    conditionBasis: item.conditionBasis, conditionNote: item.conditionNote}));
  return current.ok && stableLetterValue(current.snapshot.items) === stableLetterValue(financial)
    && selected.every((row, index) => (row!.description ?? null) === preview.snapshot.items[index].description
      && (row!.item_code ?? null) === preview.snapshot.items[index].itemCode && (row!.unit ?? null) === preview.snapshot.items[index].unit);
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function useSmartLetterState({projectId, initialSelectedItems}: UseSmartLetterStateParams): UseSmartLetterStateResult {
  const session = useRef<LetterDraftSession | null>(null);
  if (!session.current) session.current = new LetterDraftSession(projectId);
  const [draft, setDraft] = useState(() => session.current!.state);
  const [letterType, setLetterType] = useState<LetterTypeValue | ''>('general');
  const [recipient, setRecipient] = useState(''), [subject, setSubject] = useState(''), [keyPoints, setKeyPoints] = useState('');
  const [tone, setTone] = useState<ToneValue>('professional'), [generatedLetter, setGeneratedLetter] = useState('');
  const [isGenerating, setIsGenerating] = useState(false), [isCopied, setIsCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false), [saveSuccess, setSaveSuccess] = useState(false);
  const [ledgerItems, setLedgerItems] = useState<SmartLetterLedgerItem[]>([]), [selectedLedgerItems, setSelectedLedgerItems] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'edit' | 'history'>('edit'), [savedLetters, setSavedLetters] = useState<SavedSmartLetter[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null), [showPrintPreview, setShowPrintPreview] = useState(false);
  const [projectName, setProjectName] = useState(''), [operationError, setOperationError] = useState<SmartLetterState['operationError']>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(true), [ledgerReadFailed, setLedgerReadFailed] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true), [isLoadingPrintContext, setIsLoadingPrintContext] = useState(false);
  const [printContext, setPrintContext] = useState<LetterPrintContext | null>(null);
  const [preview, setPreview] = useState<LetterDraftPreview | null>(null), [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false), [isMarkingSent, setIsMarkingSent] = useState(false);
  const epoch = useRef(0), printRequest = useRef(0), ledgerRequest = useRef(0), historyRequest = useRef(0), busy = useRef(false);
  const invalidateRequests = useCallback(() => {++epoch.current; ++printRequest.current; ++ledgerRequest.current; ++historyRequest.current;}, []);
  const activeProject = useRef(projectId), initial = useRef(initialSelectedItems), initialApplied = useRef(false);
  initial.current = initialSelectedItems;
  if (activeProject.current !== projectId) { activeProject.current = projectId; ++epoch.current; session.current.reset(projectId); }
  const supabase = useMemo(() => createClient(), []);
  const selectedItems = useMemo(() => selectedLedgerItems.map(id => ledgerItems.find(item => item.id === id)).filter((item): item is SmartLetterLedgerItem => Boolean(item)), [ledgerItems, selectedLedgerItems]);
  const financials = useMemo(() => selectedItems.length === selectedLedgerItems.length ? prepareLetterFinancialSnapshot(selectedItems)
    : {ok: false as const, issues: [{itemId: '', reason: 'selection-incomplete'}]}, [selectedItems, selectedLedgerItems.length]);
  const docType = draft.docType === 'official_vo' ? 'official_vo' : letterType || 'general';
  const key = selectionKey(projectId, docType, selectedLedgerItems, ledgerItems);
  const previewReady = Boolean(preview && reviewedKey === key);
  const signature = letterDraftSignature({projectId, docType, itemIds: selectedLedgerItems, subject, recipientName: recipient, content: generatedLetter});
  const isDirty = draft.savedSignature !== null ? signature !== draft.savedSignature
    || (previewReady && stableLetterValue(preview!.sourceRevisions) !== stableLetterValue(draft.sourceRevisions)) : Boolean(generatedLetter.trim());
  const readOnly = draft.status === 'SENT' || draft.isLegacy || draft.operationKind === 'sent' || Boolean(draft.letterId && !draft.snapshot);
  const latest = useRef({projectId, docType, selectedLedgerItems, subject, recipient, generatedLetter, key, signature, ledgerItems, preview, previewReady, readOnly});
  latest.current = {projectId, docType, selectedLedgerItems, subject, recipient, generatedLetter, key, signature, ledgerItems, preview, previewReady, readOnly};

  const clearPrintContext = useCallback(() => {++printRequest.current; setPrintContext(null); setIsLoadingPrintContext(false); setShowPrintPreview(false);}, []);
  const newDraft = useCallback(() => {
    ++epoch.current; busy.current = false; session.current!.reset(projectId); setDraft(session.current!.state);
    clearPrintContext(); setPreview(null); setReviewedKey(null); setGeneratedLetter(''); setSubject(''); setRecipient(''); setKeyPoints('');
    setLetterType('general'); setSelectedLedgerItems([]); setSaveSuccess(false); setOperationError(null); setViewMode('edit');
    setIsSaving(false); setIsMarkingSent(false); setIsPreviewing(false); setIsGenerating(false); setIsDeleting(null); setIsCopied(false);
  }, [clearPrintContext, projectId]);
  const loadPrintContext = useCallback(async (letterId: string, adopt = false) => {
    const request = ++printRequest.current, token = epoch.current;
    setShowPrintPreview(false); setIsLoadingPrintContext(true); setPrintContext(null);
    try {
      const context = await fetchLetterPrintContext(supabase, projectId, letterId);
      if (token !== epoch.current || request !== printRequest.current) return;
      setPrintContext(context);
      if (adopt && context.projectId === projectId) {
        session.current!.open(projectId, context); setDraft(session.current!.state);
        setGeneratedLetter(context.content); setSubject(context.subject); setRecipient(context.recipientName);
        setLetterType(['claim', 'notice', 'vo_request', 'response', 'general'].includes(context.docType) ? context.docType as LetterTypeValue : 'general');
        const ids = context.snapshot?.items.map(item => item.ledgerItemId) || []; setSelectedLedgerItems(ids);
        if (context.snapshot) {
          const savedPreview = {snapshot: context.snapshot, sourceRevisions: context.sourceRevisions};
          setPreview(savedPreview);
          setReviewedKey(matchesCurrentSnapshot(savedPreview, latest.current.ledgerItems)
            ? selectionKey(projectId, context.docType, ids, latest.current.ledgerItems) : null);
        }
      } else if (context.revision !== session.current!.state.revision) {
        setOperationError({kind: 'print', message: 'הגרסה השמורה השתנתה. יש לפתוח אותה שוב מההיסטוריה לפני הדפסה.'});
      }
    } catch {
      if (token === epoch.current && request === printRequest.current) setPrintContext(blockedLetterPrintContext(letterId, 'לא ניתן לקרוא את המכתב השמור כרגע. הטקסט נשאר זמין.'));
    } finally {if (token === epoch.current && request === printRequest.current) setIsLoadingPrintContext(false);}
  }, [projectId, supabase]);
  const fetchContextDetails = useCallback(async (ids: string[]) => {
    const token = epoch.current, previous = latest.current.signature;
    const contradictions = await fetchContradictionsByIds(supabase, ids);
    if (token !== epoch.current || previous !== latest.current.signature || session.current!.state.letterId) return;
    if (contradictions[0]) {setSubject(`הודעה על סתירה/אי-התאמה: ${contradictions[0].title || ''}`);
      setKeyPoints(`נמצאה סתירה בין מסמכי החוזה לביצוע:\n${contradictions[0].description || ''}\n\nנדרשת הנחיה ברורה ותמחור חריג בהתאם לתנאי החוזה.`); setLetterType('claim');}
  }, [supabase]);
  const fetchLedgerItems = useCallback(async () => {
    const request = ++ledgerRequest.current; setIsLoadingLedger(true);
    try {
      const rows = await apiFetchLedgerItems(supabase, projectId);
      if (activeProject.current !== projectId || request !== ledgerRequest.current) return;
      setLedgerItems(rows); setLedgerReadFailed(false); setOperationError(previous => previous?.kind === 'ledger' ? null : previous);
      if (!initialApplied.current) {
        initialApplied.current = true; const ids = (initial.current || []).filter(id => rows.some(row => row.id === id)); setSelectedLedgerItems(ids);
        const findings = rows.filter(row => ids.includes(row.id)).map(row => row.contradiction_id).filter((id): id is string => Boolean(id));
        if (findings.length) void fetchContextDetails([...new Set(findings)]);
      }
    } catch {if (activeProject.current === projectId && request === ledgerRequest.current) {setLedgerReadFailed(true); setOperationError({kind: 'ledger', message: 'לא ניתן לקרוא את השורות הכספיות. הטקסט והבחירה נשמרו.'});}}
    finally {if (activeProject.current === projectId && request === ledgerRequest.current) setIsLoadingLedger(false);}
  }, [fetchContextDetails, projectId, supabase]);
  const fetchSavedLetters = useCallback(async () => {
    const request = ++historyRequest.current; setIsLoadingHistory(true);
    try {
      const [name, letters] = await Promise.all([fetchProjectName(supabase, projectId), apiFetchSavedLetters(supabase, projectId)]);
      if (activeProject.current !== projectId || request !== historyRequest.current) return;
      setProjectName(name); setSavedLetters(letters); setOperationError(previous => previous?.kind === 'history' ? null : previous);
    } catch {if (activeProject.current === projectId && request === historyRequest.current) setOperationError({kind: 'history', message: 'קריאת ההיסטוריה לא הושלמה. אפשר לנסות שוב.'});}
    finally {if (activeProject.current === projectId && request === historyRequest.current) setIsLoadingHistory(false);}
  }, [projectId, supabase]);
  useEffect(() => {
    newDraft(); initialApplied.current = false; setLedgerItems([]); setSavedLetters([]); setProjectName('');
    void fetchLedgerItems(); void fetchSavedLetters();
    return invalidateRequests;
  }, [fetchLedgerItems, fetchSavedLetters, invalidateRequests, newDraft]);

  const reviewLetter = useCallback(async () => {
    if (busy.current || latest.current.readOnly) return;
    const view = latest.current, token = epoch.current; busy.current = true; setIsPreviewing(true); setOperationError(null); setPreview(null); setReviewedKey(null);
    try {
      const result = await previewVoLetter({projectId, docType: view.docType, itemIds: view.selectedLedgerItems});
      if (token === epoch.current && latest.current.key === view.key) {setPreview(result); setReviewedKey(view.key);}
    } catch (error) {if (token === epoch.current) setOperationError({kind: 'preview', message: message(error, 'בדיקת הסכומים והמקורות לא הושלמה.')});}
    finally {if (token === epoch.current) {busy.current = false; setIsPreviewing(false);}}
  }, [projectId]);
  const saveLetter = useCallback(async () => {
    const view = latest.current;
    if (busy.current || view.readOnly || !view.previewReady || !view.preview || !view.generatedLetter.trim()) return;
    const token = epoch.current; busy.current = true; setIsSaving(true); setSaveSuccess(false); setOperationError(null);
    let attempt: ReturnType<LetterDraftSession['saveAttempt']> | null = null;
    try {
      attempt = session.current!.saveAttempt({projectId, docType: view.docType, itemIds: view.selectedLedgerItems, subject: view.subject,
        recipientName: view.recipient, content: view.generatedLetter, sourceRevisions: view.preview.sourceRevisions});
      setDraft(session.current!.state);
      const result = await saveVoLetter(attempt.request);
      if (token !== epoch.current || !session.current!.saved(attempt, result)) return;
      setDraft(session.current!.state); setSaveSuccess(latest.current.signature === letterDraftSignature(attempt.request));
      void loadPrintContext(result.letterId); void fetchSavedLetters();
    } catch (error) {if (token === epoch.current) {
      if (attempt && error instanceof LetterRequestError && [400, 409, 422].includes(error.status)) {
        session.current!.rejectedSave(attempt); setPreview(null); setReviewedKey(null);
      }
      setDraft(session.current!.state); setOperationError({kind: 'save', message: message(error, 'שמירת הטיוטה לא הושלמה. הטקסט נשמר בחלון.')});}}
    finally {if (token === epoch.current) {busy.current = false; setIsSaving(false);}}
  }, [fetchSavedLetters, loadPrintContext, projectId]);
  const markLetterSent = useCallback(async () => {
    if (busy.current) return;
    const view = latest.current, current = session.current!.state;
    if (current.operationKind !== 'sent' && (view.readOnly || !view.previewReady || view.signature !== current.savedSignature)) {
      throw new Error('יש לשמור ולבדוק את הטיוטה לפני סימון השליחה.');
    }
    const token = epoch.current; busy.current = true; setIsMarkingSent(true); setOperationError(null);
    let attempt: ReturnType<LetterDraftSession['sentAttempt']> | null = null;
    try {
      attempt = session.current!.sentAttempt(); setDraft(session.current!.state);
      const result = await markVoLetterSent(attempt.request);
      if (token !== epoch.current) return;
      if (!session.current!.markedSent(attempt, result)) throw new Error('אישור הסימון אינו תואם למכתב השמור. יש לקרוא אותו שוב.');
      setDraft(session.current!.state); setPrintContext(previous => previous ? {...previous, status: 'SENT', revision: result.revision, sentMarkedAt: result.sentMarkedAt} : previous);
      void fetchSavedLetters(); void fetchLedgerItems();
    } catch (error) {if (token === epoch.current) {
      if (attempt && error instanceof LetterRequestError && [400, 409, 422].includes(error.status)) {
        session.current!.rejectedSent(attempt); setPreview(null); setReviewedKey(null);
      }
      setDraft(session.current!.state); setOperationError({kind: 'sent', message: message(error, 'הסימון לא הושלם. המכתב נשאר זמין לבדיקה.')}); throw error;}}
    finally {if (token === epoch.current) {busy.current = false; setIsMarkingSent(false);}}
  }, [fetchLedgerItems, fetchSavedLetters]);
  const generateLetter = useCallback(async () => {
    if (!letterType || latest.current.readOnly || busy.current) return;
    const token = epoch.current; setOperationError(null); setIsGenerating(true); setGeneratedLetter('');
    try {
      const data = await apiGenerateLetter({projectId, letterType, recipient, subject, keyPoints, tone, itemIds: selectedItems.map((item) => item.id)});
      if (token !== epoch.current) return;
      if (data.success) setGeneratedLetter(data.letter || ''); else setOperationError({kind: 'generate', message: data.error || 'הכנת הטיוטה לא הושלמה.'});
    } catch {if (token === epoch.current) setOperationError({kind: 'generate', message: 'הכנת הטיוטה לא הושלמה בגלל בעיית חיבור. אפשר לנסות שוב.'});}
    finally {if (token === epoch.current) setIsGenerating(false);}
  }, [keyPoints, letterType, projectId, recipient, selectedItems, subject, tone]);
  const copyLetter = useCallback(async () => {
    try {await navigator.clipboard.writeText(generatedLetter); setIsCopied(true); setOperationError(null);}
    catch {setOperationError({kind: 'copy', message: 'ההעתקה לא הושלמה. אפשר לבחור את הטקסט ולהעתיק ידנית.'});}
  }, [generatedLetter]);
  useEffect(() => {if (!isCopied) return; const timer = setTimeout(() => setIsCopied(false), 3000); return () => clearTimeout(timer);}, [isCopied]);
  const deleteLetter = useCallback(async (id: string, confirmed = false) => {
    if (!confirmed) return; const token = epoch.current; setIsDeleting(id); setOperationError(null);
    try {await apiDeleteVoLetter(id); if (token === epoch.current) {if (session.current!.state.letterId === id) newDraft(); void fetchSavedLetters();}}
    catch (error) {if (token === epoch.current) setOperationError({kind: 'delete', message: 'מחיקת המכתב לא הושלמה. ההיסטוריה נשארה זמינה.'}); throw error;}
    finally {if (token === epoch.current) setIsDeleting(null);}
  }, [fetchSavedLetters, newDraft]);
  const selectSavedLetter = useCallback((letter: SavedSmartLetter) => {
    if (letter.project_id !== projectId) return;
    ++epoch.current; busy.current = false;
    session.current!.open(projectId, {...blockedLetterPrintContext(letter.id, 'קורא את המכתב השמור…'), projectId,
      mode: letter.calculation_version === 'letter-individual-v1' ? 'snapshot' : 'legacy', status: letter.status || 'UNKNOWN',
      clientDraftId: letter.client_draft_id || null, revision: letter.revision ?? null, docType: letter.doc_type || 'general',
      content: letter.content, subject: letter.subject, recipientName: letter.recipient_name || ''}); setDraft(session.current!.state);
    setGeneratedLetter(letter.content); setSubject(letter.subject); setRecipient(letter.recipient_name || ''); setViewMode('edit');
    setSelectedLedgerItems([]); setPreview(null); setReviewedKey(null); setSaveSuccess(false); setOperationError(null); setIsSaving(false);
    setIsGenerating(false); setIsPreviewing(false); setIsMarkingSent(false); setIsDeleting(null);
    void loadPrintContext(letter.id, true);
  }, [loadPrintContext, projectId]);
  const toggleLedgerItem = useCallback((id: string) => {
    if (latest.current.readOnly) return;
    setPreview(null); setReviewedKey(null); setSaveSuccess(false); setShowPrintPreview(false);
    setSelectedLedgerItems(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  }, []);
  const canPrint = Boolean(generatedLetter.trim() && !isLoadingPrintContext && (draft.letterId
    ? printContext?.mode === 'legacy' ? printContext.canPrintText : printContext?.matchesStoredTotals && printContext.revision === draft.revision && !isDirty
    : previewReady));
  const totals = draft.status === 'SENT' || draft.isLegacy ? draft.snapshot?.totals || (printContext ? {net: printContext.storedNet, vat: printContext.storedVat, gross: printContext.storedGross} : null)
    : previewReady ? preview!.snapshot.totals : financials.ok ? financials.snapshot.totals : null;
  const available = !readOnly && !isLoadingLedger && !ledgerReadFailed && !isLoadingPrintContext;
  return {
    state: {operationError, isLoadingLedger, ledgerReadFailed, isLoadingHistory, isLoadingPrintContext, printContext,
      letterType, recipient, subject, keyPoints, tone, generatedLetter, isGenerating, isCopied, isSaving, saveSuccess,
      ledgerItems, selectedLedgerItems, viewMode, savedLetters, isDeleting, showPrintPreview, projectName,
      clientDraftId: draft.clientDraftId, letterId: draft.letterId, revision: draft.revision, status: draft.status, isLegacy: draft.isLegacy,
      isDirty, snapshot: draft.snapshot, previewSnapshot: previewReady ? preview!.snapshot : null, sourceRevisions: previewReady ? preview!.sourceRevisions : draft.sourceRevisions,
      operationId: draft.operationId, operationKind: draft.operationKind, isPreviewing, isMarkingSent, sentMarkedAt: printContext?.sentMarkedAt || null},
    setters: {setLetterType, setRecipient, setSubject, setKeyPoints, setTone, setGeneratedLetter, setSelectedLedgerItems, setViewMode},
    actions: {retryPrintContext: async () => {if (printContext?.letterId) await loadPrintContext(printContext.letterId, !session.current!.state.snapshot);},
      fetchContextDetails, fetchLedgerItems, fetchSavedLetters, reviewLetter, markLetterSent, newDraft, generateLetter, copyLetter, saveLetter,
      deleteLetter, openPrintPreview: () => {if (canPrint) setShowPrintPreview(true);}, closePrintPreview: () => setShowPrintPreview(false), selectSavedLetter, toggleLedgerItem},
    derived: {canPrint, selectedItems, subtotal: totals?.net ?? null, vat: totals?.vat ?? null, totalInclVat: totals?.gross ?? null,
      canGenerate: available && Boolean(letterType && selectedItems.length), canPreview: available && financials.ok,
      canSave: available && previewReady && Boolean(generatedLetter.trim() && subject.trim()) && (isDirty || Boolean(draft.operationId)),
      canMarkSent: draft.operationKind === 'sent' || available && Boolean(draft.letterId && draft.snapshot && !isDirty && previewReady && !draft.operationId && printContext?.matchesStoredTotals && printContext.revision === draft.revision),
      financialIssues: financials.ok ? [] : financials.issues},
  };
}
