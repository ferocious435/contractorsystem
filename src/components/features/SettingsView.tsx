"use client";
import {Building2, Cpu, Settings} from 'lucide-react';
import {useAiReadiness} from '@/hooks/useAiReadiness';
import {VAT_RATE} from '@/utils/constants';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Field} from '@/components/ui/titanium/Field';
import {Panel} from '@/components/ui/titanium/Panel';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
interface SettingsProject { name?: string | null; client_name?: string | null; }
interface SettingsViewProps { project: SettingsProject | null | undefined; projectId: string | null; }
export function SettingsSummaryView({project,vatRate,currency,readiness,projectId}: {project:SettingsViewProps['project'];vatRate:number;currency:string;readiness:ReturnType<typeof useAiReadiness>;projectId?:string|null}): React.JSX.Element {
 return <main className="ti-page ti-settings" dir="rtl">
  <header className="ti-page-heading"><div><p className="ti-eyebrow">מידע והגדרות</p><h1 className="ti-title">הגדרות מערכת</h1><p className="ti-subtitle">הנתונים הקיימים של הפרויקט והשירותים הזמינים</p></div><StatusChip tone="neutral">תצוגה לקריאה</StatusChip></header>
  <div className="ti-settings-grid">
   <Panel><h2 className="ti-section-title"><Building2 size={18} aria-hidden="true"/>זהות הפרויקט</h2><Field label="שם הפרויקט" name="projectName" value={project?.name||'לא צוין'} readOnly/><Field label="לקוח / מזמין" name="clientName" value={project?.client_name||'לא צוין'} readOnly/>{projectId&&<div><p className="ti-field__label">מזהה פרויקט</p><BidiText kind="code" value={projectId}/></div>}<p className="ti-meta">פרטי הפרויקט מנוהלים ברשימת הפרויקטים.</p></Panel>
   <Panel><h2 className="ti-section-title"><Settings size={18} aria-hidden="true"/>פרמטרים כלכליים</h2><Field label="שיעור מע״מ (%)" name="vatRate" value={vatRate} readOnly/><Field label="מטבע פעיל" name="currency" value={currency} readOnly/><Feedback>הסכומים העיקריים מוצגים ללא מע״מ. המע״מ מחושב בנפרד לפי כללי הפרויקט.</Feedback><Button aria-label="שמירת הגדרות" disabled disabledReason="אין במסך זה פעולת שמירה מחוברת. הערכים מוצגים לקריאה בלבד.">שמירת הגדרות</Button></Panel>
   <Panel><h2 className="ti-section-title"><Cpu size={18} aria-hidden="true"/>מצב העוזר</h2>{readiness===null?<Feedback>קורא את מצב השירות…</Feedback>:readiness.available?<><StatusChip tone="success">זמין</StatusChip><p className="ti-copy" dir="auto">{readiness.provider||'שם השירות לא נמסר'}</p><p className="ti-meta">זמינות החיבור אינה אישור לאיכות המסמכים או התשובה.</p></>:<><StatusChip tone="warning">לא זמין</StatusChip><Feedback tone="warning">{readiness.reason==='STATUS_UNAVAILABLE'?'לא התקבל מצב השירות.':readiness.reason||'לא אושר חיבור זמין לעוזר.'}</Feedback></>}<dl className="ti-settings-facts"><div><dt>שימוש בזיכרון</dt><dd>לא נמדד במסך זה</dd></div><div><dt>בדיקת מסד הנתונים</dt><dd>אין בדיקה נפרדת במסך זה</dd></div></dl></Panel>
   <Panel><h2 className="ti-section-title">פעולות שאינן מחוברות למסך</h2><p className="ti-copy">בחירת פורמט מתבצעת בפעולת הייצוא עצמה. שינוי שפת הממשק אינו זמין כאן.</p><Button disabled disabledReason="שינוי פורמט ושפה אינו נשמר דרך המסך הזה.">אפשרויות תצוגה וייצוא</Button><Button variant="danger" disabled disabledReason="ניהול ומחיקת פרויקט נמצאים בתפריט הפרויקט ברשימת הפרויקטים.">ניהול הפרויקט</Button></Panel>
  </div>
 </main>;
}
export default function SettingsView({project,projectId}:SettingsViewProps): React.JSX.Element {const readiness=useAiReadiness();return <SettingsSummaryView project={project} projectId={projectId} vatRate={VAT_RATE*100} currency="ILS (₪)" readiness={readiness}/>;}
