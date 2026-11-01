import type {NumericCheck,ReadingUnit,UnitReading} from './visual-source-reading';

const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const visualSourceResponseSchema={type:'object',additionalProperties:false,required:['unitId','viewId','text','tables','visualDescription','uncertainties'],properties:{
    unitId:{type:'string'},viewId:{type:'string'},text:{type:'string'},tables:{type:'array',items:{type:'array',items:{type:'array',items:{type:'string'}}}},
    visualDescription:{type:'string'},uncertainties:{type:'array',items:{type:'string'}},
}};
export function validateUnitReading(raw:string,expected:ReadingUnit,viewId:string):UnitReading {
    if(Buffer.byteLength(raw,'utf8')>4*1024*1024)throw Error('Image reading response is too large');
    const value:unknown=JSON.parse(raw);
    if(!object(value)||Object.keys(value).sort().join('|')!==['unitId','viewId','text','tables','visualDescription','uncertainties'].sort().join('|')
        ||value.unitId!==expected.id||value.viewId!==viewId||!expected.views.some(view=>view.id===viewId)
        ||typeof value.text!=='string'||typeof value.visualDescription!=='string'||!Array.isArray(value.uncertainties)
        ||!value.uncertainties.every(v=>typeof v==='string')||!Array.isArray(value.tables)
        ||!value.tables.every(table=>Array.isArray(table)&&table.every(row=>Array.isArray(row)&&row.every(cell=>typeof cell==='string'))))throw Error('Invalid image reading response');
    return value as UnitReading;
}
const hasNumber=(value:string)=>/\d/u.test(value);
const lineKey=(value:string)=>value.normalize('NFKC').replace(/[\u200e\u200f]/g,'').replace(/\s+/g,' ').trim();
function numericPositions(reading:UnitReading) {
    const positions:string[]=[];
    for(const [tableIndex,table] of reading.tables.entries())for(const [rowIndex,row] of table.entries()){
        if(!row.some(hasNumber))continue;
        // Include the row and column labels: equal sets of digits do not imply equal cells.
        positions.push(JSON.stringify({tableIndex,rowIndex,header:table[0].map(lineKey),cells:row.map(lineKey)}));
    }
    for(const [field,text] of [['text',reading.text],['description',reading.visualDescription]]){
        const lines=text.split(/\r?\n/).map(lineKey).filter(Boolean);
        for(const [i,line] of lines.entries())if(hasNumber(line))positions.push(JSON.stringify({field,index:i,line}));
    }
    return positions;
}
export function compareNumericReadings(a:UnitReading,b:UnitReading):NumericCheck {
    const left=numericPositions(a),right=numericPositions(b),unresolved:string[]=[];
    for(let i=0;i<Math.max(left.length,right.length);i++)if(left[i]!==right[i])unresolved.push('Numeric position '+(i+1)+' differs');
    return {matched:unresolved.length===0,unresolved};
}
