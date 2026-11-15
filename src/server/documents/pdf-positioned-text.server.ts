import 'server-only';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeReadingTypography} from '@/utils/visual-source-response';
import {validReadingRect,type Rect} from '@/utils/visual-source-reading';
import type {FragmentValue, PositionedLine, PositionedDifference} from '@/utils/visual-fragment-contracts';

/** Work in the same rotated crop-box viewport as the displayed PDF. Text items
 * are proposals only. An independent reading of these pixels is mandatory. */
export async function readPositionedPdfLines(file:Buffer,page:number):Promise<PositionedLine[]> {
    if(!Number.isSafeInteger(page)||page<1)throw Error('Invalid PDF page');
    const {createRequire}=await import(/* webpackIgnore: true */ 'node:module');
    const runtime=createRequire(path.join(process.cwd(),'package.json'));
    const parser=createRequire(runtime.resolve('pdf-parse'));
    const pdf=await import(/* webpackIgnore: true */ pathToFileURL(parser.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href) as typeof import('pdfjs-dist');
    const task=pdf.getDocument({data:Uint8Array.from(file),isEvalSupported:false,useSystemFonts:false});
    try{
        const document=await task.promise, source=await document.getPage(page);
        const viewport=source.getViewport({scale:1}), content=await source.getTextContent(), lines:PositionedLine[]=[];
        for(const [objectIndex,item] of content.items.entries()){
            if(!('str' in item)||!item.str.trim()||item.dir==='ttb')continue;
            const [a,b,c,d,x,y]=item.transform,baseline=Math.hypot(a,b),height=Math.hypot(c,d);
            if(!baseline||!height||!item.width)continue;
            const style=content.styles[item.fontName],ascent=style?.ascent??0.85,descent=style?.descent??-0.2;
            const points=[0,item.width].flatMap(offset=>[descent,ascent].map(vertical=>
                viewport.convertToViewportPoint(x+a/baseline*offset+c*vertical,y+b/baseline*offset+d*vertical)));
            const xs=points.map(p=>p[0]/viewport.width),ys=points.map(p=>p[1]/viewport.height);
            const left=Math.min(...xs),top=Math.min(...ys);
            const rect={x:left,y:top,width:Math.max(...xs)-left,height:Math.max(...ys)-top};
            if(validReadingRect(rect))lines.push({text:item.str,rect,objectIndex,rotation:viewport.rotation});
        }
        return lines;
    }finally{await task.destroy();}
}
const tokens=(text:string)=>normalizeReadingTypography(text).match(/[\p{L}\p{M}\p{N}]+|[^\s]/gu)??[];
const inside=(inner:Rect,outer:Rect)=>inner.x>=outer.x-1e-8&&inner.y>=outer.y-1e-8&&inner.x+inner.width<=outer.x+outer.width+1e-8&&inner.y+inner.height<=outer.y+outer.height+1e-8;
const intersects=(a:Rect,b:Rect)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>0.0001&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>0.0001;

/** Identify exactly one printed run spanning the disagreement and its context.
 * Search the whole sheet for both alternatives before narrowing to the row. */
export function findPositionedDifference(first:FragmentValue,second:FragmentValue,lines:PositionedLine[],region:Rect):PositionedDifference|null {
    if(typeof first!==typeof second||!validReadingRect(region))return null;
    const one=typeof first==='string'?[first]:first,two=typeof second==='string'?[second]:second;
    if(one.length!==two.length)return null;
    const differences=one.flatMap((s,i)=>normalizeReadingTypography(s)===normalizeReadingTypography(two[i])?[]:[i]);
    if(differences.length!==1)return null;
    const cell=differences[0],a=tokens(one[cell]),b=tokens(two[cell]);
    if(a.length!==b.length)return null;
    const indices=a.flatMap((word,i)=>word===b[i]?[]:[i]);if(indices.length!==1)return null;
    const at=indices[0],matches:PositionedDifference[]=[];
    for(const line of lines){
        const run=tokens(line.text);if(run.length<3)continue;
        for(const [choice,words] of [a,b].entries()){
            for(let i=Math.max(0,at-run.length+1);i<=Math.min(at,words.length-run.length);i++){
                if(run.every((word,j)=>words[i+j]===word))matches.push({line,choice:choice as 0|1,cell});
            }
        }
    }
    if(matches.length!==1)return null;
    const match=matches[0];
    if(!inside(match.line.rect,region)||lines.some(line=>line!==match.line&&intersects(line.rect,match.line.rect)))return null;
    return match;
}
export function confirmPositionedReading(match:PositionedDifference,visible:unknown):boolean {
    if(!visible||typeof visible!=='object'||!('text' in visible)||typeof visible.text!=='string'||!('uncertainties' in visible)||!Array.isArray(visible.uncertainties)||visible.uncertainties.length)return false;
    return normalizeReadingTypography(visible.text)===normalizeReadingTypography(match.line.text);
}
