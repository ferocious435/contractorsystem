import React from 'react';
import { CURRENCY_FORMAT_OPTIONS, PRICING_LEDGER_STAT_CARDS } from '../constants';
import type { PricingLedgerTotals } from '../types';
import { Panel } from '@/components/ui/titanium/Panel';
import { BidiText } from '@/components/ui/titanium/BidiText';
function TotalsSummary({ totals, unavailable = false }: {
    totals: PricingLedgerTotals;
    unavailable?: boolean;
}) { return <div className="ti-ledger-totals-frame"><div className="ti-ledger-totals" dir="rtl">{PRICING_LEDGER_STAT_CARDS.map(stat => <Panel material="metal" key={stat.id}><span className="ti-meta">{stat.id === 'grand_total' ? 'צפי כולל מע״מ' : stat.label}</span><strong><BidiText kind="money" value={!unavailable && Number.isFinite(totals[stat.valueKey]) ? new Intl.NumberFormat('he-IL', CURRENCY_FORMAT_OPTIONS).format(totals[stat.valueKey]) : '—'}/></strong><span className="ti-meta">{stat.id === 'grand_total' ? 'כולל חריגים בהמתנה · אינו אישור לתשלום' : stat.id === 'variation_orders' ? 'כולל כל מצבי החריגים · ללא מע״מ' : stat.sub}</span></Panel>)}</div></div>; }
export default React.memo(TotalsSummary);
