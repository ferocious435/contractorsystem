import {Download,Scan} from 'lucide-react';
import {Panel} from '@/components/ui/titanium/Panel';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {StatusChip} from '@/components/ui/titanium/StatusChip';
interface ContradictionRadarHeaderProps {
    isScanning: boolean;
    progress: number;
    retryableDocsCount?: number;
    currentStep: string | null;
    currentStepStatus?: 'success' | 'error' | null;
    contractDocsCount: number;
    executionDocsCount: number;
    hasContradictions: boolean;
    aiAvailable: boolean | null;
    projectName: string;
    scanProject: (force: boolean, retrySkipped?: boolean) => void;
    onExportPDF: () => void;
    onBack?: () => void;
}


export default function ContradictionRadarHeader({isScanning,progress,retryableDocsCount=0,currentStep,currentStepStatus,contractDocsCount,executionDocsCount,hasContradictions,aiAvailable,projectName,scanProject,onExportPDF,onBack}:ContradictionRadarHeaderProps){
 const unavailable=aiAvailable!==true,reason=aiAvailable===null?'בודק את זמינות שירות הניתוח…':'שירות הניתוח אינו זמין. אפשר לצפות בממצאים ובמקורות השמורים.';
 return <Panel material="metal" className="ti-radar-header"><div className="ti-page-header"><div className="ti-radar-header__title"><h1 className="ti-title">מכ״ם סתירות</h1><p className="ti-subtitle">פערים בין החוזה לביצוע · {projectName}</p></div><div className="ti-actions">{onBack&&<Button variant="text" onClick={onBack}>חזרה לרשימת פרויקטים</Button>}<Button variant="primary" onClick={()=>scanProject(false)} disabled={isScanning||unavailable} pending={isScanning} busyLabel="הבדיקה פועלת…" disabledReason={unavailable?reason:undefined}><Scan size={17} aria-hidden="true"/>בדיקה חכמה</Button>{retryableDocsCount>0 && <Button onClick={()=>scanProject(false,true)} disabled={isScanning||unavailable} disabledReason={unavailable?reason:undefined}>בדיקה חוזרת ל־{retryableDocsCount} {retryableDocsCount===1?'מסמך':'מסמכים'}</Button>}<Button onClick={onExportPDF} disabled={!hasContradictions} disabledReason={!hasContradictions?'אין ממצאים שמורים לייצוא':undefined}><Download size={17} aria-hidden="true"/>ייצוא דוח PDF</Button></div></div>
 <div className="ti-radar-header__status"><StatusChip tone={isScanning?'info':'neutral'}>{isScanning?'בדיקת מסמכים בתהליך':aiAvailable===null?'בודק זמינות ניתוח':aiAvailable?'שירות הניתוח זמין':'ניתוח חדש אינו זמין'}</StatusChip><span className="ti-meta">ברשימה שנטענה: {contractDocsCount} מסמכים חוזיים · {executionDocsCount} מסמכי ביצוע</span><span className="ti-meta">הבדיקה החכמה משתמשת בתוצאות הקיימות ובודקת מסמכים חדשים או שהשתנו.</span></div>
 {isScanning && <div className="ti-radar-progress" role="status"><span>{currentStep || 'בודק מסמכים…'}</span><progress max={100} value={Math.max(0,Math.min(100,progress))} aria-label="התקדמות בדיקת המסמכים"/><bdi dir="ltr">{Math.round(progress)}%</bdi></div>}
 {currentStep&&!isScanning && <Feedback tone={currentStepStatus==='success'?'success':currentStepStatus==='error'?'danger':'info'}>{currentStep}</Feedback>}
 </Panel>;
}
