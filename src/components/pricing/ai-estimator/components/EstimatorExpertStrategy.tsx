import React from 'react';
import {Panel} from '@/components/ui/titanium/Panel';
interface EstimatorExpertStrategyProps {isExpertMode:boolean;expertStrategy?:unknown;expertTechnical?:string|null;expertArgument?:string|null;expertDiary?:string|null;}
function EstimatorExpertStrategy({isExpertMode,expertStrategy,expertTechnical,expertArgument,expertDiary}:EstimatorExpertStrategyProps){
 if(!isExpertMode||!expertStrategy)return null;
 return <Panel className="ti-estimator-expert"><h3 className="ti-section-title">ביסוס הנדסי־מסחרי</h3>{[['ביסוס מקצועי',expertTechnical],['טיעון מקצועי',expertArgument],['הנחיה ליומן עבודה',expertDiary]].map(([title,value])=><section key={String(title)}><h4 className="ti-section-title">{title}</h4><p className="ti-copy ti-preserve-lines">{value||'לא נשמר פירוט נוסף.'}</p></section>)}<p className="ti-meta">הניתוח שנשמר נבחן מול המקורות; הוא אינו אישור כספי.</p></Panel>;
}
export default React.memo(EstimatorExpertStrategy);
