import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,realpath,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {BusinessAiError,record,validUuid} from './contracts';
import {VISUAL_READING_RULES,validReadingHash,type ReadingScope,type ReadingUnit,type UnitReading,type VerifiedUnit} from '@/utils/visual-source-reading';
import {validateUnitReading,compareNumericReadings} from '@/utils/visual-source-response';
import {hasDocumentBodyText,hasRenderedEmptyPageProof} from '@/utils/document-source-readiness';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
/** Walk before creating each directory; recursive mkdir must not follow an unverified junction. */
export async function checkedReadingDirectory(root:string,directory:string,create=false):Promise<boolean> {
    const absolute=path.resolve(directory),base=path.resolve(root);
    if(absolute!==base&&!absolute.startsWith(base+path.sep))throw new BusinessAiError('AI_POLICY_UNSAFE');
    let cursor=path.parse(absolute).root,canonicalBase:string|undefined;
    for(const segment of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){
        cursor=path.join(cursor,segment);
        let info;try{info=await lstat(cursor);}catch(error){
            if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
            if(!create)return false;
            try{await mkdir(cursor,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
            info=await lstat(cursor);
        }
        if(!info.isDirectory()||info.isSymbolicLink())throw new BusinessAiError('AI_POLICY_UNSAFE');
        const actual=await realpath(cursor);
        // Windows packaged apps redirect LocalAppData without a filesystem symlink.
        // Bind the real root once, then require every owned descendant to stay beneath it.
        if(samePath(cursor,base))canonicalBase=actual;
        else if(canonicalBase&&!samePath(actual,path.join(canonicalBase,path.relative(base,cursor))))throw new BusinessAiError('AI_POLICY_UNSAFE');
    }
    return true;
}
export function unitReadingLiteral(reading:UnitReading):string {
    const tables=reading.tables.map(table=>table.map(row=>'| '+row.join(' | ')+' |').join('\n')).filter(Boolean);
    return [reading.text,...tables].filter(Boolean).join('\n\n');
}
export const unitHasNumbers=(reading:UnitReading)=>/\p{N}/u.test(unitReadingLiteral(reading)+'\n'+reading.visualDescription);
export function readingUnitInputHash(unit:ReadingUnit):string {
    for(const view of unit.views)if(digest(view.bytes)!==view.sha256)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
    return digest(JSON.stringify({rulesVersion:VISUAL_READING_RULES,id:unit.id,kind:unit.kind,locations:unit.locations,contextText:unit.contextText,localText:unit.localText,
        localMethod:unit.localMethod??null,emptyPageProof:unit.emptyPageProof??null,views:unit.views.map(v=>({id:v.id,sha256:v.sha256,width:v.width,height:v.height,rect:v.rect}))}));
}
export function verifiedReadingUnit(value:unknown,unit:ReadingUnit):boolean {
    if(!record(value)||value.unitId!==unit.id||value.inputHash!==readingUnitInputHash(unit)||typeof value.text!=='string'||value.textHash!==digest(value.text)
        ||value.complete!==true||!Array.isArray(value.uncertainties)||value.uncertainties.length||!Array.isArray(value.views)||value.views.length!==unit.views.length
        ||typeof value.visualDescription!=='string'||!Array.isArray(value.tables))return false;
    for(const view of unit.views){
        const proofs=value.views.filter(p=>record(p)&&p.viewId===view.id),proof=proofs[0];
        if(proofs.length!==1||!record(proof)||proof.imageHash!==view.sha256||!record(proof.reading))return false;
        const readingViewId=proof.reading.viewId;
        const readView=unit.views.find(v=>v.id===readingViewId&&JSON.stringify(v.rect)===JSON.stringify(view.rect));
        if(!readView)return false;
        let reading:UnitReading;try{reading=validateUnitReading(JSON.stringify(proof.reading),unit,readView.id);}catch{return false;}
        if(reading.uncertainties.length||proof.textHash!==digest(unitReadingLiteral(reading)))return false;
        if(proof.method==='physical-empty'){
            const page=unit.locations[0]?.page;
            if(!page||!record(proof.emptyPageProof)||proof.emptyPageProof.imageSha256!==view.sha256
                ||!hasRenderedEmptyPageProof({page,text:reading.text,confidence:0,emptyPageProof:proof.emptyPageProof as never}))return false;
        }else if(proof.method==='no-numbers'){
            if(unitHasNumbers(reading)||proof.confirmationHash!==proof.textHash)return false;
            if(proof.initialReading){try{const initial=validateUnitReading(JSON.stringify(proof.initialReading),unit,view.id);if(unitHasNumbers(initial))return false;}catch{return false;}}
        }else{
            if(!['native-match','local-ocr-match','visual-double-pass'].includes(String(proof.method))||!record(proof.confirmation))return false;
            const confirmation=proof.confirmation as unknown as UnitReading;
            // A blind enlargement has the same source region and id, even when its pixel hash differs.
            try{validateUnitReading(JSON.stringify(confirmation),unit,confirmation.viewId);}catch{return false;}
            if(confirmation.uncertainties.length||proof.confirmationHash!==digest(unitReadingLiteral(confirmation))||!compareNumericReadings(reading,confirmation).matched)return false;
            if(proof.method!=='visual-double-pass'&&confirmation.text!==unit.localText)return false;
        }
    }
    const full=unit.views.filter(v=>v.rect.x===0&&v.rect.y===0&&v.rect.width===1&&v.rect.height===1).sort((a,b)=>b.width*b.height-a.width*a.height);
    const primaryId=full[0]?.id??unit.views[0]?.id,primary=value.views.find(p=>record(p)&&p.viewId===primaryId);
    if(!record(primary)||!record(primary.reading)||value.text!==unitReadingLiteral(primary.reading as unknown as UnitReading)
        ||JSON.stringify(value.tables)!==JSON.stringify(primary.reading.tables))return false;
    return Boolean(hasDocumentBodyText(value.text)||value.visualDescription.trim()||value.views.every(p=>record(p)&&p.method==='physical-empty'));
}
/** Recheck retained blind reads after a verifier correction. A model uncertainty
 * needs a retained clear pair for that exact region; unrelated issues stay open. */
export function reverifySavedNumericUnit(value:unknown,unit:ReadingUnit):VerifiedUnit|null {
    if(!record(value)||value.complete!==false||!Array.isArray(value.uncertainties)||!value.uncertainties.length
        ||!value.uncertainties.every(reason=>typeof reason==='string')||!Array.isArray(value.views)
        ||!record(value.createdBy)||!validUuid(value.createdBy.jobId)||value.createdBy.rulesVersion!==VISUAL_READING_RULES
        ||!Number.isSafeInteger(value.createdBy.profileRevision)||(value.createdBy.profileRevision as number)<1)return null;
    const checked={...structuredClone(value),complete:true,uncertainties:[]} as unknown as VerifiedUnit;
    if(!value.uncertainties.every(reason=>reason.startsWith('Numeric or source verification failed: '))){
        try{
            const pairs=new Map<string,VerifiedUnit['views'][number]>(),known=new Set<string>();
            const sourceView=(reading:UnitReading)=>unit.views.find(view=>view.id===reading.viewId);
            const sameRegion=(a:RenderedSourceView,b:RenderedSourceView)=>JSON.stringify(a.rect)===JSON.stringify(b.rect);
            type RenderedSourceView=ReadingUnit['views'][number];
            for(const proof of checked.views){
                if(!record(proof)||!record(proof.reading))return null;
                const reading=validateUnitReading(JSON.stringify(proof.reading),unit,proof.reading.viewId),target=unit.views.find(view=>view.id===proof.viewId),original=sourceView(reading);
                if(!target||!original||!sameRegion(target,original))return null;
                for(const reason of reading.uncertainties)known.add(reason);
                const confirmation=proof.confirmation?validateUnitReading(JSON.stringify(proof.confirmation),unit,proof.confirmation.viewId):null;
                for(const reason of confirmation?.uncertainties??[])known.add(reason);
                if(proof.method!=='visual-double-pass'||reading.uncertainties.length||!confirmation||confirmation.uncertainties.length||!unitHasNumbers(reading)||!proof.initialReading)continue;
                const initial=validateUnitReading(JSON.stringify(proof.initialReading),unit,proof.initialReading.viewId),witness=sourceView(confirmation),initialView=sourceView(initial);
                const exactImage=(image:VerifiedUnit['views'][number]['readingImage'],view:RenderedSourceView)=>image?.sha256===view.sha256&&image.width===view.width&&image.height===view.height&&JSON.stringify(image.rect)===JSON.stringify(view.rect);
                if(!initial.uncertainties.length||!witness||!initialView||!sameRegion(target,witness)||!sameRegion(target,initialView)
                    ||!exactImage(proof.readingImage,original)||!exactImage(proof.confirmationImage,witness)||!compareNumericReadings(reading,confirmation).matched)continue;
                const key=JSON.stringify(target.rect),previous=pairs.get(key);if(previous&&!compareNumericReadings(previous.reading,reading).matched)return null;pairs.set(key,proof);
            }
            if(!pairs.size||value.uncertainties.some(reason=>!reason.startsWith('Numeric or source verification failed: ')&&!known.has(reason)))return null;
            for(const proof of checked.views){
                const target=unit.views.find(view=>view.id===proof.viewId)!,pair=pairs.get(JSON.stringify(target.rect));if(!pair)continue;
                const initial=proof.initialReading??(proof.reading.uncertainties.length?proof.reading:proof.confirmation?.uncertainties.length?proof.confirmation:undefined);
                Object.assign(proof,{reading:pair.reading,confirmation:pair.confirmation,textHash:pair.textHash,confirmationHash:pair.confirmationHash,method:'visual-double-pass',
                    readingImage:pair.readingImage,confirmationImage:pair.confirmationImage,...(initial?{initialReading:initial}:{})});
            }
        }catch{return null;}
    }
    return verifiedReadingUnit(checked,unit)?checked:null;
}
function checkedScope(scope:ReadingScope) {
    if(!validUuid(scope.ownerId)||!validUuid(scope.projectId)||!validUuid(scope.documentId)||!validReadingHash(scope.sourceHash))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
}
export function createVisualReadingCache(root:string) {
    if(!path.isAbsolute(root))throw new BusinessAiError('AI_POLICY_UNSAFE');
    const absolute=path.resolve(root),maxBytes=32*1024*1024;
    function filename(scope:ReadingScope,unit:ReadingUnit){checkedScope(scope);return path.join(absolute,'reading-cache',scope.ownerId,scope.projectId,scope.documentId,scope.sourceHash,VISUAL_READING_RULES,readingUnitInputHash(unit)+'.json');}
    return {
        async read(scope:ReadingScope,unit:ReadingUnit):Promise<VerifiedUnit|null>{
            const file=filename(scope,unit);if(!await checkedReadingDirectory(absolute,path.dirname(file)))return null;
            try{
                const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>maxBytes||!samePath(await realpath(file),path.join(await realpath(path.dirname(file)),path.basename(file))))return null;
                const payload:unknown=JSON.parse(await readFile(file,'utf8'));
                if(!record(payload)||!record(payload.scope))return null;
                const savedScope=payload.scope;
                if(payload.version!=='visual-unit-cache-v2'||!['ownerId','projectId','documentId','sourceHash'].every(k=>savedScope[k]===scope[k as keyof ReadingScope])
                    ||payload.inputHash!==readingUnitInputHash(unit)||payload.payloadHash!==digest(JSON.stringify(payload.unit))||!verifiedReadingUnit(payload.unit,unit))return null;
                return payload.unit as VerifiedUnit;
            }catch(error){if(error instanceof BusinessAiError)throw error;return null;}
        },
        async write(scope:ReadingScope,unit:ReadingUnit,result:VerifiedUnit):Promise<void>{
            const file=filename(scope,unit);
            if(!verifiedReadingUnit(result,unit))throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
            const payload=JSON.stringify({version:'visual-unit-cache-v2',scope:{ownerId:scope.ownerId,projectId:scope.projectId,documentId:scope.documentId,sourceHash:scope.sourceHash},inputHash:readingUnitInputHash(unit),unit:result,payloadHash:digest(JSON.stringify(result))});
            if(Buffer.byteLength(payload)>maxBytes)throw new BusinessAiError('AI_RESPONSE_TOO_LARGE');
            await checkedReadingDirectory(absolute,path.dirname(file),true);
            const temporary=file+'.'+randomUUID()+'.tmp';
            try{await writeFile(temporary,payload,{flag:'wx',mode:0o600});await checkedReadingDirectory(absolute,path.dirname(file));await rename(temporary,file);}
            finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
        },
    };
}
