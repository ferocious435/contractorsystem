export type AiJobKind = 'letter'|'consultant'|'scan'|'scan_preview'|'pricing'|'work_change'|'support_enrichment'|'document_analysis';
export type AiJobState = 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'INTERRUPTED';
export type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type JsonObject = {[key:string]:JsonValue};
export interface RuntimeProfile {ownerId:string; accountFingerprint:string; model:string; effort:string|null; revision:number;}
export interface JobDto {
    id:string; projectId:string; kind:AiJobKind; state:AiJobState; revision:number;
    conversationId:string|null; clientContextId:string|null; result:JsonValue|null;
    error:{code:string;message:string}|null;
}
export interface AiTurnInput {text:string; images?:readonly string[]; outputSchema:Record<string,unknown>;}
export interface VerifiedAiEffect {
    type:'SCAN_FINDING'|'SCAN_STATE'|'PRICING_EVIDENCE'|'DOCUMENT_ANALYSIS';
    targetId:string; expectedRevision:string; data:JsonObject;
}
export interface PreparedAiResult {result:JsonValue; effects:readonly VerifiedAiEffect[];}
export interface AiExecutionContext {
    jobId:string; ownerId:string; projectId:string; profile:RuntimeProfile; signal:AbortSignal;
    generate(input:AiTurnInput):Promise<string>; checkActive():Promise<void>;
}
export interface AiJobHandler {
    validate(payload:unknown):JsonObject;
    execute(payload:JsonObject,execution:AiExecutionContext):Promise<PreparedAiResult>;
}
export class BusinessAiError extends Error {
    constructor(readonly code:string, message='Помощник не завершил действие. Данные сохранены.', readonly status=503) {super(message);this.name='BusinessAiError';}
}
export const record = (value:unknown):value is Record<string,unknown> => value!==null && typeof value==='object' && !Array.isArray(value);
export const validUuid = (value:unknown):value is string => typeof value==='string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export interface ModelChoice {model:string;effort:string|null;}
/** The catalog is data, not permission to pick another model for the user. */
export function checkedModelChoice(selection:unknown,catalog:unknown):ModelChoice {
    if(!record(selection)||Object.keys(selection).some(key=>!['model','effort'].includes(key))
        ||typeof selection.model!=='string'||!selection.model.trim()||selection.model.length>200
        ||(selection.effort!==null&&typeof selection.effort!=='string')) throw new BusinessAiError('AI_PROFILE_INVALID',undefined,400);
    if(!Array.isArray(catalog)) throw new BusinessAiError('AI_UNAVAILABLE');
    const model=catalog.find(value=>record(value)&&value.model===selection.model&&value.hidden!==true);
    if(!record(model)) throw new BusinessAiError('AI_MODEL_UNAVAILABLE');
    if(selection.effort!==null && (!Array.isArray(model.supportedReasoningEfforts)
        || !model.supportedReasoningEfforts.some(value=>record(value)&&value.reasoningEffort===selection.effort))) {
        throw new BusinessAiError('AI_PROFILE_INVALID',undefined,400);
    }
    return {model:selection.model,effort:selection.effort as string|null};
}
