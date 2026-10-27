"use client";
import {useCallback,useState} from 'react';
import type {ContradictionItem} from '@/types';
import type {useAiEstimatorState} from './hooks/useAiEstimatorState';
import type {AIPricingEvidenceReference} from './types';
import {normalizeDocumentPage} from '@/components/features/contradiction-radar/utils/documentPage';
import {applyPricingScopeFormEdit} from './pricingScopeForm';
import ScreenOfTruthModal from '@/components/documents/ScreenOfTruthModal';
import EstimatorEvidenceTrace from './components/EstimatorEvidenceTrace';
import EstimatorExpertStrategy from './components/EstimatorExpertStrategy';
import EstimatorFinancialSummary from './components/EstimatorFinancialSummary';
import EstimatorLoadingState from './components/EstimatorLoadingState';
import EstimatorPricingBreakdown from './components/EstimatorPricingBreakdown';
import EstimatorPricingForm from './components/EstimatorPricingForm';
import EstimatorReasoningPanel from './components/EstimatorReasoningPanel';
import EstimatorSourceSelector from './components/EstimatorSourceSelector';
import {Button} from '@/components/ui/titanium/Button';
import {Panel} from '@/components/ui/titanium/Panel';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {BidiText} from '@/components/ui/titanium/BidiText';

type Props=ReturnType<typeof useAiEstimatorState>&{contradiction:ContradictionItem;onClose():void;saveError?:string|null};
export function EstimatorWorkspaceView({state,setters,actions,derived,contradiction,onClose,saveError}:Props){
 const {isLoading,estimateData,isSaving,isExpertMode,formState,viewerDoc,isViewerOpen}=state;
 const {setFormState,setIsExpertMode,setIsViewerOpen}=setters;
 const {handleViewSource}=actions;
 const [sourceContext,setSourceContext]=useState<{page:number|null;quote:string|null}|null>(null);
 const viewSource=useCallback((evidence:AIPricingEvidenceReference)=>{setSourceContext({page:normalizeDocumentPage(evidence.page),quote:evidence.quote||null});void handleViewSource(evidence);},[handleViewSource]);
 const markupPreset=useCallback((markup:number)=>setFormState(previous=>applyPricingScopeFormEdit(previous,'markup',markup)),[setFormState]);
 return <div className="ti-estimator" dir="rtl">
  <header className="ti-dialog__header"><div><h2 id="estimator-title" className="ti-title">הערכת עלות</h2><p className="ti-subtitle">מקורות, הרכב העבודה והסכומים לפני אישור</p></div><div className="ti-actions"><Button aria-pressed={isExpertMode} onClick={()=>setIsExpertMode(!isExpertMode)} disabled={isLoading||isSaving}>מצב מומחה: {isExpertMode?'פעיל':'כבוי'}</Button><Button onClick={onClose} disabled={isSaving} disabledReason={isSaving?'ממתין להשלמת השמירה':undefined}>סגירה</Button></div></header>
  <Panel className="ti-estimator-context"><h3 className="ti-section-title">{contradiction.title}</h3><p className="ti-copy ti-preserve-lines">{contradiction.description}</p><div className="ti-estimator-context__sources">{contradiction.target_doc?.title&&<p className="ti-meta">מסמך חוזה: <BidiText kind="file" value={contradiction.target_doc.title}/></p>}{contradiction.source_doc?.title&&<p className="ti-meta">מסמך ביצוע: <BidiText kind="file" value={contradiction.source_doc.title}/></p>}</div></Panel>
  {saveError&&<Feedback tone="danger">{saveError}</Feedback>}
  <div className="ti-estimator-grid">
   <section className="ti-estimator-evidence" aria-label="מקורות ובסיס ההערכה"><EstimatorSourceSelector source={formState.source} themeColor={derived.themeColor} hasPricingDraft={derived.hasPricingDraft}/>{isLoading?<EstimatorLoadingState isExpertMode={isExpertMode} themeHex={derived.themeHex}/>:<><EstimatorReasoningPanel estimateData={estimateData} isZeroMatch={derived.isZeroMatch} confidencePct={derived.confidencePct} source={formState.source} hasPricingDraft={derived.hasPricingDraft}/><EstimatorPricingBreakdown estimateData={estimateData}/><EstimatorExpertStrategy isExpertMode={isExpertMode} expertStrategy={estimateData?.expert_strategy} expertTechnical={derived.expertTechnical} expertArgument={derived.expertArgument} expertDiary={derived.expertDiary}/><EstimatorEvidenceTrace contradiction={contradiction} estimateData={estimateData} onViewSource={viewSource}/>{!estimateData&&<Button onClick={()=>void actions.runEstimation(isExpertMode)}>ניסיון נוסף לבדיקת מחיר</Button>}</>}</section>
   <section className="ti-estimator-finance" aria-label="נתוני התמחור"><Panel><h3 className="ti-section-title">נתוני התמחור</h3><EstimatorPricingForm formState={formState} onFormChange={actions.handleFormChange} onMarkupPreset={markupPreset} hasPricingDraft={derived.hasPricingDraft} disabled={isLoading||isSaving}/></Panel><EstimatorFinancialSummary themeColor={derived.themeColor} themeHex={derived.themeHex} isExpertMode={isExpertMode} isSaving={isSaving} isLoading={isLoading} totalExclVat={derived.totalExclVat} vatAmount={derived.vatAmount} totalInclVat={derived.totalInclVat} transactionDisplayId={derived.transactionDisplayId} canSubmit={derived.hasPricingDraft&&!derived.requiresUserAnswerBeforeApproval} blockReason={derived.pricingBlockReason||undefined} onSubmit={actions.handleSubmit}/></section>
  </div>
  {isViewerOpen&&viewerDoc&&<ScreenOfTruthModal document={viewerDoc} projectId={viewerDoc.project_id||contradiction.project_id} onClose={()=>setIsViewerOpen(false)} onValidate={async()=>setIsViewerOpen(false)} sourceContext={sourceContext} readOnly/>}
 </div>;
}
