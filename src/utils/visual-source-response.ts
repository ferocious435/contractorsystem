import type {NumericCheck,ReadingUnit,UnitReading} from './visual-source-reading';

const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const visualSourceResponseSchema={type:'object',additionalProperties:false,required:['unitId','viewId','text','tables','visualDescription','uncertainties','contentRole','nonBlockingNotes'],properties:{
    unitId:{type:'string'},viewId:{type:'string'},text:{type:'string'},tables:{type:'array',items:{type:'array',items:{type:'array',items:{type:'string'}}}},
    visualDescription:{type:'string'},uncertainties:{type:'array',items:{type:'string'}},
    contentRole:{type:'string',enum:['CONTENT','BRANDING_ONLY','UNKNOWN']},nonBlockingNotes:{type:'array',items:{type:'string'}},
}};
export function validateUnitReading(raw:string,expected:ReadingUnit,viewId:string):UnitReading {
    if(Buffer.byteLength(raw,'utf8')>4*1024*1024)throw Error('Image reading response is too large');
    const value:unknown=JSON.parse(raw);
    const required=['unitId','viewId','text','tables','visualDescription','uncertainties'];
    if(!object(value)||!required.every(key=>Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,'contentRole','nonBlockingNotes'].includes(key))
        ||value.unitId!==expected.id||value.viewId!==viewId||!expected.views.some(view=>view.id===viewId)
        ||typeof value.text!=='string'||typeof value.visualDescription!=='string'||!Array.isArray(value.uncertainties)
        ||!value.uncertainties.every(v=>typeof v==='string')||!Array.isArray(value.tables)
        ||!value.tables.every(table=>Array.isArray(table)&&table.every(row=>Array.isArray(row)&&row.every(cell=>typeof cell==='string')))
        ||value.contentRole!==undefined&&!['CONTENT','BRANDING_ONLY','UNKNOWN'].includes(String(value.contentRole))
        ||value.nonBlockingNotes!==undefined&&(!Array.isArray(value.nonBlockingNotes)||!value.nonBlockingNotes.every(note=>typeof note==='string')))throw Error('Invalid image reading response');
    if(value.contentRole==='BRANDING_ONLY'){
        const view=expected.views.find(view=>view.id===viewId)!;
        if(expected.kind==='PDF_PAGE'||view.rect.x!==0||view.rect.y!==0||view.rect.width!==1||view.rect.height!==1
            ||value.text.trim()||value.tables.length||value.uncertainties.length||!value.visualDescription.trim())throw Error('Branding classification cannot hide substantive or uncertain source content');
    }
    return value as UnitReading;
}
const hasNumber=(value:string)=>/\p{N}/u.test(value);
const numberTokens=(value:string)=>value.match(/\p{N}+(?:[.,/]\p{N}+)*/gu)||[];
// Compare presentation consistently; keep the stored transcription, digits, signs and labels intact.
export const normalizeReadingTypography=(value:string)=>value.normalize('NFKC').replace(/[\u200e\u200f]/g,'').replace(/[\u05f4\u201c\u201d]/g,'"')
    .replace(/[\u05f3\u2018\u2019]/g,"'").replace(/\s+/g,' ').replace(/(?<=\p{L})\s*-\s*(?=\p{N})/gu,'-').replace(/\s*:\s*/g,':').trim();
const lineKey=normalizeReadingTypography;
function numericLineKey(line:string):string {
    // A complete postal/phone/fax footer is metadata. Keep every word, number and sign,
    // while comparing its punctuation and conventional Kiryat-prefix spelling consistently.
    if(/^(?:רח'|רחוב)\s/u.test(line)&&/ת\.\s*ד\./u.test(line)&&/טלפון\s+\d/u.test(line)
        &&/פקס\s+[+\d][\d -]*$/u.test(line)&&!/[₪$€£%<>=±]/u.test(line)){
        const tokens=line.replace(/(?<!\p{L})קריית(?=\s)/gu,'קרית').match(/\p{N}+(?:[.,/]\p{N}+)*|\p{L}+|[+−-]/gu)||[];
        return JSON.stringify({contactTokens:tokens});
    }
    return line;
}
const quoteStyleOnly=(note:string)=>/(?:кавыч|гершаим|gershayim|quotation|quote)/iu.test(note)
    &&!/(?:^|[^\p{L}])(?:букв|слов|текст|цифр|числ|номер|сумм|дата|диапазон|порядок|значен|подпис|штамп|количеств|нечита|неразборчив|letters?|words?|digits?|numbers?|amount|signature|stamp|unreadable|illegible|value|date)/iu.test(note);
const literalShape=(reading:UnitReading)=>JSON.stringify({text:lineKey(reading.text),tables:reading.tables.map(table=>table.map(row=>row.map(lineKey)))});
/** Font/codepoint ambiguity can be resolved only by a matching independent full reading.
 * Raw responses and their original uncertainty notes are never rewritten. */
export function unresolvedReadingUncertainties(reading:UnitReading,confirmation:UnitReading|null):string[]{
    if(!reading.uncertainties.length)return [];
    if(!confirmation||reading.unitId!==confirmation.unitId||!reading.uncertainties.every(quoteStyleOnly)
        ||!confirmation.uncertainties.every(quoteStyleOnly)||literalShape(reading)!==literalShape(confirmation)
        ||!compareNumericReadings(reading,confirmation).matched)return [...reading.uncertainties];
    return [];
}
function numericPositions(reading:UnitReading) {
    const positions:string[]=[];
    for(const [tableIndex,table] of reading.tables.entries())for(const [rowIndex,row] of table.entries()){
        if(!row.some(hasNumber))continue;
        // Include the row and column labels: equal sets of digits do not imply equal cells.
        positions.push(JSON.stringify({tableIndex,rowIndex,header:table[0].map(lineKey),cells:row.map(lineKey)}));
    }
    const literalNumbers=new Set(numberTokens([reading.text,...reading.tables.flat().flat()].join('\n')));
    for(const [field,text] of [['text',reading.text],['description',reading.visualDescription]]){
        const lines=text.split(/\r?\n/).map(lineKey).filter(Boolean);
        for(const [i,line] of lines.entries())if(hasNumber(line)){
            // A description may refer to item numbers already checked in the literal
            // transcript. Its wording is interpretation, never a second source quote.
            if(field==='description'&&numberTokens(line).every(number=>literalNumbers.has(number)))continue;
            positions.push(JSON.stringify({field,index:i,line:field==='text'?numericLineKey(line):line}));
        }
    }
    return positions;
}
export function compareNumericReadings(a:UnitReading,b:UnitReading):NumericCheck {
    const left=numericPositions(a),right=numericPositions(b),unresolved:string[]=[];
    for(let i=0;i<Math.max(left.length,right.length);i++)if(left[i]!==right[i])unresolved.push('Numeric position '+(i+1)+' differs');
    return {matched:unresolved.length===0,unresolved};
}
