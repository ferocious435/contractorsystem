import {BusinessAiError,record} from '@/server/ai/contracts';
import {renderWritingSources} from './business-writing-result';
import type {LetterSourceRef} from './letter-draft-types';
export type CorrespondenceResult={letter:string;sourceRefs:LetterSourceRef[]};
export function checkedCorrespondenceResult(value:unknown):CorrespondenceResult{
    if(!record(value)||value.purpose!=='correspondence'||typeof value.letter!=='string'||!value.letter.trim()||!Array.isArray(value.sourceRefs))throw Error('לא התקבל מכתב מלא. אפשר לנסות שוב.');
    const sourceRefs=value.sourceRefs as LetterSourceRef[];
    const legacyAppendix='\n\nמקורות שמורים:\n'+renderWritingSources(sourceRefs);
    const letter=value.formatVersion!=='correspondence-v2'&&sourceRefs.length&&value.letter.endsWith(legacyAppendix)?value.letter.slice(0,-legacyAppendix.length):value.letter;
    return {letter,sourceRefs};
}
export type GenerationIdentity={signature:string;id:string};
/** A lost acknowledgement may already have created a job; a known final failure
 * needs a new key so that retrying cannot reopen the same failed job forever. */
export function generationIdentityAfterFailure(pending:GenerationIdentity|null,error:unknown):GenerationIdentity|null{
    if(error instanceof BusinessAiError){
        if(error.status===409)return null;
        return ['AI_TIMEOUT','AI_UNAVAILABLE','AI_RESPONSE_INVALID'].includes(error.code)?pending:null;
    }
    return error instanceof TypeError||error instanceof DOMException&&['AbortError','TimeoutError'].includes(error.name)?pending:null;
}
