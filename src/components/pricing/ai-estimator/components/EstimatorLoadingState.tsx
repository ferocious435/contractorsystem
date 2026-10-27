import React from 'react';
import {Feedback} from '@/components/ui/titanium/Feedback';
interface EstimatorLoadingStateProps {isExpertMode:boolean;themeHex:string;}
function EstimatorLoadingState({isExpertMode}:EstimatorLoadingStateProps){return <Feedback aria-live="polite" className="ti-estimator-loading"><span className="ti-spinner" aria-hidden="true"/><span>{isExpertMode?'ממתין לניתוח ההנדסי־מסחרי…':'ממתין לתוצאת בדיקת המחיר…'}</span><p className="ti-meta">הסכומים והאפשרות לשמור יתעדכנו אחרי תוצאת הבדיקה.</p></Feedback>;}
export default React.memo(EstimatorLoadingState);
