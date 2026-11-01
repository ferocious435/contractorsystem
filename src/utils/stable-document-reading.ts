import {makeTextInput,type PreparedDocumentAnalysisInput} from './document-text-extraction';
import {assessDocumentSourceReadiness,type DocumentSourceInput} from './document-source-readiness';
import {hasSavedVisualReading} from './document-reading-history';
import type {VisualDescription,VisualReadingVerification} from './visual-source-reading';

/** A renderer update may repad Markdown tables. Keep the complete saved source
 * representation so existing exact citations remain valid for identical bytes. */
export function preserveStableDocumentText(prepared:PreparedDocumentAnalysisInput,saved:DocumentSourceInput,fileHash:string):PreparedDocumentAnalysisInput{
    if(hasSavedVisualReading(saved,fileHash)){
        const parsed=saved.parsed_json as Record<string,unknown>;
        return makeTextInput(prepared.fileBuffer,'saved_visual_source_reading',String(saved.extracted_text||''),{
            readingVerification:parsed.source_reading as VisualReadingVerification,requiresReview:!assessDocumentSourceReadiness(saved).extractionComplete,
            visualDescriptions:Array.isArray(parsed.source_reading_visual_descriptions)?parsed.source_reading_visual_descriptions as VisualDescription[]:[]});
    }
    if(prepared.kind!=='text'||prepared.readingVerification?.version!=='docx-image-coverage-v1'||prepared.requiresReview||saved.content_hash!==fileHash||typeof saved.extracted_text!=='string')return prepared;
    const current={...saved,extracted_text:prepared.extractedText,ocr_status:'COMPLETED',parsed_json:{source_reading:prepared.readingVerification}};
    if(!assessDocumentSourceReadiness(saved).extractionComplete||!assessDocumentSourceReadiness(current).extractionComplete)return prepared;
    const tables=(text:string)=>text.replaceAll('\r\n','\n').split('\n').map(line=>/^\s*\|.*\|\s*$/.test(line)?line.trim().split('|').map(cell=>cell.trim()).join('|'):line).join('\n');
    if(tables(saved.extracted_text)!==tables(prepared.extractedText))return prepared;
    return makeTextInput(prepared.fileBuffer,prepared.extractionSource,saved.extracted_text,{readingVerification:prepared.readingVerification,requiresReview:prepared.requiresReview,ocrConfidence:prepared.ocrConfidence});
}
