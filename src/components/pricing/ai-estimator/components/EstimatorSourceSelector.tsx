import React from 'react';
import {FileSpreadsheet,FileText,Landmark,ReceiptText} from 'lucide-react';
import {Feedback} from '@/components/ui/titanium/Feedback';
interface EstimatorSourceSelectorProps {source:string;themeColor:string;hasPricingDraft:boolean;}
const SOURCE_STEPS=[{id:'BOQ',label:'כתב כמויות',icon:FileSpreadsheet,desc:'מקור חוזי ראשון'},{id:'HOUSING_MINISTRY',label:'מחירון משרד השיכון',icon:Landmark,desc:'אם מצוין בחוזה'},{id:'DEKEL',label:'דקל',icon:FileText,desc:'מחירון רשמי נוסף'},{id:'CONTRACTOR',label:'הצעות מחיר',icon:ReceiptText,desc:'רק כשאין מקור רשמי'}];
const SOURCE_LABELS:Record<string,string>={BOQ:'כתב כמויות / סעיף חוזי',HOUSING_MINISTRY:'מחירון משרד הבינוי והשיכון',DEKEL:'דקל / מחירון רשמי',CONTRACTOR:'הצעת מחיר',CUSTOM_ANALYSIS:'טיוטת תמחור לעריכה לפי מסמכי הפרויקט'};
function EstimatorSourceSelector({source,hasPricingDraft}:EstimatorSourceSelectorProps){
 const currentSourceLabel=!hasPricingDraft&&source==='CUSTOM_ANALYSIS'?'לא נבנתה טיוטת מחיר מלאה - עדיין חסרים נתונים לחישוב':SOURCE_LABELS[source]||SOURCE_LABELS.CUSTOM_ANALYSIS;
 return <section className="ti-estimator-sources" data-source-status={hasPricingDraft?'draft':'unknown'}><h3 className="ti-section-title">סדר מקורות המחיר</h3><ol>{SOURCE_STEPS.map((step,index)=><li key={step.id} data-active={step.id===source||undefined}><step.icon size={18} aria-hidden="true"/><span className="ti-meta">{index+1}</span><div><strong>{step.label}</strong><span className="ti-meta">{step.desc}</span></div></li>)}</ol><p className="ti-meta">סדר החיפוש לפי החוזה. הופעת מקור ברשימה אינה אימות שלו ואין צורך לבחור אותו ידנית.</p><Feedback>בסיס התמחור הנוכחי: {currentSourceLabel}</Feedback></section>;
}
export default React.memo(EstimatorSourceSelector);
