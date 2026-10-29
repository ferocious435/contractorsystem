import React from 'react';
import { Panel } from '@/components/ui/titanium/Panel';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { formatIndividualMoney, type IndividualPricingSummary } from '../utils/individualPricing';

function TotalsSummary({ summary, unavailable = false }: {
    summary: IndividualPricingSummary;
    unavailable?: boolean;
}) {
    const cards = [
        { label: 'סך התמחורים המוכנים · כולל מע״מ', value: summary.totalInclVat, count: summary.readyCount },
        { label: 'ממתינים לאישור · כולל מע״מ', count: summary.byStatus.pending.count, value: summary.byStatus.pending.totalInclVat },
        { label: 'מאושרים · כולל מע״מ', count: summary.byStatus.approved.count, value: summary.byStatus.approved.totalInclVat },
        { label: 'נשלחו לדרישה · כולל מע״מ', count: summary.byStatus.sent.count, value: summary.byStatus.sent.totalInclVat },
    ];
    return <div className="ti-ledger-totals-frame">
        <div className="ti-ledger-totals" dir="rtl">{cards.map(card => <Panel material="metal" key={card.label}>
            <span className="ti-meta">{card.label}</span>
            <strong><BidiText kind="money" value={formatIndividualMoney(unavailable ? null : card.value)}/></strong>
            <span className="ti-meta">{unavailable ? 'הנתונים אינם זמינים כרגע' : `${card.count} תמחורים מוכנים`}</span>
        </Panel>)}</div>
        {!unavailable && <>
            {summary.incompleteCount > 0 && <Feedback tone="warning">{summary.incompleteCount} רשומות דורשות השלמה ולא נכללו בסכומים.</Feedback>}
            {summary.alternativeCount > 0 && <Feedback tone="warning">{summary.alternativeCount} רשומות הן גרסאות או חלופות שלא הוכרעו ולא נכללו יחד בסכום.</Feedback>}
            {summary.duplicateCount > 0 && <p className="ti-meta">{summary.duplicateCount} מופעים חוזרים של אותה רשומה לא נספרו שוב.</p>}
            <p className="ti-copy">הסכומים הם חיבור של התמחורים המוכנים, כולל המע״מ של כל תמחור. לא נוסף מע״מ פעם נוספת.</p>
            <p className="ti-meta">רישומי חוזה הבסיס אינם כלולים בסיכום זה ({summary.excludedBaseCount}). שליחה לדרישה אינה אישור לתשלום.</p>
        </>}
    </div>;
}

export default React.memo(TotalsSummary);
