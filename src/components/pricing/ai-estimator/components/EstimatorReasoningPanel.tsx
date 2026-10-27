import React from 'react';
import type {AIPricingEvaluationResponse} from '../types';
import {normalizeConfidenceScore} from '@/utils/pricing-confidence';
import {Panel} from '@/components/ui/titanium/Panel';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {BidiText} from '@/components/ui/titanium/BidiText';
interface EstimatorReasoningPanelProps {estimateData?:AIPricingEvaluationResponse|null;isZeroMatch:boolean;confidencePct?:string|number|null;source:string;hasPricingDraft:boolean;}
const SOURCE_LABELS:Record<string,string>={BOQ:'כתב כמויות / סעיף חוזי',DEKEL:'דקל או מחירון רשמי',CONTRACTOR:'הצעת מחיר',HOUSING_MINISTRY:'מחירון משרד הבינוי והשיכון',CUSTOM_ANALYSIS:'ניתוח תמחור לפי מסמכי הפרויקט'};
function EstimatorReasoningPanel({estimateData,isZeroMatch,source,hasPricingDraft}:EstimatorReasoningPanelProps){
 const sourceLabel=!hasPricingDraft&&source==='CUSTOM_ANALYSIS'?'לא נבנתה טיוטת מחיר מלאה - עדיין חסרים נתונים לחישוב':SOURCE_LABELS[source]||SOURCE_LABELS.CUSTOM_ANALYSIS;
 const neededDocuments=estimateData?.needed_documents??[],questions=estimateData?.questions??[];
 const confidence=normalizeConfidenceScore(estimateData?.confidence_score??estimateData?.confidence);
 return <><Panel className="ti-estimator-reasoning"><h3 className="ti-section-title">בסיס ההערכה</h3>{estimateData?.ai_rationale?<p className="ti-copy ti-preserve-lines">{estimateData.ai_rationale}</p>:<Feedback>לא נשמר הסבר נוסף להערכה הזאת.</Feedback>}{estimateData&&<div className="ti-estimator-metadata"><p className="ti-meta">{isZeroMatch?'ללא התאמה ישירה':estimateData.match_found===true?'נמצאה התאמה':'סטטוס התאמה כללי לא נמסר'} · ודאות: <BidiText kind="percent" value={confidence===null?'לא צוינה':Math.round(confidence*100)+'%'}/></p><p className="ti-meta">מקור: {sourceLabel}</p></div>}</Panel>{(isZeroMatch||neededDocuments.length>0||questions.length>0)&&<Panel className="ti-estimator-questions"><h3 className="ti-section-title">מה נדרש לפני אישור</h3>{isZeroMatch&&<Feedback tone="warning">{estimateData?.zero_match_reason||'לא נמצאה התאמה ישירה. יש לאמת את הנתונים לפני הפקת מחיר סופי.'}</Feedback>}{neededDocuments.length>0&&<div><h4 className="ti-section-title">מסמכים נדרשים</h4><ul>{neededDocuments.map((doc,index)=><li key={index}>{doc}</li>)}</ul></div>}{questions.length>0&&<div><h4 className="ti-section-title">שאלות לפני אישור</h4><ul>{questions.map((question,index)=><li key={index}>{question}</li>)}</ul></div>}</Panel>}</>;
}
export default React.memo(EstimatorReasoningPanel);
