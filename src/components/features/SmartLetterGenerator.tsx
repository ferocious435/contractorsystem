"use client";
import {LetterWorkspaceView} from './smart-letter/LetterWorkspaceView';
import {useSmartLetterState} from './smart-letter/hooks/useSmartLetterState';
import type {SmartLetterGeneratorProps} from './smart-letter/types';

export default function SmartLetterGenerator({projectId, initialSelectedItems}: SmartLetterGeneratorProps): React.JSX.Element {
    const workflow = useSmartLetterState({ projectId, initialSelectedItems });
    return <LetterWorkspaceView {...workflow}/>;
}
