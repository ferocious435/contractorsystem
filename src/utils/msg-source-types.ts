export type MsgHeaders = {subject:string;from:string[];to:string[];cc:string[];bcc:string[];sentAt:string|null;sentAtRaw:string|null};
export type MsgBody = {text:string;textHash:string;complete:boolean;issues:string[]};
export type MsgPart = {
    id:string;parentId:string|null;kind:'MESSAGE'|'FILE'|'INLINE';name:string;mimeType:string|null;
    containerPath:string[];payloadHash:string|null;byteLength:number|null;contentId?:string;
    headers?:MsgHeaders;body?:MsgBody;issues:string[];
};
export type MsgPartReading = Omit<MsgPart,'body'> & {
    bodyTextHash:string|null;nativeComplete:boolean;unitIds:string[];textRanges:Array<{start:number;end:number}>;
    status:'READ'|'REQUIRES_REVIEW';
};
export type MsgInventoryPart = Pick<MsgPart,'id'|'parentId'|'kind'|'name'|'mimeType'|'containerPath'|'payloadHash'|'byteLength'> & {bodyTextHash:string|null};
export type MsgReadingProof = {version:'msg-source-v1';sourceHash:string;rootPartId:string;inventoryHash:string;inventory:MsgInventoryPart[];parts:MsgPartReading[];issues:string[];scope?:{ownerId:string;projectId:string;documentId:string;sourceHash:string}};
export type MsgLimits = {maxSourceBytes:number;maxPartBytes:number;maxTotalPartBytes:number;maxParts:number;maxDepth:number;timeoutMs:number;maxOutputBytes:number};
export type MsgReadOptions = {signal?:AbortSignal;limits?:Partial<MsgLimits>};
export type MsgExtraction = {sourceHash:string;rootPartId:string;inventoryHash:string;parts:MsgPart[];payloads:Map<string,Buffer>;issues:string[]};
export type MsgNativeResult = {headers:MsgHeaders;bodyText:string;issues:string[]};
export const MSG_DEFAULT_LIMITS:Readonly<MsgLimits> = Object.freeze({maxSourceBytes:32*1024*1024,maxPartBytes:32*1024*1024,maxTotalPartBytes:64*1024*1024,maxParts:128,maxDepth:4,timeoutMs:45_000,maxOutputBytes:64*1024*1024});
