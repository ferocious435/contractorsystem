import React,{useId} from 'react';
import type {ChangeEvent} from 'react';
import type {AIEstimatorFormState} from '../types';
import {Field} from '@/components/ui/titanium/Field';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
interface EstimatorPricingFormProps {formState:AIEstimatorFormState;onFormChange:(event:ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>void;onMarkupPreset:(markup:number)=>void;hasPricingDraft:boolean;disabled?:boolean;}
const MARKUP_PRESETS=[0,10,15,20,25];
const SOURCE_LABELS:Record<string,string>={BOQ:'כתב כמויות / סעיף חוזי',DEKEL:'דקל או מחירון רשמי שנמצא במערכת',HOUSING_MINISTRY:'מחירון משרד הבינוי והשיכון',CONTRACTOR:'הצעת מחיר',CUSTOM_ANALYSIS:'מחיר לפי מקור שמור בפרויקט'};
function EstimatorPricingForm({formState,onFormChange,onMarkupPreset,disabled=false}:EstimatorPricingFormProps){
 const descriptionId=useId();
 const pricingBasisLabel=formState.unitPrice===null?'לא נבנה מחיר אוטומטי - יש להזין מחיר יחידה':formState.manualPricingInputs.unitPriceExclVat!==undefined||formState.manualPricingInputs.markupPercent?'מחיר שהוזן או הותאם ידנית':SOURCE_LABELS[formState.source]||SOURCE_LABELS.CUSTOM_ANALYSIS;
 return <div className="ti-estimator-form"><div className="ti-field ti-estimator-form__wide"><label htmlFor={descriptionId} className="ti-field__label">תיאור עבודה</label><textarea id={descriptionId} name="description" value={formState.description} onChange={onFormChange} className="ti-textarea" rows={4} disabled={disabled}/></div><div className="ti-estimator-form__wide"><span className="ti-field__label">בסיס התמחור</span><Feedback>{pricingBasisLabel}</Feedback></div><Field label="יחידה" name="unit" value={formState.unit} onChange={onFormChange} disabled={disabled}/><Field label="כמות" name="quantity" type="number" step="any" value={formState.quantity??''} onChange={onFormChange} hint={formState.quantity===null?'הכמות אינה ידועה עדיין':undefined} disabled={disabled}/><Field label="מחיר יחידה ללא מע״מ" name="unitPrice" type="number" step="any" value={formState.unitPrice??''} onChange={onFormChange} hint={formState.unitPrice===null?'לא נמצא מחיר יחידה לחישוב':undefined} disabled={disabled}/><Field label="תקורה ורווח (%)" name="markup" type="number" step="any" value={formState.markup} onChange={onFormChange} disabled={disabled}/><div className="ti-estimator-form__wide"><div className="ti-actions" aria-label="שיעורי תקורה ורווח">{MARKUP_PRESETS.map(value=><Button key={value} variant="text" aria-pressed={formState.markup===value} onClick={()=>onMarkupPreset(value)} disabled={disabled}>{value===0?'0%':'+'+value+'%'}</Button>)}</div><p className="ti-meta">אם לא מאשרים רווח קבלני, השאר 0%. המע״מ נשאר מחושב בנפרד.</p></div></div>;
}
export default React.memo(EstimatorPricingForm);
