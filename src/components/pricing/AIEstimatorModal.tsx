"use client";
import {useCallback,useState} from 'react';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {EstimatorWorkspaceView} from './ai-estimator/EstimatorWorkspaceView';
import {useAiEstimatorState} from './ai-estimator/hooks/useAiEstimatorState';
import type {AIEstimatorModalProps} from './ai-estimator/types';
export default function AIEstimatorModal({contradiction,onClose,onApprove}:AIEstimatorModalProps){
 const [saveError,setSaveError]=useState<string|null>(null);
 const approve=useCallback<AIEstimatorModalProps['onApprove']>(async data=>{setSaveError(null);try{await onApprove(data);}catch(cause){setSaveError('שמירת התמחור לא הושלמה. '+(cause instanceof Error?cause.message:'הנתונים נשארו בחלון לבדיקה.'));throw cause;}},[onApprove]);
 const workflow=useAiEstimatorState({contradiction,onClose,onApprove:approve});
 return <Dialog open labelledBy="estimator-title" className="ti-dialog--estimator" onClose={()=>{if(!workflow.state.isSaving)onClose();}}><EstimatorWorkspaceView {...workflow} contradiction={contradiction} onClose={onClose} saveError={saveError}/></Dialog>;
}
