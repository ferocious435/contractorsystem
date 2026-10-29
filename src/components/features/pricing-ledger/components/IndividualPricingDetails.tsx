import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import {
    formatIndividualMoney, getIndividualPricing, individualPricingReasonLabels,
    type IndividualPricingInput,
} from '../utils/individualPricing';

export function IndividualPricingDetails({ item }: { item: IndividualPricingInput }) {
    const pricing = getIndividualPricing(item);
    return <section className="ti-individual-pricing" aria-label="פירוט התמחור השמור" data-pricing-status={pricing.status}>
        <h4 className="ti-section-title">פירוט התמחור</h4>
        <dl className="ti-source-metadata ti-individual-pricing__amounts">
            <div><dt>כמות שמורה</dt><dd><BidiText kind="code" value={pricing.quantity === null ? '—' : String(pricing.quantity)}/></dd></div>
            <div><dt>מחיר יחידה לאחר התאמות, ללא מע״מ</dt><dd><BidiText kind="money" value={formatIndividualMoney(pricing.unitPriceExclVat)}/></dd></div>
            <div><dt>סכום לפני מע״מ</dt><dd><BidiText kind="money" value={formatIndividualMoney(pricing.totalExclVat)}/></dd></div>
            <div><dt>שיעור מע״מ</dt><dd><BidiText kind="percent" value={pricing.vatRate === null ? '—' : `${Number((pricing.vatRate * 100).toFixed(4))}%`}/></dd></div>
            <div><dt>מע״מ לתמחור הזה</dt><dd><BidiText kind="money" value={formatIndividualMoney(pricing.vatAmount)}/></dd></div>
            <div className="ti-individual-pricing__total"><dt>סה״כ כולל מע״מ</dt><dd><strong><BidiText kind="money" value={formatIndividualMoney(pricing.totalInclVat)}/></strong></dd></div>
        </dl>
        <div><h5 className="ti-section-title">הנחות ותוספות</h5><p className="ti-copy ti-preserve-lines">{pricing.conditionNote}</p>
            {pricing.adjustments.length > 0 && <ul className="ti-ledger-notes">{pricing.adjustments.map((adjustment, index) => <li key={index}>
                {adjustment.label}: <BidiText kind="code" value={String(adjustment.value)}/>{adjustment.note && <p className="ti-meta ti-preserve-lines">{adjustment.note}</p>}
            </li>)}</ul>}
        </div>
        {pricing.status !== 'complete' && <Feedback tone="warning" title="התמחור דורש השלמה">
            <ul className="ti-ledger-notes">{pricing.reasons.map(reason => <li key={reason}>{individualPricingReasonLabels[reason]}</li>)}</ul>
        </Feedback>}
        <p className="ti-meta">זהו פירוט שמור. פתיחת החלון אינה מפעילה ניתוח או משנה את התמחור.</p>
    </section>;
}
