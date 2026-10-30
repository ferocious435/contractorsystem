"use client";

import {useId, useState} from 'react';
import {Copy, History, Printer, Save, Trash2, Plus} from 'lucide-react';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Button} from '@/components/ui/titanium/Button';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Field} from '@/components/ui/titanium/Field';
import {Panel} from '@/components/ui/titanium/Panel';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
import {PrintableLetter} from '@/components/pricing/PrintableLetter';
import {formatIndividualMoney, getIndividualPricing, individualPricingReasonLabels, type IndividualPricingReason} from '@/utils/individual-pricing';
import {prepareLetterFinancialSnapshot} from '@/utils/letter-financials';
import type { LedgerItem } from '@/types';
import {LETTER_TYPES, TONE_OPTIONS} from './constants';
import type {useSmartLetterState} from './hooks/useSmartLetterState';
import type {SavedSmartLetter, ToneValue, SmartLetterState, SmartLetterDerivedState} from './types';

type Props = ReturnType<typeof useSmartLetterState>;
const money = (value: number | null | undefined): string => formatIndividualMoney(value ?? null);
const date = (value: string | null | undefined): string => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('he-IL') : '—';
const historical = (letter: SavedSmartLetter) => letter.calculation_version !== 'letter-individual-v1';
const statusLabel = (letter: SavedSmartLetter) => historical(letter) ? 'רשומה היסטורית' : letter.status === 'SENT' ? letter.sent_marked_at ? 'סומן כנשלח ידנית' : 'נשלח · מועד לא ידוע' : 'טיוטה';

export function getLetterPrintableItems(state: Pick<SmartLetterState, 'printContext'>, derived: Pick<SmartLetterDerivedState, 'selectedItems'>): LedgerItem[] {
    const rows = state.printContext ? state.printContext.matchesStoredTotals ? state.printContext.items : [] : derived.selectedItems;
    if (!state.printContext && !prepareLetterFinancialSnapshot(rows).ok) return [];
    if (rows.some(item => typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || typeof item.unit_price_excl_vat !== 'number' || !Number.isFinite(item.unit_price_excl_vat))) return [];
    return rows.map(item => ({...item, id: item.id, item_code: item.item_code || '', description: item.description || '', unit: item.unit || '',
        quantity: item.quantity, unit_price_excl_vat: item.unit_price_excl_vat, item_type: 'ITEM'} as LedgerItem));
}

/** The dialog body is also rendered independently for its explicit acknowledgement contract. */
export function LetterSentConfirmation({isSending, onClose, onConfirm}: {isSending: boolean; onClose(): void; onConfirm(): Promise<void>}): React.JSX.Element {
    const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState<string | null>(null);
    return <><h2 id="letter-sent-title" className="ti-section-title">סימון מכתב כנשלח</h2>
        <p className="ti-copy">הסימון מתעד שהמכתב השמור כבר נשלח מחוץ למערכת.</p>
        <label className="ti-copy"><input type="checkbox" checked={acknowledged} disabled={isSending} onChange={event => setAcknowledged(event.target.checked)}/> אני מאשר/ת שהמכתב כבר נשלח מחוץ למערכת</label>
        {error && <Feedback tone="danger">{error}</Feedback>}
        <div className="ti-actions"><Button disabled={isSending} onClick={onClose}>ביטול</Button><Button variant="primary" pending={isSending} busyLabel="מתעד את הסימון…" disabled={!acknowledged || isSending}
            onClick={async () => {setError(null); try {await onConfirm(); onClose();} catch (cause) {setError(cause instanceof Error ? cause.message : 'הסימון לא הושלם.');}}}>סימון כנשלח</Button></div></>;
}

