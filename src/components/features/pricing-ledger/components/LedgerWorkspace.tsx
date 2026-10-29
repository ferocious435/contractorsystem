"use client";
import { useCallback, useMemo, useState } from 'react';
import type { usePricingLedgerState } from '../hooks/usePricingLedgerState';
import type { PricingLedgerItem, PricingLedgerRowType } from '../types';
import { LEDGER_ROW_TYPES } from '../constants';
import { summarizeIndividualPricing } from '../utils/individualPricing';
import { toggleVisibleSelection } from '../utils/viewSelection';
import { isLedgerRowSelectable } from '@/components/pricing/PricingLedgerTable';
import ActionBar from './ActionBar';
import TotalsSummary from './TotalsSummary';
import LedgerTable from './LedgerTable';
import QueuePanel from './QueuePanel';
import { Button } from '@/components/ui/titanium/Button';
import { Field } from '@/components/ui/titanium/Field';
import { Dialog } from '@/components/ui/titanium/Dialog';
import { Feedback } from '@/components/ui/titanium/Feedback';
export function selectLedgerViewRows(rows: readonly PricingLedgerItem[], query: string, type: PricingLedgerRowType | 'ALL') { const search = query.trim().toLocaleLowerCase(); return rows.filter(row => (type === 'ALL' || row.type === type) && (!search || [row.item_code, row.description, row.source, row.source_execution_doc].filter(Boolean).join(' ').toLocaleLowerCase().includes(search))); }
export function LedgerWorkspace({ state, derived, setters, actions, focusedFlow = false }: ReturnType<typeof usePricingLedgerState> & {
    focusedFlow?: boolean;
}) {
    const [query, setQuery] = useState(''), [rowType, setRowType] = useState<PricingLedgerRowType | 'ALL'>('ALL'), [summaryOpen, setSummaryOpen] = useState(false), [filtersOpen, setFiltersOpen] = useState(false);
    const rows = useMemo(() => selectLedgerViewRows(derived.visibleLedgerRows, query, rowType), [derived.visibleLedgerRows, query, rowType]);
    const summary = useMemo(() => summarizeIndividualPricing(derived.visibleLedgerRows), [derived.visibleLedgerRows]);
    const selectable = useMemo(() => new Set(derived.visibleLedgerRows.filter(isLedgerRowSelectable).map(row => row.id)), [derived.visibleLedgerRows]);
    const activeTab = focusedFlow ? 'ledger' : state.activeTab, unavailable = state.loading || Boolean(state.error), visibleSelected = rows.filter(row => derived.selectedVOIds.includes(row.id)).length;
    const filters = (suffix: string) => <><Field label="חיפוש בשורות" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="קוד, תיאור או מקור…"/><div className="ti-field"><label className="ti-field__label" htmlFor={'ledger-type-' + suffix}>סוג שורה</label><select className="ti-select" id={'ledger-type-' + suffix} value={rowType} onChange={event => setRowType(event.target.value as PricingLedgerRowType | 'ALL')}><option value="ALL">כל הסוגים</option>{LEDGER_ROW_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div></>;
    const { setIsGeneratingLetter, setIsAddingNew, setSelectedLedgerIds } = setters;
    const { handleExportCSV, handleSync } = actions;
    const generateLetter = useCallback(() => setIsGeneratingLetter(true), [setIsGeneratingLetter]);
    const addNew = useCallback(() => setIsAddingNew(true), [setIsAddingNew]);
    const exportCSV = useCallback(() => { void handleExportCSV(); }, [handleExportCSV]);
    const sync = useCallback(() => { void handleSync(); }, [handleSync]);
    const toggleAll = useCallback(() => setSelectedLedgerIds(toggleVisibleSelection(rows.map(row => row.id), state.selectedLedgerIds, selectable)), [rows, state.selectedLedgerIds, selectable, setSelectedLedgerIds]);
    const confidence = useMemo(() => ({ queueConfidencePercentById: derived.queueConfidencePercentById, queueConfidenceStats: derived.queueConfidenceStats, selectedHighConfidenceQueueIds: derived.selectedHighConfidenceQueueIds }), [derived.queueConfidencePercentById, derived.queueConfidenceStats, derived.selectedHighConfidenceQueueIds]);
    return <section className="ti-ledger-workspace" dir="rtl"><ActionBar selectedCount={derived.selectedVOIds.length} isSyncing={state.isSyncing} onGenerateLetter={generateLetter} onExportCSV={exportCSV} onAddNew={addNew} onSync={sync} onOpenSummary={()=>setSummaryOpen(true)} onOpenFilters={activeTab==='ledger'?()=>setFiltersOpen(true):undefined}/>
 <div className="ti-ledger-summary-access ti-actions"><Button onClick={() => setSummaryOpen(true)}>סיכום התמחורים</Button>{activeTab === 'ledger' && <Button className="ti-ledger-summary-filter" onClick={() => setFiltersOpen(true)}>חיפוש וסינון</Button>}</div>
 <div className="ti-tabs ti-ledger-tabs" aria-label="סביבת תמחור"><button type="button" className="ti-tab" aria-pressed={activeTab === 'ledger'} onClick={() => setters.setActiveTab('ledger')}>רישום כספי ({derived.visibleLedgerRows.length})</button>{!focusedFlow && <button type="button" className="ti-tab" aria-pressed={activeTab === 'queue'} onClick={() => setters.setActiveTab('queue')}>תור לתמחור ({state.pendingQueue.length})</button>}<span className="ti-meta">{activeTab === 'ledger' ? `${rows.length} שורות מוצגות · נבחרו ${derived.selectedVOIds.length} (${visibleSelected} מוצגות)` : `נבחרו ${state.selectedQueueIds.length} פריטים מהתור`}</span></div>
 {activeTab === 'ledger' && <div className="ti-ledger-wide-filters">{filters('wide')}</div>}{state.error && <Feedback tone="danger">{state.error}</Feedback>}
 <div className="ti-ledger-body">{activeTab === 'ledger' ? <LedgerTable key={query + '|' + rowType} rows={rows} isLoading={state.loading} isAddingNew={state.isAddingNew} isEditing={state.isEditing} newItemForm={state.newItemForm} setNewItemForm={setters.setNewItemForm} editForm={state.editForm} setEditForm={setters.setEditForm} selectedLedgerIds={derived.selectedVOIds} toggleSelectItem={actions.handleToggleLedgerSelection} toggleSelectAll={toggleAll} handleAddNew={actions.handleAddNew} setIsAddingNew={setters.setIsAddingNew} handleSaveEdit={actions.handleSaveEdit} handleCancelEdit={actions.handleCancelEdit} approveVO={actions.approveVO} handleEditClick={actions.handleEditClick} handleDelete={actions.handleDelete} errorMessage={state.error}/> : <QueuePanel items={state.pendingQueue} selectedIds={state.selectedQueueIds} scanningItems={state.scanningItems} confidence={confidence} onToggleSelection={actions.handleToggleQueueSelection} onSelectAll={actions.handleSelectAllQueue} onSelectForEstimation={actions.handleSelectForEstimation} onRescan={actions.handleRescan} onBulkRescan={actions.handleBulkRescan} onBulkDelete={actions.handleBulkDeleteQueue} onBulkApprove={actions.handleBulkApprove}/>}</div>
 <Dialog open={summaryOpen} labelledBy="ledger-summary-title" className="ti-dialog--wide" onClose={() => setSummaryOpen(false)}><header className="ti-dialog__header"><h2 id="ledger-summary-title" className="ti-section-title">סיכום התמחורים</h2><Button onClick={() => setSummaryOpen(false)}>סגירה</Button></header><TotalsSummary summary={summary} unavailable={unavailable}/><p className="ti-copy">הסיכום מתייחס לכל התמחורים השמורים בפרויקט, ללא חוזה הבסיס. חיפוש, סינון או בחירה ברשימה אינם משנים אותו.</p><p className="ti-meta">{state.pendingQueue.length} פריטים בתור עדיין ממתינים לתמחור ואינם נחשבים למחיר מוכן בסיכום.</p></Dialog>
 <Dialog open={filtersOpen} labelledBy="ledger-filter-title" onClose={() => setFiltersOpen(false)}><header className="ti-dialog__header"><h2 id="ledger-filter-title" className="ti-section-title">חיפוש וסינון</h2><Button onClick={() => setFiltersOpen(false)}>סגירה</Button></header><div className="ti-ledger-filter-form">{filters('modal')}</div></Dialog>
 </section>;
}
