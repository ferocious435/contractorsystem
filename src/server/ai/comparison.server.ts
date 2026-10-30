import 'server-only';
import {BusinessAiError,record,type AiExecutionContext} from './contracts';
import {isAiExecutionContext} from './worker.server';

function active(execution:AiExecutionContext):void {
    if(!isAiExecutionContext(execution)||execution.signal.aborted)throw new BusinessAiError('AI_EXECUTION_REQUIRED',undefined,409);
}
export function getComparisonAiIdentity(execution:AiExecutionContext):{kind:'codex';provider:'Codex';model:string} {
    active(execution);return {kind:'codex',provider:'Codex',model:execution.profile.model};
}
const textEnvelope={type:'object',additionalProperties:false,required:['text'],properties:{text:{type:'string'}}};
/** Nested comparisons use the parent's serial generate boundary. This never creates or observes another job. */
export async function generateComparisonText(prompt:string,execution:AiExecutionContext,options:{responseFormat?:Record<string,unknown>}={}):Promise<string> {
    active(execution);if(typeof prompt!=='string'||!prompt.trim()||(options.responseFormat!==undefined&&!record(options.responseFormat)))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
    const schema=options.responseFormat??textEnvelope;
    const result=await execution.generate({text:options.responseFormat?prompt:'Perform the comparison requested below. Return a JSON object with one text field containing the requested comparison output in full. Do not add a preamble.\n\nCOMPARISON REQUEST:\n'+prompt,outputSchema:structuredClone(schema)});
    active(execution);if(options.responseFormat)return result;
    let parsed:unknown;try{parsed=JSON.parse(result);}catch{throw new BusinessAiError('AI_RESPONSE_INCOMPLETE');}
    if(!record(parsed)||Object.keys(parsed).some(key=>key!=='text')||typeof parsed.text!=='string'||!parsed.text.trim())throw new BusinessAiError('AI_RESPONSE_INCOMPLETE');return parsed.text;
}
