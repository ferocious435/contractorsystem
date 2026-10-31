"use client";
import {LetterWorkspaceView} from './smart-letter/LetterWorkspaceView';
import {useSmartLetterState} from './smart-letter/hooks/useSmartLetterState';
import type {SmartLetterGeneratorProps} from './smart-letter/types';
import {useState} from 'react';
import {Button} from '@/components/ui/titanium/Button';
import {ProjectCorrespondence} from './correspondence/ProjectCorrespondence';

function FinancialLetter({projectId,initialSelectedItems}:SmartLetterGeneratorProps){
    const workflow = useSmartLetterState({ projectId, initialSelectedItems });
    return <LetterWorkspaceView {...workflow}/>;
}
export default function SmartLetterGenerator(props:SmartLetterGeneratorProps):React.JSX.Element{
    const [mode,setMode]=useState<'correspondence'|'financial'>(()=>props.initialSelectedItems?.length?'financial':'correspondence');
    return <div className="ti-stack"><div className="ti-actions" role="group" aria-label="סוג המכתב"><Button variant={mode==='correspondence'?'primary':'secondary'} aria-pressed={mode==='correspondence'} onClick={()=>setMode('correspondence')}>מכתב עבודה</Button><Button variant={mode==='financial'?'primary':'secondary'} aria-pressed={mode==='financial'} onClick={()=>setMode('financial')}>מכתב עם פירוט כספי</Button></div>
        {mode==='correspondence'?<ProjectCorrespondence key={props.projectId} projectId={props.projectId}/>:<FinancialLetter {...props}/>}</div>;
}
