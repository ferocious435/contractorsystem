"use client";
import {Building2, Cpu, Settings} from 'lucide-react';
import {useAiReadiness} from '@/hooks/useAiReadiness';
import {VAT_RATE} from '@/utils/constants';
import {BidiText} from '@/components/ui/titanium/BidiText';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {Field} from '@/components/ui/titanium/Field';
import {Panel} from '@/components/ui/titanium/Panel';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
import {AiRuntimeSettings} from './ai/AiRuntimeSettings';
interface SettingsProject { name?: string | null; client_name?: string | null; }
interface SettingsViewProps { project: SettingsProject | null | undefined; projectId: string | null; }
export function SettingsSummaryView({project,vatRate,currency,readiness,projectId}: {project:SettingsViewProps['project'];vatRate:number;currency:string;readiness:ReturnType<typeof useAiReadiness>;projectId?:string|null}): React.JSX.Element {
 return <main className="ti-page ti-settings" dir="rtl">
  <header className="ti-page-heading"><div><p className="ti-eyebrow">מידע והגדרות</p><h1 className="ti-title">הגדרות מערכת</h1><p className="ti-subtitle">פרטי הפרויקט ובחירת עוזר העבודה</p></div><StatusChip tone="neutral">הגדרות הפרויקט והעוזר</StatusChip></header>
  <div className="ti-settings-grid">
   <Panel><h2 className="ti-section-title"><Building2 size={18} aria-hidden="true"/>זהות הפרויקט</h2><Field label="שם הפרויקט" name="projectName" value={project?.name||'לא צוין'} readOnly/><Field label="לקוח / מזמין" name="clientName" value={project?.client_name||'לא צוין'} readOnly/>{projectId&&<div><p className="ti-field__label">מזהה פרויקט</p><BidiText kind="code" value={projectId}/></div>}<p className="ti-meta">פרטי הפרויקט מנוהלים ברשימת הפרויקטים.</p></Panel>
   <Panel><h2 className="ti-section-title"><Settings size={18} aria-hidden="true"/>פרמטרים כלכליים</h2><Field label="שיעור מע״מ (%)" name="vatRate" value={vatRate} readOnly/><Field label="מטבע פעיל" name="currency" value={currency} readOnly/><Feedback>הסכומים העיקריים מוצגים ללא מע״מ. המע״מ מחושב בנפרד לפי כללי הפרויקט.</Feedback><p className="ti-meta">כללי החישוב מוצגים לקריאה. נתוני הפרויקט נערכים במסכי הפרויקט.</p></Panel>
   <Panel><h2 className="ti-section-title"><Cpu size={18} aria-hidden="true"/>עוזר העבודה</h2><AiRuntimeSettings/>{readiness?.available&&<p className="ti-meta" dir="auto">{readiness.provider}</p>}</Panel>
  </div>
 </main>;
}
export default function SettingsView({project,projectId}:SettingsViewProps): React.JSX.Element {const readiness=useAiReadiness();return <SettingsSummaryView project={project} projectId={projectId} vatRate={VAT_RATE*100} currency="ILS (₪)" readiness={readiness}/>;}
