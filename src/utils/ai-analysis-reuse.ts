import {createHash} from 'node:crypto';
import {record,validUuid,type JsonObject} from '@/server/ai/contracts';
import {assessDocumentSourceReadiness} from './document-source-readiness';
import {buildScanMemorySignature} from './document-scan-memory';
import observations from '@/server/ai/historical-identities.json' with {type:'json'};

/** Evidence for old key reconstruction only; generation reads the owner's frozen execution profile. */
export const observedHistoricalIdentities:readonly JsonObject[]=Object.freeze(observations.identities.map(value=>Object.freeze({...value})));

function canonical(value:unknown):string {
    if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(record(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    throw new Error('Incomplete analysis inputs');
}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const analysisContextFingerprint=(context:JsonObject):string=>digest(canonical(context));
/** context contains every current source, relation and rules version, from counted server reads.
 * historicalContextHash is supplied only after validating a stored historical packet signature
 * or a previously recorded full context. A title, date or COMPLETED label never supplies this proof.
 * material reconstructs the exact old encoding; it cannot weaken the separate full-context check.
 */
function ready(inputs:JsonObject):boolean {
    const context=inputs.context;if(!record(context)||!validUuid(context.projectId)||typeof context.rulesVersion!=='string'||!context.rulesVersion
        ||!Array.isArray(context.documents)||!context.documents.length||!Array.isArray(context.relatedDocuments)||!Array.isArray(context.relations))return false;
    return [...context.documents,...context.relatedDocuments].every(document=>record(document)&&typeof document.id==='string'&&assessDocumentSourceReadiness(document).canCompare);
}
function identity(value:unknown):value is JsonObject {return record(value)&&['kind','provider','model'].every(key=>typeof value[key]==='string'&&Boolean(value[key]));}
function fullKey(inputs:JsonObject,aiIdentity:JsonObject):string {return digest(canonical({version:'ai-analysis-reuse-v1',context:inputs.context,material:inputs.material,identity:aiIdentity}));}
function legacyKey(inputs:JsonObject,aiIdentity:JsonObject):string|null {
    if(inputs.historicalContextHash!==analysisContextFingerprint(inputs.context as JsonObject)||!record(inputs.material))return null;
    const material=inputs.material;
    if(material.format==='json-identity'&&record(material.before)&&record(material.after)&&!Object.hasOwn(material.before,'identity')&&!Object.hasOwn(material.after,'identity'))return digest(JSON.stringify({...material.before,identity:aiIdentity,...material.after}));
    if(material.format==='scan-memory'&&record(material.fields)&&['engineVersion','projectId','contractFingerprint','workFingerprint','relatedWorkFingerprint'].every(key=>typeof material.fields==='object'&&material.fields!==null&&typeof (material.fields as JsonObject)[key]==='string')){
        const fields=material.fields as Record<string,string>;
        return buildScanMemorySignature({engineVersion:fields.engineVersion,projectId:fields.projectId,contractFingerprint:fields.contractFingerprint,workFingerprint:fields.workFingerprint,relatedWorkFingerprint:fields.relatedWorkFingerprint,aiIdentity:aiIdentity.provider+':'+aiIdentity.model});
    }
    return null;
}
export function reusableAnalysisKeys(inputs:JsonObject,currentIdentity:JsonObject,observedHistoricalIdentities:readonly JsonObject[]):string[] {
    try{if(!ready(inputs)||!identity(currentIdentity)||!record(inputs.material))return [];
        const previous=observedHistoricalIdentities.filter(identity);
        return [...new Set([fullKey(inputs,currentIdentity),...previous.map(value=>fullKey(inputs,value)),...previous.map(value=>legacyKey(inputs,value)).filter((key):key is string=>key!==null)])];
    }catch{return [];}
}
/** Read-only lookup. Every hit still passes its existing subject/structure/quote validator. */
export function findReusableAnalysis<T>(cache:Readonly<Record<string,unknown>>,inputs:JsonObject,currentIdentity:JsonObject,observedHistoricalIdentities:readonly JsonObject[],validate:(value:unknown)=>value is T):T|null;
export function findReusableAnalysis(cache:Readonly<Record<string,unknown>>,inputs:JsonObject,currentIdentity:JsonObject,observedHistoricalIdentities:readonly JsonObject[],validate:(value:unknown)=>boolean):unknown|null;
export function findReusableAnalysis(cache:Readonly<Record<string,unknown>>,inputs:JsonObject,currentIdentity:JsonObject,observedHistoricalIdentities:readonly JsonObject[],validate:(value:unknown)=>boolean):unknown|null {
    const keys=reusableAnalysisKeys(inputs,currentIdentity,observedHistoricalIdentities);if(!keys.length)return null;
    const contextHash=analysisContextFingerprint(inputs.context as JsonObject),legacy=new Set(observedHistoricalIdentities.filter(identity).map(value=>legacyKey(inputs,value)).filter(Boolean));
    for(const key of keys){const saved=cache[key];let value:unknown;
        if(record(saved)&&saved.version==='verified-analysis-v1'&&saved.contextHash===contextHash)value=saved.value;
        else if(legacy.has(key)&&inputs.historicalContextHash===contextHash)value=saved;
        else continue;
        try{if(validate(value))return value;}catch{/* A malformed cached result never grants reuse. */}
    }
    return null;
}