export function LetterWorkspaceView({state, setters, actions, derived}: Props): React.JSX.Element {
    const {letterType, recipient, subject, keyPoints, tone, generatedLetter, isGenerating, isCopied, isSaving, saveSuccess, ledgerItems, selectedLedgerItems, viewMode, savedLetters,
        isDeleting, showPrintPreview, projectName, operationError, isLoadingLedger, ledgerReadFailed, isLoadingHistory, isLoadingPrintContext, printContext} = state;
    const {setLetterType, setRecipient, setSubject, setKeyPoints, setTone, setGeneratedLetter, setViewMode} = setters;
    const toneId = useId(), pointsId = useId(), editorId = useId();
    const [deleteTarget, setDeleteTarget] = useState<SavedSmartLetter | null>(null), [deleteError, setDeleteError] = useState<string | null>(null), [sentOpen, setSentOpen] = useState(false);
    const busy = isGenerating || isSaving || Boolean(state.isPreviewing) || Boolean(state.isMarkingSent);
    const editingBlocked = isSaving || Boolean(state.isPreviewing) || Boolean(state.isMarkingSent);
    const readOnly = state.status === 'SENT' || Boolean(state.isLegacy) || Boolean(state.letterId && !state.snapshot) || state.operationKind === 'sent';
    const contentReadOnly = readOnly || letterType === '' && Boolean(state.letterId) || (printContext?.docType === 'official_vo');
    const ledgerUnavailable = Boolean(isLoadingLedger || ledgerReadFailed || operationError?.kind === 'ledger');
    const dirty = state.isDirty ?? !saveSuccess, saved = saveSuccess && !dirty && operationError?.kind !== 'save';
    const printableItems = getLetterPrintableItems(state, derived);
    const legacy = printContext?.mode === 'legacy';
    const canPrint = Boolean(derived.canPrint && (legacy ? printContext.canPrintText : state.letterId ? printContext?.matchesStoredTotals : state.previewSnapshot || printableItems.length));
    const eligible = ledgerItems.filter(item => item.type === 'PENDING_VO' || item.type === 'APPROVED_VO');
    const completeSelection = derived.selectedItems.length > 0 && selectedLedgerItems.every(id => eligible.some(item => item.id === id));
    const displaySnapshot = state.previewSnapshot || state.snapshot;
    const rateCandidates = displaySnapshot ? displaySnapshot.items.map(item => item.vatRate) : derived.selectedItems.map(item => getIndividualPricing(item).vatRate);
    const rate = rateCandidates.length && rateCandidates.every(value => value !== null && Number.isFinite(value)) && new Set(rateCandidates).size === 1 ? rateCandidates[0] : null;
    const remove = async (): Promise<void> => {
        if (!deleteTarget || isDeleting) return; setDeleteError(null);
        try {await actions.deleteLetter(deleteTarget.id, true); setDeleteTarget(null);} catch (cause) {setDeleteError(cause instanceof Error ? cause.message : 'מחיקת המכתב לא הושלמה.');}
    };
    const retry = operationError?.kind === 'history' ? actions.fetchSavedLetters : operationError?.kind === 'ledger' ? actions.fetchLedgerItems
        : operationError?.kind === 'preview' ? actions.reviewLetter : operationError?.kind === 'save' ? actions.saveLetter : operationError?.kind === 'print' ? actions.retryPrintContext : operationError?.kind === 'generate' ? actions.generateLetter : undefined;
    return <div className="ti-page ti-letter-workspace" data-view={viewMode} dir="rtl">
        <header className="ti-page-heading"><div><p className="ti-eyebrow">תכתובות הפרויקט</p><h1 className="ti-title">מכתבים ודרישות</h1><p className="ti-subtitle">טיוטות שמורות, מקורות וסימון שליחה · {projectName || 'פרויקט נבחר'}</p></div>
            <Button disabled={busy} onClick={() => actions.newDraft?.()}><Plus size={16} aria-hidden="true"/>טיוטה חדשה</Button></header>
        <div className="ti-tabs" aria-label="תצוגת מכתבים"><button className="ti-tab" aria-pressed={viewMode === 'edit'} onClick={() => setViewMode('edit')}>עריכת מכתב</button>
            <button className="ti-tab" aria-pressed={viewMode === 'history'} onClick={() => {setViewMode('history'); void actions.fetchSavedLetters();}}><History size={16} aria-hidden="true"/>היסטוריה</button></div>
        {state.aiReadiness !== undefined && state.aiReadiness?.available !== true && <Feedback tone="warning"><span>{state.aiReadiness === null ? 'בודק את זמינות העיבוד המקומי…' : state.aiReadiness.reason === 'AI_MODEL_MISSING' ? 'המודל המקומי המוגדר אינו זמין.' : state.aiReadiness.reason === 'STATUS_UNAVAILABLE' ? 'לא ניתן לאשר כרגע את זמינות העיבוד המקומי.' : 'השרת המקומי אינו זמין כעת.'} אפשר לערוך טקסט, לבדוק סכומים ומקורות ולשמור טיוטה ידנית.</span><Button onClick={() => actions.refreshAiReadiness?.()}>בדיקת זמינות חוזרת</Button></Feedback>}
        {operationError && <Feedback tone="danger"><span>{operationError.message}</span>{retry && <Button onClick={() => void retry()}>ניסיון חוזר</Button>}</Feedback>}
        {ledgerReadFailed && operationError?.kind !== 'ledger' && <Feedback tone="warning">קריאת השורות הכספיות לא הושלמה.<Button onClick={() => void actions.fetchLedgerItems()}>קריאה חוזרת של השורות</Button></Feedback>}
        <div className="ti-letter-grid">
            <Panel className="ti-letter-parameters"><h2 className="ti-section-title">פרטי המכתב</h2>
                <fieldset className="ti-letter-types" disabled={editingBlocked || readOnly || Boolean(isLoadingPrintContext) || contentReadOnly}><legend className="ti-field__label">סוג מכתב</legend>{LETTER_TYPES.map(option => <label key={option.value} className="ti-letter-type"><input type="radio" name="letterType" value={option.value} checked={letterType === option.value} onChange={() => setLetterType(option.value)}/><span>{option.label}</span></label>)}</fieldset>
                <Field label="נמען" name="recipient" value={recipient} readOnly={contentReadOnly} disabled={editingBlocked || isLoadingPrintContext} onChange={event => setRecipient(event.target.value)}/>
                <Field label="נושא המסמך" name="subject" value={subject} readOnly={contentReadOnly} disabled={editingBlocked || isLoadingPrintContext} onChange={event => setSubject(event.target.value)}/>
                <div className="ti-field"><label className="ti-field__label" htmlFor={toneId}>טון המכתב</label><select id={toneId} name="tone" className="ti-select" value={tone} disabled={editingBlocked || contentReadOnly} onChange={event => setTone(event.target.value as ToneValue)}>{TONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="ti-field"><label className="ti-field__label" htmlFor={pointsId}>עיקרי הפנייה</label><textarea id={pointsId} name="keyPoints" className="ti-textarea" rows={5} value={keyPoints} readOnly={contentReadOnly} disabled={editingBlocked} onChange={event => setKeyPoints(event.target.value)}/></div>
                <section className="ti-letter-selection" aria-label="בחירת שורות כספיות"><h3 className="ti-section-title">בחירת שורות למכתב</h3><p className="ti-meta">שורות חריג בהמתנה או מאושר. חוזה הבסיס מוצג בסיכום הפרויקט בנפרד.</p>
                    {isLoadingLedger ? <Feedback aria-live="polite">קורא את השורות הכספיות…</Feedback> : eligible.length === 0 ? <Feedback>אין שורות מתאימות לבחירה. אפשר לקרוא מכתבים שמורים מההיסטוריה.</Feedback> : <div className="ti-letter-ledger">{eligible.map(item => <label key={item.id} className="ti-letter-row"><input type="checkbox" value={item.id} checked={selectedLedgerItems.includes(item.id)} disabled={busy || readOnly || isLoadingPrintContext} onChange={() => actions.toggleLedgerItem(item.id)}/><span><strong><BidiText kind="code" value={item.item_code || '—'}/></strong><span className="ti-copy ti-preserve-lines">{item.description}</span><span className="ti-meta">סכום אישי כולל מע״מ: <BidiText kind="money" value={money(getIndividualPricing(item).totalInclVat)}/></span></span></label>)}</div>}
                    <dl className="ti-letter-totals"><div><dt>{readOnly ? 'הסכום השמור ללא מע״מ' : 'הבחירה ללא מע״מ'}</dt><dd><BidiText kind="money" value={money(ledgerUnavailable && !readOnly ? null : derived.subtotal)}/></dd></div><div><dt>מע״מ {rate === null ? "לפי התמחורים" : <BidiText kind="percent" value={String(rate * 100) + "%"}/>}</dt><dd><BidiText kind="money" value={money(ledgerUnavailable && !readOnly ? null : derived.vat)}/></dd></div><div><dt>סה״כ כולל מע״מ</dt><dd><BidiText kind="money" value={money(ledgerUnavailable && !readOnly ? null : derived.totalInclVat)}/></dd></div></dl>
                    {!readOnly && derived.financialIssues?.length ? <Feedback tone="warning">{[...new Set(derived.financialIssues.map(issue => individualPricingReasonLabels[issue.reason as IndividualPricingReason] || 'יש להשלים בחירה ונתוני תמחור תקינים.'))].join(' ')}</Feedback> : null}
                </section>
                <div className="ti-actions"><Button onClick={() => void actions.reviewLetter?.()} pending={state.isPreviewing} busyLabel="בודק סכומים ומקורות…" disabled={!derived.canPreview || busy || ledgerUnavailable || readOnly} disabledReason={!derived.canPreview ? 'נדרשת בחירה מלאה של תמחורים מוכנים. לאחר שינוי שורה יש לבדוק אותה שוב.' : undefined}>בדיקת סכומים ומקורות</Button>
                    <Button aria-label="יצירת טיוטה" disabled={!derived.canGenerate || busy || ledgerUnavailable || contentReadOnly} disabledReason={!derived.canGenerate ? readOnly ? 'מסמך זה זמין לקריאה ולהדפסה בלבד.' : state.aiReadiness?.available === false ? 'העיבוד המקומי אינו זמין. אפשר לכתוב ולשמור טיוטה ידנית.' : 'נדרשים סוג מכתב ובחירת תמחורים מתאימים. אפשר לכתוב את הטקסט ידנית.' : undefined} pending={isGenerating} busyLabel="מכין טיוטה…" onClick={() => void actions.generateLetter()}>יצירת טיוטה</Button></div>
            </Panel>
            <section className="ti-letter-result">
                {viewMode === 'history' ? <Panel className="ti-letter-history"><h2 className="ti-section-title">היסטוריית מכתבים</h2><p className="ti-meta">פתיחה קוראת את הטקסט והצילום השמורים. טיוטה נערכת כאותו מכתב.</p>
                    {isLoadingHistory ? <Feedback aria-live="polite">קורא את ההיסטוריה…</Feedback> : savedLetters.length === 0 ? <Feedback title="אין עדיין מכתבים שמורים">אפשר להכין ולשמור טיוטה חדשה.</Feedback> : <div className="ti-letter-history__list">{savedLetters.map(letter => <article key={letter.id} className="ti-letter-history__item"><div className="ti-letter-history__meta"><BidiText kind="code" value={letter.letter_number || '—'}/><BidiText kind="date" value={date(letter.created_at)}/><StatusChip tone="neutral">{statusLabel(letter)}</StatusChip></div><h3 className="ti-section-title">{letter.subject}</h3><p className="ti-copy">נמען: {letter.recipient_name || 'לא צוין'}</p><p className="ti-meta">סכום שמור כולל מע״מ: <BidiText kind="money" value={money(letter.total_amount_incl_vat)}/></p><div className="ti-actions"><Button onClick={() => actions.selectSavedLetter(letter)}>{!historical(letter) && letter.status === 'DRAFT' ? 'פתיחת הטיוטה לעריכה' : 'פתיחת המכתב לקריאה'}</Button><Button variant="danger" aria-label={`מחיקת מכתב ${letter.subject}`} disabled={Boolean(isDeleting)} onClick={() => {setDeleteError(null); setDeleteTarget(letter);}}><Trash2 size={16} aria-hidden="true"/>מחיקה</Button></div></article>)}</div>}
                </Panel> : <Panel className="ti-letter-editor"><div className="ti-letter-editor__heading"><h2 className="ti-section-title">{state.isLegacy ? 'רשומה היסטורית' : state.status === 'SENT' ? 'מכתב שסומן כנשלח' : 'טיוטת המכתב'}</h2><StatusChip tone={saved ? 'success' : 'neutral'}>{state.isLegacy ? 'לקריאה' : state.status === 'SENT' ? 'סומן כנשלח ידנית' : saved ? 'טיוטה נשמרה' : state.letterId && dirty ? 'שינויים שלא נשמרו' : state.letterId ? 'טיוטה שמורה' : 'לפני שמירה'}</StatusChip></div>
                    {isLoadingPrintContext && <Feedback aria-live="polite">קורא את הגרסה והצילום הכספי השמורים…</Feedback>}
                    {readOnly && <Feedback>{state.isLegacy ? 'רשומה היסטורית. הסכומים שלא נשמרו מסומנים כלא ידועים.' : state.operationKind === 'sent' ? 'תוצאת סימון השליחה עדיין לא אושרה. אפשר לחזור על אותו סימון.' : 'המכתב השמור זמין לקריאה ולהדפסה.'}</Feedback>}
                    {printContext && <section className="ti-letter-print-context" aria-label="הצירוף הכספי של המכתב"><h3 className="ti-section-title">הצילום הכספי השמור</h3><p className="ti-meta">ללא מע״מ: <BidiText kind="money" value={money(printContext.storedNet)}/> · מע״מ: <BidiText kind="money" value={money(printContext.storedVat)}/> · כולל מע״מ: <BidiText kind="money" value={money(printContext.storedGross)}/></p>{printContext.blockedReason && <Feedback tone="warning">{printContext.blockedReason}{actions.retryPrintContext && <Button onClick={() => void actions.retryPrintContext?.()}>קריאה חוזרת של הצירוף</Button>}</Feedback>}</section>}
                    {displaySnapshot && <section aria-label="סכומים ומקורות למכתב"><h3 className="ti-section-title">{state.previewSnapshot ? 'סכומים ומקורות שנבדקו לשמירה' : 'שורות ומקורות מתוך הצילום השמור'}</h3>{displaySnapshot.items.map(item => <article className="ti-letter-history__item" key={item.ledgerItemId}><p className="ti-copy"><BidiText kind="code" value={item.itemCode || item.ledgerItemId}/> · {item.description}</p><p className="ti-meta">ללא מע״מ {money(item.net)} · מע״מ {money(item.vat)} · כולל מע״מ {money(item.gross)}</p><p className="ti-meta">{item.conditionNote}</p>{item.sources.map((source, index) => <div key={index} className="ti-copy ti-preserve-lines"><strong>{source.basis === 'MANUAL' ? 'אישור ידני' : source.status === 'VERIFIED' ? 'מקור שנבדק' : 'נדרשת בדיקת מקור'}</strong>{source.title && <span> · {source.title}</span>}{source.pageLabel && <span> · עמוד {source.pageLabel}</span>}<p dir="auto">{source.manualNote || source.quote || 'המקור אינו זמין לאימות.'}</p></div>)}</article>)}</section>}
                    {isGenerating && <Feedback aria-live="polite">{state.generationState==='QUEUED'?'הבקשה שמורה וממתינה לעוזר…':'מכין טיוטה לפי הפרטים שנבחרו…'} אפשר להמשיך לערוך. תשובה חדשה לא תחליף עריכה מאוחרת.<Button disabled={!state.generationState} onClick={()=>void actions.cancelGeneration?.()}>ביטול ההכנה</Button></Feedback>}
                    {state.pendingGeneration&&<details><summary>נוסח מוכן לעיון — הטקסט שלך נשמר</summary><p className="ti-copy ti-preserve-lines" dir="auto">{state.pendingGeneration.letter}</p><Button disabled={!derived.canApplyGeneratedOption||busy} disabledReason={!derived.canApplyGeneratedOption?'הבחירה הכספית או סוג המכתב השתנו. אפשר לעיין בנוסח ולהעתיק ממנו ידנית.':undefined} onClick={()=>actions.applyGeneratedOption?.()}>החלפת הטקסט בנוסח המוכן</Button></details>}
                    {state.bufferUnavailable&&<Feedback tone="warning">הדפדפן אינו מאפשר לשמור את העבודה המקומית. יש לשמור טיוטה לפני רענון העמוד.</Feedback>}
                    <label className="ti-field__label" htmlFor={editorId}>תוכן המכתב</label><textarea id={editorId} name="letterText" className="ti-textarea ti-letter-text" value={generatedLetter} readOnly={contentReadOnly} disabled={editingBlocked || isLoadingPrintContext} onChange={event => setGeneratedLetter(event.target.value)} placeholder="אפשר לכתוב כאן טקסט ידני, לבדוק סכומים ומקורות ולשמור טיוטה."/>
                    <p className="ti-meta">שמירת טיוטה שומרת את הטקסט והצילום הכספי. סימון כנשלח נעשה בנפרד, לאחר שליחה מחוץ למערכת.</p>
                    <div className="ti-actions"><Button variant="primary" aria-label="שמירת טיוטה" onClick={() => void actions.saveLetter()} pending={isSaving} busyLabel="שומר טיוטה…" disabled={!derived.canSave || !completeSelection || busy || ledgerUnavailable || readOnly} disabledReason={!derived.canSave ? readOnly ? 'מסמך זה זמין לקריאה ולהדפסה בלבד.' : saved ? 'הטיוטה כבר נשמרה. עריכה נוספת תאפשר שמירה.' : 'נדרשים טקסט, נושא ובדיקה עדכנית של הסכומים והמקורות.' : undefined}><Save size={16} aria-hidden="true"/>שמירת טיוטה</Button>
                        {!state.isLegacy && state.letterId && <Button aria-label={state.status === 'SENT' ? 'סומן כנשלח ידנית' : 'סימון כנשלח'} aria-disabled={state.status === 'SENT' || undefined} disabled={state.status !== 'SENT' && (!derived.canMarkSent || busy)} onClick={() => {if (derived.canMarkSent && !busy) setSentOpen(true);}}>{state.status === 'SENT' ? 'סומן כנשלח ידנית' : 'סימון כנשלח'}</Button>}
                        <Button onClick={actions.openPrintPreview} disabled={!canPrint || busy} disabledReason={!canPrint ? 'נדרשת גרסה שמורה מלאה או בדיקה מלאה של הטיוטה לפני הדפסה.' : undefined}><Printer size={16} aria-hidden="true"/>תצוגת הדפסה</Button><Button onClick={() => void actions.copyLetter()} disabled={!generatedLetter || busy}><Copy size={16} aria-hidden="true"/>{isCopied ? 'הטקסט הועתק' : 'העתקת טקסט'}</Button></div>
                </Panel>}
            </section>
        </div>
        <Dialog open={sentOpen} labelledBy="letter-sent-title" className="ti-dialog--compact" onClose={() => {if (!state.isMarkingSent) setSentOpen(false);}}><LetterSentConfirmation isSending={Boolean(state.isMarkingSent)} onClose={() => setSentOpen(false)} onConfirm={async () => {await actions.markLetterSent?.();}}/></Dialog>
        <Dialog open={Boolean(deleteTarget)} labelledBy="letter-delete-title" className="ti-dialog--compact" onClose={() => {if (!isDeleting) setDeleteTarget(null);}}>{deleteTarget && <><h2 id="letter-delete-title" className="ti-section-title">מחיקת מכתב</h2><p className="ti-copy">למחוק את <strong>{deleteTarget.subject}</strong> מההיסטוריה?</p>{deleteError && <Feedback tone="danger">{deleteError}</Feedback>}<div className="ti-actions"><Button disabled={Boolean(isDeleting)} onClick={() => setDeleteTarget(null)}>ביטול</Button><Button variant="danger" pending={isDeleting === deleteTarget.id} busyLabel="מוחק מכתב…" onClick={() => void remove()}>מחיקת המכתב</Button></div></>}</Dialog>
        {showPrintPreview && canPrint && <PrintableLetter projectName={projectName} recipient={state.letterId && printContext ? printContext.recipientName : recipient}
            subject={state.letterId && printContext ? printContext.subject : subject} legalText={state.letterId && printContext ? printContext.content : generatedLetter} onClose={actions.closePrintPreview} items={printableItems}
            mode={legacy ? 'legacy' : state.letterId || state.previewSnapshot ? 'snapshot' : 'preview'} snapshot={state.letterId ? printContext?.snapshot : state.previewSnapshot}
            letterNumber={state.letterId ? printContext?.letterNumber : 'טיוטה שלא נשמרה'} createdAt={state.letterId ? printContext?.createdAt : null}
            legacyTotals={legacy ? {net: printContext.storedNet, vat: printContext.storedVat, gross: printContext.storedGross} : undefined}/>}
    </div>;
}
