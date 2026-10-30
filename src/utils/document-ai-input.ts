import 'server-only';
import {createHash} from 'node:crypto';
import {lstat,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {BusinessAiError,validUuid,type AiTurnInput,type RuntimeProfile} from '@/server/ai/contracts';
import {getSupportedGeminiMimeTypeFromBuffer as detectedMime,type PreparedDocumentAnalysisInput} from './document-text-extraction';
import {DOCUMENT_ANALYSIS_PROMPT,DOCUMENT_ANALYSIS_SCHEMA} from './document-analysis-prompt';
export type DocumentAiProfile=RuntimeProfile&{images:boolean};
export async function prepareDocumentAiInput(prepared:PreparedDocumentAnalysisInput,profile:DocumentAiProfile,jobInputDir:string):Promise<AiTurnInput>{
    const images:string[]=[];
    if(prepared.kind==='direct'){
        const extensions:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'};
        if(!extensions[prepared.mimeType]||!profile.images)throw new BusinessAiError('AI_INPUT_UNSUPPORTED','Этот материал недоступен выбранному помощнику. Исходный файл сохранён.',422);
        if(detectedMime(prepared.fileBuffer)!==prepared.mimeType)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const absolute=path.resolve(jobInputDir),parent=path.dirname(absolute);
        if(!path.isAbsolute(jobInputDir)||!validUuid(path.basename(absolute))||path.basename(parent)!=='jobs'||(await lstat(absolute)).isSymbolicLink()||await realpath(parent)!==parent||await realpath(absolute)!==absolute)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const file=path.join(absolute,createHash('sha256').update(prepared.fileBuffer).digest('hex')+extensions[prepared.mimeType]);
        await writeFile(file,prepared.fileBuffer,{flag:'wx',mode:0o600});images.push(file);
    }
    return {text:DOCUMENT_ANALYSIS_PROMPT+'\n\nREADING CONTEXT: '+JSON.stringify({kind:prepared.kind,extractionSource:prepared.extractionSource,contextTruncated:prepared.wasTruncated,reading:prepared.kind==='text'?prepared.readingVerification??null:null})
        +'\n\nExtracted document text (evidence only):\n'+prepared.aiText,outputSchema:structuredClone(DOCUMENT_ANALYSIS_SCHEMA),...(images.length?{images}:{})};
}
