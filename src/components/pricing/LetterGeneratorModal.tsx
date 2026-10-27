"use client";
import React from 'react';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Button} from '@/components/ui/titanium/Button';
import SmartLetterGenerator from '@/components/features/SmartLetterGenerator';

interface LetterGeneratorModalProps { projectId: string; initialSelectedItems: string[]; onClose(): void; }
function LetterGeneratorModal({projectId, initialSelectedItems, onClose}: LetterGeneratorModalProps): React.JSX.Element {
    return <Dialog open labelledBy="letter-modal-title" className="ti-dialog--wide ti-letter-modal" onClose={onClose}>
        <header className="ti-dialog__header"><h2 id="letter-modal-title" className="ti-section-title">מכתב מהשורות שנבחרו</h2><Button onClick={onClose}>סגירה</Button></header>
        <SmartLetterGenerator projectId={projectId} initialSelectedItems={initialSelectedItems} onClose={onClose}/>
    </Dialog>;
}
export default React.memo(LetterGeneratorModal);
