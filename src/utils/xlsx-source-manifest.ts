import {createHash} from 'node:crypto';
import {extractXlsxSource} from './xlsx-source-extraction';
import {createRasterReadingUnits,sealImageManifest} from './raster-source-manifest';
import type {SourceManifest,ReadingUnit} from './visual-source-reading';

const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
export function isXlsxSource(file:Buffer,title:string):boolean {
    return /\.xlsx(?:$|[?#])/iu.test(title)||file.subarray(0,2).toString('ascii')==='PK'&&file.includes(Buffer.from('xl/workbook.xml'));
}
export async function buildXlsxSourceManifest(file:Buffer):Promise<SourceManifest>{
    const source=await extractXlsxSource(file),units:ReadingUnit[]=[],issues=[...source.issues];
    for(const image of source.images){
        const rendered=await createRasterReadingUnits(image.bytes,{kind:'XLSX_IMAGE',idPrefix:'xlsx:'+digest(image.bytes),locations:image.locations,contextText:image.contextText});
        units.push(...rendered.units);issues.push(...rendered.issues.map(issue=>image.locations[0].anchor+':'+issue));
    }
    return sealImageManifest({sourceHash:digest(file),format:'XLSX',nativeText:source.nativeText,
        nativeVerification:{version:'xlsx-source-v1',complete:issues.length===0,imageLocations:source.images.reduce((sum,image)=>sum+image.locations.length,0)},
        units,issues,assembly:[{kind:'native',text:source.nativeText},...units.map(unit=>({kind:'unit' as const,unitId:unit.id}))]});
}
