"use client";
import React, { useState } from 'react';
import { Download, FileText, Plus, RefreshCw, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/titanium/Button';
import { Dialog } from '@/components/ui/titanium/Dialog';
interface ActionBarProps {
    selectedCount: number;
    isSyncing: boolean;
    onGenerateLetter(): void;
    onExportCSV(): void;
    onAddNew(): void;
    onSync(): void;
    onOpenSummary?(): void;
    onOpenFilters?(): void;
}
function ActionBar({ selectedCount, isSyncing, onGenerateLetter, onExportCSV, onAddNew, onSync, onOpenSummary, onOpenFilters }: ActionBarProps) { const [toolsOpen, setToolsOpen] = useState(false); const tools = <><Button onClick={onSync} pending={isSyncing} busyLabel="מסנכרן…"><RefreshCw size={16} aria-hidden="true"/>סנכרון BOQ</Button><Button onClick={onGenerateLetter} disabled={!selectedCount} disabledReason={!selectedCount ? 'בחר שורות חריג מתאימות למכתב' : undefined}><FileText size={16} aria-hidden="true"/>הפקת מכתב ({selectedCount})</Button><Button onClick={onExportCSV}><Download size={16} aria-hidden="true"/>ייצוא CSV</Button></>; return <><header className="ti-page-header ti-ledger-header"><div><h1 className="ti-title">תמחור חריגים</h1><p className="ti-subtitle">תמחורים עצמאיים · פירוט ומקורות לכל רשומה</p></div><div className="ti-actions"><div className="ti-ledger-desktop-tools ti-actions">{tools}</div><Button className="ti-ledger-add" variant="primary" onClick={onAddNew}><Plus size={16} aria-hidden="true"/>הוספת שורה</Button><Button className="ti-ledger-compact-tools" aria-label="כלי תמחור נוספים" onClick={() => setToolsOpen(true)}><MoreHorizontal size={18} aria-hidden="true"/></Button></div></header><Dialog open={toolsOpen} labelledBy="ledger-tools-title" onClose={() => setToolsOpen(false)}><header className="ti-dialog__header"><h2 id="ledger-tools-title" className="ti-section-title">כלי תמחור</h2><Button onClick={() => setToolsOpen(false)}>סגירה</Button></header><div className="ti-ledger-tool-list"><Button variant="primary" onClick={onAddNew}><Plus size={16} aria-hidden="true"/>הוספת שורה</Button>{onOpenSummary&&<Button onClick={onOpenSummary}>סיכום התמחורים</Button>}{onOpenFilters&&<Button onClick={onOpenFilters}>חיפוש וסינון</Button>}{tools}</div></Dialog></>; }
export default React.memo(ActionBar);
