"use client";

import {useId, useState} from 'react';
import {Copy, History, Printer, Save, Trash2} from 'lucide-react';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Button} from '@/components/ui/titanium/Button';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Field} from '@/components/ui/titanium/Field';
import {Panel} from '@/components/ui/titanium/Panel';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
import {PrintableLetter} from '@/components/pricing/PrintableLetter';
import {VAT_RATE} from '@/utils/constants';
import {getLedgerRowAmount} from '@/utils/project-financials';
import type { LedgerItem } from '@/types';
import {LETTER_TYPES, TONE_OPTIONS} from './constants';
import type {useSmartLetterState} from './hooks/useSmartLetterState';
import type {SavedSmartLetter, ToneValue, SmartLetterState, SmartLetterDerivedState} from './types';

type Props = ReturnType<typeof useSmartLetterState>;
const money = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('he-IL') + ' ₪' : '—';
const date = (value: string): string => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('he-IL') : '—';

export function getLetterPrintableItems(state: Pick<SmartLetterState, 'printContext'>, derived: Pick<SmartLetterDerivedState, 'selectedItems'>): LedgerItem[] {
    const rows = state.printContext ? state.printContext.matchesStoredTotals ? state.printContext.items : [] : derived.selectedItems;
    const knownNumber=(value:unknown):boolean=>typeof value==='number'&&Number.isFinite(value);
    if(rows.some(item=>!knownNumber(item.quantity)||!knownNumber(item.unit_price_excl_vat??item.unit_price)))return [];
    return rows.map((item) => ({
        id: item.id,
        item_code: item.item_code || '',
        description: item.description || '',
        unit: item.unit || '',
        quantity: Number(item.quantity ?? 0),
        unit_price_excl_vat: Number(item.unit_price_excl_vat ?? item.unit_price ?? 0),
        total_price_excl_vat: getLedgerRowAmount(item),
        source: item.source || undefined,
        project_id: item.project_id,
        item_type: 'ITEM',
        type: typeof item.type === 'string' ? (item.type as LedgerItem['type']) : undefined,
        ai_rationale: item.ai_rationale || undefined,
        governing_notes: item.governing_notes,
        evidence_data: item.evidence_data,
    }));
}

