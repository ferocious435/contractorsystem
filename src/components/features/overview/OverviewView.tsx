"use client";

import { ArrowUpLeft } from 'lucide-react';
import { Panel } from '@/components/ui/titanium/Panel';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Feedback } from '@/components/ui/titanium/Feedback';
import { StatusChip } from '@/components/ui/titanium/StatusChip';
import type { ProjectView } from '@/components/layout/ProjectNavigation';
import type { ClientAiReadiness } from '@/hooks/useAiReadiness';
import { VAT_RATE } from '@/utils/constants';
import { getAmountInclVat, getAmountVat } from '@/utils/project-financials';

export interface OverviewStats {
  originalBudget:number|null; approvedVO:number|null; pendingVO:number|null; criticalCount:number|null; totalDiscrepancies:number|null; documentCount:number|null; evidenceCoverage:number|null; clientName:string|null;
}
export const emptyOverviewStats: OverviewStats = {originalBudget:null,approvedVO:null,pendingVO:null,criticalCount:null,totalDiscrepancies:null,documentCount:null,evidenceCoverage:null,clientName:null};
const moneyFormatter = new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:2,maximumFractionDigits:2});
export function OverviewView({stats,loading,error,aiStatus,onNavigate}: {stats:OverviewStats;loading:boolean;error:string|null;aiStatus?:ClientAiReadiness|null;onNavigate(view:ProjectView):void}) {
  const data = loading || error ? emptyOverviewStats : stats;
  const totalProjected = data.originalBudget !== null && data.approvedVO !== null && data.pendingVO !== null ? data.originalBudget + data.approvedVO + data.pendingVO : null;
  const money = (amount:number|null) => amount !== null && Number.isFinite(amount) ? moneyFormatter.format(amount) : '—';
  const count = (value:number|null,suffix='') => value !== null && Number.isFinite(value) ? value.toLocaleString('he-IL')+suffix : '—';
  const navigate = (view:ProjectView,label:string) => <Button onClick={()=>onNavigate(view)} data-overview-navigation={view}>{label}<ArrowUpLeft size={16} aria-hidden="true" /></Button>;
  return <div className="ti-page ti-overview" dir="rtl">
    <header className="ti-page-header"><div><h1 className="ti-title">סקירה כללית</h1><p className="ti-subtitle">{data.clientName || 'תמונת מצב של החוזה, המסמכים והנושאים לטיפול'}</p></div><StatusChip tone="neutral">נתוני הפרויקט</StatusChip></header>
    {loading && <Feedback>טוען את נתוני הפרויקט…</Feedback>}{error && <Feedback tone="danger" title="קריאת נתוני הפרויקט לא הושלמה">{error}</Feedback>}
    <div className="ti-overview-kpis">{[
      {label:'חוזה בסיס',value:data.originalBudget,note:'ללא מע״מ'},
      {label:'חריגים מאושרים / נשלחו',value:data.approvedVO,note:'ללא מע״מ · לפי מצב השורות'},
      {label:`מע״מ על הצפי (${(VAT_RATE*100).toFixed(0)}%)`,value:totalProjected===null?null:getAmountVat(totalProjected,VAT_RATE),note:'מוצג בנפרד'},
      {label:'צפי כולל מע״מ',value:totalProjected===null?null:getAmountInclVat(totalProjected,VAT_RATE),note:'כולל חריגים בהמתנה · אינו אישור לתשלום'},
    ].map(item=><Panel material="metal" key={item.label} className="ti-overview-kpi"><span className="ti-meta">{item.label}</span><strong><BidiText kind="money" value={money(item.value)} /></strong><span className="ti-meta">{item.note}</span></Panel>)}</div>
    <div className="ti-overview-grid">
      <Panel className="ti-overview-issues"><h2 className="ti-section-title">דורש תשומת לב</h2><p className="ti-copy">הממצאים נשארים לבדיקה לפי המקור וההקשר שלהם.</p><dl className="ti-overview-counts"><div><dt>ממצאים פתוחים</dt><dd><BidiText kind="code" value={count(data.totalDiscrepancies)} /></dd></div><div><dt>בסיכון גבוה</dt><dd className="ti-risk-value"><BidiText kind="code" value={count(data.criticalCount)} /></dd></div><div><dt>חריגים בהמתנה</dt><dd><BidiText kind="money" value={money(data.pendingVO)} /></dd></div></dl>{navigate('radar','פתיחת מכ״ם הסתירות')}</Panel>
      <Panel className="ti-overview-documents"><h2 className="ti-section-title">מסמכי הפרויקט</h2><p className="ti-overview-big-count"><BidiText kind="code" value={count(data.documentCount)} /></p><p className="ti-copy">קבצים במערכת. מצב הקריאה והאישור מוצגים לכל מסמך בנפרד.</p>{navigate('contracts','פתיחת מסמכי חוזה')}</Panel>
      <Panel className="ti-overview-basis"><h2 className="ti-section-title">בסיס החישוב</h2><p className="ti-copy">הצפי מחבר את חוזה הבסיס, החריגים המאושרים או שנשלחו והחריגים בהמתנה.</p><dl className="ti-overview-counts"><div><dt>חוזה בסיס ללא מע״מ</dt><dd><BidiText kind="money" value={money(data.originalBudget)} /></dd></div><div><dt>חריגים בהמתנה ללא מע״מ</dt><dd><BidiText kind="money" value={money(data.pendingVO)} /></dd></div><div><dt>צפי סופי ללא מע״מ</dt><dd><BidiText kind="money" value={money(totalProjected)} /></dd></div></dl><p className="ti-meta">סכום לא ידוע נשאר — עד לאימות. חריג בהמתנה אינו תשלום מאושר.</p>{navigate('pricing','פתיחת התמחור')}</Panel>
      <Panel className="ti-overview-context"><h2 className="ti-section-title">הסברים ומקורות</h2><dl className="ti-overview-counts"><div><dt>פריטי תמחור עם הסבר</dt><dd><BidiText kind="percent" value={count(data.evidenceCoverage,'%')} /></dd></div></dl><p className="ti-copy">המדד סופר שורות עם הסבר או הערות. הוא אינו אישור לכך שמקור המסמך נבדק.</p><p className="ti-meta">מצב היועץ: {aiStatus === undefined || aiStatus === null ? 'הזמינות טרם נבדקה' : aiStatus.available ? 'זמין' : 'אינו זמין כרגע'}{aiStatus?.available && aiStatus.provider && <> · <bdi dir="ltr">{aiStatus.provider}</bdi></>}</p>{navigate('consultant','פתיחת היועץ')}</Panel>
    </div>
  </div>;
}
