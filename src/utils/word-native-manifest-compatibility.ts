import {createHash} from 'node:crypto';
import {matchesLegacyWordManifestHash} from './word-manifest-compatibility';
import {validReadingRect,type SourceManifest} from './visual-source-reading';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const views=(manifest:SourceManifest)=>manifest.units.map(u=>({...u,views:u.views.map(v=>({id:v.id,sha256:v.sha256,width:v.width,height:v.height,rect:v.rect}))}));
export function wordManifestDigest(manifest:SourceManifest):string {const {manifestHash,...value}=manifest;return hash(JSON.stringify({...value,units:views(manifest)}));}
const snapshots=new WeakMap<SourceManifest,{before:SourceManifest;currentHash:string}>();
const soundPixels=(manifest:SourceManifest)=>manifest.units.every(u=>u.views.every(v=>valid(v.sha256)&&hash(v.bytes)===v.sha256));
function projection(current:SourceManifest,before:SourceManifest):boolean{
    if(current.format!=='DOCX'||before.format!=='DOCX'||!valid(current.sourceHash)||current.sourceHash!==before.sourceHash
        ||current.manifestHash!==wordManifestDigest(current)||before.manifestHash!==wordManifestDigest(before))return false;
    const previous=views(before),now=views(current),added=current.units.slice(before.units.length);
    if(!added.length||new Set(current.units.map(u=>u.id)).size!==current.units.length||JSON.stringify(now.slice(0,previous.length))!==JSON.stringify(previous))return false;
    if(added.some(u=>!u.id.startsWith('docx-region:')||u.kind!=='DOCX_IMAGE'||u.locations.length!==1||u.locations.some(location=>{
        const proof=location.wordLayoutProof;return !proof||proof.version!=='native-word-source-removal-v1'||proof.sourceHash!==current.sourceHash
            ||!valid(proof.visibleHash)||!valid(proof.original.sha256)||!valid(proof.removed.sha256)||proof.original.sha256===proof.removed.sha256
            ||!location.sourceRect||!validReadingRect(location.sourceRect)||!validReadingRect(proof.rect)||proof.page!==location.page;
    })))return false;
    const prior=current.nativeVerification as {issues?:unknown;[key:string]:unknown}|null,old=before.nativeVerification as {issues?:unknown;[key:string]:unknown}|null;
    if(!prior||!old||prior.version!=='docx-image-coverage-v1'||old.version!=='docx-image-coverage-v1'||prior.sourceHash!==current.sourceHash||old.sourceHash!==current.sourceHash)return false;
    const {issues:_a,...nativeNow}=prior,{issues:_b,...nativeBefore}=old;
    if(JSON.stringify(nativeNow)!==JSON.stringify(nativeBefore)||!Array.isArray(prior.issues)||!Array.isArray(old.issues))return false;
    const remaining=prior.issues;const resolved=old.issues.filter((reason):reason is string=>typeof reason==='string'&&!remaining.includes(reason));
    if(resolved.some(reason=>!added.some(u=>u.locations.some(l=>reason===l.part+':UNSUPPORTED_PICT'||reason===l.part+':DRAWING_TEXT_LAYOUT_UNVERIFIED'))))return false;
    const removeResolved=(text:string)=>resolved.reduce((value,reason)=>value.replaceAll(`[DOCX_ISSUE ${reason}]`,''),text);
    if(removeResolved(before.nativeText)!==current.nativeText)return false;
    const ids=new Set(added.map(u=>u.id)),assembly=current.assembly.filter(p=>p.kind!=='unit'||!ids.has(p.unitId));
    const expected=before.assembly.map(p=>p.kind==='native'?{...p,text:removeResolved(p.text)}:p);
    return JSON.stringify(assembly)===JSON.stringify(expected);
}
/** Server-only capability: remember the freshly rebuilt pre-native result, never an incoming list of accepted hashes. */
export function bindPreviousNativeWordManifest(current:SourceManifest,before:SourceManifest):void{
    if(!projection(current,before)||!soundPixels(current)||!soundPixels(before))return;
    const copy=structuredClone(before);for(const u of copy.units)for(const v of u.views)v.bytes=new Uint8Array();snapshots.set(current,{before:copy,currentHash:current.manifestHash});
}
/** This is only a retained-unit gate. It must never authorize a cached full document. */
export function matchesPreviousNativeWordManifestHash(current:SourceManifest,previousHash:unknown):boolean{
    if(!valid(previousHash))return false;const saved=snapshots.get(current),before=saved?.before;
    return Boolean(saved&&before&&current.manifestHash===saved.currentHash&&projection(current,before)&&soundPixels(current)&&(previousHash===before.manifestHash||matchesLegacyWordManifestHash(before,previousHash)));
}

/** Read-only audit metadata from the same server pass; serialization never carries the capability. */
export function previousNativeWordManifestSnapshot(current:SourceManifest):SourceManifest|null{
    const saved=snapshots.get(current);return saved&&current.manifestHash===saved.currentHash&&projection(current,saved.before)&&soundPixels(current)?structuredClone(saved.before):null;
}