export function LetterWorkspaceView({state, setters, actions, derived}: Props): React.JSX.Element {
    const {letterType, recipient, subject, keyPoints, tone, generatedLetter, isGenerating, isCopied, isSaving, saveSuccess, ledgerItems, selectedLedgerItems, viewMode, savedLetters, isDeleting, showPrintPreview, projectName, operationError, isLoadingLedger, ledgerReadFailed, isLoadingHistory, isLoadingPrintContext, printContext} = state;
    const {setLetterType, setRecipient, setSubject, setKeyPoints, setTone, setGeneratedLetter, setViewMode} = setters;
    const toneId = useId(), pointsId = useId(), editorId = useId();
    const [deleteTarget, setDeleteTarget] = useState<SavedSmartLetter | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [openedFromHistory, setOpenedFromHistory] = useState(false);
    const [editedSinceSave, setEditedSinceSave] = useState(false);
    const busy = isGenerating || isSaving;
    const ledgerUnavailable = isLoadingLedger || ledgerReadFailed || operationError?.kind === 'ledger';
    const saved = saveSuccess && !editedSinceSave && operationError?.kind !== 'save';
    const printableItems = getLetterPrintableItems(state, derived);
    const expectedPrintCount=printContext?printContext.items.length:derived.selectedItems.length;
    const canPrint = (derived.canPrint ?? Boolean(generatedLetter)) && expectedPrintCount===printableItems.length && (!ledgerUnavailable || Boolean(printContext?.matchesStoredTotals));
    const eligibleItems = ledgerItems.filter(item => item.type === 'PENDING_VO' || item.type === 'APPROVED_VO');
    const hasCompleteSelection = derived.selectedItems.length > 0 && selectedLedgerItems.every(id => eligibleItems.some(item => item.id === id));
    const generateReason = !letterType ? 'יש לבחור סוג מכתב לפני הכנת הטיוטה.' : 'נדרשת בחירת שורות כספיות מתאימות לפני הכנת הטיוטה.';
    const remove = async (): Promise<void> => {
        if (!deleteTarget || isDeleting) return;
        setDeleteError(null);
        try { await actions.deleteLetter(deleteTarget.id, true); setDeleteTarget(null); }
        catch (cause) { setDeleteError(cause instanceof Error ? cause.message : 'מחיקת המכתב לא הושלמה.'); }
    };

    return <div className="ti-page ti-letter-workspace" data-view={viewMode} dir="rtl" onChangeCapture={() => setEditedSinceSave(true)}>
        <header className="ti-page-heading"><div><p className="ti-eyebrow">תכתובות הפרויקט</p><h1 className="ti-title">מכתבים ודרישות</h1><p className="ti-subtitle">הכנת טיוטה, עריכה והיסטוריה · {projectName || 'פרויקט נבחר'}</p></div><StatusChip tone="neutral">טיוטה לבדיקה</StatusChip></header>
        <div className="ti-tabs" aria-label="תצוגת מכתבים"><button className="ti-tab" aria-pressed={viewMode === 'edit'} onClick={() => setViewMode('edit')}>עריכת מכתב</button><button className="ti-tab" aria-pressed={viewMode === 'history'} onClick={() => setViewMode('history')}><History size={16} aria-hidden="true"/>היסטוריה</button></div>
        {operationError && <Feedback tone="danger"><span>{operationError.message}</span>{operationError.kind === 'ledger' && <Button onClick={() => void actions.fetchLedgerItems()}>קריאה חוזרת של השורות</Button>}{operationError.kind === 'history' && <Button onClick={() => void actions.fetchSavedLetters()}>קריאה חוזרת של ההיסטוריה</Button>}</Feedback>}
        {ledgerReadFailed && operationError?.kind !== 'ledger' && <Feedback tone="warning">יש להשלים קריאה תקינה של השורות הכספיות.<Button onClick={() => void actions.fetchLedgerItems()}>קריאה חוזרת של השורות</Button></Feedback>}
        <div className="ti-letter-grid">
            <Panel className="ti-letter-parameters"><h2 className="ti-section-title">פרטי המכתב</h2>
                <fieldset className="ti-letter-types" disabled={busy}><legend className="ti-field__label">סוג מכתב</legend>{LETTER_TYPES.map(option => <label key={option.value} className="ti-letter-type"><input type="radio" name="letterType" value={option.value} checked={letterType === option.value} onChange={() => setLetterType(option.value)}/><span>{option.label}</span></label>)}</fieldset>
                <Field label="נמען" name="recipient" value={recipient} disabled={busy} onChange={event => setRecipient(event.target.value)}/>
                <Field label="נושא המסמך" name="subject" value={subject} disabled={busy} onChange={event => setSubject(event.target.value)}/>
                <div className="ti-field"><label className="ti-field__label" htmlFor={toneId}>טון המכתב</label><select id={toneId} name="tone" className="ti-select" value={tone} disabled={busy} onChange={event => setTone(event.target.value as ToneValue)}>{TONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="ti-field"><label className="ti-field__label" htmlFor={pointsId}>עיקרי הפנייה</label><textarea id={pointsId} name="keyPoints" className="ti-textarea" rows={5} value={keyPoints} disabled={busy} onChange={event => setKeyPoints(event.target.value)}/></div>
                <section className="ti-letter-selection" aria-label="בחירת שורות כספיות"><h3 className="ti-section-title">בחירת שורות למכתב</h3><p className="ti-meta">רק שורות חריג בהמתנה או מאושר. חוזה הבסיס אינו נכלל במכתב.</p>
                    {isLoadingLedger ? <Feedback aria-live="polite">קורא את השורות הכספיות…</Feedback> : eligibleItems.length === 0 ? <Feedback>אין כרגע שורות כספיות מתאימות לבחירה.</Feedback> : <div className="ti-letter-ledger">{eligibleItems.map(item => <label key={item.id} className="ti-letter-row"><input type="checkbox" value={item.id} checked={selectedLedgerItems.includes(item.id)} disabled={busy} onChange={() => actions.toggleLedgerItem(item.id)}/><span><strong><BidiText kind="code" value={item.item_code || '—'}/></strong><span className="ti-copy ti-preserve-lines">{item.description}</span><span className="ti-meta">סכום השורה ללא מע״מ: <BidiText kind="money" value={money(getLedgerRowAmount(item))}/></span></span></label>)}</div>}
                    <dl className="ti-letter-totals"><div><dt>הבחירה ללא מע״מ</dt><dd><BidiText kind="money" value={money(ledgerUnavailable ? null : derived.subtotal)}/></dd></div><div><dt>מע״מ <BidiText kind="percent" value={VAT_RATE * 100 + '%'}/></dt><dd><BidiText kind="money" value={money(ledgerUnavailable ? null : derived.vat)}/></dd></div><div><dt>סה״כ כולל מע״מ</dt><dd><BidiText kind="money" value={money(ledgerUnavailable ? null : derived.totalInclVat)}/></dd></div></dl>
                </section>
                <Button variant="primary" aria-label="יצירת טיוטה" disabled={!derived.canGenerate || busy || ledgerUnavailable} disabledReason={ledgerUnavailable ? 'יש להשלים קריאה תקינה של השורות הכספיות לפני הכנת הטיוטה.' : !derived.canGenerate ? generateReason : undefined} pending={isGenerating} busyLabel="מכין טיוטה…" onClick={() => {setOpenedFromHistory(false);setEditedSinceSave(true);void actions.generateLetter();}}>יצירת טיוטה</Button>
            </Panel>
            <section className="ti-letter-result">
                {viewMode === 'history' ? <Panel className="ti-letter-history"><h2 className="ti-section-title">היסטוריית מכתבים</h2><p className="ti-meta">פתיחת טקסט שמור לעריכה אינה מפעילה יצירה מחדש.</p>
                    {isLoadingHistory ? <Feedback aria-live="polite">קורא את ההיסטוריה…</Feedback> : savedLetters.length === 0 ? <Feedback title="אין עדיין מכתבים שמורים">מכתב יופיע כאן אחרי שמירה מוצלחת.</Feedback> : <div className="ti-letter-history__list">{savedLetters.map(letter => <article key={letter.id} className="ti-letter-history__item"><div className="ti-letter-history__meta"><BidiText kind="code" value={letter.letter_number || '—'}/><BidiText kind="date" value={date(letter.created_at)}/></div><h3 className="ti-section-title">{letter.subject}</h3><p className="ti-copy">נמען: {letter.recipient_name || 'לא צוין'}</p><p className="ti-meta">סכום שמור כולל מע״מ: <BidiText kind="money" value={money(letter.total_amount_incl_vat)}/></p><div className="ti-actions"><Button onClick={() => {setOpenedFromHistory(true);actions.selectSavedLetter(letter);}}>פתיחת הטקסט לעריכה</Button><Button variant="danger" aria-label={`מחיקת מכתב ${letter.subject}`} disabled={Boolean(isDeleting)} onClick={() => {setDeleteError(null);setDeleteTarget(letter);}}><Trash2 size={16} aria-hidden="true"/>מחיקה</Button></div></article>)}</div>}
                </Panel> : <Panel className="ti-letter-editor"><div className="ti-letter-editor__heading"><h2 className="ti-section-title">טיוטת המכתב</h2><StatusChip tone={saved ? 'success' : 'neutral'}>{saved ? 'נשמר בארכיון' : 'לפני שמירה'}</StatusChip></div>
                    {openedFromHistory && <Feedback>הטקסט נפתח מההיסטוריה כעותק לעריכה. שמירה חדשה דורשת בחירת שורות מתאימות; צירוף ההדפסה נקרא מהקישורים של המכתב השמור.</Feedback>}
                    {isLoadingPrintContext && <Feedback aria-live="polite">קורא את השורות המקושרות למכתב ואת הסכומים השמורים לפני תצוגת ההדפסה…</Feedback>}
                    {printContext && <section className="ti-letter-print-context" aria-label="הצירוף הכספי של המכתב"><h3 className="ti-section-title">הצירוף הכספי למכתב השמור</h3><p className="ti-meta">סכום שמור ללא מע״מ: <BidiText kind="money" value={money(printContext.storedNet)}/> · כולל מע״מ: <BidiText kind="money" value={money(printContext.storedGross)}/></p>{printContext.blockedReason ? <Feedback tone="warning"><span>{printContext.blockedReason}</span>{printContext.letterId && actions.retryPrintContext && <Button onClick={() => void actions.retryPrintContext?.()}>קריאה חוזרת של הצירוף</Button>}</Feedback> : <p className="ti-meta">נקראו {printContext.items.length} שורות מקושרות והסכומים תואמים לסכומים השמורים. זהו שחזור לפי השורות הזמינות; הוא אינו צילום בלתי־משתנה של מסמך היסטורי.</p>}</section>}
                    {isGenerating && <Feedback aria-live="polite"><span className="ti-spinner" aria-hidden="true"/>מכין טיוטה על בסיס פרטי המכתב והשורות שנבחרו…</Feedback>}
                    <label className="ti-field__label" htmlFor={editorId}>תוכן המכתב</label><textarea id={editorId} name="letterText" className="ti-textarea ti-letter-text" value={generatedLetter} disabled={busy} onChange={event => {setEditedSinceSave(true);setGeneratedLetter(event.target.value);}} placeholder="אפשר לכתוב כאן או להכין טיוטה לפי הפרטים שנבחרו."/>
                    <p className="ti-meta">יש לבדוק את הניסוח, הסכומים והמקורות לפני שימוש. עריכת טקסט אינה שמירה או שליחה.</p>
                    <div className="ti-actions"><Button variant="primary" aria-label="שמירת מכתב" onClick={() => {setEditedSinceSave(false);void actions.saveLetter();}} pending={isSaving} busyLabel="שומר מכתב…" disabled={!derived.canSave || !hasCompleteSelection || busy || saved || ledgerUnavailable} disabledReason={!derived.canSave || !hasCompleteSelection ? 'נדרשים טקסט ובחירת שורות כספיות מתאימות לשמירה.' : ledgerUnavailable ? 'יש להשלים קריאה תקינה של השורות הכספיות לפני שמירה.' : undefined}><Save size={16} aria-hidden="true"/>{saved ? 'נשמר בארכיון' : 'שמירת מכתב'}</Button><Button onClick={actions.openPrintPreview} disabled={!canPrint || busy} disabledReason={!canPrint ? isLoadingPrintContext ? 'קורא את הצירוף הכספי השמור.' : printContext?.blockedReason || 'נדרשות שורות כספיות מלאות לצירוף ההדפסה.' : undefined}><Printer size={16} aria-hidden="true"/>תצוגת הדפסה</Button><Button onClick={() => void actions.copyLetter()} disabled={!generatedLetter || busy}><Copy size={16} aria-hidden="true"/>{isCopied ? 'הטקסט הועתק' : 'העתקת טקסט'}</Button></div>
                </Panel>}
            </section>
        </div>
        <Dialog open={Boolean(deleteTarget)} labelledBy="letter-delete-title" className="ti-dialog--compact" onClose={() => {if (!isDeleting) setDeleteTarget(null);}}>{deleteTarget && <><h2 id="letter-delete-title" className="ti-section-title">מחיקת מכתב</h2><p className="ti-copy">למחוק את <strong>{deleteTarget.subject}</strong> מההיסטוריה?</p>{deleteError && <Feedback tone="danger">{deleteError}</Feedback>}<div className="ti-actions"><Button disabled={Boolean(isDeleting)} onClick={() => setDeleteTarget(null)}>ביטול</Button><Button variant="danger" pending={isDeleting === deleteTarget.id} busyLabel="מוחק מכתב…" onClick={() => void remove()}>מחיקת המכתב</Button></div></>}</Dialog>
        {showPrintPreview && canPrint && <PrintableLetter projectName={projectName} recipient={recipient} subject={subject} legalText={generatedLetter} onClose={actions.closePrintPreview} items={printableItems}/>}
    </div>;
}
