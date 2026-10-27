import React from 'react';
import {VAT_RATE} from '@/utils/constants';
import {formatPricingAmount} from '../pricingScopeForm';
import {Panel} from '@/components/ui/titanium/Panel';
import {Button} from '@/components/ui/titanium/Button';
import {BidiText} from '@/components/ui/titanium/BidiText';
interface EstimatorFinancialSummaryProps {themeColor:string;themeHex:string;isExpertMode:boolean;isSaving:boolean;isLoading:boolean;totalExclVat:number|null;vatAmount:number|null;totalInclVat:number|null;transactionDisplayId:string;canSubmit:boolean;blockReason?:string;onSubmit:()=>void;}
const money=(value:number|null)=>value===null?'—':formatPricingAmount(value)+' ₪';
function EstimatorFinancialSummary({isSaving,isLoading,totalExclVat,vatAmount,totalInclVat,canSubmit,blockReason,onSubmit}:EstimatorFinancialSummaryProps){
 const isSubmitDisabled=isSaving||isLoading||!canSubmit;
 const reason=isLoading?'בדיקת המחיר בתהליך':!canSubmit?blockReason||'נדרשים מחיר, כמות ומקור מתאימים לפני שמירה.':undefined;
 return <Panel material="metal" className="ti-estimator-summary"><h3 className="ti-section-title">סיכום ההערכה</h3><dl className="ti-estimator-amounts"><div><dt>ערך נטו (ללא מע״מ)</dt><dd><BidiText kind="money" value={money(totalExclVat)}/></dd></div><div><dt>מע״מ <BidiText kind="percent" value={(VAT_RATE*100).toFixed(0)+'%'}/></dt><dd><BidiText kind="money" value={money(vatAmount)}/></dd></div><div className="ti-estimator-total"><dt>סה״כ כולל מע״מ</dt><dd><BidiText kind="money" value={money(totalInclVat)}/></dd></div></dl><Button variant="primary" onClick={onSubmit} pending={isSaving} busyLabel="שומר תמחור…" disabled={isSubmitDisabled} disabledReason={reason}>בצע רישום במערכת</Button></Panel>;
}
export default React.memo(EstimatorFinancialSummary);
